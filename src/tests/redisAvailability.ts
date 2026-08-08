/**
 * Redis reachability probe for tests.
 *
 * `@redis/client` is an optional peer and redis is no longer required to run the
 * framework, so a clean checkout with no redis must not produce red tests. The
 * redis-backed suites previously timed out at 10s each with no explanation —
 * a contributor's first impression was two failures and a 20s stall.
 *
 * A bare TCP connect is deliberate: node-redis retries the initial connect with
 * backoff rather than rejecting, so asking the client itself "are you up?" hangs
 * instead of answering. One socket, short timeout, no dependency on the optional
 * peer being installed at all.
 */

import net from 'node:net';
import redisConfig from '../config/redis.ts';

/** `redis://host:port` → `{ host, port }`, defaulting to redis's 6379. */
function redisTarget(): { host: string; port: number } {
  try {
    const url = new URL(redisConfig.url);
    return {
      host: url.hostname || 'localhost',
      port: Number(url.port) || 6379,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

let cached: Promise<boolean> | null = null;

/**
 * Can we open a TCP socket to the configured redis? Probed once per process.
 *
 * The timeout is deliberately generous: `node:test` starts many file processes
 * at once, and a short budget made the probe lose the race under that load —
 * one suite skipped while its sibling ran against the SAME live redis. A skip
 * that depends on machine load is worse than no skip at all.
 */
export function isRedisReachable(timeoutMs = 3000): Promise<boolean> {
  if (!cached) {
    const { host, port } = redisTarget();
    cached = new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      const done = (reachable: boolean) => {
        socket.destroy();
        resolve(reachable);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }
  return cached;
}

/**
 * `false` when redis is up (run the suite), or a reason string when it is not —
 * exactly the shape `describe(name, { skip }, fn)` wants, so the reason is
 * printed instead of the suite silently vanishing.
 */
export async function redisSkip(): Promise<false | string> {
  // An explicitly set REDIS_URI means the environment PROMISES a redis — CI
  // sets it alongside the service container. Never skip there: a probe that
  // lost a race would silently turn a real regression into a green run.
  if (process.env.REDIS_URI) {
    return false;
  }
  if (await isRedisReachable()) {
    return false;
  }
  const { host, port } = redisTarget();
  return `redis not reachable at ${host}:${port} — start one with \`npm run redis:docker\``;
}
