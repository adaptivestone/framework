import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Response } from 'express';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';
import Home from './Home.ts';

describe('home', () => {
  it('can open home have', async () => {
    const { status } = await fetch(getTestServerURL('/')).catch(() => ({
      status: 500,
    }));

    assert.strictEqual(status, 200);
  });

  it('answers its message', async () => {
    const res = await fetch(getTestServerURL('/'));
    assert.deepStrictEqual(await res.json(), { message: 'Home' });
  });

  it('still accepts an override written against res (compile-time check)', () => {
    class LegacyHome extends Home {
      override async home(_req: FrameworkRequest, res: Response) {
        return res.json({ message: 'custom' });
      }
    }
    assert.strictEqual(typeof LegacyHome.prototype.home, 'function');
  });
});
