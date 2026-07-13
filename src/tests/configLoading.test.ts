import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Config loading is exercised in a spawned child so NODE_ENV can be set per
// scenario (it's process-global, and the in-process test server already owns a
// Server). The fixture loads configs only — no Mongo, no HTTP boot.
const fixture = fileURLToPath(
  new URL('./fixtures/configLoadServer.ts', import.meta.url),
);

const runInit = (
  nodeEnv: string,
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve, reject) => {
    const env = { ...process.env } as NodeJS.ProcessEnv;
    env.NODE_ENV = nodeEnv;
    env.LOGGER_CONSOLE_LEVEL = 'error';
    const child = spawn('node', [fixture], { env });
    let out = '';
    child.stdout?.on('data', (d) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d) => {
      out += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out.\n${out}`));
    }, 25000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });

const parseConfigs = (out: string): Record<string, unknown> => {
  const line = out.split('\n').find((l) => l.startsWith('CONFIGS_JSON='));
  if (!line) {
    throw new Error(`No CONFIGS_JSON in output:\n${out}`);
  }
  return JSON.parse(line.slice('CONFIGS_JSON='.length));
};

describe('config loading — env-only config (finding #11)', () => {
  it('loads an env-only config (no base file) when NODE_ENV matches its env segment', async () => {
    const { code, out } = await runInit('production');
    expect(code).toBe(0);
    const configs = parseConfigs(out);
    // envOnly.production.ts is the only file for this config — its values load
    // directly instead of crashing boot with `import(undefined)`.
    expect(configs.envOnly).toEqual({
      marker: 'env-only-production-value',
      fromEnv: 42,
    });
    // A normal base+env config still merges byte-identically: env overrides base.
    expect(configs.withBase).toEqual({ a: 1, b: 'prod', c: 3 });
  }, 40000);

  it('treats an env-only config as absent (like an unknown config) when NODE_ENV does not match, naming the config and missing base', async () => {
    const { code, out } = await runInit('test');
    expect(code).toBe(0);
    // No applicable file for NODE_ENV=test → same as a config that was never
    // defined: getConfig returns {}.
    const configs = parseConfigs(out);
    expect(configs.envOnly).toEqual({});
    // Base-only config still loads its base (env override does not apply).
    expect(configs.withBase).toEqual({ a: 1, b: 'base' });
    // Clear diagnostic names the config and the missing base file — never the
    // bare `Cannot find package 'undefined'`.
    expect(out).toMatch(/envOnly/);
    expect(out).toMatch(/envOnly\.ts/);
    expect(out).not.toMatch(/Cannot find package 'undefined'/);
  }, 40000);
});
