const vscode = require('vscode');
const { YunxiaoApiClient } = require('../services/yunxiaoApiClient');
const { CacheManager } = require('./cacheManager');

/**
 * 代码仓库管理器
 * 负责管理代码仓库数据的获取、缓存、分页和收藏状态
 */
class CodeRepoManager {
    constructor(context, apiClient, cacheManager) {
        this.context = context;
        this.apiClient = apiClient;
        this.cacheManager = cacheManager;
        this.favorites = new Set();
        
        // 分页加载状态管理
        // namespaceId -> { currentPage, hasMore, items, total }
        this.lazyLoadState = new Map();
        
        this.loadFavorites();
    }

    /**
     * 获取所有仓库列表
     * @param {Object} options - 选项参数
     * @param {number} options.page - 页码
     * @param {number} options.perPage - 每页大小
     * @param {string} options.search - 搜索关键词
     * @param {boolean} options.archived - 是否归档
     * @param {boolean} forceRefresh - 是否强制刷新
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async getRepositories(options = {}, forceRefresh = false) {
        const { page = 1, perPage = 20, search, archived } = options;
        const cacheKey = `code_repos:${page}:${perPage}:${search || ''}:${archived || ''}`;
        
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
            if (search) {
                params.search = search;
            }
            if (typeof archived !== 'undefined') {
                params.archived = archived;
            }

            const response = await this.apiClient.getCodeRepositories(params);
            const result = {
                items: response.items,
                total: response.total,
                hasMore: response.hasMore
            };
            
            // 缓存仓库列表，10分钟
            const cacheDuration = 10 * 60 * 1000;
            this.cacheManager.set(cacheKey, result, cacheDuration);
            
            return {
                items: this.applyFavorites(result.items),
                total: result.total,
                hasMore: result.hasMore
            };
        } catch (error) {
            throw new Error(`获取代码仓库列表失败: ${error.message}`);
        }
    }

    /**
     * 获取分组下的仓库列表
     * @param {string} namespaceId - 分组ID
     * @param {Object} page - 分页参数
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async getRepositoriesByGroup(namespaceId, page = { page: 1, pageSize: 50 }) {
        const cacheKey = `code_repos_by_group:${namespaceId}:${page.page}:${page.pageSize}`;
        
        const cached = this.cacheManager.get(cacheKey);
        if (cached) {
            return {
                items: this.applyFavorites(cached.items),
                total: cached.total,
                hasMore: cached.hasMore
            };
        }

        try {
            const response = await this.apiClient.getCodeRepositoriesByGroup(namespaceId, page);
            
            // 客户端按仓库名称排序（服务端没有排序）
            const sortedItems = response.items.sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
            const result = {
                items: sortedItems,
                total: response.total,
                hasMore: response.hasMore
            };
            
            // 缓存仓库列表，10分钟
            const cacheDuration = 10 * 60 * 1000;
            this.cacheManager.set(cacheKey, result, cacheDuration);
            
            return {
                items: this.applyFavorites(result.items),
                total: result.total,
                hasMore: result.hasMore
            };
        } catch (error) {
            throw new Error(`获取分组下的代码仓库列表失败: ${error.message}`);
        }
    }

    /**
     * 获取仓库详情
     * @param {string} repoId - 仓库ID
     * @returns {Promise<Object>} 仓库详情
     */
    async getRepositoryById(repoId) {
        const cacheKey = `code_repo:${repoId}`;
        
        const cached = this.cacheManager.get(cacheKey);
        if (cached) {
            return this.applyFavorite(cached);
        }

        try {
            const repo = await this.apiClient.getCodeRepositoryById(repoId);
            
            // 缓存仓库详情，10分钟
            const cacheDuration = 10 * 60 * 1000;
            this.cacheManager.set(cacheKey, repo, cacheDuration);
            
            return this.applyFavorite(repo);
        } catch (error) {
            throw new Error(`获取代码仓库详情失败: ${error.message}`);
        }
    }

