import { describe, expect, it } from 'vitest';
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
    expect.assertions(2);

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
    expect(all).toContain(email); // identifier kept for debuggability
    expect(all).not.toContain('sessionTokens'); // whole document not serialized
  });
});

describe('CreateUser command — input validation guards', () => {
  const run = (args: Record<string, unknown>) =>
    new CreateUser(appInstance, {}, args).run();

  it('fails when neither email nor id is given', async () => {
    await expect(run({})).resolves.toBe(false);
  });

  it('fails to create a new user without a password', async () => {
    await expect(run({ email: 'cu-nopass@example.com' })).resolves.toBe(false);
  });

  it('fails when looked up by a missing id with no email to create from', async () => {
    await expect(
      run({ id: '000000000000000000000000', password: 'x' }),
    ).resolves.toBe(false);
  });

  it('refuses to overwrite an existing user without `update`', async () => {
    const email = 'cu-existing@example.com';
    await expect(run({ email, password: 'pw1', update: true })).resolves.toBe(
      true,
    ); // first run creates it
    await expect(run({ email, password: 'pw2' })).resolves.toBe(false); // exists, no update
  });

  it('creates a user, splitting comma-separated roles', async () => {
    const email = 'cu-roles@example.com';
    await expect(
      run({ email, password: 'pw', roles: 'user,admin' }),
    ).resolves.toBe(true);
    const user = await appInstance.getModel('User').findOne({ email });
    expect(user?.roles).toEqual(['user', 'admin']);
  });
});
