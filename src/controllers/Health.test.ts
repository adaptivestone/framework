import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import mongoose from 'mongoose';
import { appInstance } from '../helpers/appInstance.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';

const healthConfig = () =>
  appInstance.getConfig('health') as { token?: string };

describe('health endpoints', () => {
  afterEach(() => {
    healthConfig().token = undefined;
    mock.restoreAll();
  });

  it('live answers ok without a user session', async () => {
    const res = await fetch(getTestServerURL('/health/live'));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { status: 'ok' });
  });

  it('ready pings MongoDB', async () => {
    const res = await fetch(getTestServerURL('/health/ready'));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), {
      status: 'ok',
      checks: { mongo: 'ok' },
    });
  });

  it('ready answers 503 without details when the ping fails', async () => {
    const { db } = mongoose.connection;
    assert.ok(db);
    mock.method(db, 'command', () =>
      Promise.reject(new Error('connection refused: secret-host:27017')),
    );
    const res = await fetch(getTestServerURL('/health/ready'));
    const text = await res.text();
    assert.strictEqual(res.status, 503);
    assert.deepStrictEqual(JSON.parse(text), {
      status: 'error',
      checks: { mongo: 'error' },
    });
    assert.ok(!text.includes('secret-host'));
  });

  it('ready answers 503 when the ping hangs past the timeout', async () => {
    const { db } = mongoose.connection;
    assert.ok(db);
    mock.method(db, 'command', () => new Promise(() => {}));
    const res = await fetch(getTestServerURL('/health/ready'));
    assert.strictEqual(res.status, 503);
  });

  describe('with a token configured', () => {
    it('rejects a missing or wrong token with 401', async () => {
      healthConfig().token = 'probe-secret';
      for (const init of [
        undefined,
        { headers: { 'X-Health-Token': 'wrong' } },
      ]) {
        const res = await fetch(getTestServerURL('/health/live'), init);
        assert.strictEqual(res.status, 401);
        assert.strictEqual(typeof (await res.json()).message, 'string');
      }
      const ready = await fetch(getTestServerURL('/health/ready?token=wrong'));
      assert.strictEqual(ready.status, 401);
    });

    it('accepts the token as a header or a query parameter', async () => {
      healthConfig().token = 'probe-secret';
      const byHeader = await fetch(getTestServerURL('/health/live'), {
        headers: { 'X-Health-Token': 'probe-secret' },
      });
      assert.strictEqual(byHeader.status, 200);
      const byQuery = await fetch(
        getTestServerURL('/health/ready?token=probe-secret'),
      );
      assert.strictEqual(byQuery.status, 200);
    });
  });

  it('leaves GET /health free for an app route', async () => {
    const registry = appInstance.httpServer?.routeRegistry;
    assert.ok(registry);
    registry.registerRoute('GET', '/health', {
      handler: (_req: unknown, res: { json: (b: unknown) => void }) =>
        res.json({ app: true }),
    } as never);
    const res = await fetch(getTestServerURL('/health'));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { app: true });
  });
});
