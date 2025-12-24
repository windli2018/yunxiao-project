/**
 * 内存缓存管理器
 */
class CacheManager {
    constructor(defaultTTL) {
        this.cache = new Map();
        this.defaultTTL = defaultTTL || 30 * 60 * 1000; // 30分钟
    }

    get(key) {
        const item = this.cache.get(key);
        
        if (!item) {
            return undefined;
        }

        if (this.isExpired(key)) {
            this.delete(key);
            return undefined;
        }

        return item.data;
    }

    set(key, value, ttl) {
        const expiry = ttl || this.defaultTTL;
        const item = {
            data: value,
            timestamp: Date.now(),
            expiry: expiry
        };
        
        this.cache.set(key, item);
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    isExpired(key) {
        const item = this.cache.get(key);
        
        if (!item) {
            return true;
        }

        const now = Date.now();
        return (now - item.timestamp) > item.expiry;
    }

    /**
     * 清理过期缓存
     */
    cleanExpired() {
        const now = Date.now();
        const keysToDelete = [];

        this.cache.forEach((item, key) => {
            if ((now - item.timestamp) > item.expiry) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach(key => this.delete(key));
    }

    /**
     * 获取所有缓存键
     * @returns {Array<string>} 所有缓存键的数组
     */
    getAllKeys() {
        return Array.from(this.cache.keys());
    }
}

module.exports = { CacheManager };
