import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Transport from 'winston-transport';
import { appInstance } from '../helpers/appInstance.ts';
import CreateUser from './CreateUser.ts';

// Captures every log entry so the test can assert no credential is serialized.
class CaptureTransport extends Transport {
  sink: string[];
  constructor(sink: string[]) {
    super({ level: 'silly' });
    this.sink = sink;
  }
  log(info: unknown, callback: () => void) {
    this.sink.push(JSON.stringify(info));
    callback();
  }
}

describe('CreateUser command (doc 20)', () => {
  it('logs the email but not the password hash or session tokens', async () => {
    const email = 'createusertest@example.com';
    const captured: string[] = [];
    const transport = new CaptureTransport(captured);
    appInstance.logger.add(transport);
    try {
      const command = new CreateUser(
        appInstance,
        {},
        { email, password: 'somePassword123', update: true },
      );
      await command.run();
    } finally {
      appInstance.logger.remove(transport);
    }

    const all = captured.join('\n');
    assert.ok(all.includes(email)); // identifier kept for debuggability
    assert.ok(!all.includes('sessionTokens')); // whole document not serialized
  });
});

describe('CreateUser command — input validation guards', () => {
  const run = (args: Record<string, unknown>) =>
    new CreateUser(appInstance, {}, args).run();

  it('fails when neither email nor id is given', async () => {
    await assert.strictEqual(await run({}), false);
  });

  it('fails to create a new user without a password', async () => {
    await assert.strictEqual(
      await run({ email: 'cu-nopass@example.com' }),
      false,
    );
  });

  it('fails when looked up by a missing id with no email to create from', async () => {
    await assert.strictEqual(
      await run({ id: '000000000000000000000000', password: 'x' }),
      false,
    );
  });

  it('refuses to overwrite an existing user without `update`', async () => {
    const email = 'cu-existing@example.com';
    await assert.strictEqual(
      await run({ email, password: 'pw1', update: true }),
      true,
    ); // first run creates it
    await assert.strictEqual(await run({ email, password: 'pw2' }), false); // exists, no update
  });

  it('creates a user, splitting comma-separated roles', async () => {
    const email = 'cu-roles@example.com';
    await assert.strictEqual(
      await run({ email, password: 'pw', roles: 'user,admin' }),
      true,
    );
    const user = await appInstance.getModel('User').findOne({ email });
    assert.deepStrictEqual(user?.roles, ['user', 'admin']);
  });
});
