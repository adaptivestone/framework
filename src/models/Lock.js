import AbstractModel from '../modules/AbstractModel.js';

class Lock extends AbstractModel {
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
   * @returns {Promise<boolean>}
   */
  static async acquireLock(name, ttlSeconds = 30) {
    try {
      await this.create({
        _id: name,
        expiredAt: new Date(Date.now() + ttlSeconds * 1000),
      });
    } catch (error) {
      if (error.code !== 11000) {
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
   * @returns {Promise<boolean>}
   */
  static async releaseLock(name) {
    const res = await this.deleteOne({ _id: name });
    if (res.acknowledged && res.deletedCount) {
      return true;
    }
    return false;
  }

  /**
   * wait lock based on lock name
   * @param {string} name
   * @returns {Promise}
   */
  static async waitForUnlock(name) {
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
        resolve();
      });
    });
  }

  /**
   * get lock remaining time based on lock name
   * @param {string} name
   * @returns {Promise<{ttl: number}>}
   */
  static async getLockData(name) {
    const res = await this.findOne({ _id: name });
    if (!res) {
      return { ttl: 0 };
    }
    return { ttl: res.expiredAt.getTime() - Date.now() };
  }

  /**
   * get lock remaining time based on lock name
   * @param {string[]} names
   * @returns {Promise<{name: string, ttl: number}[]>}
   */
  static async getLocksData(names) {
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
