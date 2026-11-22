import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertTextMatch } from './assertions.ts';

// These tests spawn a real server in a child process: only there can a real
// SIGTERM (problem 1) and a real EADDRINUSE (problem 2) be observed via exit
// codes and marker output.
const fixture = fileURLToPath(
  new URL('./fixtures/shutdownServer.ts', import.meta.url),
);
const clusterFixture = fileURLToPath(
  new URL('./fixtures/clusterShutdownServer.ts', import.meta.url),
);
const crashFixture = fileURLToPath(
  new URL('./fixtures/crashSentryServer.ts', import.meta.url),
);
const beforeShutdownFixture = fileURLToPath(
  new URL('./fixtures/beforeShutdownServer.ts', import.meta.url),
);

const childEnv = () => {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  // The fixture is production-shaped, so run the real signal-registration path.
  env.FRAMEWORK_TEST = undefined;
  env.AUTH_SALT ||= 'test-shutdown-salt';
  // Boot asserts a Mongo DSN is configured (server.ts #assertBootConfig). The
  // fixture never opens a connection — it skips model init — so any truthy DSN
  // satisfies the check; no live database is needed. Set explicitly so the test
  // doesn't depend on a developer's local .env (CI has none → boot would throw).
  env.MONGO_DSN ||= 'mongodb://127.0.0.1:27017/shutdown-fixture';
  env.LOGGER_CONSOLE_LEVEL = 'error';
  return env;
};

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });

const spawnFixture = (port: number) => {
  const child = spawn('node', [fixture, String(port)], { env: childEnv() });
  let out = '';
  child.stdout?.on('data', (d) => {
    out += d.toString();
  });
  child.stderr?.on('data', (d) => {
    out += d.toString();
  });
  return { child, getOutput: () => out };
};

const spawnClusterFixture = (port: number) => {
  const child = spawn('node', [clusterFixture, String(port)], {
    env: childEnv(),
    detached: true,
  });
  let out = '';
  child.stdout?.on('data', (d) => {
    out += d.toString();
  });
  child.stderr?.on('data', (d) => {
    out += d.toString();
  });
  return { child, getOutput: () => out };
};

const spawnCrashFixture = (mode?: string) => {
  const args = mode ? [crashFixture, mode] : [crashFixture];
  const child = spawn('node', args, { env: childEnv() });
  let out = '';
  child.stdout?.on('data', (d) => {
    out += d.toString();
  });
  child.stderr?.on('data', (d) => {
    out += d.toString();
  });
  return { child, getOutput: () => out };
};

const spawnBeforeShutdownFixture = (port: number, mode?: string) => {
  const args = [beforeShutdownFixture, String(port)];
  if (mode) {
    args.push(mode);
  }
  // Warn level, so the bound's timeout warning reaches the output.
  const child = spawn('node', args, {
    env: { ...childEnv(), LOGGER_CONSOLE_LEVEL: 'warn' },
  });
  let out = '';
  child.stdout?.on('data', (d) => {
    out += d.toString();
  });
  child.stderr?.on('data', (d) => {
    out += d.toString();
  });
  return { child, getOutput: () => out };
};

/** Open the fixture's never-ending `GET /hold` and resolve once it answers. */
const holdConnection = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/hold', agent: false },
      (res) => {
        // The server destroys this socket on purpose during shutdown.
        res.on('error', () => {});
        res.resume();
        resolve();
      },
    );
    req.on('error', reject);
  });

/** Open a TCP connection; resolve `'connected'` or the error code. */
const connectOutcome = (port: number): Promise<string> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code ?? String(err));
    });
  });