    /**
     * 初始化懒加载（加载第一页）
     * @param {string} namespaceId - 分组ID，传入'all'表示所有仓库
     * @param {boolean} forceRefresh - 是否强制刷新
     * @returns {Promise<Array>} 第一页的仓库列表
     */
    async initializeLazyLoad(namespaceId, forceRefresh = false) {
        const cacheKey = `code_repos_lazy:${namespaceId}:page1`;
        
        // 检查缓存（只缓存第一页）
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                this.lazyLoadState.set(namespaceId, cached.state);
                console.log(`[CodeRepoManager] 从缓存加载分组 ${namespaceId}: ${cached.items.length} 项, hasMore=${cached.state.hasMore}`);
                return this.applyFavorites(cached.items);
            }
        }

        try {
            let response;
            if (namespaceId === 'all') {
                // 加载所有仓库，使用服务端按名称排序
                response = await this.apiClient.getCodeRepositories({ 
                    page: 1, 
                    perPage: 50,
                    orderBy: 'name',
                    sort: 'asc'
                });
            } else {
                // 加载指定分组的仓库
                response = await this.apiClient.getCodeRepositoriesByGroup(namespaceId, { page: 1, pageSize: 50 });
                
                // 客户端排序（分组接口服务端不支持排序）
                response.items = response.items.sort((a, b) => {
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                });
            }
            
            console.log(`[CodeRepoManager] API返回分组 ${namespaceId}: ${response.items.length} 项, total=${response.total}, hasMore=${response.hasMore}`);
            
            // 初始化懒加载状态
            const state = {
                currentPage: 1,
                hasMore: response.hasMore,
                total: response.total,
                items: response.items
            };
            
            this.lazyLoadState.set(namespaceId, state);
            
            // 只缓存第一页
            const cacheDuration = 10 * 60 * 1000;
            this.cacheManager.set(cacheKey, { state, items: response.items }, cacheDuration);
            
            return this.applyFavorites(response.items);
        } catch (error) {
            console.warn(`加载分组 ${namespaceId} 的仓库失败:`, error.message);
            // 初始化空状态
            const emptyState = {
                currentPage: 1,
                hasMore: false,
                total: 0,
                items: []
            };
            this.lazyLoadState.set(namespaceId, emptyState);
            return [];
        }
    }

    /**
     * 加载下一页
     * @param {string} namespaceId - 分组ID
     * @returns {Promise<{items: Array, hasMore: boolean}>}
     */
    async loadNextPage(namespaceId) {
        const state = this.lazyLoadState.get(namespaceId);
        if (!state) {
            throw new Error('请先初始化懒加载');
        }
        
        if (!state.hasMore) {
            return { items: [], hasMore: false, message: '没有更多了' };
        }
        
        const nextPage = state.currentPage + 1;
        
        try {
            let response;
            if (namespaceId === 'all') {
                // 加载所有仓库的下一页，使用服务端按名称排序
                response = await this.apiClient.getCodeRepositories({ 
                    page: nextPage, 
                    perPage: 50,
                    orderBy: 'name',
                    sort: 'asc'
                });
            } else {
                // 加载指定分组的下一页
                response = await this.apiClient.getCodeRepositoriesByGroup(namespaceId, { page: nextPage, pageSize: 50 });
                
                // 客户端排序（分组接口服务端不支持排序）
                response.items = response.items.sort((a, b) => {
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                });
            }
            
            // 更新状态
            state.currentPage = nextPage;
            state.items = [...state.items, ...response.items];
            state.hasMore = response.hasMore;
            
            console.log(`[CodeRepoManager] 加载分组 ${namespaceId} 第 ${nextPage} 页: ${response.items.length} 项, hasMore=${response.hasMore}`);
            
            return {
                items: this.applyFavorites(response.items),
                hasMore: response.hasMore,
                loaded: state.items.length,
                total: state.total
            };
        } catch (error) {
            throw new Error(`加载下一页失败: ${error.message}`);
        }
    }

    /**
     * 获取当前已加载的所有仓库
     * @param {string} namespaceId - 分组ID
     * @returns {Array} 已加载的仓库列表
     */
    getLoadedRepos(namespaceId) {
        const state = this.lazyLoadState.get(namespaceId);
        if (!state) return [];
        return this.applyFavorites(state.items);
    }

    /**
     * 检查是否还有更多仓库
     * @param {string} namespaceId - 分组ID
     * @returns {boolean}
     */
    hasMoreRepos(namespaceId) {
        const state = this.lazyLoadState.get(namespaceId);
        if (!state) return false;
        return state.hasMore;
    }

    /**
     * 获取加载进度信息
     * @param {string} namespaceId - 分组ID
     * @returns {Object}
     */
    getLoadProgress(namespaceId) {
        const state = this.lazyLoadState.get(namespaceId);
        if (!state) {
            return { loaded: 0, total: 0, percentage: 0 };
        }
        
        const loaded = state.items.length;
        const total = state.total;
        const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
        
        return { loaded, total, percentage };
    }

    /**
     * 切换收藏状态
     * @param {string} repoId - 仓库ID
     * @returns {Promise<boolean>} 是否收藏
     */
    async toggleFavorite(repoId) {
        if (this.favorites.has(repoId)) {
            this.favorites.delete(repoId);
        } else {
            this.favorites.add(repoId);
        }
        
        await this.saveFavorites();
        
        // 清除缓存，重新加载时会应用收藏状态
        this.clearCache();
        
        return this.favorites.has(repoId);
    }

    /**
     * 判断是否收藏
     * @param {string} repoId - 仓库ID
     * @returns {boolean}
     */
    isFavorite(repoId) {
        return this.favorites.has(repoId);
    }

    /**
     * 获取收藏的仓库
     * @returns {Array<Object>} 收藏的仓库列表
     */
    async getFavoriteRepos() {
        const favoriteIds = Array.from(this.favorites);
        const favoriteRepos = [];
        
        for (const repoId of favoriteIds) {
            try {
                const repo = await this.getRepositoryById(repoId);
                favoriteRepos.push(repo);
            } catch (error) {
                console.error(`获取收藏的仓库 ${repoId} 失败:`, error);
                // 移除无效的收藏
                this.favorites.delete(repoId);
            }
        }
        
        // 如果有无效收藏被移除，保存更新
        if (favoriteIds.length !== favoriteRepos.length) {
            await this.saveFavorites();
        }
        
        return favoriteRepos;
    }

    /**
     * 搜索仓库
     * @param {string} keyword - 搜索关键词
     * @param {Object} options - 选项参数
     * @param {number} options.page - 页码
     * @param {number} options.perPage - 每页大小
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async searchRepositories(keyword, options = {}) {
        const { page = 1, perPage = 20 } = options;
        
        if (!keyword || keyword.trim() === '') {
            return this.getRepositories({ page, perPage });
        }

        return this.getRepositories({ page, perPage, search: keyword });
    }

    /**
     * 清除缓存
     */
    clearCache() {
        // 清除所有代码仓库相关缓存
        const allKeys = this.cacheManager.getAllKeys();
        const repoKeys = allKeys.filter(key => 
            key.startsWith('code_repos:') || 
            key.startsWith('code_repo:') || 
            key.startsWith('code_repos_by_group:') ||
            key.startsWith('code_repos_lazy:')
        );
        repoKeys.forEach(key => this.cacheManager.delete(key));
        
        // 清除懒加载状态
        this.lazyLoadState.clear();
    }

    /**
     * 加载收藏列表
     */
    loadFavorites() {
        const saved = this.context.globalState.get('yunxiao.favoriteCodeRepos', []);
        this.favorites = new Set(saved);
    }

    /**
     * 保存收藏列表
     */
    async saveFavorites() {
        await this.context.globalState.update('yunxiao.favoriteCodeRepos', Array.from(this.favorites));
    }

    /**
     * 应用收藏状态到仓库列表
     * @param {Array} repos - 仓库列表
     * @returns {Array}
     */
    applyFavorites(repos) {
        return repos.map(r => this.applyFavorite(r));
    }

    /**
     * 应用收藏状态到单个仓库
     * @param {Object} repo - 仓库对象
     * @returns {Object}
     */
    applyFavorite(repo) {
        return {
            ...repo,
            isFavorite: this.isFavorite(repo.id)
        };
    }
}

module.exports = { CodeRepoManager };
