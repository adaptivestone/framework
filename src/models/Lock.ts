import type { MongoError } from "mongodb";
import type { Schema } from "mongoose";
import type {
  ExtractProperty,
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from "../modules/BaseModel.ts";
import { BaseModel } from "../modules/BaseModel.ts";

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
      ExtractProperty<typeof Lock, "schemaOptions">
    >;

    return {
      /**
       * acquire lock based on lock name
       * @param {string} name
       * @param {number} [ttlSeconds=30]
       */
      acquireLock: async function (
        this: LockModelLite,
        name: string,
        ttlSeconds = 30,
      ) {
        try {
          await this.create({
            _id: name,
            expiredAt: new Date(Date.now() + ttlSeconds * 1000),
          });
        } catch (error: unknown) {
          if ((error as MongoError).code !== 11000) {
            // not a duplicate keys
            throw error;
          }
          return false;
        }
        return true;
      },

      /**
       * release lock based on lock name
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
       * wait lock based on lock name
       * @param {string} name
       */
      waitForUnlock: async function (this: LockModelLite, name: string) {
        const res = await this.findOne({ _id: name });
        if (!res) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          const stream = this.watch([
            { $match: { operationType: "delete", "documentKey._id": name } },
          ]);
          stream.on("change", () => {
            stream.close();
            resolve(true);
          });
        });
      },

      /**
       * get lock remaining time based on lock name
       * @param {string} name
       */
      getLockData: async function (this: LockModelLite, name: string) {
        const res = await this.findOne({ _id: name });
        if (!res || !res.expiredAt) {
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
            ttl:
              lock && lock.expiredAt
                ? lock.expiredAt.getTime() - Date.now()
                : 0,
          };
        });
      },
    } as const;
  }
}

export default Lock;
