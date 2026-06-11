import { type ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// These tests spawn a real server in a child process: only there can a real
// SIGTERM (problem 1) and a real EADDRINUSE (problem 2) be observed via exit
// codes and marker output.
const fixture = fileURLToPath(
  new URL('./fixtures/shutdownServer.ts', import.meta.url),
);

const childEnv = () => {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  // The fixture is a production-shaped server; strip vitest markers so it runs
  // the real signal-registration path (which is skipped under VITEST).
  env.VITEST = undefined;
  env.VITEST_WORKER_ID = undefined;
  env.VITEST_POOL_ID = undefined;
  env.AUTH_SALT ||= 'test-shutdown-salt';
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

  it('exits 0 on SIGTERM, firing the shutdown event first', async () => {
    const port = await getFreePort();
    const { child, getOutput } = spawnFixture(port);
    running.push(child);

    await waitForMarker(child, getOutput, /SERVER_LISTENING/);
    child.kill('SIGTERM');

    const { code } = await waitForExit(child, getOutput);
    expect(code).toBe(0);
    expect(getOutput()).toMatch(/SHUTDOWN_EVENT_FIRED/);
  }, 40000);

  it('a second server on a taken port exits non-zero (no zombie)', async () => {
    const port = await getFreePort();
    const first = spawnFixture(port);
    running.push(first.child);
    await waitForMarker(first.child, first.getOutput, /SERVER_LISTENING/);

    const second = spawnFixture(port);
    running.push(second.child);
    const { code } = await waitForExit(second.child, second.getOutput);
    expect(code).toBe(1);
  }, 40000);
});
