const vscode = require('vscode');
const { RecentItemType } = require('../models/types');

/**
 * 最近使用管理器
 */
class RecentManager {
    constructor(context) {
        this.context = context;
        this.recentItems = [];
        this.TIME_WEIGHT = 0.6;  // 时间权重
        this.FREQ_WEIGHT = 0.4;  // 频次权重
        this.TIME_DECAY_DAYS = 7; // 时间衰减天数
        
        this.loadRecentItems();
    }

    /**
     * 添加或更新最近使用项
     */
    addItem(itemId, itemType, data) {
        const now = Date.now();
        const existingIndex = this.recentItems.findIndex(
            item => item.itemId === itemId && item.itemType === itemType
        );

        if (existingIndex >= 0) {
            // 更新现有项
            const item = this.recentItems[existingIndex];
            item.lastUsedAt = now;
            item.useCount++;
            item.data = data || item.data;
            item.score = this.calculateScore(item);
        } else {
            // 添加新项
            const newItem = {
                itemId,
                itemType,
                lastUsedAt: now,
                useCount: 1,
                score: this.calculateScore({ itemId, itemType, lastUsedAt: now, useCount: 1, score: 0 }),
                data
            };
            this.recentItems.push(newItem);
        }

        // 限制数量
        this.limitItems();

        // 重新计算所有分数并排序
        this.recalculateScores();

        // 保存
        this.saveRecentItems();
    }

    /**
     * 获取最近使用的项目
     */
    getRecentProjects(limit) {
        const projects = this.recentItems.filter(item => item.itemType === RecentItemType.Project);
        return limit ? projects.slice(0, limit) : projects;
    }

    /**
     * 获取最近使用的工作项
     */
    getRecentWorkItems(limit) {
        const workitems = this.recentItems.filter(item => item.itemType === RecentItemType.WorkItem);
        return limit ? workitems.slice(0, limit) : workitems;
    }

    /**
     * 获取最近搜索关键词
     */
    getRecentSearchKeywords(limit) {
        const keywords = this.recentItems.filter(item => item.itemType === RecentItemType.SearchKeyword);
        return limit ? keywords.slice(0, limit) : keywords;
    }

    /**
     * 获取最近使用的代码分组
     */
    getRecentCodeGroups(limit) {
        const codeGroups = this.recentItems.filter(item => item.itemType === RecentItemType.CodeGroup);
        return limit ? codeGroups.slice(0, limit) : codeGroups;
    }

    /**
     * 获取最近使用的代码仓库
     */
    getRecentCodeRepos(limit) {
        const codeRepos = this.recentItems.filter(item => item.itemType === RecentItemType.CodeRepo);
        return limit ? codeRepos.slice(0, limit) : codeRepos;
    }

    /**
     * 获取最近使用的代码分支
     */
    getRecentCodeBranches(limit) {
        const codeBranches = this.recentItems.filter(item => item.itemType === RecentItemType.CodeBranch);
        return limit ? codeBranches.slice(0, limit) : codeBranches;
    }

    /**
     * 获取所有最近使用项
     */
    getAllRecentItems(limit) {
        return limit ? this.recentItems.slice(0, limit) : this.recentItems;
    }

    /**
     * 获取特定项的使用信息
     */
    getItem(itemId, itemType) {
        return this.recentItems.find(
            item => item.itemId === itemId && item.itemType === itemType
        );
    }

    /**
     * 移除项
     */
    removeItem(itemId, itemType) {
        this.recentItems = this.recentItems.filter(
            item => !(item.itemId === itemId && item.itemType === itemType)
        );
        this.saveRecentItems();
    }

    /**
     * 清空所有记录
     */
    clear() {
        this.recentItems = [];
        this.saveRecentItems();
    }

    /**
     * 清空指定类型的记录
     */
    clearByType(itemType) {
        this.recentItems = this.recentItems.filter(item => item.itemType !== itemType);
        this.saveRecentItems();
    }

    /**
     * 计算评分
     * 评分 = 时间权重 × 时间得分 + 频次权重 × 频次得分
     */
    calculateScore(item) {
        const timeScore = this.calculateTimeScore(item.lastUsedAt);
        const freqScore = this.calculateFreqScore(item.useCount);
        
        return this.TIME_WEIGHT * timeScore + this.FREQ_WEIGHT * freqScore;
    }

    /**
     * 计算时间得分（指数衰减）
     * 最近使用的得分高，随时间指数衰减
     */
    calculateTimeScore(lastUsedAt) {
        const now = Date.now();
        const daysPassed = (now - lastUsedAt) / (1000 * 60 * 60 * 24);
        
        // 使用指数衰减公式：score = e^(-daysPassed / DECAY_DAYS)
        const score = Math.exp(-daysPassed / this.TIME_DECAY_DAYS);
        
        return Math.max(0, Math.min(1, score)); // 限制在 [0, 1] 范围内
    }

    /**
     * 计算频次得分（对数增长）
     * 使用次数越多得分越高，但增长速度递减
     */
    calculateFreqScore(useCount) {
        // 使用对数函数：score = log(1 + count) / log(1 + MAX_COUNT)
        const MAX_COUNT = 100; // 假设最大使用次数为 100
        const score = Math.log(1 + useCount) / Math.log(1 + MAX_COUNT);
        
        return Math.max(0, Math.min(1, score)); // 限制在 [0, 1] 范围内
    }

