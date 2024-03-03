import Base from '../../modules/Base';
import Server from '../../server.js';

declare class Cache extends Base {
  app: Server['app'];

  constructor(app: Server['app']);

  /**
   * As framework support namespaces all key for cache go through this function
   * Function return new key with added namespace
   * @param key key to add namespace
   */
  getKeyWithNameSpace(key: string): string;

  /**
   * Get value from cache. Set and get if not eists
   * @param key key to check
   * @param onNotFound callback that will be executed if value not found on cahce
   * @param storeTime how long we should store value on cache
   */
  getSetValue(
    key: string,
    onNotFound: () => Promise<any>,
    storeTime: number,
  ): Promise<any>;

  /**
   * Remove key from cache
   * @param key key to remove
   */
  removeKey(key: string): Promise<number>;
}

export default Cache;
