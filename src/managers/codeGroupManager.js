const vscode = require('vscode');
const { YunxiaoApiClient } = require('../services/yunxiaoApiClient');
const { CacheManager } = require('./cacheManager');

/**
 * 代码分组管理器
 * 负责管理代码分组数据的获取、缓存和收藏状态
 */
class CodeGroupManager {
    constructor(context, apiClient, cacheManager) {
        this.context = context;
        this.apiClient = apiClient;
        this.cacheManager = cacheManager;
        this.favorites = new Set();
        
        this.loadFavorites();
    }

    /**
     * 获取代码分组列表
     * @param {Object} options - 选项参数
     * @param {number} options.page - 页码
     * @param {number} options.perPage - 每页大小
     * @param {string} options.parentId - 父分组ID
     * @param {string} options.search - 搜索关键词
     * @param {boolean} forceRefresh - 是否强制刷新
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async getGroups(options = {}, forceRefresh = false) {
        const { page = 1, perPage = 20, parentId, search } = options;
        const cacheKey = `code_groups:${page}:${perPage}:${parentId || 'root'}:${search || ''}`;
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                return {
                    items: this.applyFavorites(cached.items),
                    total: cached.total,
                    hasMore: cached.hasMore
                };
            }
        }

        try {
            const params = { page, perPage };
            if (parentId) {
                params.parentId = parentId;
            }
            if (search) {
                params.search = search;
            }

            const response = await this.apiClient.getCodeGroups(params);
            const result = {
                items: response.items,
                total: response.total,
                hasMore: response.hasMore
            };
            
            // 缓存分组列表，30分钟
            const cacheDuration = 30 * 60 * 1000;
            this.cacheManager.set(cacheKey, result, cacheDuration);
            
            return {
                items: this.applyFavorites(result.items),
                total: result.total,
                hasMore: result.hasMore
            };
        } catch (error) {
            throw new Error(`获取代码分组列表失败: ${error.message}`);
        }
    }

    /**
     * 获取分组详情
     * @param {string} groupId - 分组ID
     * @returns {Promise<Object>} 分组详情
     */
    async getGroupById(groupId) {
        const cacheKey = `code_group:${groupId}`;
        
        const cached = this.cacheManager.get(cacheKey);
        if (cached) {
            return this.applyFavorite(cached);
        }

        try {
            const group = await this.apiClient.getCodeGroupById(groupId);
            
            // 缓存分组详情，30分钟
            const cacheDuration = 30 * 60 * 1000;
            this.cacheManager.set(cacheKey, group, cacheDuration);
            
            return this.applyFavorite(group);
        } catch (error) {
            throw new Error(`获取代码分组详情失败: ${error.message}`);
        }
    }

    /**
     * 获取子分组列表
     * @param {string} parentId - 父分组ID
     * @param {Object} page - 分页参数
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async getSubGroups(parentId, page = { page: 1, pageSize: 20 }) {
        const cacheKey = `code_subgroups:${parentId}:${page.page}:${page.pageSize}`;
        
        const cached = this.cacheManager.get(cacheKey);
        if (cached) {
            return {
                items: this.applyFavorites(cached.items),
                total: cached.total,
                hasMore: cached.hasMore
            };
        }

        try {
            const response = await this.apiClient.getSubGroups(parentId, page);
            const result = {
                items: response.items,
                total: response.total,
                hasMore: response.hasMore
            };
            
            // 缓存子分组列表，30分钟
            const cacheDuration = 30 * 60 * 1000;
            this.cacheManager.set(cacheKey, result, cacheDuration);
            
            return {
                items: this.applyFavorites(result.items),
                total: result.total,
                hasMore: result.hasMore
            };
        } catch (error) {
            throw new Error(`获取子分组列表失败: ${error.message}`);
        }
    }

    /**
     * 切换收藏状态
     * @param {string} groupId - 分组ID
     * @returns {Promise<boolean>} 是否收藏
     */
    async toggleFavorite(groupId) {
        if (this.favorites.has(groupId)) {
            this.favorites.delete(groupId);
        } else {
            this.favorites.add(groupId);
        }
        
        await this.saveFavorites();
        
        // 清除缓存，重新加载时会应用收藏状态
        this.clearCache();
        
        return this.favorites.has(groupId);
    }

    /**
     * 判断是否收藏
     * @param {string} groupId - 分组ID
     * @returns {boolean}
     */
    isFavorite(groupId) {
        return this.favorites.has(groupId);
    }

    /**
     * 获取收藏的分组
     * @returns {Array<Object>} 收藏的分组列表
     */
    async getFavoriteGroups() {
        const favoriteIds = Array.from(this.favorites);
        const favoriteGroups = [];
        
        for (const groupId of favoriteIds) {
            try {
                const group = await this.getGroupById(groupId);
                favoriteGroups.push(group);
            } catch (error) {
                console.error(`获取收藏的分组 ${groupId} 失败:`, error);
                // 移除无效的收藏
                this.favorites.delete(groupId);
            }
        }
        
        // 如果有无效收藏被移除，保存更新
        if (favoriteIds.length !== favoriteGroups.length) {
            await this.saveFavorites();
        }
        
        return favoriteGroups;
    }

    /**
     * 搜索分组
     * @param {string} keyword - 搜索关键词
     * @param {Object} options - 选项参数
     * @param {number} options.page - 页码
     * @param {number} options.perPage - 每页大小
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async searchGroups(keyword, options = {}) {
        const { page = 1, perPage = 20 } = options;
        
        if (!keyword || keyword.trim() === '') {
            return this.getGroups({ page, perPage });
        }

        return this.getGroups({ page, perPage, search: keyword });
    }

    /**
     * 清除缓存
     */
    clearCache() {
        // 清除所有代码分组相关缓存
        const allKeys = this.cacheManager.getAllKeys();
        const groupKeys = allKeys.filter(key => 
            key.startsWith('code_groups:') || 
            key.startsWith('code_group:') || 
            key.startsWith('code_subgroups:')
        );
        groupKeys.forEach(key => this.cacheManager.delete(key));
    }

    /**
     * 加载收藏列表
     */
    loadFavorites() {
        const saved = this.context.globalState.get('yunxiao.favoriteCodeGroups', []);
        this.favorites = new Set(saved);
    }

    /**
     * 保存收藏列表
     */
    async saveFavorites() {
        await this.context.globalState.update('yunxiao.favoriteCodeGroups', Array.from(this.favorites));
    }

    /**
     * 应用收藏状态到分组列表
     * @param {Array} groups - 分组列表
     * @returns {Array}
     */
    applyFavorites(groups) {
        return groups.map(g => this.applyFavorite(g));
    }

    /**
     * 应用收藏状态到单个分组
     * @param {Object} group - 分组对象
     * @returns {Object}
     */
    applyFavorite(group) {
        return {
            ...group,
            isFavorite: this.isFavorite(group.id)
        };
    }
}

module.exports = { CodeGroupManager };
