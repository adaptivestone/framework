import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTestServerURL } from '../tests/testHelpers.ts';

describe('home', () => {
  it('can open home have', async () => {
    const { status } = await fetch(getTestServerURL('/')).catch(() => ({
      status: 500,
    }));

    assert.strictEqual(status, 200);
  });
});
