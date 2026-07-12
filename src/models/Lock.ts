import type { MongoError } from 'mongodb';
import type { Schema } from 'mongoose';
import type {
  ExtractProperty,
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../modules/BaseModel.ts';
import { BaseModel } from '../modules/BaseModel.ts';

export type TLock = GetModelTypeFromClass<typeof Lock>;

class Lock extends BaseModel {
  static initHooks(schema: Schema) {
    schema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 });
  }

  static get modelSchema() {
    return {
      _id: { type: String, required: true },
      expiredAt: {
        type: Date,
      },
    } as const;
  }

  static get modelStatics() {
    type LockModelLite = GetModelTypeLiteFromSchema<
      typeof Lock.modelSchema,
      ExtractProperty<typeof Lock, 'schemaOptions'>
    >;

    return {
      /**
       * Acquire an advisory lock by name. Locks have NO ownership token: any
       * caller may release any lock, so only release from the flow that
       * acquired it. Steal-if-expired is atomic — an expired lock is reclaimed
       * immediately rather than waiting on Mongo's TTL reaper (which lags up to
       * ~60s). The TTL index stays as garbage collection.
       * @param {string} name
       * @param {number} [ttlSeconds=30]
       */
      acquireLock: async function (
        this: LockModelLite,
        name: string,
        ttlSeconds = 30,
      ) {
        try {
          // Absent → upsert inserts (acquired). Present & expired (or with a
          // missing/null `expiredAt`, which `$lt` alone would never match and the
          // TTL reaper ignores) → filter matches, update steals it (acquired).
          // Present & live → filter misses, upsert tries to insert the same _id →
          // E11000 → not acquired. The documented upsert-race-safe pattern.
          await this.findOneAndUpdate(
            {
              _id: name,
              $or: [{ expiredAt: { $lt: new Date() } }, { expiredAt: null }],
            },
            { expiredAt: new Date(Date.now() + ttlSeconds * 1000) },
            { upsert: true },
          );
        } catch (error: unknown) {
          if ((error as MongoError).code !== 11000) {
            // a real DB error, not a duplicate key — surface it
            throw error;
          }
          // E11000: a live (unexpired) lock already exists
          return false;
        }
        return true;
      },

      /**
       * Release an advisory lock by name. Unconditional: this does NOT verify
       * the caller still holds the lock (no ownership token), so a lock that
       * expired and was re-acquired by another worker can be released by the
       * original holder. Release only from the flow that acquired it.
       * @param {string} name
       */
      releaseLock: async function (this: LockModelLite, name: string) {
        const res = await this.deleteOne({ _id: name });
        if (res.acknowledged && res.deletedCount) {
          return true;
        }
        return false;
      },

      /**
       * Resolve once the named lock is gone. Optionally reject after
       * `timeoutMs` so callers can bound the wait.
       * @param {string} name
       * @param {number} [timeoutMs] reject after this many ms if still locked
       */
      waitForUnlock: async function (
        this: LockModelLite,
        name: string,
        timeoutMs?: number,
      ) {
        // The driver opens the change-stream cursor lazily on the first
        // 'change' listener and only then fixes its server-side start point.
        // Checking existence BEFORE that point leaves a window where a delete
        // is missed forever. So: attach the listener (opening the cursor),
        // wait for 'resumeTokenChanged' — the wrapper's first signal that the
        // aggregate has run and the start point is fixed — and only then read.
        // A delete after that point is guaranteed observed; if the lock is
        // already gone, the re-check resolves.
        const stream = this.watch([
          { $match: { operationType: 'delete', 'documentKey._id': name } },
        ]);
        try {
          return await new Promise((resolve, reject) => {
            stream.on('change', () => resolve(true));
            // A standalone Mongo (change streams need a replica set) or a stream
            // failure emits 'error'; unhandled, it would crash the process.
            stream.on('error', reject);
            stream.once('resumeTokenChanged', () => {
              this.findOne({ _id: name })
                .then((exists) => {
                  if (!exists) {
                    resolve(undefined);
                  }
                })
                .catch(reject);
            });
            if (timeoutMs) {
              setTimeout(
                () => reject(new Error(`waitForUnlock('${name}') timed out`)),
                timeoutMs,
              ).unref();
            }
          });
        } finally {
          await stream.close().catch(() => {});
        }
      },

      /**
       * get lock remaining time based on lock name
       * @param {string} name
       */
      getLockData: async function (this: LockModelLite, name: string) {
        const res = await this.findOne({ _id: name });
        if (!res?.expiredAt) {
          return { ttl: 0 };
        }
        return { ttl: res.expiredAt.getTime() - Date.now() };
      },

      /**
       * get lock remaining time based on lock name
       * @param {string[]} names
       */
      getLocksData: async function (this: LockModelLite, names: string[]) {
        const res = await this.find({ _id: { $in: names } });
        const lockMap = new Map(res.map((lock) => [lock._id, lock]));

        return names.map((name) => {
          const lock = lockMap.get(name);
          return {
            name,
            ttl: lock?.expiredAt ? lock.expiredAt.getTime() - Date.now() : 0,
          };
        });
      },
    } as const;
  }
}

export default Lock;
