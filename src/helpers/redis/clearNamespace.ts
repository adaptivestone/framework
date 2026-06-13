import type { RedisClientType } from '@redis/client';

/**
 * Delete every cache / rate-limiter key under a namespace.
 *
 * WARNING: keys are matched by the `${namespace}-` prefix, so namespaces must
 * not be prefixes of one another. Clearing `main` ALSO deletes `main-eu-*`
 * keys — `main-eu-foo` is indistinguishable from a `main` key named `eu-foo`.
 * Choose namespaces that are not prefixes of each other.
 */
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
