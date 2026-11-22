import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertTextMatch } from './assertions.ts';

// Boot-policy scenarios (docs 25/26) run in spawned children: the shared test
// server boots with Mongo + AUTH_SALT, so these failure permutations need
// separate processes. Mongo is required — each scenario boots into a failure.
const fixture = fileURLToPath(
  new URL('./fixtures/bootServer.ts', import.meta.url),
);

const baseEnv = () => {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.FRAMEWORK_TEST = undefined;
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
  it('fails boot when no Mongo connection is configured (Mongo is required)', {
    timeout: 40000,
  }, async () => {
    const env = baseEnv();
    env.AUTH_SALT = undefined;
    const { code, out } = await runBoot(env);
    assert.strictEqual(code, 1);
    assertTextMatch(out, /No Mongo connection configured/);
  });

  it('fails boot when AUTH_SALT is missing', { timeout: 40000 }, async () => {
    const env = baseEnv();
    env.BOOT_MONGO = '1';
    env.AUTH_SALT = undefined;
    const { code, out } = await runBoot(env);
    assert.strictEqual(code, 1);
    assertTextMatch(out, /AUTH_SALT/);
    assertTextMatch(out, /generateRandomBytes/);
  });

  it('fails boot and names the model when a model fails to initialize', {
    timeout: 40000,
  }, async () => {
    const env = baseEnv();
    env.BOOT_MONGO = '1';
    env.BOOT_BROKEN_MODEL = '1';
    env.AUTH_SALT = 'set-so-the-salt-check-passes';
    const { code, out } = await runBoot(env);
    assert.strictEqual(code, 1);
    assertTextMatch(out, /Failed to initialize model 'BrokenModel'/);
  });

  it('fails boot with a dedupe diagnostic when a model extends BaseModel from a different framework copy', {
    timeout: 40000,
  }, async () => {
    const env = baseEnv();
    env.BOOT_MONGO = '1';
    env.BOOT_DUP_COPY = '1';
    env.AUTH_SALT = 'set-so-the-salt-check-passes';
    const { code, out } = await runBoot(env);
    assert.strictEqual(code, 1);
    assertTextMatch(out, /DIFFERENT copy of @adaptivestone\/framework/);
    assertTextMatch(out, /npm ls @adaptivestone\/framework/);
  });
});

describe('UserOld deprecation at boot', () => {
  // The framework loads its own models with the app's, UserOld included.
  const bootWithWarnings = (extra: NodeJS.ProcessEnv = {}) => {
    const env = { ...baseEnv(), ...extra };
    env.BOOT_MONGO = '1';
    env.AUTH_SALT = 'set-so-the-salt-check-passes';
    env.LOGGER_CONSOLE_LEVEL = 'warn';
    return runBoot(env);
  };
  const count = (text: string, pattern: RegExp) =>
    text.match(new RegExp(pattern, 'g'))?.length ?? 0;

  it('does not warn when the app never uses UserOld', {
    timeout: 40000,
  }, async () => {
    const { code, out } = await bootWithWarnings();
    assert.strictEqual(code, 0, out);
    assert.strictEqual(count(out, /ASF_DEP_USEROLD/), 0, out);
    assert.strictEqual(count(out, /UserOld is old type model/), 0, out);
  });

  it('warns once for an app model extending UserOld', {
    timeout: 40000,
  }, async () => {
    const { code, out } = await bootWithWarnings({ BOOT_USEROLD_MODEL: '1' });
    assert.strictEqual(code, 0, out);
    assert.strictEqual(count(out, /ASF_DEP_USEROLD/), 1, out);
    assert.strictEqual(count(out, /LegacyUser is old type model/), 1, out);
    assert.strictEqual(count(out, /UserOld is old type model/), 0, out);
  });
});
