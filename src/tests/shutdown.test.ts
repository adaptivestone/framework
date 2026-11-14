import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
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
