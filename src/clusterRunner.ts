import cluster, { type Worker } from 'node:cluster';
import { availableParallelism } from 'node:os';

const RESTART_DELAY_MS = 1_000;
const RESTART_WINDOW_MS = 60_000;
const RESTARTS_PER_WORKER = 5;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

type ShutdownSignal = 'SIGTERM' | 'SIGINT';
type EmitEvent = (event: ClusterEvent) => void;

export type ClusterWorkerCount = 'auto' | number;

export interface ClusterEvent {
  type: 'primary:start' | 'worker:exit' | 'cluster:shutdown' | 'cluster:error';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface RunClusterOptions {
  /** Number of workers, or the host's available parallelism. Default: `auto`. */
  workers?: ClusterWorkerCount;
  /** Maximum time workers get to stop after a shutdown signal. Default: 30 seconds. */
  shutdownTimeoutMs?: number;
  /** Receives early lifecycle events before the application logger exists. */
  onEvent?(event: ClusterEvent): void;
}

function defaultEventHandler(event: ClusterEvent): void {
  const write =
    event.level === 'error'
      ? console.error
      : event.level === 'warn'
        ? console.warn
        : console.log;
  write(event.message);
}

function createEmitter(handler = defaultEventHandler): EmitEvent {
  return (event) => {
    try {
      handler(event);
    } catch (error) {
      console.error('Cluster onEvent callback failed:', error);
    }
  };
}

function resolveOptions(options: RunClusterOptions): {
  workers: number;
  shutdownTimeoutMs: number;
} {
  const workersOption = options.workers ?? 'auto';
  const workers =
    workersOption === 'auto' ? availableParallelism() : workersOption;
  if (!Number.isInteger(workers) || workers < 1) {
    throw new RangeError('workers must be `auto` or a positive integer');
  }

  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
    throw new RangeError('shutdownTimeoutMs must be a finite number >= 1');
  }
  return { workers, shutdownTimeoutMs };
}

/** Run `startWorker` only in Node cluster workers; the primary supervises them. */
export async function runCluster(
  startWorker: () => void | Promise<void>,
  options: RunClusterOptions = {},
): Promise<void> {
  const resolved = resolveOptions(options);
  if (!cluster.isPrimary) {
    await startWorker();
    return;
  }

  await supervisePrimary(
    resolved.workers,
    resolved.shutdownTimeoutMs,
    createEmitter(options.onEvent),
  );
}

function supervisePrimary(
  workerCount: number,
  shutdownTimeoutMs: number,
  emit: EmitEvent,
): Promise<void> {
  return new Promise((resolve) => {
    const activeWorkers = new Map<number, Worker>();
    const restartTimers = new Set<NodeJS.Timeout>();
    let restartTimes: number[] = [];
    let shutdownTimer: NodeJS.Timeout | undefined;
    let shutdownSignal: ShutdownSignal | undefined;
    let shuttingDown = false;
    let exitCode = 0;
    let finished = false;

    const onSigterm = () => beginShutdown('SIGTERM', 0);
    const onSigint = () => beginShutdown('SIGINT', 0);
    const report = (
      type: ClusterEvent['type'],
      level: ClusterEvent['level'],
      message: string,
    ) => emit({ type, level, message });

    function finish(): void {
      if (finished) {
        return;
      }
      finished = true;
      cluster.off('exit', onWorkerExit);
      process.off('SIGTERM', onSigterm);
      process.off('SIGINT', onSigint);
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
      for (const timer of restartTimers) {
        clearTimeout(timer);
      }
      restartTimers.clear();
      process.exitCode = exitCode;
      resolve();
    }

    function finishIfIdle(): void {
      if (activeWorkers.size === 0 && restartTimers.size === 0) {
        finish();
      }
    }

    function signalWorker(worker: Worker, signal: NodeJS.Signals): void {
      try {
        worker.kill(signal);
      } catch (error) {
        report(
          'cluster:error',
          'error',
          `Could not send ${signal} to worker ${worker.process.pid ?? worker.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    function beginShutdown(signal: ShutdownSignal, code: number): void {
      exitCode = Math.max(exitCode, code);
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      shutdownSignal = signal;
      report(
        'cluster:shutdown',
        code === 0 ? 'info' : 'error',
        `Cluster shutting down with ${signal}.`,
      );

      for (const timer of restartTimers) {
        clearTimeout(timer);
      }
      restartTimers.clear();
      if (activeWorkers.size === 0) {
        finish();
        return;
      }

      shutdownTimer = setTimeout(() => {
        shutdownTimer = undefined;
        if (activeWorkers.size === 0) {
          finishIfIdle();
          return;
        }
        exitCode = 1;
        report(
          'cluster:error',
          'error',
          `Cluster shutdown timed out after ${shutdownTimeoutMs}ms; force-terminating ${activeWorkers.size} worker(s).`,
        );
        for (const worker of activeWorkers.values()) {
          signalWorker(worker, 'SIGKILL');
        }
      }, shutdownTimeoutMs);

      for (const worker of activeWorkers.values()) {
        signalWorker(worker, signal);
      }
    }

    function forkWorker(): void {
      if (shuttingDown) {
        return;
      }
      try {
        const worker = cluster.fork();
        activeWorkers.set(worker.id, worker);
      } catch (error) {
        report(
          'cluster:error',
          'error',
          `Failed to fork cluster worker: ${error instanceof Error ? error.message : String(error)}`,
        );
        beginShutdown('SIGTERM', 1);
      }
    }

    function scheduleRestart(): void {
      const timer = setTimeout(() => {
        restartTimers.delete(timer);
        forkWorker();
        finishIfIdle();
      }, RESTART_DELAY_MS);
      restartTimers.add(timer);
    }

    function onWorkerExit(
      worker: Worker,
      code: number,
      rawSignal: string | null,
    ): void {
      const signal = rawSignal as NodeJS.Signals | null;
      activeWorkers.delete(worker.id);
      if (shuttingDown) {
        if (code !== 0 || (signal && signal !== shutdownSignal)) {
          exitCode = 1;
        }
        finishIfIdle();
        return;
      }

      if (code === 0 && !signal) {
        report(
          'worker:exit',
          'info',
          `Worker ${worker.process.pid ?? worker.id} exited cleanly; it will not be restarted.`,
        );
        finishIfIdle();
        return;
      }

      const now = Date.now();
      restartTimes = restartTimes.filter(
        (time) => now - time < RESTART_WINDOW_MS,
      );
      const restartLimit = workerCount * RESTARTS_PER_WORKER;
      if (restartTimes.length >= restartLimit) {
        report(
          'cluster:error',
          'error',
          `Cluster exceeded its restart limit (${restartLimit} in ${RESTART_WINDOW_MS}ms).`,
        );
        beginShutdown('SIGTERM', 1);
        return;
      }

      restartTimes.push(now);
      report(
        'worker:exit',
        'warn',
        `Worker ${worker.process.pid ?? worker.id} exited abnormally (${signal ?? `code ${code}`}); restarting in ${RESTART_DELAY_MS}ms.`,
      );
      scheduleRestart();
    }

    cluster.on('exit', onWorkerExit);
    process.once('SIGTERM', onSigterm);
    process.once('SIGINT', onSigint);
    report(
      'primary:start',
      'info',
      `Cluster primary ${process.pid} starting ${workerCount} worker(s).`,
    );
    for (let index = 0; index < workerCount; index += 1) {
      forkWorker();
    }
    finishIfIdle();
  });
}
