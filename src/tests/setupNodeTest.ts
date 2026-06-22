// node:test glue for the framework test lifecycle, mirroring `setupVitest.ts`.
// The setup logic is runner-agnostic in `setupFramework.ts`; this file only
// wires it to node:test's hooks.
//
// node:test runs each file in its own process, so there is no built-in
// run-once-globally hook like vitest's globalSetup. Ensure `TEST_MONGO_URI` is
// set before these hooks run — either start one shared Mongo outside the test
// processes (a preload that calls `startTestMongo`, see the testing docs) or
// point `TEST_MONGO_URI` at an external instance.
import { after, afterEach, before, beforeEach } from 'node:test';
import {
  clearTestRedisNamespace,
  setTestRedisNamespace,
  startTestServer,
  stopTestServer,
} from './setupFramework.ts';

before(startTestServer);
beforeEach(setTestRedisNamespace);
afterEach(clearTestRedisNamespace);
after(stopTestServer);
