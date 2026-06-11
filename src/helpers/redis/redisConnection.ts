import type { RedisClientType } from '@redis/client';
import { createClient } from '@redis/client';
import { appInstance } from '../appInstance.ts';

// Cache the CONNECT PROMISE, not the bare client. Caching the bare client let a
// second concurrent caller get it before `connect()` resolved (double-connect),
// and a failed first connect cached a dead client forever. `redisClient` is kept
// alongside only for the synchronous accessor.
let clientPromise: Promise<RedisClientType> | null = null;
let redisClient: RedisClientType | null = null;
let shutdownHookRegistered = false;

export const getRedisClient = (): Promise<RedisClientType> => {
  if (!clientPromise) {
    const client = buildClient();
    redisClient = client;
    clientPromise = client.connect().then(() => client);
    // A failed boot must not cache a dead client — clear the state so the next
    // call builds a fresh attempt instead of returning a never-connected client.
    clientPromise.catch(() => {
      clientPromise = null;
      redisClient = null;
    });
  }
  return clientPromise;
};

/**
 * Synchronous way to get redis client. Make sure to call connect on it before usage.
 * Connection failure is logged (not an unhandled rejection), and concurrent async
 * callers all await the same connect via {@link getRedisClient}.
 */
export const getRedisClientSync = (): RedisClientType => {
  if (!redisClient) {
    // `getRedisClient` assigns `redisClient` synchronously (before connect), so
    // it is set by the time this returns. Attach a handler so a failed connect
    // logs instead of crashing the process.
    getRedisClient().catch((e) =>
      appInstance.logger?.error(`Redis connect failed: ${e}`),
    );
  }
  return redisClient as RedisClientType;
};

const buildClient = (): RedisClientType => {
  const redisConfig = appInstance.getConfig('redis') as {
    url: string;
  };

  const client: RedisClientType = createClient({
    url: redisConfig.url,
  });

  client.on('error', (error, b, c) => {
    appInstance.logger?.error('Redis Client Error', error, b, c);
  });

  client.on('connect', () => {
    appInstance.logger?.info('Redis connection established');
  });

  // Register the shutdown hook once: it quits whichever client is current and
  // clears BOTH caches so a post-shutdown call can reconnect.
  if (!shutdownHookRegistered) {
    shutdownHookRegistered = true;
    appInstance.events.on('shutdown', async () => {
      if (redisClient?.isOpen) {
        await redisClient.quit();
      }
      redisClient = null;
      clientPromise = null;
    });
  }

  return client;
};
