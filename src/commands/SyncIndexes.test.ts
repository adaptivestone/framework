import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IApp } from '../server.ts';
import SyncIndexes from './SyncIndexes.ts';

describe('SyncIndexes command', () => {
  it('syncs every initialized model using its full registry name', async () => {
    const calls: string[] = [];
    const model = (name: string) => ({
      syncIndexes: async () => {
        calls.push(name);
        return [];
      },
    });
    const app = {
      internalFilesCache: {
        models: new Map([
          ['admin/User', model('admin/User')],
          ['billing/Invoice', model('billing/Invoice')],
        ]),
      },
      logger: {
        child: () => ({ info: () => {} }),
      },
    } as unknown as IApp;

    assert.strictEqual(await new SyncIndexes(app, {}, {}).run(), true);
    assert.deepStrictEqual(calls, ['admin/User', 'billing/Invoice']);
  });
});
