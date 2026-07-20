/**
 * node:test suite — full per-file lifecycle against the shared Mongo.
 *
 * Mongo is started ONCE by the global-setup entry module
 * (`globalSetupNodeTest.ts`, wired via `--test-global-setup` — see the
 * `test:node` script). This file never touches Mongo init; it only boots a
 * per-suite `Server` against the shared instance (via the shipped
 * `setupNodeTest.ts` glue) and exercises the full stack: a live HTTP request and
 * a Mongo write/read round-trip.
 *
 * Runs as part of `npm run test:node` (it shares one Mongo with the other
 * `*.node-test.ts` files). The `.node-test.ts` suffix keeps vitest's glob away.
 */
import './setupNodeTest.ts';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { appInstance } from '../helpers/appInstance.ts';
import type { TUser } from '../models/User.ts';
import type Server from '../server.ts';
import {
  createDefaultTestUser,
  ensureTestServerReady,
  getTestServerURL,
  serverInstance,
} from './testHelpers.ts';

let serverAwaitedBySiblingRootHook: Server;

// This is intentionally a sibling of setupNodeTest's root hook. node:test may
// start both hooks concurrently; the public helper must return the same startup
// promise and resolve only after the server is ready.
before(async () => {
  const firstReadiness = ensureTestServerReady();
  const secondReadiness = ensureTestServerReady();
  assert.strictEqual(firstReadiness, secondReadiness);
  serverAwaitedBySiblingRootHook = await firstReadiness;
});

describe('node:test: server boot + Mongo round-trip', () => {
  it('shares readiness with sibling root-level setup hooks', async () => {
    assert.strictEqual(serverAwaitedBySiblingRootHook, serverInstance);
    assert.strictEqual(await ensureTestServerReady(), serverInstance);
  });

  it('booted a Server connected to the shared Mongo', async () => {
    await mongoose.connection.asPromise(); // resolves once the connection is open
    assert.equal(mongoose.connection.readyState, 1); // 1 === connected
    assert.ok(appInstance, 'app instance should be set');
  });

  it('serves HTTP from the booted server', async () => {
    const { status } = await fetch(getTestServerURL('/')).catch(() => ({
      status: 500,
    }));
    assert.equal(status, 200);
  });

  it('round-trips through Mongo (create + read a user via the model)', async () => {
    const result = await createDefaultTestUser();
    assert.ok(result, 'default user should be created');
    assert.ok(result.token, 'an auth token should be generated');

    const User = appInstance.getModel('User') as unknown as TUser;
    const found = await User.findOne({ email: 'test@test.com' });
    assert.ok(found, 'created user should be readable back from Mongo');
  });
});
