import type { RedisClientType } from '@redis/client';

export const clearNamespace = async (
  redisClient: RedisClientType,
  namespace: string,
) => {
  const deletedKeys = [];

  const keys = await redisClient.sendCommand<string[]>([
    'keys',
    `*${namespace}*`,
  ]);

  if (keys && keys.length > 0) {
    for (const key of keys) {
      deletedKeys.push(redisClient.sendCommand(['del', key]));
    }
    await Promise.all(deletedKeys);
  }
};
