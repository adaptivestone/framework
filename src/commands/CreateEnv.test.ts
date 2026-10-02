import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import CreateEnv from './CreateEnv.ts';

describe('CreateEnv command', () => {
  const cwd = process.cwd();
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'create-env-'));
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  });

  const run = () => new CreateEnv(appInstance, {}, {}).run();
  const readEnv = () => readFile(path.join(dir, '.env'), 'utf8');

  it('describes itself for the CLI help', () => {
    assert.match(CreateEnv.description, /AUTH_SALT/);
  });

  it('copies .env.example and fills AUTH_SALT', async () => {
    await writeFile(
      path.join(dir, '.env.example'),
      'HTTP_PORT=3300\nAUTH_SALT=""\nMONGO_DSN=mongodb://localhost/app\n',
    );
    assert.strictEqual(await run(), true);
    const env = await readEnv();
    assert.match(env, /^HTTP_PORT=3300$/m);
    assert.match(env, /^MONGO_DSN=mongodb:\/\/localhost\/app$/m);
    assert.match(env, /^AUTH_SALT=[0-9a-f]{64}$/m);
    assert.strictEqual(env.match(/AUTH_SALT=/g)?.length, 1);
  });

  it('appends AUTH_SALT when .env.example has no such line', async () => {
    await writeFile(path.join(dir, '.env.example'), 'HTTP_PORT=3300');
    await run();
    assert.match(await readEnv(), /^HTTP_PORT=3300\nAUTH_SALT=[0-9a-f]{64}\n$/);
  });

  it('creates .env with only AUTH_SALT when there is no .env.example', async () => {
    await run();
    assert.match(await readEnv(), /^AUTH_SALT=[0-9a-f]{64}\n$/);
  });

  it('never touches an existing .env', async () => {
    await writeFile(path.join(dir, '.env'), 'AUTH_SALT=keep-me\n');
    await writeFile(path.join(dir, '.env.example'), 'AUTH_SALT=""\n');
    assert.strictEqual(await run(), true);
    assert.strictEqual(await readEnv(), 'AUTH_SALT=keep-me\n');
  });

  it('generates a different salt each time', async () => {
    await run();
    const first = await readEnv();
    await rm(path.join(dir, '.env'));
    await run();
    assert.notStrictEqual(await readEnv(), first);
  });
});
