import assert from 'node:assert/strict';
import test from 'node:test';
import { getTestServerURL } from '../testHelpers.ts';

// Runs under `node --import documentedPreloadArrangement.ts --test` in a child
// process. The shipped glue boots the server; this proves the preload-declared
// `bootHttp` reached the Server constructor and wired its route.
test('bootHttp from the documented preload arrangement is wired', async () => {
  const response = await fetch(getTestServerURL('/from-documented-preload'));
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(await response.json(), { documented: 'ok' });
});
