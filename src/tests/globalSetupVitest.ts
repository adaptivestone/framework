// Vitest global setup delegates to the runner-agnostic Mongo lifecycle.
import { startTestMongo, stopTestMongo } from './setupFramework.ts';

let isTeardown = false;

const setup = async () => {
  process.env.FRAMEWORK_TEST = '1';
  await startTestMongo();
};

const teardown = async () => {
  if (isTeardown) {
    throw new Error('teardown called twice');
  }
  isTeardown = true;
  await stopTestMongo();
};

export { setup, teardown };
