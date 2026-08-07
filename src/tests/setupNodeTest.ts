// node:test glue for the runner-agnostic lifecycle in `setupFramework.ts`.
// `globalSetupNodeTest.ts` starts one shared Mongo before the test processes;
// consumers may instead provide an external `TEST_MONGO_URI`.
import { after, afterEach, before, beforeEach } from 'node:test';
import {
  clearTestRedisNamespace,
  ensureTestServerReady,
  setTestRedisNamespace,
  stopTestServer,
} from './setupFramework.ts';
import { createDefaultTestUser } from './testHelpers.ts';

process.env.FRAMEWORK_TEST = '1';

const isFrameworkSetupSkipped = process.argv.some((argument) =>
  argument.endsWith('/cluster.test.ts'),
);

before(async () => {
  if (isFrameworkSetupSkipped) {
    return;
  }
  await ensureTestServerReady();
  await createDefaultTestUser();
});
beforeEach(() => {
  if (!isFrameworkSetupSkipped) {
    setTestRedisNamespace();
  }
});
afterEach(async () => {
  if (!isFrameworkSetupSkipped) {
    await clearTestRedisNamespace();
  }
});
after(async () => {
  if (!isFrameworkSetupSkipped) {
    await stopTestServer();
  }
});
