const vscode = require('vscode');
const { YunxiaoApiClient } = require('../services/yunxiaoApiClient');
const { CacheManager } = require('./cacheManager');

/**
 * 项目管理器
 */
class ProjectManager {
    constructor(context, apiClient, cacheManager) {
        this.context = context;
        this.apiClient = apiClient;
        this.cacheManager = cacheManager;
        this.currentProject = undefined;
        this.favorites = new Set();
        
        this.loadFavorites();
    }

    /**
     * 获取项目列表
     */
    async getProjects(forceRefresh = false) {
        const cacheKey = 'projects';
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                return this.applyFavorites(cached);
            }
        }

        try {
            const response = await this.apiClient.getProjects({ page: 1, pageSize: 100 });
            const projects = response.items;
            
            // 缓存项目列表
            const config = vscode.workspace.getConfiguration('yunxiao');
            const cacheDuration = config.get('projectCacheDuration', 30) * 60 * 1000;
            console.error(`缓存项目列表 ${cacheKey}，有效期 ${cacheDuration} ms`);
            console.error(projects )
            this.cacheManager.set(cacheKey, projects, cacheDuration);
            
            return this.applyFavorites(projects);
        } catch (error) {
            throw new Error(`获取项目列表失败: ${error.message}`);
        }
    }

    /**
     * 获取项目详情
     */
    async getProject(projectId, forceRefresh = false) {
        const cacheKey = `project:${projectId}`;
        
        if (!forceRefresh) {
            const cached = this.cacheManager.get(cacheKey);
            if (cached) {
                return this.applyFavorite(cached);
            }
        }

        try {
            const project = await this.apiClient.getProject(projectId);
            
            // 缓存项目详情
            const config = vscode.workspace.getConfiguration('yunxiao');
            const cacheDuration = config.get('projectCacheDuration', 30) * 60 * 1000;
            this.cacheManager.set(cacheKey, project, cacheDuration);
            
            return this.applyFavorite(project);
        } catch (error) {
            throw new Error(`获取项目详情失败: ${error.message}`);
        }
    }

    /**
     * 搜索项目
     */
    async searchProjects(keyword) {
        const allProjects = await this.getProjects();
        
        if (!keyword) {
            return allProjects;
        }

        const lowerKeyword = keyword.toLowerCase();
        return allProjects.filter(p => 
            p.projectName.toLowerCase().includes(lowerKeyword) ||
            (p.description && p.description.toLowerCase().includes(lowerKeyword)) ||
            p.projectId.toLowerCase().includes(lowerKeyword)
        );
    }

    /**
     * 设置当前项目
     */
    setCurrentProject(project) {
        this.currentProject = project;
        this.context.globalState.update('yunxiao.currentProject', project);
    }

    /**
     * 获取当前项目
     */
    getCurrentProject() {
        if (!this.currentProject) {
            this.currentProject = this.context.globalState.get('yunxiao.currentProject');
        }
        return this.currentProject;
    }

    /**
     * 切换收藏状态
     */
    async toggleFavorite(projectId) {
        if (this.favorites.has(projectId)) {
            this.favorites.delete(projectId);
        } else {
            this.favorites.add(projectId);
        }
        
        await this.saveFavorites();
        
        // 清除缓存，重新加载时会应用收藏状态
        this.cacheManager.delete('projects');
        
        return this.favorites.has(projectId);
    }

    /**
     * 判断是否收藏
     */
    isFavorite(projectId) {
        return this.favorites.has(projectId);
    }

    /**
     * 获取收藏的项目
     */
    async getFavoriteProjects() {
        const allProjects = await this.getProjects();
        return allProjects.filter(p => this.isFavorite(p.projectId));
    }

    /**
     * 排序项目（收藏在前）
     */
    sortProjects(projects) {
        return projects.sort((a, b) => {
            const aFav = this.isFavorite(a.projectId);
            const bFav = this.isFavorite(b.projectId);
            
            if (aFav && !bFav) return -1;
            if (!aFav && bFav) return 1;
            
            // 按名称排序
            return a.projectName.localeCompare(b.projectName, 'zh-CN');
        });
    }

    /**
     * 刷新项目列表
     */
    async refresh() {
        this.cacheManager.delete('projects');
        await this.getProjects(true);
    }

    /**
     * 清除缓存
     */
    clearCache() {
        // 清除所有项目相关缓存
        const keys = ['projects'];
        keys.forEach(key => this.cacheManager.delete(key));
    }

    /**
     * 加载收藏列表
     */
    loadFavorites() {
        const saved = this.context.globalState.get('yunxiao.favoriteProjects', []);
        this.favorites = new Set(saved);
    }

    /**
     * 保存收藏列表
     */
    async saveFavorites() {
        await this.context.globalState.update('yunxiao.favoriteProjects', Array.from(this.favorites));
    }

    /**
     * 应用收藏状态到项目列表
     */
    applyFavorites(projects) {
        return projects.map(p => this.applyFavorite(p));
    }

    /**
     * 应用收藏状态到单个项目
     */
    applyFavorite(project) {
        return {
            ...project,
            isFavorite: this.isFavorite(project.projectId)
        };
    }
}

module.exports = { ProjectManager };