const waitForMarker = (
  child: ChildProcess,
  getOutput: () => string,
  re: RegExp,
  timeoutMs = 20000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(interval);
      child.off('exit', onExit);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${re}.\n${getOutput()}`));
    }, timeoutMs);
    const interval = setInterval(() => {
      if (re.test(getOutput())) {
        cleanup();
        resolve();
      }
    }, 50);
    const onExit = () => {
      cleanup();
      if (re.test(getOutput())) {
        resolve();
      } else {
        reject(new Error(`Exited before ${re}.\n${getOutput()}`));
      }
    };
    child.once('exit', onExit);
  });

const waitForExit = (
  child: ChildProcess,
  getOutput: () => string,
  timeoutMs = 20000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for exit.\n${getOutput()}`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

describe('graceful shutdown + listen failure (doc 12)', () => {
  const running: ChildProcess[] = [];

  afterEach(() => {
    for (const c of running) {
      if (c.exitCode === null && c.signalCode === null) {
        c.kill('SIGKILL');
      }
    }
    running.length = 0;
  });

  it('exits 0 on SIGTERM, firing the shutdown event first', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnFixture(port);
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING/);
    child.kill('SIGTERM');

    const { code } = await waitForExit(child, getOutput);
    assert.strictEqual(code, 0);
    assertTextMatch(getOutput(), /SHUTDOWN_EVENT_FIRED/);
  });

  it('awaits beforeShutdown listeners before the HTTP drain, so they can close a long-lived connection', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnBeforeShutdownFixture(port);
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING/);
    await holdConnection(port);
    await waitForMarker(child, getOutput, /REQUEST_HELD/);
    const startedAt = Date.now();
    child.kill('SIGTERM');

    const { code } = await waitForExit(child, getOutput);
    // Without the listener the open connection holds the drain until the 10 s
    // force-exit timer, which exits 1.
    assert.strictEqual(code, 0, getOutput());
    assert.ok(Date.now() - startedAt < 5_000, getOutput());
    // The server stopped accepting connections before the async listener
    // started, the held one stayed open for it, and 'shutdown' fired after it.
    assertTextMatch(
      getOutput(),
      /BEFORE_SHUTDOWN_STARTED:listening=false\n[\s\S]*BEFORE_SHUTDOWN_DONE:listening=false\n[\s\S]*SHUTDOWN_EVENT_FIRED/,
    );
  });

  it('refuses new connections while beforeShutdown listeners run', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnBeforeShutdownFixture(port, 'slow');
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING/);
    child.kill('SIGTERM');
    await waitForMarker(child, getOutput, /SLOW_LISTENER_STARTED/);

    // A client reconnecting now must not hold the drain open.
    assert.strictEqual(await connectOutcome(port), 'ECONNREFUSED', getOutput());
    const { code } = await waitForExit(child, getOutput);
    assert.strictEqual(code, 0, getOutput());
    assertTextMatch(
      getOutput(),
      /SLOW_LISTENER_DONE\n[\s\S]*SHUTDOWN_EVENT_FIRED/,
    );
  });

  it('stops waiting for a beforeShutdown listener that never settles', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnBeforeShutdownFixture(port, 'hang');
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING/);
    const startedAt = Date.now();
    child.kill('SIGTERM');

    const { code } = await waitForExit(child, getOutput);
    assert.strictEqual(code, 0, getOutput());
    // Past the bound, well before the force-exit timer.
    assert.ok(Date.now() - startedAt < 9_000, getOutput());
    assertTextMatch(getOutput(), /beforeShutdown[^\n]*did not finish/);
    assertTextMatch(getOutput(), /BEFORE_SHUTDOWN_DONE/);
    assertTextMatch(getOutput(), /SHUTDOWN_EVENT_FIRED/);
  });

  it('logs a failing beforeShutdown listener and continues the shutdown', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnBeforeShutdownFixture(port, 'throw');
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING/);
    child.kill('SIGTERM');

    const { code } = await waitForExit(child, getOutput);
    assert.strictEqual(code, 0, getOutput());
    assertTextMatch(getOutput(), /BEFORE_SHUTDOWN_SYNC_FAILURE/);
    assertTextMatch(getOutput(), /BEFORE_SHUTDOWN_ASYNC_FAILURE/);
    assertTextMatch(getOutput(), /BEFORE_SHUTDOWN_DONE/);
    assertTextMatch(getOutput(), /SHUTDOWN_EVENT_FIRED/);
  });

  it('keeps EventEmitter semantics for beforeShutdown listeners', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnBeforeShutdownFixture(port, 'semantics');
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING/);
    child.kill('SIGTERM');

    const { code } = await waitForExit(child, getOutput);
    assert.strictEqual(code, 0, getOutput());
    // A `function` listener is called with the emitter as `this`.
    assertTextMatch(getOutput(), /THIS_IS_EMITTER:true/);
    // An async `once` listener is awaited before the teardown, then removed.
    assertTextMatch(
      getOutput(),
      /ONCE_LISTENER_DONE\n[\s\S]*ONCE_LISTENER_REMOVED:true/,
    );
  });

  it('drains a clustered worker after a signal sent only to the primary', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnClusterFixture(port);
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING:/);
    const responsePromise = fetch(`http://127.0.0.1:${port}/hold`, {
      headers: { connection: 'close' },
    }).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }));
    await waitForMarker(child, getOutput, /REQUEST_STARTED:/);
    child.kill('SIGTERM');

    const [response, { code, signal }] = await Promise.all([
      responsePromise,
      waitForExit(child, getOutput),
    ]);
    assert.deepStrictEqual(response, { status: 200, body: 'DRAINED' });
    assert.strictEqual(code, 0, getOutput());
    assert.strictEqual(signal, null);
    assertTextMatch(getOutput(), /SHUTDOWN_EVENT_FIRED:/);
    assertTextMatch(getOutput(), /PRIMARY_FINISHED/);
  });

  it('absorbs duplicate worker signals when the whole process group is signaled', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnClusterFixture(port);
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING:/);
    const responsePromise = fetch(`http://127.0.0.1:${port}/hold`, {
      headers: { connection: 'close' },
    }).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }));
    await waitForMarker(child, getOutput, /REQUEST_STARTED:/);
    assert.ok(child.pid);
    process.kill(-child.pid, 'SIGTERM');

    const [response, { code, signal }] = await Promise.all([
      responsePromise,
      waitForExit(child, getOutput),
    ]);
    assert.deepStrictEqual(response, { status: 200, body: 'DRAINED' });
    assert.strictEqual(code, 0, getOutput());
    assert.strictEqual(signal, null);
    assertTextMatch(getOutput(), /SHUTDOWN_EVENT_FIRED:/);
    assertTextMatch(getOutput(), /PRIMARY_FINISHED/);
  });

  it('lets a clustered worker finish its async shutdown teardown', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnClusterFixture(port);
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING:/);
    child.kill('SIGTERM');

    const { code, signal } = await waitForExit(child, getOutput);
    assert.strictEqual(code, 0, getOutput());
    assert.strictEqual(signal, null);
    // Closing the IPC channel must not exit the worker before its teardown
    // ends, and the primary sees a voluntary exit.
    assertTextMatch(
      getOutput(),
      /SHUTDOWN_TEARDOWN_DONE:\d+\n[\s\S]*WORKER_EXITED:0:null:true\n[\s\S]*PRIMARY_FINISHED/,
    );
  });

  it('a second server on a taken port exits non-zero (no zombie)', {
    timeout: 40000,
  }, async () => {
    const port = await getFreePort();
    const first = spawnFixture(port);
    running.push(first.child);
    await waitForMarker(first.child, first.getOutput, /SERVER_LISTENING/);

    const second = spawnFixture(port);
    running.push(second.child);
    const { code } = await waitForExit(second.child, second.getOutput);
    assert.strictEqual(code, 1);
  });

  it('flushes Sentry before exiting on an uncaught exception', {
    timeout: 40000,
  }, async () => {
    const { child, getOutput } = spawnCrashFixture();
    running.push(child);

    await waitForMarker(
      child,
      getOutput,
      /Sentry Winston transport loaded successfully/,
    );
    const { code, signal } = await waitForExit(child, getOutput);

    assert.strictEqual(code, 1);
    assert.strictEqual(signal, null);
    assertTextMatch(getOutput(), /SENTRY_EVENT_SENT/);
    assertTextMatch(getOutput(), /SENTRY_FLUSH_COMPLETED/);
  });

  it('forces the crash exit when Sentry flush does not complete', {
    timeout: 40000,
  }, async () => {
    const { child, getOutput } = spawnCrashFixture('hang');
    running.push(child);

    await waitForMarker(
      child,
      getOutput,
      /Sentry Winston transport loaded successfully/,
    );
    await waitForMarker(child, getOutput, /SENTRY_FLUSH_STARTED/);
    const startedAt = Date.now();
    const { code, signal } = await waitForExit(child, getOutput);

    assert.strictEqual(code, 1);
    assert.strictEqual(signal, null);
    assert.ok(Date.now() - startedAt < 4_500);
    assert.ok(!/SENTRY_FLUSH_COMPLETED/.test(getOutput()));
  });
});
