import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClusterEvent, runCluster } from './clusterRunner.ts';

interface FakeWorker {
  id: number;
  process: { pid: number };
  kill: ReturnType<typeof vi.fn>;
}

type ExitListener = (
  worker: FakeWorker,
  code: number,
  signal: string | null,
) => void;

const clusterState = vi.hoisted(() => ({
  isPrimary: true,
  parallelism: 2,
  nextWorkerId: 1,
  workers: new Map<number, FakeWorker>(),
  exitListeners: new Set<ExitListener>(),
}));

vi.mock('node:os', () => ({
  availableParallelism: () => clusterState.parallelism,
}));

vi.mock('node:cluster', () => ({
  default: {
    get isPrimary() {
      return clusterState.isPrimary;
    },
    fork() {
      const id = clusterState.nextWorkerId++;
      const worker: FakeWorker = {
        id,
        process: { pid: 10_000 + id },
        kill: vi.fn(),
      };
      clusterState.workers.set(id, worker);
      return worker;
    },
    on(event: string, listener: ExitListener) {
      if (event === 'exit') {
        clusterState.exitListeners.add(listener);
      }
    },
    off(event: string, listener: ExitListener) {
      if (event === 'exit') {
        clusterState.exitListeners.delete(listener);
      }
    },
  },
}));

const signalListeners = new Map<NodeJS.Signals, () => void>();
let originalExitCode: typeof process.exitCode;

function events(target: ClusterEvent[] = []) {
  return { onEvent: (event: ClusterEvent) => target.push(event) };
}

function worker(id: number): FakeWorker {
  const value = clusterState.workers.get(id);
  if (!value) {
    throw new Error(`Worker ${id} does not exist`);
  }
  return value;
}

function emitExit(
  value: FakeWorker,
  code: number,
  signal: NodeJS.Signals | null = null,
): void {
  clusterState.workers.delete(value.id);
  for (const listener of clusterState.exitListeners) {
    listener(value, code, signal);
  }
}

function emitSignal(signal: NodeJS.Signals): void {
  signalListeners.get(signal)?.();
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  clusterState.isPrimary = true;
  clusterState.parallelism = 2;
  clusterState.nextWorkerId = 1;
  clusterState.workers.clear();
  clusterState.exitListeners.clear();
  signalListeners.clear();
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.spyOn(process, 'once').mockImplementation(((
    signal: NodeJS.Signals,
    listener: () => void,
  ) => {
    signalListeners.set(signal, listener);
    return process;
  }) as typeof process.once);
  vi.spyOn(process, 'off').mockImplementation(((
    signal: NodeJS.Signals,
    listener: () => void,
  ) => {
    if (signalListeners.get(signal) === listener) {
      signalListeners.delete(signal);
    }
    return process;
  }) as typeof process.off);
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('runCluster', () => {
  it('runs the callback only in a worker process', async () => {
    clusterState.isPrimary = false;
    const startWorker = vi.fn(async () => undefined);

    await runCluster(startWorker, events());

    expect(startWorker).toHaveBeenCalledOnce();
    expect(clusterState.workers.size).toBe(0);
  });

  it('forks one worker per available parallelism in auto mode', async () => {
    clusterState.parallelism = 3;
    const received: ClusterEvent[] = [];
    const done = runCluster(vi.fn(), events(received));

    expect(clusterState.workers.size).toBe(3);
    expect(received[0]).toMatchObject({
      type: 'primary:start',
    });

    for (const value of [...clusterState.workers.values()]) {
      emitExit(value, 0);
    }
    await done;
    expect(process.exitCode).toBe(0);
  });

  it('does not restart a worker that exits cleanly', async () => {
    const done = runCluster(vi.fn(), { workers: 1, ...events() });

    emitExit(worker(1), 0);
    await done;

    expect(clusterState.nextWorkerId).toBe(2);
    expect(process.exitCode).toBe(0);
  });

  it('restarts an abnormal exit after the fixed safety delay', async () => {
    const received: ClusterEvent[] = [];
    const done = runCluster(vi.fn(), { workers: 1, ...events(received) });

    emitExit(worker(1), 1);
    expect(received.at(-1)).toMatchObject({
      type: 'worker:exit',
      level: 'warn',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    emitExit(worker(2), 0);
    await done;

    expect(clusterState.nextWorkerId).toBe(3);
  });

  it('stops after the fixed rolling restart limit', async () => {
    const received: ClusterEvent[] = [];
    const done = runCluster(vi.fn(), { workers: 1, ...events(received) });

    for (let id = 1; id <= 5; id += 1) {
      emitExit(worker(id), 1);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    emitExit(worker(6), 1);
    await done;

    expect(process.exitCode).toBe(1);
    expect(received.some((event) => /restart limit/.test(event.message))).toBe(
      true,
    );
  });

  it('forgets restarts outside the fixed rolling window', async () => {
    const done = runCluster(vi.fn(), { workers: 1, ...events() });

    for (let id = 1; id <= 5; id += 1) {
      emitExit(worker(id), 1);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    vi.setSystemTime(65_001);
    emitExit(worker(6), 1);
    await vi.advanceTimersByTimeAsync(1_000);
    emitExit(worker(7), 0);
    await done;

    expect(process.exitCode).toBe(0);
  });

  it('forwards shutdown signals and never resurrects workers', async () => {
    const done = runCluster(vi.fn(), { workers: 2, ...events() });
    const workers = [...clusterState.workers.values()];

    emitSignal('SIGTERM');
    expect(workers.map((value) => value.kill.mock.calls)).toEqual([
      [['SIGTERM']],
      [['SIGTERM']],
    ]);
    for (const value of workers) {
      emitExit(value, 0, 'SIGTERM');
    }
    await done;

    expect(clusterState.nextWorkerId).toBe(3);
    expect(process.exitCode).toBe(0);
  });

  it('cancels a pending restart when shutdown begins', async () => {
    const done = runCluster(vi.fn(), { workers: 1, ...events() });

    emitExit(worker(1), 1);
    emitSignal('SIGTERM');
    await done;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(clusterState.nextWorkerId).toBe(2);
  });

  it('force-terminates stuck workers after the shutdown timeout', async () => {
    const done = runCluster(vi.fn(), {
      workers: 1,
      shutdownTimeoutMs: 250,
      ...events(),
    });
    const value = worker(1);

    emitSignal('SIGINT');
    await vi.advanceTimersByTimeAsync(250);
    expect(value.kill.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
    emitExit(value, 0, 'SIGKILL');
    await done;

    expect(process.exitCode).toBe(1);
  });

  it('rejects invalid worker and timeout settings', async () => {
    await expect(runCluster(vi.fn(), { workers: 0 })).rejects.toThrow(
      /positive integer/,
    );
    await expect(
      runCluster(vi.fn(), { shutdownTimeoutMs: Number.NaN }),
    ).rejects.toThrow(/shutdownTimeoutMs/);
  });
});
