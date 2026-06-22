import type { CacheDriver } from '../CacheDriver.ts';

interface Entry {
  value: string;
  timer?: NodeJS.Timeout;
}

/**
 * Default cache driver: a per-process `Map` with per-key TTL via `setTimeout`.
 * Needs no external service, which is what makes `@redis/client` an optional
 * dependency. Per-process only — multi-node deployments that need a shared cache
 * should configure the redis driver.
 */
class MemoryDriver implements CacheDriver {
  #store = new Map<string, Entry>();

  async get(key: string): Promise<string | null> {
    return this.#store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const existing = this.#store.get(key);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const entry: Entry = { value };
    if (ttlSeconds > 0) {
      entry.timer = setTimeout(() => {
        this.#store.delete(key);
      }, ttlSeconds * 1000);
      // `unref` so a pending expiry never keeps the process alive.
      entry.timer.unref?.();
    }
    this.#store.set(key, entry);
  }

  async del(key: string): Promise<number> {
    const existing = this.#store.get(key);
    if (!existing) {
      return 0;
    }
    if (existing.timer) {
      clearTimeout(existing.timer);
    }
    this.#store.delete(key);
    return 1;
  }
}

export default MemoryDriver;
