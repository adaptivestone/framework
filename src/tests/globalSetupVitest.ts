// vitest globalSetup: runs once per test run. Delegates the in-memory Mongo
// lifecycle to the runner-agnostic `setupFramework.ts`.
import { startTestMongo, stopTestMongo } from './setupFramework.ts';

let isTeardown = false;

const setup = async () => {
  console.log('GLOBAL SETUP PREPARE RUNNING...');
  console.time('GLOBAL TEST PREPARE. DONE');
  await startTestMongo();
  console.timeEnd('GLOBAL TEST PREPARE. DONE');
};

const teardown = async () => {
  if (isTeardown) {
    throw new Error('teardown called twice');
  }
  isTeardown = true;
  console.log('GLOBAL TEARDOWN RUNNING...');
  console.time('GLOBAL TEARDOWN RUNNING. DONE');
  await stopTestMongo();
  console.timeEnd('GLOBAL TEARDOWN RUNNING. DONE');
};

export { setup, teardown };
