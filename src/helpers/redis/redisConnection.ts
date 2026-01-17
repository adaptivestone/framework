import type { RedisClientType } from '@redis/client';
import { createClient } from '@redis/client';
import { appInstance } from '../appInstance.ts';

let redisClient: RedisClientType | null = null;

export const getRedisClient = async (): Promise<RedisClientType> => {
  if (redisClient) {
    return redisClient;
  }
  const redisClientLocal = createNewRedisClient();
  await redisClientLocal.connect();

  return redisClientLocal;
};

/**
 * Synchronous way to get redis client. Make sure to call connect on it before usage
 */
export const getRedisClientSync = (): RedisClientType => {
  if (redisClient) {
    return redisClient;
  }
  const redisClientLocal = createNewRedisClient();
  // to make sure connection is established
  (async () => {
    await redisClientLocal.connect();
  })();

  return redisClientLocal;
};

const createNewRedisClient = (): RedisClientType => {
  if (redisClient) {
    return redisClient;
  }

  const redisConfig = appInstance.getConfig('redis') as {
    url: string;
  };

  redisClient = createClient({
    url: redisConfig.url,
  });

  redisClient.on('error', (error, b, c) => {
    appInstance.logger?.error('Redis Client Error', error, b, c);
  });

  redisClient.on('connect', () => {
    appInstance.logger?.info('Redis connection established');
  });

  appInstance.events.on('shutdown', async () => {
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
    }
  });
  return redisClient;
};
