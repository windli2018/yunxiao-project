const vscode = require('vscode');
const { YunxiaoApiClient } = require('../services/yunxiaoApiClient');
const { CacheManager } = require('./cacheManager');

/**
 * 代码分支管理器
 * 负责管理代码分支数据的获取、缓存、收藏和合并请求创建
 */
class CodeBranchManager {
    constructor(context, apiClient, cacheManager) {
        this.context = context;
        this.apiClient = apiClient;
        this.cacheManager = cacheManager;
        // 收藏按仓库维度管理: repoId -> Set<branchName>
        this.favorites = new Map();
        
        this.loadFavorites();
    }

    /**
     * 获取仓库的分支列表
     * @param {string} repoId - 仓库ID
     * @param {Object} options - 选项参数
     * @param {number} options.page - 页码
     * @param {number} options.perPage - 每页大小
     * @param {string} options.sort - 排序方式
     * @param {string} options.search - 搜索关键词
     * @param {boolean} forceRefresh - 是否强制刷新
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async getBranches(repoId, options = {}, forceRefresh = false) {
        const { page = 1, perPage = 20, sort, search } = options;
        const cacheKey = `code_branches:${repoId}:${page}:${perPage}:${sort || ''}:${search || ''}`;
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                return {
                    items: this.applyFavorites(repoId, cached.items),
                    total: cached.total,
                    hasMore: cached.hasMore
                };
            }
        }

        try {
            const params = { page, perPage };
            // 使用服务端按更新时间降序排列（最新的在前）
            params.sort = 'updated_desc';
            
            if (search) {
                params.search = search;
            }

            const response = await this.apiClient.getCodeBranches(repoId, params);
            const result = {
                items: response.items,
                total: response.total,
                hasMore: response.hasMore
            };
            
            // 缓存分支列表，5分钟
            const cacheDuration = 5 * 60 * 1000;
            this.cacheManager.set(cacheKey, result, cacheDuration);
            
            return {
                items: this.applyFavorites(repoId, result.items),
                total: result.total,
                hasMore: result.hasMore
            };
        } catch (error) {
            await this.apiClient.handle403Error(error);
            throw new Error(`获取代码分支列表失败: ${error.message}`);
        }
    }

    /**
     * 获取分支详情
     * @param {string} repoId - 仓库ID
     * @param {string} branchName - 分支名称
     * @returns {Promise<Object>} 分支详情
     */
    async getBranchByName(repoId, branchName) {
        // 通过搜索获取特定分支
        const response = await this.getBranches(repoId, { search: branchName, perPage: 1 });
        
        if (response.items.length === 0) {
            throw new Error(`分支 ${branchName} 不存在`);
        }
        
        // 返回第一个匹配的分支
        const branch = response.items[0];
        
        // 确保名称完全匹配
        if (branch.name !== branchName) {
            throw new Error(`分支 ${branchName} 不存在`);
        }
        
        return branch;
    }

    /**
     * 切换收藏状态
     * @param {string} repoId - 仓库ID
     * @param {string} branchName - 分支名称
     * @returns {Promise<boolean>} 是否收藏
     */
    async toggleFavorite(repoId, branchName) {
        if (!this.favorites.has(repoId)) {
            this.favorites.set(repoId, new Set());
        }
        
        const repoBranches = this.favorites.get(repoId);
        
        if (repoBranches.has(branchName)) {
            repoBranches.delete(branchName);
        } else {
            repoBranches.add(branchName);
        }
        
        await this.saveFavorites();
        
        // 清除该仓库的缓存，重新加载时会应用收藏状态
        this.clearCache(repoId);
        
        return repoBranches.has(branchName);
    }

    /**
     * 判断是否收藏
     * @param {string} repoId - 仓库ID
     * @param {string} branchName - 分支名称
     * @returns {boolean}
     */
    isFavorite(repoId, branchName) {
        const repoBranches = this.favorites.get(repoId);
        return repoBranches ? repoBranches.has(branchName) : false;
    }

    /**
     * 获取收藏的分支
     * @param {string} repoId - 仓库ID
     * @returns {Array<Object>} 收藏的分支列表
     */
    async getFavoriteBranches(repoId) {
        const repoBranches = this.favorites.get(repoId);
        if (!repoBranches || repoBranches.size === 0) {
            return [];
        }
        
        const favoriteBranches = [];
        const branchNames = Array.from(repoBranches);
        
        for (const branchName of branchNames) {
            try {
                const branch = await this.getBranchByName(repoId, branchName);
                favoriteBranches.push(branch);
            } catch (error) {
                console.error(`获取收藏的分支 ${branchName} 失败:`, error);
                // 移除无效的收藏
                repoBranches.delete(branchName);
            }
        }
        
        // 如果有无效收藏被移除，保存更新
        if (branchNames.length !== favoriteBranches.length) {
            await this.saveFavorites();
        }
        
        return favoriteBranches;
    }

