import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import RequestLogger from './RequestLogger.ts';

const run = async (path: string, statusCode: number) => {
  const lines: [level: string, message: string][] = [];
  const middleware = new RequestLogger(appInstance);
  const log = (level: string) => (message: string) => {
    lines.push([level, message]);
  };
  Object.defineProperty(middleware, 'logger', {
    value: { info: log('info'), warn: log('warn') },
  });
  const res = Object.assign(new EventEmitter(), { statusCode });
  await middleware.middleware(
    { method: 'GET', path } as never,
    res as never,
    () => {},
  );
  res.emit('finish');
  return lines;
};

describe('RequestLogger', () => {
  it('logs a request when it starts and when it finishes', async () => {
    const lines = await run('/users', 200);
    assert.deepStrictEqual(
      lines.map(([level]) => level),
      ['info', 'info'],
    );
  });

  it('skips successful health probes', async () => {
    assert.deepStrictEqual(await run('/health/live', 200), []);
  });

  it('logs a failed health probe once, at warn', async () => {
    const lines = await run('/health/ready', 503);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0]?.[0], 'warn');
    assert.match(lines[0]?.[1] ?? '', /\/health\/ready.*503/);
  });
});
