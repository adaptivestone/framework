import Base from '../../modules/Base';
import Server from '../../server';

declare class Cache extends Base {
  app: Server['app'];

  constructor(app: Server['app']);

  /**
   * As framework support namespaces all key for cache go through this function
   * Function return new key with added namespace
   * @param key key to add namespace
   */
  getKeyWithNameSpace(key: String): String;

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

  /**
   * Remove key from cache
   * @param key key to remove
   */
  removeKey(key: String): Promise<number>;
}

export = Cache;
