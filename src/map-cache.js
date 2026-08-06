/**
 * Simple in-memory TTL cache for read-only map API responses.
 */
export class MapCache {
  /**
   * @param {number} ttlMs Cache lifetime in milliseconds (default 45s).
   */
  constructor(ttlMs = 45_000) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  /**
   * @param {string} key
   * @returns {{ data: unknown, fetchedAt: Date, expiresAt: Date }|null}
   */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt.getTime()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * @param {string} key
   * @param {unknown} data
   * @returns {{ data: unknown, fetchedAt: Date, expiresAt: Date }}
   */
  set(key, data) {
    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + this.ttlMs);
    const entry = { data, fetchedAt, expiresAt };
    this.entries.set(key, entry);
    return entry;
  }

  clear() {
    this.entries.clear();
  }
}
