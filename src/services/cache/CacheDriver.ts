/**
 * A cache backend. The {@link Cache} orchestrator owns namespacing, request
 * dedup, JSON/bigint (de)serialization and fail-soft degradation — a driver only
 * stores and retrieves already-serialized string values by key.
 *
 * Drivers surface real backend failures by **throwing**: the orchestrator
 * catches them and degrades (recompute on a read failure, best-effort write).
 * Drivers must not swallow errors themselves.
 */
export interface CacheDriver {
  /** Resolves once the driver is usable (e.g. a connection is open). */
  whenReady?: Promise<void>;
  /** Return the stored string for `key`, or `null` if absent. */
  get(key: string): Promise<string | null>;
  /** Store `value` under `key` for `ttlSeconds` seconds. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Delete `key`; resolves to the number of keys removed (0 or 1). */
  del(key: string): Promise<number>;
}
