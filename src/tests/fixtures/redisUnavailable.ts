import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import rateLimiterConfig from '../../config/rateLimiter.ts';
import { setAppInstance } from '../../helpers/appInstance.ts';
import { noopLogger } from '../../helpers/logger.ts';
import type { IApp } from '../../server.ts';
import Cache from '../../services/cache/Cache.ts';
import RedisDriver from '../../services/cache/drivers/RedisDriver.ts';
import RateLimiter from '../../services/http/middleware/RateLimiter.ts';

// A TCP peer that never completes the Redis handshake keeps connect() pending,
// like an unreachable Redis with node-redis's default reconnect strategy.
const sockets = new Set<net.Socket>();
const peer = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
const port = (peer.address() as net.AddressInfo).port;
const app = {
  events: new EventEmitter(),
  logger: noopLogger,
  getConfig: (name: string) => {
    if (name === 'cache') {
      return { driver: 'redis' };
    }
    if (name === 'redis') {
      return { url: `redis://127.0.0.1:${port}`, namespace: 'unavailable' };
    }
    if (name === 'rateLimiter') {
      return rateLimiterConfig;
    }
    throw new Error(`Unexpected config ${name}`);
  },
} as unknown as IApp;
setAppInstance(app);
const { getRedisClientSync } = await import(
  '../../helpers/redis/redisConnection.ts'
);
const client = getRedisClientSync();
const deadline = setTimeout(() => {
  process.stderr.write('Redis operations waited for a connection\n');
  process.exit(1);
}, 2500);
try {
  const cache = new Cache(app);
  let calls = 0;
  const compute = async () => ({ value: ++calls });
  assert.deepEqual(await cache.getSetValue('key', compute), { value: 1 });
  assert.deepEqual(await cache.getSetValue('key', compute), { value: 2 });
  assert.equal(await cache.removeKey('key'), 0);
  assert.equal(cache.promiseMapping.size, 0);
  const driver = new RedisDriver();
  await assert.rejects(driver.set('key', 'value', 0.5), /not ready/);
  const limiter = new RateLimiter(app, {
    driver: 'redis',
    limiterOptions: { points: 1, duration: 60 },
  });
  await limiter.whenReady;
  assert.equal((await limiter.consumeResult('client', 1)).isAllowed, true);
  assert.equal((await limiter.consumeResult('client', 1)).isAllowed, false);
  assert.equal(client.isReady, false);
  process.stdout.write('UNAVAILABLE_REDIS_OK\n');
} finally {
  clearTimeout(deadline);
  if (client.isOpen) {
    client.destroy();
  }
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => peer.close(() => resolve()));
}
