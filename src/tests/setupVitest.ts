// vitest glue for the framework test lifecycle. The actual setup logic is
// runner-agnostic in `setupFramework.ts`; this file only wires it to vitest's
// per-file hooks. (Global Mongo lifecycle is in `globalSetupVitest.ts`.)
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import {
  clearTestRedisNamespace,
  setTestRedisNamespace,
  startTestServer,
  stopTestServer,
} from './setupFramework.ts';

beforeAll(startTestServer);
beforeEach(setTestRedisNamespace);
afterEach(clearTestRedisNamespace);
afterAll(stopTestServer);
