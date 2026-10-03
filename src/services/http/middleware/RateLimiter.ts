import { createHash } from 'node:crypto';
import merge from 'deepmerge';
import type { NextFunction, Response } from 'express';
import mongoose from 'mongoose';
import type {
  RateLimiterAbstract,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import {
  RateLimiterMemory,
  RateLimiterMongo,
  RateLimiterRedis,
} from 'rate-limiter-flexible';
import type rateLimiterConfig from '../../../config/rateLimiter.js';
import { makeOncePerClassWarner } from '../../../helpers/deprecation.ts';
import type { IApp } from '../../../server.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { HttpError } from '../httpErrors.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';

const warnMisspelledKeyOverride = makeOncePerClassWarner(
  'ASF_DEP_RATE_LIMITER_KEY_METHOD',
  (name) =>
    `Middleware "${name}" overrides RateLimiter.gerenateConsumeKey, which is renamed to generateConsumeKey. Rename the override — the old name will be removed in v6.`,
);

class RateLimiter extends AbstractMiddleware {
  static get description() {
    return 'Rate limiter middleware. Limit amount of request. Please refer to documentation';
  }

  finalOptions: typeof rateLimiterConfig;
  limiter!: RateLimiterAbstract;

  /**
   * Resolves once the limiter is built. Only the redis driver is async (it
   * lazy-loads `@redis/client`); memory/mongo build synchronously, so this stays
   * an already-resolved promise for them. `middleware()` awaits it before the
   * first request.
   */
  whenReady: Promise<void> = Promise.resolve();

  constructor(app: IApp, params?: Record<string, unknown>) {
    super(app, params);
    const limiterOptions = this.app.getConfig('rateLimiter');
    this.finalOptions = merge(
      limiterOptions,
      params || {},
    ) as typeof rateLimiterConfig;

    switch (this.finalOptions.driver) {
      case 'memory':
        this.limiter = new RateLimiterMemory(this.finalOptions.limiterOptions);
        break;

      case 'redis':
        // Defer: the redis path lazy-loads `@redis/client` so the package only
        // loads when the redis driver is actually used. memory/mongo never reach
        // here, so importing RateLimiter no longer forces redis into the graph.
        this.whenReady = this.initRedisLimiter();
        break;

      case 'mongo':
        this.limiter = new RateLimiterMongo({
          storeClient: mongoose.connection,
          disableIndexesCreation: process.env.TEST === 'true', // disable in test env, but we can still overrite it later
          // Memory fallback so a Mongo outage doesn't drop limiting entirely.
          insuranceLimiter: new RateLimiterMemory(
            this.finalOptions.limiterOptions,
          ),
          ...this.finalOptions.limiterOptions,
        });
        break;

      default:
        this.logger?.error(
          `Unknwon option for driver ${this.finalOptions.driver}`,
        );
        break;
    }
  }

  async initRedisLimiter() {
    try {
      // Dynamic-import the helper so `@redis/client` only loads on the redis
      // path. `getRedisClientSync` returns immediately (connect runs in the
      // background) — like the old static import, so the limiter builds without
      // blocking, and a down redis is absorbed by the memory insurance below
      // rather than leaving `this.limiter` unbuilt.
      const { getRedisClientSync } = await import(
        '../../../helpers/redis/redisConnection.ts'
      );
      const redisClient = getRedisClientSync();
      this.limiter = new RateLimiterRedis({
        storeClient: redisClient,
        useRedisPackage: true,
        // Memory fallback so a Redis outage doesn't drop limiting entirely; the
        // library serves from this when the store errors, and doc-10's fail-open
        // in `consumeResult` is the last resort.
        insuranceLimiter: new RateLimiterMemory(
          this.finalOptions.limiterOptions,
        ),
        ...this.finalOptions.limiterOptions,
      });
    } catch (e) {
      // Leave `this.limiter` undefined so `middleware()` returns 500 (same as an
      // unknown driver) rather than crashing — e.g. `@redis/client` not installed.
      this.logger?.error(
        `RateLimiter redis init failed (is '@redis/client' installed?): ${e}`,
      );
    }
  }

  generateConsumeKey(req: FrameworkRequest & GetUserByTokenAppInfo) {
    const { ip, route, user, request } = this.finalOptions.consumeKeyComponents;

    const key = [];
    if (ip) {
      if (!req.appInfo.ip) {
        this.logger?.error(
          `RateLimiter: Can't get remote address from request. Please check that you used IpDetecor middleware before RateLimiter`,
        );
      } else {
        key.push(req.appInfo.ip);
      }
    }
    if (route) {
      // Concrete URLs are attacker-controlled: aliases and different IDs
      // must consume the registered route's budget. A global/unmatched limiter
      // uses one fixed bucket until routing has established a template.
      const method =
        req.method === 'HEAD' &&
        req.route?.methods?.get &&
        !req.route?.methods?.head
          ? 'GET'
          : (req.method ?? 'ALL');
      key.push(`${method}:${req.route?.path ?? 'unmatched'}`);
    }
    if (user && req.appInfo?.user) {
      key.push(req.appInfo?.user.id);
    }

    if (request?.length) {
      // Raw body, before validation: fold the spellings a normalizing lookup
      // treats as one account (case, surrounding spaces, compatibility forms),
      // or each variant gets a fresh budget.
      const fields: [string, string][] = [];
      for (const field of request) {
        const value = req.body?.[field];
        if (typeof value !== 'string' && typeof value !== 'number') {
          continue;
        }
        const normalized = String(value).normalize('NFKC').trim().toLowerCase();
        if (normalized) {
          fields.push([field, normalized]);
        }
      }
      // Hashed: bounds the key size and keeps request values (often e-mails)
      // out of stored keys and the 429 log line.
      if (fields.length) {
        key.push(
          createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
        );
      }
    }

    return key.join('_');
  }

  /** @deprecated Misspelled; use {@link generateConsumeKey}. Removed in v6. */
  gerenateConsumeKey(req: FrameworkRequest & GetUserByTokenAppInfo) {
    return this.generateConsumeKey(req);
  }

  async consumeResult(consumeKey: string, consumePoints = 0) {
    try {
      const result = await this.limiter.consume(
        consumeKey,
        consumePoints || this.finalOptions.consumePoints,
      );
      return { isAllowed: true, retryAfter: 0, ...result };
    } catch (e: unknown) {
      // `rate-limiter-flexible` rejects with a `RateLimiterRes` (plain object)
      // when the limit is hit, but with an `Error` when the backing store
      // (Redis/Mongo) fails. A store outage must NOT turn every request into a
      // 429 — fail open (the insurance limiter above absorbs most cases, so this
      // is the last resort). `RateLimiterRes` is not an Error, so `instanceof`
      // is a reliable discriminator.
      if (e instanceof Error) {
        this.logger?.error(
          `RateLimiter store failure for key '${consumeKey}': ${e}`,
        );
        return { isAllowed: true, retryAfter: 0, storeFailure: true };
      }
      this.logger?.warn(`Too many requests. Consume key: ${consumeKey}`);
      const result = e as RateLimiterRes;
      const retryAfter = Math.round(result.msBeforeNext / 1000) || 1;

      return { isAllowed: false, retryAfter, ...result };
    }
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    // No-op for memory/mongo (already resolved); awaits the lazy redis build on
    // the first request only.
    await this.whenReady;
    if (!this.limiter) {
      this.logger?.info(
        `RateLimiter not inited correclty! Please check init logs `,
      );
      return res.status(500).json({ message: 'RateLimiter error' });
    }

    // The redis `namespace` prefixes the consume key regardless of driver
    // (memory/mongo too) — intentional, so keys stay stable across a driver
    // switch. Not a redis dependency; don't "fix" it to be redis-only.
    const { namespace } = this.app.getConfig('redis');

    // A subclass still overriding the misspelled name keeps its custom key.
    let key: string;
    if (this.gerenateConsumeKey !== RateLimiter.prototype.gerenateConsumeKey) {
      warnMisspelledKeyOverride(this.constructor);
      key = this.gerenateConsumeKey(req);
    } else {
      key = this.generateConsumeKey(req);
    }
    const consumeKey = `${namespace}-${key}`;

    const consumeResult = await this.consumeResult(consumeKey);
    if (consumeResult.isAllowed) {
      return next();
    }

    throw new HttpError(429, {
      code: 'TOO_MANY_REQUESTS',
      i18nKey: 'middleware.rateLimiter.tooManyRequests',
      message: 'Too Many Requests',
      headers: { 'Retry-After': String(consumeResult.retryAfter) },
    });
  }
}

export default RateLimiter;
