import AbstractModel from '../modules/AbstractModel.ts';
import type {
  IAbstractModel,
  IAbstractModelMethods,
} from '../modules/AbstractModel.ts';

import type { MongoError } from 'mongodb';

interface ILock {
  _id: string;
  expiredAt: Date;
}

interface IStatic extends IAbstractModel<ILock, IAbstractModelMethods<ILock>> {
  acquireLock(name: string, ttlSeconds?: number): Promise<boolean>;
  releaseLock(name: string): Promise<boolean>;
  waitForUnlock(name: string): Promise<void>;
  getLockData(name: string): Promise<{ ttl: number }>;
  getLocksData(names: string[]): Promise<{ name: string; ttl: number }[]>;
}

class Lock extends AbstractModel<ILock, IAbstractModelMethods<ILock>, IStatic> {
  initHooks() {
    this.mongooseSchema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 });
  }

  // eslint-disable-next-line class-methods-use-this
  get modelSchema() {
    return {
      _id: { type: String, required: true },
      expiredAt: {
        type: Date,
      },
    };
  }

  /**
   * acquire lock based on lock name
   * @param {string} name
   * @param {number} [ttlSeconds=30]
   */
  static async acquireLock(
    this: Lock['mongooseModel'],
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
        // not a duplicate leys
        throw error;
      }
      return false;
    }
    return true;
  }

  /**
   * release lock based on lock name
   * @param {string} name
   */
  static async releaseLock(this: Lock['mongooseModel'], name: string) {
    const res = await this.deleteOne({ _id: name });
    if (res.acknowledged && res.deletedCount) {
      return true;
    }
    return false;
  }

  /**
   * wait lock based on lock name
   * @param {string} name
   */
  static async waitForUnlock(this: Lock['mongooseModel'], name: string) {
    const res = await this.findOne({ _id: name });
    if (!res) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const stream = this.watch([
        { $match: { operationType: 'delete', 'documentKey._id': name } },
      ]);
      stream.on('change', () => {
        stream.close();
        resolve(true);
      });
    });
  }

  /**
   * get lock remaining time based on lock name
   * @param {string} name
   */
  static async getLockData(this: Lock['mongooseModel'], name: string) {
    const res = await this.findOne({ _id: name });
    if (!res) {
      return { ttl: 0 };
    }
    return { ttl: res.expiredAt.getTime() - Date.now() };
  }

  /**
   * get lock remaining time based on lock name
   * @param {string[]} names
   */
  static async getLocksData(this: Lock['mongooseModel'], names: string[]) {
    const res = await this.find({ _id: { $in: names } });
    const lockMap = new Map(res.map((lock) => [lock._id, lock]));

    return names.map((name) => {
      const lock = lockMap.get(name);
      return {
        name,
        ttl: lock ? lock.expiredAt.getTime() - Date.now() : 0,
      };
    });
  }
}

export default Lock;
