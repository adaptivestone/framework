// Framework-repository-only setup. Consumer projects should create their own
// fixture user from project hooks when their suites need one.
import { before } from 'node:test';
import { createDefaultTestUser, ensureTestServerReady } from './testHelpers.ts';

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
