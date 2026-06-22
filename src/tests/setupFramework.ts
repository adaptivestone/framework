/**
 * Runner-agnostic test setup. Plain async functions with **no test-runner
 * import** (no vitest, no `node:test`) so the framework's test lifecycle can be
 * driven from either runner — or programmatically.
 *
 * - vitest glue: `setupVitest.ts` (per-file) + `globalSetupVitest.ts` (once).
 * - node:test glue: `setupNodeTest.ts`.
 *
 * Lifecycle pieces:
 * - `startTestMongo` / `stopTestMongo` — once per run; spins up an in-memory
 *   Mongo replica set and publishes `process.env.TEST_MONGO_URI`.
 * - `startTestServer` / `stopTestServer` — once per test file/suite; boots a
 *   framework `Server` against a fresh DB and tears it down.
 * - `setTestRedisNamespace` / `clearTestRedisNamespace` — per test; isolate the
 *   cache/rate-limiter keyspace.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import mongoose from 'mongoose'; // we do not need create indexes on tests
import type redisConfig from '../config/redis.ts';
import { clearNamespace } from '../helpers/redis/clearNamespace.ts';
import Server from '../server.ts';
import { serverInstance, setServerInstance } from './testHelpers.ts';

mongoose.set('autoIndex', false);

const basePath = new URL('.', import.meta.url).pathname;

// ── Global Mongo lifecycle (once per test run) ──────────────────────────────

// Only `.stop()` is needed at module scope; the full type comes from the lazy
// import inside `startTestMongo` so merely importing this module doesn't pull in
// `mongodb-memory-server` (an optional peer — a node:test consumer may supply
// `TEST_MONGO_URI` from an external Mongo instead).
let mongoServer: { stop: () => Promise<unknown> } | null = null;

/** Start an in-memory Mongo replica set and publish `TEST_MONGO_URI`. */
export async function startTestMongo(): Promise<string> {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const instance = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await instance.waitUntilRunning();
  mongoServer = instance;
  const uri = await instance.getUri('__DB_TO_REPLACE__');
  process.env.TEST_MONGO_URI = uri;
  return uri;
}

/** Stop the in-memory Mongo replica set. */
export async function stopTestMongo(): Promise<void> {
  await mongoServer?.stop();
  mongoServer = null;
}

// ── Per-suite server lifecycle ──────────────────────────────────────────────

/**
 * Boot a framework `Server` against a fresh per-suite database (derived from
 * `TEST_MONGO_URI`) and start its HTTP server on a random port. Registers the
 * instance via `setServerInstance` so `testHelpers` can reach it.
 */
export async function startTestServer(): Promise<Server> {
  process.env.LOGGER_CONSOLE_LEVEL = 'error';
  process.env.AUTH_SALT = crypto.randomBytes(16).toString('hex');
  const server = new Server({
    folders: {
      config:
        process.env.TEST_FOLDER_CONFIG || path.resolve(basePath, '../config'),
      controllers:
        process.env.TEST_FOLDER_CONTROLLERS ||
        path.resolve(basePath, '../controllers'),
      models:
        process.env.TEST_FOLDER_MODELS || path.resolve(basePath, '../models'),
      emails:
        process.env.TEST_FOLDER_EMAIL ||
        process.env.TEST_FOLDER_EMAILS ||
        path.resolve(basePath, '../services/messaging/email/templates'),
      locales:
        process.env.TEST_FOLDER_LOCALES || path.resolve(basePath, '../locales'),
      commands:
        process.env.TEST_FOLDER_COMMANDS ||
        path.resolve(basePath, '../commands'),
      migrations:
        process.env.TEST_FOLDER_MIGRATIONS ||
        path.resolve(basePath, '../migrations'),
    },
  });
  setServerInstance(server);

  await server.init({ isSkipModelInit: true });
  const connectionString = (process.env.TEST_MONGO_URI as string).replace(
    '__DB_TO_REPLACE__',
    `TEST_${crypto.randomUUID()}`,
  );
  server.updateConfig('mongo', { connectionString });
  server.updateConfig('http', { port: 0 }); // allow to use random
  server.updateConfig('mail', { transport: 'stub' });
  // Use the in-memory rate limiter for the default (controller-mounted) limiter:
  // it's synchronous, so it can't time out and fail-open under the CPU load of
  // parallel workers (which made the Auth 429 test flaky). The Mongo/Redis
  // drivers are still covered explicitly in RateLimiter.test.ts.
  server.updateConfig('rateLimiter', { driver: 'memory' });
  // scrypt is memory-hard: the production ln=17 (~0.5s/hash) run across parallel
  // workers starves each other and trips hook timeouts. Lower the cost for tests
  // (~15ms/hash). The verify/rehash paths read this same config, so the v2
  // round-trip and upgrade logic are still exercised.
  server.updateConfig('auth', { scrypt: { ln: 12, r: 8, p: 1 } });
  await server.initAllModels();
  await server.startServer();
  return server;
}

/** Shut down the server, drop its database, and disconnect mongoose. */
export async function stopTestServer(): Promise<void> {
  if (serverInstance) {
    serverInstance.app.httpServer?.shutdown();
    serverInstance.app.events.emit('shutdown');
  }
  try {
    await mongoose.connection.db?.dropDatabase(); // clean database after test
  } catch {
    // that ok. No mongoose connection
  }
  await mongoose.disconnect();
}

// ── Per-test redis namespace isolation ──────────────────────────────────────

/** Point the cache/rate-limiter keyspace at a fresh random namespace. */
export function setTestRedisNamespace(): void {
  if (serverInstance) {
    const key = `test-${Math.random().toString(36).substring(7)}`;
    serverInstance.app.updateConfig('redis', { namespace: key });
  }
}

/** Best-effort clear of the current test's redis namespace (no-op without redis). */
export async function clearTestRedisNamespace(): Promise<void> {
  if (!serverInstance) {
    return;
  }
  const { url, namespace } = serverInstance.getConfig(
    'redis',
  ) as typeof redisConfig;
  try {
    // Lazy-import `@redis/client` so a memory-only consumer that uses this test
    // setup never loads the (optional) redis package.
    const { createClient } = await import('@redis/client');
    const redisClient = createClient({ url });
    await redisClient.connect();
    await clearNamespace(redisClient, namespace);
    await redisClient.destroy();
  } catch {
    // that ok. No redis connection
  }
}
