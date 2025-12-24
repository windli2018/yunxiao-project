const vscode = require('vscode');
const { RecentItemType } = require('../models/types');

/**
 * 代码分组树视图提供者
 */
class CodeGroupsTreeProvider {
    constructor(codeGroupManager, authManager) {
        this.codeGroupManager = codeGroupManager;
        this.authManager = authManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.collapsible || vscode.TreeItemCollapsibleState.None
        );

        treeItem.contextValue = element.contextValue;
        treeItem.id = element.id;
        treeItem.tooltip = element.tooltip;

        if (element.iconPath) {
            treeItem.iconPath = element.iconPath;
        }

        if (element.command) {
            treeItem.command = element.command;
        }

        if (element.description) {
            treeItem.description = element.description;
        }

        return treeItem;
    }

    async getChildren(element) {
        // 检查登录状态
        if (!this.authManager.isAuthenticated()) {
            return [{
                type: 'login-button',
                label: '🔑 点击登录云效',
                id: 'code-groups-login-button',
                contextValue: 'login-button',
                iconPath: new vscode.ThemeIcon('account'),
                tooltip: '点击登录云效账号',
                command: {
                    command: 'yunxiao.login',
                    title: '登录',
                    arguments: []
                }
            }];
        }

        try {
            if (!element) {
                // 根级：显示收藏的分组和所有分组
                const result = [];
                
                // 获取收藏的分组
                const favorites = await this.codeGroupManager.getFavoriteGroups();
                if (favorites.length > 0) {
                    result.push({
                        id: 'code-groups-favorites-header',
                        label: '⭐ 收藏的分组',
                        contextValue: 'code-groups-favorites-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow')),
                        tooltip: '收藏的代码分组',
                        children: favorites.map(g => this.createGroupNode(g, true))
                    });
                }
                
                // 获取所有分组
                const response = await this.codeGroupManager.getGroups({ page: 1, perPage: 100 });
                const allGroups = response.items;
                
                if (allGroups.length > 0) {
                    result.push({
                        id: 'code-groups-all-header',
                        label: '📁 所有分组',
                        contextValue: 'code-groups-all-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('folder'),
                        tooltip: '所有代码分组',
                        children: allGroups.map(g => this.createGroupNode(g, false))
                    });
                }
                
                return result;
            } else if (element.contextValue === 'code-groups-favorites-header' || element.contextValue === 'code-groups-all-header') {
                // 展开收藏或所有分组
                return element.children || [];
            } else if (element.contextValue === 'code-group' || element.contextValue === 'code-group-favorited') {
                // 展开分组，显示子分组
                const groupId = element.data.id;
                const response = await this.codeGroupManager.getSubGroups(groupId, { page: 1, pageSize: 50 });
                
                if (response.items.length === 0) {
                    return [];
                }
                
                return response.items.map(g => this.createGroupNode(g, element.data.isFavorite));
            }

            return [];
        } catch (error) {
            console.error('获取代码分组失败:', error);
            vscode.window.showErrorMessage(`获取代码分组失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 创建分组节点
     */
    createGroupNode(group, isFavorite) {
        return {
            id: `code-group-${group.id}`,
            label: group.name,
            contextValue: isFavorite ? 'code-group-favorited' : 'code-group',
            collapsible: vscode.TreeItemCollapsibleState.Collapsed,
            iconPath: isFavorite 
                ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
                : new vscode.ThemeIcon('folder'),
            tooltip: `分组: ${group.name}\n路径: ${group.path || ''}\n收藏状态: ${isFavorite ? '已收藏' : '未收藏'}`,
            description: group.path,
            data: group
        };
    }
}

/**
 * 代码仓库树视图提供者
 * 集成分组功能，支持平铺模式和分组模式切换
 */
class CodeReposTreeProvider {
    constructor(codeGroupManager, codeRepoManager, authManager, context) {
        this.codeGroupManager = codeGroupManager;
        this.codeRepoManager = codeRepoManager;
        this.authManager = authManager;
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        
        // 视图模式：'flat' 或 'grouped'，从持久化存储中恢复，默认为 'flat'
        this.viewMode = this.context.globalState.get('yunxiao.code.repoViewMode', 'flat');
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 切换视图模式
     */
    async toggleViewMode() {
        this.viewMode = this.viewMode === 'flat' ? 'grouped' : 'flat';
        // 保存视图模式到持久化存储
        await this.context.globalState.update('yunxiao.code.repoViewMode', this.viewMode);
        this.refresh();
    }

    getTreeItem(element) {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.collapsible || vscode.TreeItemCollapsibleState.None
        );

        treeItem.contextValue = element.contextValue;
        treeItem.id = element.id;
        treeItem.tooltip = element.tooltip;

        if (element.iconPath) {
            treeItem.iconPath = element.iconPath;
        }

        if (element.command) {
            treeItem.command = element.command;
        }

        if (element.description) {
            treeItem.description = element.description;
        }

        return treeItem;
    }

    async getChildren(element) {
        // 检查登录状态
        if (!this.authManager.isAuthenticated()) {
            return [{
                type: 'login-button',
                label: '🔑 点击登录云效',
                id: 'code-repos-login-button',
                contextValue: 'login-button',
                iconPath: new vscode.ThemeIcon('account'),
                tooltip: '点击登录云效账号',
                command: {
                    command: 'yunxiao.login',
                    title: '登录',
                    arguments: []
                }
            }];
        }

        try {
            if (!element) {
                // 根级
                const result = [];
                
                // 获取收藏的仓库
                const favorites = await this.codeRepoManager.getFavoriteRepos();
                if (favorites.length > 0) {
                    result.push({
                        id: 'code-repos-favorites-header',
                        label: '⭐ 收藏的仓库',
                        contextValue: 'code-repos-favorites-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow')),
                        tooltip: '收藏的代码仓库',
                        children: favorites.map(r => this.createRepoNode(r, true, 'favorite-'))
                    });
                }
                
                if (this.viewMode === 'flat') {
                    // 平铺模式：直接显示所有仓库
                    // 检查是否已经初始化过，如果是则获取已加载的所有数据
                    let repos = this.codeRepoManager.getLoadedRepos('all');
                    if (repos.length === 0) {
                        // 第一次加载，初始化懒加载
                        repos = await this.codeRepoManager.initializeLazyLoad('all');
                    }
                    
                    if (repos.length > 0) {
                        result.push({
                            id: 'code-repos-all-header',
                            label: '📦 所有仓库',
                            contextValue: 'code-repos-all-header',
                            collapsible: vscode.TreeItemCollapsibleState.Expanded,
                            iconPath: new vscode.ThemeIcon('repo'),
                            tooltip: '所有代码仓库',
                            children: repos.map(r => this.createRepoNode(r, false))
                        });
                    }
                    
                    // 如果有更多数据，添加加载更多按钮
                    if (this.codeRepoManager.hasMoreRepos('all')) {
                        result.push({
                            id: 'load-more-repos-all',
                            label: '加载更多...',
                            contextValue: 'load-more-repos',
                            iconPath: new vscode.ThemeIcon('arrow-down'),
                            tooltip: '加载更多仓库',
                            command: {
                                command: 'yunxiao.code.loadMoreRepos',
                                title: '加载更多',
                                arguments: ['all']
                            },
                            data: { namespaceId: 'all' }
                        });
                    }
                } else {
                    // 分组模式：按分组显示仓库
                    const groupResponse = await this.codeGroupManager.getGroups({ page: 1, perPage: 100 });
                    const groups = groupResponse.items;
                    
                    if (groups.length > 0) {
                        result.push({
                            id: 'code-repos-groups-header',
                            label: '📁 分组列表',
                            contextValue: 'code-repos-groups-header',
                            collapsible: vscode.TreeItemCollapsibleState.Expanded,
                            iconPath: new vscode.ThemeIcon('folder'),
                            tooltip: '按分组查看代码仓库',
                            children: groups.map(g => this.createGroupNode(g))
                        });
                    }
                }
                
                return result;
            } else if (element.contextValue === 'code-repos-favorites-header' || 
                       element.contextValue === 'code-repos-all-header' ||
                       element.contextValue === 'code-repos-groups-header') {
                // 展开收藏、所有仓库或分组列表
                return element.children || [];
            } else if (element.contextValue === 'code-repo-group') {
                // 展开分组，显示该分组下的仓库
                const groupId = element.data.id;
                // 检查是否已经初始化过，如果是则获取已加载的所有数据
                let repos = this.codeRepoManager.getLoadedRepos(groupId);
                if (repos.length === 0) {
                    // 第一次加载，初始化懒加载
                    repos = await this.codeRepoManager.initializeLazyLoad(groupId);
                }
                const result = repos.map(r => this.createRepoNode(r, false));
                
                // 如果有更多数据，添加加载更多按钮
                if (this.codeRepoManager.hasMoreRepos(groupId)) {
                    result.push({
                        id: `load-more-repos-${groupId}`,
                        label: '加载更多...',
                        contextValue: 'load-more-repos',
                        iconPath: new vscode.ThemeIcon('arrow-down'),
                        tooltip: '加载更多仓库',
                        command: {
                            command: 'yunxiao.code.loadMoreRepos',
                            title: '加载更多',
                            arguments: [groupId]
                        },
                        data: { namespaceId: groupId }
                    });
                }
                
                return result;
            }

            return [];
        } catch (error) {
            console.error('获取代码仓库失败:', error);
            vscode.window.showErrorMessage(`获取代码仓库失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 创建分组节点（用于分组模式）
     */
    createGroupNode(group) {
        return {
            id: `code-repo-group-${group.id}`,
            label: group.name,
            contextValue: 'code-repo-group',
            collapsible: vscode.TreeItemCollapsibleState.Collapsed,
            iconPath: new vscode.ThemeIcon('folder'),
            tooltip: `分组: ${group.name}\n路径: ${group.path || ''}`,
            description: group.path,
            data: group
        };
    }

    /**
     * 格式化仓库路径
     * 移除开头的组织编号和结尾的仓库名称
     */
    formatRepoPath(pathWithNamespace, repoName) {
        if (!pathWithNamespace) return '';
        
        // 路径格式通常是: orgId/group1/group2/repoName
        const parts = pathWithNamespace.split('/');
        
        if (parts.length <= 1) {
            return '';
        }
        
        // 移除第一部分（组织编号）和最后一部分（仓库名称）
        const middleParts = parts.slice(1, -1);
        
        return middleParts.length > 0 ? middleParts.join('/') : '';
    }

    /**
     * 创建仓库节点
     */
    createRepoNode(repo, isFavorite, idPrefix = '') {
        const formattedPath = this.formatRepoPath(repo.pathWithNamespace || repo.path, repo.name);
        
        return {
            id: `${idPrefix}code-repo-${repo.id}`,
            label: repo.name,
            contextValue: isFavorite ? 'code-repository-favorited' : 'code-repository',
            iconPath: isFavorite 
                ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
                : new vscode.ThemeIcon('repo'),
            tooltip: `仓库: ${repo.name}\n路径: ${repo.pathWithNamespace || repo.path || ''}\n收藏状态: ${isFavorite ? '已收藏' : '未收藏'}`,
            description: formattedPath,
            command: {
                command: 'yunxiao.code.selectRepository',
                title: '选择仓库',
                arguments: [repo]
            },
            data: repo
        };
    }
}

/**
 * 代码分支树视图提供者
 */
class CodeBranchesTreeProvider {
    constructor(codeBranchManager, authManager) {
        this.codeBranchManager = codeBranchManager;
        this.authManager = authManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        
        // 当前选中的仓库
        this.currentRepository = null;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 设置当前仓库
     */
    setCurrentRepository(repo) {
        this.currentRepository = repo;
        this.refresh();
    }

    /**
     * 获取当前仓库名称（用于标题栏显示）
     */
    getCurrentRepositoryName() {
        if (!this.currentRepository) {
            return '未选择仓库';
        }
        return this.currentRepository.name;
    }

    /**
     * 获取当前仓库的完整路径（用于提示）
     */
    getCurrentRepositoryPath() {
        if (!this.currentRepository) {
            return '';
        }
        return this.currentRepository.path || this.currentRepository.pathWithNamespace || '';
    }

    getTreeItem(element) {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.collapsible || vscode.TreeItemCollapsibleState.None
        );

        treeItem.contextValue = element.contextValue;
        treeItem.id = element.id;
        treeItem.tooltip = element.tooltip;

        if (element.iconPath) {
            treeItem.iconPath = element.iconPath;
        }

        if (element.command) {
            treeItem.command = element.command;
        }

        if (element.description) {
            treeItem.description = element.description;
        }

        return treeItem;
    }

    async getChildren(element) {
        // 检查登录状态
        if (!this.authManager.isAuthenticated()) {
            return [{
                type: 'login-button',
                label: '🔑 点击登录云效',
                id: 'code-branches-login-button',
                contextValue: 'login-button',
                iconPath: new vscode.ThemeIcon('account'),
                tooltip: '点击登录云效账号',
                command: {
                    command: 'yunxiao.login',
                    title: '登录',
                    arguments: []
                }
            }];
        }

        // 检查是否选中仓库
        if (!this.currentRepository) {
            return [{
                id: 'no-repo-selected',
                label: '📦 请先选择一个仓库',
                contextValue: 'no-repo-selected',
                iconPath: new vscode.ThemeIcon('info'),
                tooltip: '在代码仓库视图中选择一个仓库后，此处将显示该仓库的分支列表'
            }];
        }

        try {
            if (!element) {
                // 根级：显示当前仓库的分支
                const result = [];
                const repoId = this.currentRepository.id;
                
                // 获取收藏的分支
                const favorites = await this.codeBranchManager.getFavoriteBranches(repoId);
                if (favorites.length > 0) {
                    result.push({
                        id: 'code-branches-favorites-header',
                        label: '⭐ 收藏的分支',
                        contextValue: 'code-branches-favorites-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow')),
                        tooltip: '收藏的代码分支',
                        children: favorites.map(b => this.createBranchNode(repoId, b, true, 'favorite-'))
                    });
                }
                
                // 获取所有分支
                const response = await this.codeBranchManager.getBranches(repoId, { page: 1, perPage: 100 });
                const branches = response.items;
                
                if (branches.length > 0) {
                    result.push({
                        id: 'code-branches-all-header',
                        label: '🌳 所有分支',
                        description: this.currentRepository ? this.currentRepository.name : '',
                        contextValue: 'code-branches-all-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('git-branch'),
                        tooltip: '所有代码分支',
                        children: branches.map(b => this.createBranchNode(repoId, b, false))
                    });
                }
                
                return result;
            } else if (element.contextValue === 'code-branches-favorites-header' || 
                       element.contextValue === 'code-branches-all-header') {
                // 展开收藏或所有分支
                return element.children || [];
            }

            return [];
        } catch (error) {
            console.error('获取代码分支失败:', error);
            vscode.window.showErrorMessage(`获取代码分支失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 创建分支节点
     */
    createBranchNode(repoId, branch, isFavorite, idPrefix = '') {
        const isDefault = branch.defaultBranch;
        const isProtected = branch.protected;
        
        let label = branch.name;
        if (isDefault) {
            label += ' (default)';
        }
        if (isProtected) {
            label += ' 🔒';
        }
        
        return {
            id: `${idPrefix}code-branch-${repoId}-${branch.name}`,
            label: label,
            contextValue: isFavorite ? 'code-branch-favorited' : 'code-branch',
            iconPath: isFavorite 
                ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
                : new vscode.ThemeIcon('git-branch'),
            tooltip: `分支: ${branch.name}\n默认分支: ${isDefault ? '是' : '否'}\n保护分支: ${isProtected ? '是' : '否'}\n收藏状态: ${isFavorite ? '已收藏' : '未收藏'}`,
            description: branch.commit ? `${branch.commit.shortId} - ${branch.commit.title}` : '',
            data: { ...branch, repositoryId: repoId }
        };
    }
}

/**
 * 最近使用树视图提供者
 */
class CodeRecentTreeProvider {
    constructor(recentManager, authManager) {
        this.recentManager = recentManager;
        this.authManager = authManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.collapsible || vscode.TreeItemCollapsibleState.None
        );

        treeItem.contextValue = element.contextValue;
        treeItem.id = element.id;
        treeItem.tooltip = element.tooltip;

        if (element.iconPath) {
            treeItem.iconPath = element.iconPath;
        }

        if (element.command) {
            treeItem.command = element.command;
        }

        if (element.description) {
            treeItem.description = element.description;
        }

        return treeItem;
    }

    async getChildren(element) {
        // 检查登录状态
        if (!this.authManager.isAuthenticated()) {
            return [{
                type: 'login-button',
                label: '🔑 点击登录云效',
                id: 'code-recent-login-button',
                contextValue: 'login-button',
                iconPath: new vscode.ThemeIcon('account'),
                tooltip: '点击登录云效账号',
                command: {
                    command: 'yunxiao.login',
                    title: '登录',
                    arguments: []
                }
            }];
        }

        try {
            if (!element) {
                // 根级：显示最近使用的代码相关项
                const result = [];
                
                // 最近使用的代码分组
                const recentGroups = this.recentManager.getRecentCodeGroups(10);
                if (recentGroups.length > 0) {
                    result.push({
                        id: 'recent-code-groups-header',
                        label: '📁 最近使用的分组',
                        contextValue: 'recent-code-groups-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('folder'),
                        tooltip: '最近使用的代码分组',
                        children: recentGroups.map(item => this.createRecentGroupNode(item))
                    });
                }
                
                // 最近使用的代码仓库
                const recentRepos = this.recentManager.getRecentCodeRepos(20);
                if (recentRepos.length > 0) {
                    result.push({
                        id: 'recent-code-repos-header',
                        label: '📦 最近使用的仓库',
                        contextValue: 'recent-code-repos-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('repo'),
                        tooltip: '最近使用的代码仓库',
                        children: recentRepos.map(item => this.createRecentRepoNode(item))
                    });
                }
                
                // 最近使用的代码分支
                const recentBranches = this.recentManager.getRecentCodeBranches(30);
                if (recentBranches.length > 0) {
                    result.push({
                        id: 'recent-code-branches-header',
                        label: '🌳 最近使用的分支',
                        contextValue: 'recent-code-branches-header',
                        collapsible: vscode.TreeItemCollapsibleState.Expanded,
                        iconPath: new vscode.ThemeIcon('git-branch'),
                        tooltip: '最近使用的代码分支',
                        children: recentBranches.map(item => this.createRecentBranchNode(item))
                    });
                }
                
                if (result.length === 0) {
                    return [{
                        id: 'no-recent-code',
                        label: '暂无最近使用记录',
                        contextValue: 'no-recent-code',
                        iconPath: new vscode.ThemeIcon('info'),
                        tooltip: '暂无最近使用的代码相关记录'
                    }];
                }
                
                return result;
            } else if (element.children) {
                // 展开分组
                return element.children;
            }

            return [];
        } catch (error) {
            console.error('获取最近使用记录失败:', error);
            vscode.window.showErrorMessage(`获取最近使用记录失败: ${error.message}`);
            return [];
        }
    }

    /**
     * 创建最近使用的分组节点
     */
    createRecentGroupNode(item) {
        const group = item.data;
        return {
            id: `recent-code-group-${item.itemId}`,
            label: group.name,
            contextValue: 'recent-code-group',
            iconPath: new vscode.ThemeIcon('folder'),
            tooltip: `分组: ${group.name}\n路径: ${group.path || ''}\n最后使用: ${new Date(item.lastUsedAt).toLocaleString()}`,
            description: group.path,
            data: item
        };
    }

    /**
     * 创建最近使用的仓库节点
     */
    createRecentRepoNode(item) {
        const repo = item.data;
        const formattedPath = this.formatRepoPath(repo.pathWithNamespace || repo.path, repo.name);
        
        return {
            id: `recent-code-repo-${item.itemId}`,
            label: repo.name,
            contextValue: 'recent-code-repo',
            iconPath: new vscode.ThemeIcon('repo'),
            tooltip: `仓库: ${repo.name}\n路径: ${repo.pathWithNamespace || repo.path || ''}\n最后使用: ${new Date(item.lastUsedAt).toLocaleString()}`,
            description: formattedPath,
            command: {
                command: 'yunxiao.code.selectRepository',
                title: '选择仓库',
                arguments: [repo]
            },
            data: item
        };
    }

    /**
     * 格式化仓库路径，只显示分组部分
     * 与 CodeReposTreeProvider 的格式化逻辑保持一致
     */
    formatRepoPath(pathWithNamespace, repoName) {
        if (!pathWithNamespace) return '';
        
        // 路径格式通常是: orgId/group1/group2/repoName
        const parts = pathWithNamespace.split('/');
        
        if (parts.length <= 1) {
            return '';
        }
        
        // 移除第一部分（组织编号）和最后一部分（仓库名称）
        const middleParts = parts.slice(1, -1);
        
        return middleParts.length > 0 ? middleParts.join('/') : '';
    }

    /**
     * 创建最近使用的分支节点
     */
    createRecentBranchNode(item) {
        const branch = item.data;
        return {
            id: `recent-code-branch-${item.itemId}`,
            label: branch.name,
            contextValue: 'recent-code-branch',
            iconPath: new vscode.ThemeIcon('git-branch'),
            tooltip: `分支: ${branch.name}\n仓库ID: ${branch.repositoryId || ''}\n最后使用: ${new Date(item.lastUsedAt).toLocaleString()}`,
            description: branch.commit ? `${branch.commit.shortId} - ${branch.commit.title}` : '',
            data: item
        };
    }
}

module.exports = { CodeGroupsTreeProvider, CodeReposTreeProvider, CodeBranchesTreeProvider, CodeRecentTreeProvider };
