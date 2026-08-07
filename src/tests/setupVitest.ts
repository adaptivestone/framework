// Vitest glue for the runner-agnostic lifecycle in `setupFramework.ts`.
// Global Mongo lifecycle is provided by `globalSetupVitest.ts`.
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import {
  clearTestRedisNamespace,
  setTestRedisNamespace,
  startTestServer,
  stopTestServer,
} from './setupFramework.ts';

process.env.FRAMEWORK_TEST = '1';

beforeAll(startTestServer);
beforeEach(setTestRedisNamespace);
afterEach(clearTestRedisNamespace);
afterAll(stopTestServer);
