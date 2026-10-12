/**
 * In-Memory LRU Cache with TTL support
 * Eliminates external Redis dependency while supporting high RPS read caching.
 */
class MemoryCache {
  constructor(maxItems = 10000, defaultTTLMs = 15000) {
    this.maxItems = maxItems;
    this.defaultTTLMs = defaultTTLMs;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.misses++;
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Refresh LRU order (delete & re-insert)
    this.cache.delete(key);
    this.cache.set(key, item);
    this.hits++;
    return item.value;
  }

  set(key, value, ttlMs = this.defaultTTLMs) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxItems) {
      // Evict oldest item (first entry in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  del(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(2) + '%' : '0%',
    };
  }
}

module.exports = new MemoryCache();
