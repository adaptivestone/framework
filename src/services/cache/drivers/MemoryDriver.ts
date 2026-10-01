import type { CacheDriver } from '../CacheDriver.ts';

interface Entry {
  value: string;
  expiresAt: number;
  timer?: NodeJS.Timeout;
}

// Node fires a longer `setTimeout` delay after 1 ms instead (with a warning).
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Default cache driver: a per-process `Map` with per-key TTL. Reads check the
 * expiry time; a timer removes entries nobody reads again. Needs no external
 * service, which is what makes `@redis/client` an optional dependency.
 * Per-process only — multi-node deployments that need a shared cache should
 * configure the redis driver.
 */
class MemoryDriver implements CacheDriver {
  #store = new Map<string, Entry>();

  async get(key: string): Promise<string | null> {
    const entry = this.#store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.#remove(key, entry);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    // A non-positive TTL never stores (issue #10): storing without a timer would
    // strand an immortal entry, so converge on redis' `EX <= 0` = no-cache and
    // leave any existing entry untouched (redis rejects the write, not the key).
    if (ttlSeconds <= 0) {
      return;
    }
    const existing = this.#store.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const entry: Entry = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
    this.#store.set(key, entry);
    this.#schedule(key, entry);
  }

  async del(key: string): Promise<number> {
    const existing = this.#store.get(key);
    if (!existing) {
      return 0;
    }
    this.#remove(key, existing);
    return 1;
  }

  /** Arm the cleanup timer; a TTL beyond the timer limit re-arms on wake. */
  #schedule(key: string, entry: Entry): void {
    const delay = Math.min(
      Math.max(entry.expiresAt - Date.now(), 0),
      MAX_TIMER_MS,
    );
    entry.timer = setTimeout(() => {
      if (this.#store.get(key) !== entry) {
        return;
      }
      if (entry.expiresAt <= Date.now()) {
        this.#store.delete(key);
      } else {
        this.#schedule(key, entry);
      }
    }, delay);
    // `unref` so a pending expiry never keeps the process alive.
    entry.timer.unref?.();
  }

  #remove(key: string, entry: Entry): void {
    clearTimeout(entry.timer);
    this.#store.delete(key);
  }
}

export default MemoryDriver;
