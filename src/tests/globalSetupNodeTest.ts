/**
 * node:test global setup/teardown — the `--test-global-setup` entry module.
 *
 * Runs ONCE before/after the entire test run. It boots the in-memory Mongo and
 * publishes `TEST_MONGO_URI`; the child test processes inherit it. This is the
 * single entry point for the node:test suite — no per-file Mongo init, no manual
 * process spawning.
 *
 * Wire it up (see the `test:node` script):
 *   node --test --test-global-setup=./src/tests/globalSetupNodeTest.ts 'glob'
 *
 * `--test-global-setup` is Stability 1 (experimental, added in Node v24) — the
 * only API surface used here is env-var hand-off, which is the stable subset.
 */
import { startTestMongo, stopTestMongo } from './setupFramework.ts';

export async function globalSetup(): Promise<void> {
  process.env.FRAMEWORK_TEST = '1';
  await startTestMongo(); // publishes process.env.TEST_MONGO_URI for child processes
}

export async function globalTeardown(): Promise<void> {
  await stopTestMongo();
}
