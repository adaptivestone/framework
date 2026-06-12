import type { RedisClientType } from '@redis/client';

export const clearNamespace = async (
  redisClient: RedisClientType,
  namespace: string,
) => {
  // SCAN (non-blocking) with a `${namespace}-*` prefix match — the cache and
  // rate limiter prefix every key with `${namespace}-`. `KEYS *namespace*`
  // blocks Redis and its substring match could delete other namespaces' keys.
  const deletedKeys: Promise<unknown>[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redisClient.sendCommand<[string, string[]]>([
      'SCAN',
      cursor,
      'MATCH',
      `${namespace}-*`,
      'COUNT',
      '100',
    ]);
    cursor = next;
    for (const key of keys) {
      deletedKeys.push(redisClient.sendCommand(['DEL', key]));
    }
  } while (cursor !== '0');

  await Promise.all(deletedKeys);
};
