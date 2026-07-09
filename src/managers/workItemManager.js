const vscode = require('vscode');
const { YunxiaoApiClient } = require('../services/yunxiaoApiClient');
const { CacheManager } = require('./cacheManager');
const { getAllCategoryIds, getCategoryName } = require('../config/workitemTypes');

/**
 * 工作项管理器
 */
class WorkItemManager {
    constructor(context, apiClient, cacheManager) {
        this.context = context;
        this.apiClient = apiClient;
        this.cacheManager = cacheManager;
        this.workItemTypes = new Map();
        
        // 按类型分别管理懒加载状态
        // projectId -> { typeKey -> { currentPage, hasMore, items, total } }
        this.lazyLoadState = new Map();
    }

    /**
     * 获取工作项列表（懒加载）
     * 默认只加载第一页，用户滚动时再加载后续页面
     */
    async getWorkItems(projectId, page = { page: 1, pageSize: 50 }, forceRefresh = false) {
        const cacheKey = `workitems:${projectId}:${page.page}`;
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await this.apiClient.getWorkItems(projectId, page);
            const workitems = response.items;
            
            // 缓存工作项列表
            const config = vscode.workspace.getConfiguration('yunxiao');
            const cacheDuration = config.get('workitemCacheDuration', 10) * 60 * 1000;
            this.cacheManager.set(cacheKey, workitems, cacheDuration);
            
            return workitems;
        } catch (error) {
            throw new Error(`获取工作项列表失败: ${error.message}`);
        }
    }

    /**
     * 初始化懒加载（按类型加载第一页）
     * @param {string} projectId - 项目 ID
     * @param {Object} filter - 过滤条件（包含 keyword 等）
     * @param {boolean} forceRefresh - 强制刷新
     */
    async initializeLazyLoad(projectId, filter = {}, forceRefresh = false) {
        // 为每个类型分别加载第一页（50项）
        const types = getAllCategoryIds(); // 使用统一配置获取所有类型

        // 读取配置：是否在工作项树中排除「已结束」工作项（已完成/已取消）
        const config = vscode.workspace.getConfiguration('yunxiao');
        const excludeTerminal = config.get('workitemExcludeTerminal', true);
        const terminalStatusStages = String(config.get('workitemTerminalStatusStages', '4,5'))
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        // 合成实际生效的过滤条件。loadNextPageForType 会复用 state.filter，
        // 因此把 excludeTerminal 一并存入，保证「加载更多」也只加载进行中的工作项。
        const effectiveFilter = { ...filter };
        if (excludeTerminal) {
            effectiveFilter.excludeTerminal = true;
            effectiveFilter.terminalStatusStages = terminalStatusStages;
        }

        // 初始化项目状态
        if (!this.lazyLoadState.has(projectId)) {
            this.lazyLoadState.set(projectId, {});
        }
        const projectState = this.lazyLoadState.get(projectId);
        
        const allItems = [];
        
        for (const type of types) {
            const typeName = getCategoryName(type);
            // 缓存键带上过滤模式，避免切换「排除已结束」配置后命中旧缓存
            const cacheKey = `workitems:${projectId}:${type}:page1:${excludeTerminal ? 'active' : 'all'}`;
            
            // 检查缓存（只缓存第一页）
            if (!forceRefresh) {
                const cached = this.cacheManager.get(cacheKey);
                if (cached) {
                    projectState[type] = cached.state;
                    allItems.push(...cached.items);
                    console.log(`[WorkItemManager] 从缓存加载 ${typeName}: ${cached.items.length} 项, hasMore=${cached.state.hasMore}`);
                    continue;
                }
            }
            
            try {
                // 调用 API 加载指定类型的第一页，带上过滤条件
                const response = await this.apiClient.searchWorkItems(projectId, {
                    ...effectiveFilter,
                    workitemTypes: [type]
                }, { page: 1, pageSize: 50 });
                
                console.log(`[WorkItemManager] API返回 ${typeName}: ${response.items.length} 项, total=${response.total}, hasMore=${response.hasMore}`);
                
                // 初始化该类型的状态
                const state = {
                    currentPage: 1,
                    hasMore: response.hasMore,
                    total: response.total,
                    items: response.items,
                    filter: effectiveFilter  // 保存当前的过滤条件（含 excludeTerminal）
                };
                
                projectState[type] = state;
                allItems.push(...response.items);
                
                // 只缓存第一页
                const config = vscode.workspace.getConfiguration('yunxiao');
                const cacheDuration = config.get('workitemCacheDuration', 10) * 60 * 1000;
                this.cacheManager.set(cacheKey, { state, items: response.items }, cacheDuration);
                
            } catch (error) {
                console.warn(`加载${typeName}失败:`, error.message);
                // 初始化空状态
                projectState[type] = {
                    currentPage: 1,
                    hasMore: false,
                    total: 0,
                    items: [],
                    filter: effectiveFilter
                };
            }
        }
        
        console.log(`[WorkItemManager] 总计加载 ${allItems.length} 个工作项`);
        return allItems;
    }

    /**
     * 加载指定类型的下一页（50项）
     */
    async loadNextPageForType(projectId, workitemType) {
        const projectState = this.lazyLoadState.get(projectId);
        if (!projectState || !projectState[workitemType]) {
            throw new Error('请先初始化懒加载');
        }
        
        const typeState = projectState[workitemType];
        
        if (!typeState.hasMore) {
            return { items: [], hasMore: false, message: '没有更多了' };
        }
        
        const nextPage = typeState.currentPage + 1;
        const filter = typeState.filter || {};  // 使用保存的过滤条件
        
        try {
            // 调用 API 加载下一页（带上相同的过滤条件）
            const response = await this.apiClient.searchWorkItems(projectId, {
                ...filter,
                workitemTypes: [workitemType]
            }, { page: nextPage, pageSize: 50 });
            
            // 更新状态
            typeState.currentPage = nextPage;
            typeState.items = [...typeState.items, ...response.items];
            typeState.hasMore = response.hasMore;
            
            return {
                items: response.items,
                hasMore: response.hasMore,
                loaded: typeState.items.length,
                total: typeState.total
            };
        } catch (error) {
            throw new Error(`加载下一页失败: ${error.message}`);
        }
    }

    /**
     * 获取当前已加载的所有工作项
     */
    getLoadedWorkItems(projectId) {
        const projectState = this.lazyLoadState.get(projectId);
        if (!projectState) return [];
        
        const allItems = [];
        const types = getAllCategoryIds();
        types.forEach(type => {
            if (projectState[type] && projectState[type].items) {
                allItems.push(...projectState[type].items);
            }
        });
        
        return allItems;
    }

    /**
     * 检查指定类型是否还有更多数据
     */
    hasMoreWorkItems(projectId, workitemType) {
        const projectState = this.lazyLoadState.get(projectId);
        if (!projectState || !projectState[workitemType]) return false;
        return projectState[workitemType].hasMore;
    }

    /**
     * 获取指定类型的加载进度信息
     */
    getLoadProgress(projectId, workitemType) {
        const projectState = this.lazyLoadState.get(projectId);
        if (!projectState || !projectState[workitemType]) {
            return { loaded: 0, total: 0, percentage: 0 };
        }
        const typeState = projectState[workitemType];
        return {
            loaded: typeState.items.length,
            total: typeState.total,
            percentage: typeState.total > 0 ? Math.round((typeState.items.length / typeState.total) * 100) : 0,
            currentPage: typeState.currentPage,
            hasMore: typeState.hasMore
        };
    }

    /**
     * 搜索工作项（搜索所有类型）
     * @param {string} projectId - 项目 ID
     * @param {Object} filter - 过滤条件（keyword, workitemTypes, statuses 等）
     * @param {Object} page - 分页参数 { page, pageSize }
     * @returns {Promise<Array>} 工作项列表
     */
    async searchWorkItems(projectId, filter = {}, page = { page: 1, pageSize: 100 }) {
        const { getAllCategoryIds } = require('../config/workitemTypes');
        
        try {
            // 如果 filter 中没有指定 category，自动注入所有类型
            // 符合记忆中的 "searchWorkItems自动补全category" 规范
            if (!filter.category && !filter.workitemTypes) {
                const allCategories = getAllCategoryIds();
                filter.category = allCategories.join(',');
            }
            
            // 调用 API 搜索（API 已经按 gmtCreate desc 排序）
            const response = await this.apiClient.searchWorkItems(projectId, filter, page);
            
            // 为了确保结果按创建时间倒序，在前端也进行一次排序
            const items = response.items || [];
            items.sort((a, b) => {
                // 按创建时间倒序（最新的在前）
                const timeA = a.createdAt || 0;
                const timeB = b.createdAt || 0;
                return timeB - timeA;
            });
            
            return items;
        } catch (error) {
            throw new Error(`搜索工作项失败: ${error.message}`);
        }
    }

    /**
     * 获取工作项详情
     */
    async getWorkItem(workitemId, forceRefresh = false) {
        const cacheKey = `workitem:${workitemId}`;
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        try {
            const workitem = await this.apiClient.getWorkItem(workitemId);
            
            // 缓存工作项详情（5分钟）
            this.cacheManager.set(cacheKey, workitem, 5 * 60 * 1000);
            
            return workitem;
        } catch (error) {
            throw new Error(`获取工作项详情失败: ${error.message}`);
        }
    }

    /**
     * 检查是否所有工作项都已完全加载
     */
    isAllWorkItemsLoaded(projectId) {
        const projectState = this.lazyLoadState.get(projectId);
        if (!projectState) return false;
        
        const types = getAllCategoryIds();
        for (const type of types) {
            const typeState = projectState[type];
            // 如果某个类型还未初始化，或者还有更多数据未加载，则返回 false
            if (!typeState || typeState.hasMore) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * 本地过滤工作项
     */
    filterWorkItemsLocally(workitems, filter) {
        return workitems.filter(item => {
            // 关键词过滤
            if (filter.keyword) {
                const keyword = filter.keyword.toLowerCase();
                const matchKeyword = 
                    item.identifier.toLowerCase().includes(keyword) ||
                    item.subject.toLowerCase().includes(keyword) ||
                    (item.assignedTo && item.assignedTo.name.toLowerCase().includes(keyword));
                
                if (!matchKeyword) {
                    return false;
                }
            }

            // 类型过滤
            if (filter.workitemTypes && filter.workitemTypes.length > 0) {
                if (!filter.workitemTypes.includes(item.workitemType)) {
                    return false;
                }
            }

            // 状态过滤
            if (filter.statuses && filter.statuses.length > 0) {
                if (!filter.statuses.includes(item.status)) {
                    return false;
                }
            }

            // 指派人过滤
            if (filter.assignedTo) {
                if (!item.assignedTo || item.assignedTo.id !== filter.assignedTo) {
                    return false;
                }
            }

            // 优先级过滤
            if (filter.priority && filter.priority.length > 0) {
                if (!item.priority || !filter.priority.includes(item.priority)) {
                    return false;
                }
            }

            // 标签过滤
            if (filter.tags && filter.tags.length > 0) {
                if (!item.tags || !filter.tags.some(tag => item.tags.includes(tag))) {
                    return false;
                }
            }

            // 创建时间过滤
            if (filter.createTimeFrom && item.createdAt) {
                if (item.createdAt < filter.createTimeFrom) {
                    return false;
                }
            }
            if (filter.createTimeTo && item.createdAt) {
                if (item.createdAt > filter.createTimeTo) {
                    return false;
                }
            }

            // 更新时间过滤
            if (filter.updateTimeFrom && item.updatedAt) {
                if (item.updatedAt < filter.updateTimeFrom) {
                    return false;
                }
            }
            if (filter.updateTimeTo && item.updatedAt) {
                if (item.updatedAt > filter.updateTimeTo) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * 获取工作项类型配置
     */
    async getWorkItemTypes(projectId, forceRefresh = false) {
        if (!forceRefresh && this.workItemTypes.has(projectId)) {
            return this.workItemTypes.get(projectId);
        }

        const cacheKey = `workitem-types:${projectId}`;
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                this.workItemTypes.set(projectId, cached);
                return cached;
            }
        }

        try {
            const types = await this.apiClient.getWorkItemTypes(projectId);
            
            // 缓存工作项类型（24小时）
            this.cacheManager.set(cacheKey, types, 24 * 60 * 60 * 1000);
            this.workItemTypes.set(projectId, types);
            
            return types;
        } catch (error) {
            // 如果获取失败，返回默认类型
            console.warn('获取工作项类型失败，使用默认类型:', error.message);
            return this.getDefaultWorkItemTypes();
        }
    }

    /**
     * 获取默认工作项类型
     */
    getDefaultWorkItemTypes() {
        return [
            { typeId: 'Req', typeName: '需求', icon: '💡' },
            { typeId: 'Task', typeName: '任务', icon: '✓' },
            { typeId: 'Bug', typeName: '缺陷', icon: '🐛' },
            { typeId: 'Risk', typeName: '风险', icon: '⚠️' },
            { typeId: 'SubTask', typeName: '子任务', icon: '▫️' }
        ];
    }

    /**
     * 按类型分组工作项
     */
    groupByType(workitems) {
        const groups = new Map();
        
        for (const item of workitems) {
            const type = item.workitemType;
            if (!groups.has(type)) {
                groups.set(type, []);
            }
            groups.get(type).push(item);
        }
        
        return groups;
    }

    /**
     * 按状态分组工作项
     */
    groupByStatus(workitems) {
        const groups = new Map();
        
        for (const item of workitems) {
            const status = item.status;
            if (!groups.has(status)) {
                groups.set(status, []);
            }
            groups.get(status).push(item);
        }
        
        return groups;
    }

    /**
     * 刷新工作项列表
     */
    async refresh(projectId) {
        // 清除该项目的所有缓存
        this.clearProjectCache(projectId);
        // 重新初始化懒加载
        await this.initializeLazyLoad(projectId, true);
    }

    /**
     * 清除项目缓存
     */
    clearProjectCache(projectId) {
        // 清除懒加载状态
        this.lazyLoadState.delete(projectId);
        
        // 清除懒加载缓存
        for (let page = 1; page <= 20; page++) {
            this.cacheManager.delete(`workitems:${projectId}:lazy:${page}`);
        }
        
        // 清除分页缓存
        for (let page = 1; page <= 20; page++) {
            this.cacheManager.delete(`workitems:${projectId}:${page}`);
        }
        
        // 清除工作项类型缓存
        this.cacheManager.delete(`workitem-types:${projectId}`);
        this.workItemTypes.delete(projectId);
    }

    /**
     * 清除所有缓存
     */
    clearCache() {
        this.cacheManager.clear();
        this.workItemTypes.clear();
        this.lazyLoadState.clear();
    }

    /**
     * 获取工作项评论
     * @param {string} workitemId - 工作项 ID
     * @param {boolean} forceRefresh - 强制刷新
     */
    async getWorkItemComments(workitemId, forceRefresh = false) {
        const cacheKey = `workitem-comments:${workitemId}`;
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        try {
            const comments = await this.apiClient.getWorkItemComments(workitemId);
            
            // 缓存评论列表（5分钟）
            this.cacheManager.set(cacheKey, comments, 5 * 60 * 1000);
            
            return comments;
        } catch (error) {
            console.warn(`获取工作项评论失败: ${error.message}`);
            return []; // 失败时返回空数组
        }
    }
}

module.exports = { WorkItemManager };
