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

process.env.FRAMEWORK_TEST = '1';

const isFrameworkSetupSkipped = process.argv.some((argument) =>
  argument.endsWith('/cluster.test.ts'),
);

before(async () => {
  if (isFrameworkSetupSkipped) {
    return;
  }
  // node:test runs a root `before()` registered from a `--import` preload
  // immediately — synchronously inside the `before()` call, while the preload
  // graph is still evaluating. Booting right here would consume the
  // `configureTestServer` options window before the preload's own module body
  // (below its hoisted imports) ever ran. Yield one microtask so the boot
  // starts after the preload finishes evaluating.
  await null;
  await ensureTestServerReady();
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