    /**
     * 搜索分支
     * @param {string} repoId - 仓库ID
     * @param {string} keyword - 搜索关键词
     * @param {Object} options - 选项参数
     * @param {number} options.page - 页码
     * @param {number} options.perPage - 每页大小
     * @returns {Promise<{items: Array, total: number, hasMore: boolean}>}
     */
    async searchBranches(repoId, keyword, options = {}) {
        const { page = 1, perPage = 20 } = options;
        
        if (!keyword || keyword.trim() === '') {
            return this.getBranches(repoId, { page, perPage });
        }

        return this.getBranches(repoId, { page, perPage, search: keyword });
    }

    /**
     * 创建合并请求
     * @param {Object} params - 合并请求参数
     * @param {string} params.repoId - 仓库ID
     * @param {string} params.sourceBranch - 源分支
     * @param {string} params.targetBranch - 目标分支
     * @param {string} params.title - 标题
     * @param {string} params.description - 描述
     * @param {Array<string>} params.reviewerUserIds - 评审人ID列表
     * @param {Array<string>} params.workItemIds - 关联工作项ID列表
     * @param {boolean} params.triggerAIReviewRun - 是否触发AI评审
     * @returns {Promise<Object>} 创建的合并请求
     */
    async createMergeRequest(params) {
        const { repoId } = params;
        
        if (!repoId) {
            throw new Error('仓库ID不能为空');
        }

        try {
            const mergeRequest = await this.apiClient.createMergeRequest(repoId, params);
            
            // 清除分支缓存（因为可能有新的合并请求信息）
            this.clearCache(repoId);
            
            return mergeRequest;
        } catch (error) {
            // 只处理403权限错误，其他错误直接抛出（保持原始错误信息）
            if (error.status === 403 || error.code === 'PERMISSION_DENIED') {
                await this.apiClient.handle403Error(error);
            }
            // 直接抛出原始错误，不要包装
            throw error;
        }
    }

    /**
     * 清除指定仓库的分支缓存
     * @param {string} repoId - 仓库ID，不传则清除所有
     */
    clearCache(repoId) {
        const allKeys = this.cacheManager.getAllKeys();
        
        if (repoId) {
            // 清除指定仓库的分支缓存
            const branchKeys = allKeys.filter(key => 
                key.startsWith(`code_branches:${repoId}:`)
            );
            branchKeys.forEach(key => this.cacheManager.delete(key));
        } else {
            // 清除所有代码分支相关缓存
            const branchKeys = allKeys.filter(key => 
                key.startsWith('code_branches:')
            );
            branchKeys.forEach(key => this.cacheManager.delete(key));
        }
    }

    /**
     * 加载收藏列表
     */
    loadFavorites() {
        const saved = this.context.globalState.get('yunxiao.favoriteCodeBranches', {});
        
        // 转换为 Map<string, Set<string>> 结构
        this.favorites = new Map();
        for (const [repoId, branches] of Object.entries(saved)) {
            this.favorites.set(repoId, new Set(branches));
        }
    }

    /**
     * 保存收藏列表
     */
    async saveFavorites() {
        // 转换为可序列化的对象结构
        const toSave = {};
        for (const [repoId, branches] of this.favorites.entries()) {
            if (branches.size > 0) {
                toSave[repoId] = Array.from(branches);
            }
        }
        
        await this.context.globalState.update('yunxiao.favoriteCodeBranches', toSave);
    }

    /**
     * 应用收藏状态到分支列表
     * @param {string} repoId - 仓库ID
     * @param {Array} branches - 分支列表
     * @returns {Array}
     */
    applyFavorites(repoId, branches) {
        return branches.map(b => this.applyFavorite(repoId, b));
    }

    /**
     * 应用收藏状态到单个分支
     * @param {string} repoId - 仓库ID
     * @param {Object} branch - 分支对象
     * @returns {Object}
     */
    applyFavorite(repoId, branch) {
        return {
            ...branch,
            isFavorite: this.isFavorite(repoId, branch.name)
        };
    }


}

module.exports = { CodeBranchManager };
