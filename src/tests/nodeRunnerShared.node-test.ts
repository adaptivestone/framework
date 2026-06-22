/**
 * Smoke test for the **extracted / shared** Mongo-init pattern under `node:test`.
 *
 * This is a SECOND suite file in the same run: it proves the global-setup entry
 * (`globalSetupNodeTest.ts`, wired via `--test-global-setup`) starts Mongo ONCE
 * and shares it across every `*.node-test.ts` file via `TEST_MONGO_URI`. This
 * file starts nothing itself — it asserts the URI arrived from the entry module
 * and that it got its own fresh per-suite DB off the shared instance.
 *
 * The per-file server lifecycle comes from the shipped `setupNodeTest.ts` glue
 * (it wires `before(startTestServer)` etc. but never touches Mongo init). Runs as
 * part of `npm run test:node`.
 */
import './setupNodeTest.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import { getTestServerURL } from './testHelpers.ts';

describe('node:test: second suite sharing the global Mongo', () => {
  it('consumes a TEST_MONGO_URI provided by the global-setup entry', () => {
    // This file never calls startTestMongo — the URI must come from the runner.
    assert.ok(
      process.env.TEST_MONGO_URI,
      'TEST_MONGO_URI must be published before the test process starts',
    );
    assert.match(process.env.TEST_MONGO_URI, /^mongodb:\/\//);
  });

  it('boots the per-suite Server against the shared Mongo', async () => {
    await mongoose.connection.asPromise(); // resolves once the connection is open
    assert.equal(mongoose.connection.readyState, 1);
    // startTestServer derives a fresh per-suite DB (TEST_<uuid>) from the shared
    // URI — proof the extracted init flowed through to this process correctly.
    assert.match(mongoose.connection.name, /^TEST_/);
  });

  it('serves HTTP from the booted server', async () => {
    const { status } = await fetch(getTestServerURL('/')).catch(() => ({
      status: 500,
    }));
    assert.equal(status, 200);
  });
});
