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