    /**
     * 重新计算所有项的分数并排序
     */
    recalculateScores() {
        // 重新计算分数
        this.recentItems.forEach(item => {
            item.score = this.calculateScore(item);
        });

        // 按分数降序排序
        this.recentItems.sort((a, b) => b.score - a.score);
    }

    /**
     * 限制项目数量
     */
    limitItems() {
        const config = vscode.workspace.getConfiguration('yunxiao');
        const maxProjects = config.get('maxRecentProjects', 20);
        const maxWorkItems = config.get('maxRecentWorkItems', 50);
        const maxSearchKeywords = 10;  // 最多保留 10 个搜索关键词
        const maxCodeGroups = 10;  // 最多保留 10 个代码分组
        const maxCodeRepos = 20;  // 最多保留 20 个代码仓库
        const maxCodeBranches = 30;  // 最多保留 30 个代码分支

        // 分别限制项目、工作项、搜索关键词和代码相关类型的数量
        const projects = this.recentItems.filter(item => item.itemType === RecentItemType.Project);
        const workitems = this.recentItems.filter(item => item.itemType === RecentItemType.WorkItem);
        const searchKeywords = this.recentItems.filter(item => item.itemType === RecentItemType.SearchKeyword);
        const codeGroups = this.recentItems.filter(item => item.itemType === RecentItemType.CodeGroup);
        const codeRepos = this.recentItems.filter(item => item.itemType === RecentItemType.CodeRepo);
        const codeBranches = this.recentItems.filter(item => item.itemType === RecentItemType.CodeBranch);

        if (projects.length > maxProjects) {
            // 按分数排序，保留分数高的
            projects.sort((a, b) => b.score - a.score);
            const toRemove = projects.slice(maxProjects);
            toRemove.forEach(item => {
                const index = this.recentItems.findIndex(
                    i => i.itemId === item.itemId && i.itemType === item.itemType
                );
                if (index >= 0) {
                    this.recentItems.splice(index, 1);
                }
            });
        }

        if (workitems.length > maxWorkItems) {
            workitems.sort((a, b) => b.score - a.score);
            const toRemove = workitems.slice(maxWorkItems);
            toRemove.forEach(item => {
                const index = this.recentItems.findIndex(
                    i => i.itemId === item.itemId && i.itemType === item.itemType
                );
                if (index >= 0) {
                    this.recentItems.splice(index, 1);
                }
            });
        }

        if (searchKeywords.length > maxSearchKeywords) {
            searchKeywords.sort((a, b) => b.score - a.score);
            const toRemove = searchKeywords.slice(maxSearchKeywords);
            toRemove.forEach(item => {
                const index = this.recentItems.findIndex(
                    i => i.itemId === item.itemId && i.itemType === item.itemType
                );
                if (index >= 0) {
                    this.recentItems.splice(index, 1);
                }
            });
        }

        if (codeGroups.length > maxCodeGroups) {
            codeGroups.sort((a, b) => b.score - a.score);
            const toRemove = codeGroups.slice(maxCodeGroups);
            toRemove.forEach(item => {
                const index = this.recentItems.findIndex(
                    i => i.itemId === item.itemId && i.itemType === item.itemType
                );
                if (index >= 0) {
                    this.recentItems.splice(index, 1);
                }
            });
        }

        if (codeRepos.length > maxCodeRepos) {
            codeRepos.sort((a, b) => b.score - a.score);
            const toRemove = codeRepos.slice(maxCodeRepos);
            toRemove.forEach(item => {
                const index = this.recentItems.findIndex(
                    i => i.itemId === item.itemId && i.itemType === item.itemType
                );
                if (index >= 0) {
                    this.recentItems.splice(index, 1);
                }
            });
        }

        if (codeBranches.length > maxCodeBranches) {
            codeBranches.sort((a, b) => b.score - a.score);
            const toRemove = codeBranches.slice(maxCodeBranches);
            toRemove.forEach(item => {
                const index = this.recentItems.findIndex(
                    i => i.itemId === item.itemId && i.itemType === item.itemType
                );
                if (index >= 0) {
                    this.recentItems.splice(index, 1);
                }
            });
        }
    }

    /**
     * 加载最近使用记录
     */
    loadRecentItems() {
        const saved = this.context.globalState.get('yunxiao.recentItems', []);
        this.recentItems = saved;
        
        // 重新计算分数（因为时间已经过去了）
        this.recalculateScores();
    }

    /**
     * 保存最近使用记录
     */
    saveRecentItems() {
        // 保存时包含 data 字段，确保恢复时有完整数据
        const toSave = this.recentItems.map(item => ({
            itemId: item.itemId,
            itemType: item.itemType,
            lastUsedAt: item.lastUsedAt,
            useCount: item.useCount,
            score: item.score,
            data: item.data  // 保存 data 字段
        }));
        
        this.context.globalState.update('yunxiao.recentItems', toSave);
    }

    /**
     * 获取统计信息
     */
    getStatistics() {
        const projects = this.getRecentProjects();
        const workitems = this.getRecentWorkItems();

        return {
            totalProjects: projects.length,
            totalWorkItems: workitems.length,
            mostUsedProject: projects.length > 0 ? projects[0] : undefined,
            mostUsedWorkItem: workitems.length > 0 ? workitems[0] : undefined
        };
    }

    /**
     * 导出数据（用于调试）
     */
    export() {
        return this.recentItems;
    }

    /**
     * 导入数据（用于调试或迁移）
     */
    import(items) {
        this.recentItems = items;
        this.recalculateScores();
        this.saveRecentItems();
    }
}

module.exports = { RecentManager };
