import Base from '../../modules/Base';
import Server from '../../server';

declare class Cache extends Base {
  app: Server['app'];

  constructor(app: Server['app']);

  /**
   * Get value from cache. Set and get if not eists
   * @param key key to check
   * @param onNotFound callback that will be executed if value not found on cahce
   * @param storeTime how long we should store value on cache
   */
  getSetValue(
    key: String,
    onNotFound: () => Promise<any>,
    storeTime: number,
  ): Promise<any>;
}

export = Cache;
