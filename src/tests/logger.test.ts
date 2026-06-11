import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// #createLogger's custom-transport branch can only be exercised on a freshly
// created logger, but the logger is memoized and a process allows a single
// Server (singleton). So we spawn a child per scenario.
const fixtureDir = new URL('./fixtures/', import.meta.url);
const serverFixture = fileURLToPath(new URL('loggerServer.ts', fixtureDir));
const transportFixture = fileURLToPath(
  new URL('fixtureTransport.ts', fixtureDir),
);
const cjsWrapFixture = fileURLToPath(
  new URL('fixtureTransportCjsWrap.ts', fixtureDir),
);

const childEnv = () => {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.VITEST = undefined;
  env.VITEST_WORKER_ID = undefined;
  env.VITEST_POOL_ID = undefined;
  env.AUTH_SALT ||= 'test-logger-salt';
  env.LOGGER_CONSOLE_LEVEL = 'error';
  return env;
};

const spawnFixture = (transportSpec: string) => {
  const child = spawn('node', [serverFixture, transportSpec], {
    env: childEnv(),
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

// Poll the child's output for a marker rather than waiting a fixed interval —
// a slow fire-and-forget import on a loaded box must not flake the test.
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

describe('custom winston transport loading (doc 13)', () => {
  const running: ChildProcess[] = [];

  afterEach(() => {
    for (const c of running) {
      if (c.exitCode === null && c.signalCode === null) {
        c.kill('SIGKILL');
      }
    }
    running.length = 0;
  });

  it('constructs + adds a valid default-export transport', async () => {
    const { child, getOutput } = spawnFixture(transportFixture);
    running.push(child);
    await waitForMarker(child, getOutput, /FIXTURE_TRANSPORT_LOADED/);
    expect(getOutput()).not.toMatch(/not a constructor/);
  }, 40000);

  it('loads a CJS-interop double-wrapped transport', async () => {
    const { child, getOutput } = spawnFixture(cjsWrapFixture);
    running.push(child);
    await waitForMarker(child, getOutput, /FIXTURE_TRANSPORT_LOADED/);
  }, 40000);

  it('a nonexistent transport module logs an error without crashing', async () => {
    const { child, getOutput } = spawnFixture(
      '/no/such/transport-module-xyz.ts',
    );
    running.push(child);
    // If the import rejection were unhandled the child would crash before this
    // marker appears; seeing it (child still alive) proves the .catch handled it.
    await waitForMarker(child, getOutput, /Failed to load logger transport/);
    expect(child.exitCode).toBeNull();
  }, 40000);
});
