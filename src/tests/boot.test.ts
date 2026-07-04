import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Boot-policy scenarios (docs 25/26) run in spawned children: the shared test
// server boots with Mongo + AUTH_SALT, so these failure permutations need
// separate processes. Mongo is required — each scenario boots into a failure.
const fixture = fileURLToPath(
  new URL('./fixtures/bootServer.ts', import.meta.url),
);

const baseEnv = () => {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.VITEST = undefined;
  env.VITEST_WORKER_ID = undefined;
  env.VITEST_POOL_ID = undefined;
  env.LOGGER_CONSOLE_LEVEL = 'error';
  return env;
};

const runBoot = (
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve, reject) => {
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

describe('boot policy (docs 25 + 26)', () => {
  it('fails boot when no Mongo connection is configured (Mongo is required)', async () => {
    const env = baseEnv();
    env.AUTH_SALT = undefined;
    const { code, out } = await runBoot(env);
    expect(code).toBe(1);
    expect(out).toMatch(/No Mongo connection configured/);
  }, 40000);

  it('fails boot when AUTH_SALT is missing', async () => {
    const env = baseEnv();
    env.BOOT_MONGO = '1';
    env.AUTH_SALT = undefined;
    const { code, out } = await runBoot(env);
    expect(code).toBe(1);
    expect(out).toMatch(/AUTH_SALT/);
    expect(out).toMatch(/generateRandomBytes/);
  }, 40000);

  it('fails boot and names the model when a model fails to initialize', async () => {
    const env = baseEnv();
    env.BOOT_MONGO = '1';
    env.BOOT_BROKEN_MODEL = '1';
    env.AUTH_SALT = 'set-so-the-salt-check-passes';
    const { code, out } = await runBoot(env);
    expect(code).toBe(1);
    expect(out).toMatch(/Failed to initialize model 'BrokenModel'/);
  }, 40000);

  it('fails boot with a dedupe diagnostic when a model extends BaseModel from a different framework copy', async () => {
    const env = baseEnv();
    env.BOOT_MONGO = '1';
    env.BOOT_DUP_COPY = '1';
    env.AUTH_SALT = 'set-so-the-salt-check-passes';
    const { code, out } = await runBoot(env);
    expect(code).toBe(1);
    expect(out).toMatch(/DIFFERENT copy of @adaptivestone\/framework/);
    expect(out).toMatch(/npm ls @adaptivestone\/framework/);
  }, 40000);
});
