import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { ClusterEvent } from './clusterRunner.ts';
import {
  assertCalledTimes,
  assertMatchObject,
  assertRejectsLike,
} from './tests/assertions.ts';

interface FakeWorker {
  id: number;
  process: { pid: number };
  kill: ReturnType<typeof mock.fn>;
}

type ExitListener = (
  worker: FakeWorker,
  code: number,
  signal: string | null,
) => void;

const clusterState = {
  isPrimary: true,
  parallelism: 2,
  nextWorkerId: 1,
  workers: new Map<number, FakeWorker>(),
  exitListeners: new Set<ExitListener>(),
};

mock.module('node:os', {
  exports: { availableParallelism: () => clusterState.parallelism },
});

mock.module('node:cluster', {
  exports: {
    default: {
      get isPrimary() {
        return clusterState.isPrimary;
      },
      fork() {
        const id = clusterState.nextWorkerId++;
        const worker: FakeWorker = {
          id,
          process: { pid: 10_000 + id },
          kill: mock.fn(),
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
  },
});

const { runCluster } = await import('./clusterRunner.ts');

const signalListeners = new Map<NodeJS.Signals, () => void>();
let originalExitCode: typeof process.exitCode;
let timers: typeof mock.timers;

async function advanceTimers(milliseconds: number): Promise<void> {
  timers.tick(milliseconds);
  await Promise.resolve();
}

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

beforeEach((context) => {
  assert.ok('mock' in context);
  timers = context.mock.timers;
  timers.enable({
    apis: ['setInterval', 'setTimeout', 'setImmediate', 'Date'],
    now: 0,
  });
  clusterState.isPrimary = true;
  clusterState.parallelism = 2;
  clusterState.nextWorkerId = 1;
  clusterState.workers.clear();
  clusterState.exitListeners.clear();
  signalListeners.clear();
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  context.mock.method(process, 'once', ((
    signal: NodeJS.Signals,
    listener: () => void,
  ) => {
    signalListeners.set(signal, listener);
    return process;
  }) as typeof process.once);
  context.mock.method(process, 'off', ((
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
});

describe('runCluster', () => {
  it('runs the callback only in a worker process', async () => {
    clusterState.isPrimary = false;
    const startWorker = mock.fn(async () => undefined);

    await runCluster(startWorker, events());

    assertCalledTimes(startWorker, 1);
    assert.strictEqual(clusterState.workers.size, 0);
  });

  it('forks one worker per available parallelism in auto mode', async () => {
    clusterState.parallelism = 3;
    const received: ClusterEvent[] = [];
    const done = runCluster(mock.fn(), events(received));

    assert.strictEqual(clusterState.workers.size, 3);
    assertMatchObject(received[0], {
      type: 'primary:start',
    });

    for (const value of [...clusterState.workers.values()]) {
      emitExit(value, 0);
    }
    await done;
    assert.strictEqual(process.exitCode, 0);
  });

  it('does not restart a worker that exits cleanly', async () => {
    const done = runCluster(mock.fn(), { workers: 1, ...events() });

    emitExit(worker(1), 0);
    await done;

    assert.strictEqual(clusterState.nextWorkerId, 2);
    assert.strictEqual(process.exitCode, 0);
  });

  it('restarts an abnormal exit after the fixed safety delay', async () => {
    const received: ClusterEvent[] = [];
    const done = runCluster(mock.fn(), { workers: 1, ...events(received) });

    emitExit(worker(1), 1);
    assertMatchObject(received.at(-1), {
      type: 'worker:exit',
      level: 'warn',
    });
    await advanceTimers(1_000);
    emitExit(worker(2), 0);
    await done;

    assert.strictEqual(clusterState.nextWorkerId, 3);
  });

  it('stops after the fixed rolling restart limit', async () => {
    const received: ClusterEvent[] = [];
    const done = runCluster(mock.fn(), { workers: 1, ...events(received) });

    for (let id = 1; id <= 5; id += 1) {
      emitExit(worker(id), 1);
      await advanceTimers(1_000);
    }
    emitExit(worker(6), 1);
    await done;

    assert.strictEqual(process.exitCode, 1);
    assert.strictEqual(
      received.some((event) => /restart limit/.test(event.message)),
      true,
    );
  });

  it('forgets restarts outside the fixed rolling window', async () => {
    const done = runCluster(mock.fn(), { workers: 1, ...events() });

    for (let id = 1; id <= 5; id += 1) {
      emitExit(worker(id), 1);
      await advanceTimers(1_000);
    }
    timers.setTime(65_001);
    emitExit(worker(6), 1);
    await advanceTimers(1_000);
    emitExit(worker(7), 0);
    await done;

    assert.strictEqual(process.exitCode, 0);
  });

  it('forwards shutdown signals and never resurrects workers', async () => {
    const done = runCluster(mock.fn(), { workers: 2, ...events() });
    const workers = [...clusterState.workers.values()];

    emitSignal('SIGTERM');
    assert.deepStrictEqual(
      workers.map((value) =>
        value.kill.mock.calls.map((call) => call.arguments),
      ),
      [[['SIGTERM']], [['SIGTERM']]],
    );
    for (const value of workers) {
      emitExit(value, 0, 'SIGTERM');
    }
    await done;

    assert.strictEqual(clusterState.nextWorkerId, 3);
    assert.strictEqual(process.exitCode, 0);
  });

  it('cancels a pending restart when shutdown begins', async () => {
    const done = runCluster(mock.fn(), { workers: 1, ...events() });

    emitExit(worker(1), 1);
    emitSignal('SIGTERM');
    await done;
    await advanceTimers(1_000);

    assert.strictEqual(clusterState.nextWorkerId, 2);
  });

  it('force-terminates stuck workers after the shutdown timeout', async () => {
    const done = runCluster(mock.fn(), {
      workers: 1,
      shutdownTimeoutMs: 250,
      ...events(),
    });
    const value = worker(1);

    emitSignal('SIGINT');
    await advanceTimers(250);
    assert.deepStrictEqual(
      value.kill.mock.calls.map((call) => call.arguments),
      [['SIGINT'], ['SIGKILL']],
    );
    emitExit(value, 0, 'SIGKILL');
    await done;

    assert.strictEqual(process.exitCode, 1);
  });

  it('rejects invalid worker and timeout settings', async () => {
    await assertRejectsLike(
      runCluster(mock.fn(), { workers: 0 }),
      /positive integer/,
    );
    await assertRejectsLike(
      runCluster(mock.fn(), { shutdownTimeoutMs: Number.NaN }),
      /shutdownTimeoutMs/,
    );
  });
});
