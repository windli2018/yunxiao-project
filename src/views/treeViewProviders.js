const vscode = require('vscode');
const { RecentItemType } = require('../models/types');
const { CATEGORY_BI_MAP, getCategoryId } = require('../config/workitemTypes');

/**
 * 根据工作项类型获取对应的图标名称
 * @param {Object} workitem - 工作项对象
 * @param {boolean} isRecent - 是否为最近使用列表（影响默认图标）
 * @returns {string} 图标名称
 */
function getWorkItemIconName(workitem, isRecent = false) {
    const type = (workitem.workitemType || '').toLowerCase();
    
    switch (type) {
        case 'bug':
        case '缺陷':
            return 'bug';
        case 'task':
        case '任务':
            return 'check';
        case 'req':
        case '需求':
            return 'lightbulb';
        case 'risk':
        case '风险':
            return 'warning';
        default:
            return isRecent ? 'history' : 'circle-outline';
    }
}

/**
 * 根据工作项状态获取带颜色的图标（TreeView 专用）
 * @param {Object} workitem - 工作项对象
 * @param {Object} stateManager - 状态管理器（可选）
 * @param {boolean} isRecent - 是否为最近使用列表
 * @returns {vscode.ThemeIcon} 带颜色的主题图标
 */
function getWorkItemIconWithState(workitem, stateManager = null, isRecent = false) {
    // 获取图标名称
    const iconName = getWorkItemIconName(workitem, isRecent);
    
    // 根据状态设置图标颜色
    if (stateManager && workitem.workitemId) {
        const displayState = stateManager.getDisplayState(workitem.workitemId);
        
        if (displayState === 'commit') {
            // 已粘贴提交记录 - 蓝色
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('charts.blue'));
        } else if (displayState === 'ai') {
            // 已发送AI - 绿色
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('charts.green'));
        }
    }
    
    // 默认颜色
    return new vscode.ThemeIcon(iconName);
}

/**
 * 根据工作项状态获取 Codicon 图标字符串（QuickPick label 前缀专用，使用 VS Code 1.70+ 颜色修饰符语法）
 * 不显示工作项类型图标，改用状态图标（check系列）表示工作项状态
 * @param {Object} workitem - 工作项对象
 * @param {Object} stateManager - 状态管理器（可选）
 * @param {boolean} isRecent - 是否为最近使用列表
 * @returns {string} Codicon 图标字符串，例如 '$(circle-filled~blue)' 或 '$(circle-outline~green)'，默认为空
 */
function getWorkItemIconLabel(workitem, stateManager = null, isRecent = false) {
    // 根据状态设置不同的图标和颜色
    if (stateManager && workitem.workitemId) {
        const displayState = stateManager.getDisplayState(workitem.workitemId);
        
        if (displayState === 'commit') {
            // 已粘贴提交记录 - 使用蓝色实心圆
            return '$(circle-filled~blue)';
        } else if (displayState === 'ai') {
            // 已发送AI - 使用绿色空心圆
            return '$(circle-outline~green)';
        }
    }
    
    // 默认状态 - 无图标
    return '';
}

/**
 * 获取工作项状态的文本描述（用于 tooltip）
 * @param {Object} workitem - 工作项对象
 * @param {Object} stateManager - 状态管理器（可选）
 * @returns {string} 状态描述文本
 */
function getWorkItemStateDescription(workitem, stateManager = null) {
    if (stateManager && workitem.workitemId) {
        const displayState = stateManager.getDisplayState(workitem.workitemId);
        
        if (displayState === 'commit') {
            return '🔵 已粘贴到提交记录';
        } else if (displayState === 'ai') {
            return '🟢 已发送到AI';
        }
    }
    
    return '⚪ 未处理';
}

/**
 * 树节点类型
 */
const TreeItemType = {
    Project: 'project',
    WorkItemTypeGroup: 'workitem-type-group',
    WorkItem: 'workitem',
    RecentProject: 'recent-project',
    RecentWorkItem: 'recent-workitem',
    RecentSearchKeyword: 'recent-search-keyword'  // 最近搜索关键词
};

/**
 * 项目树视图提供者
 */
class ProjectsTreeProvider {
    constructor(projectManager, authManager) {
        this.projectManager = projectManager;
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
            element.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        treeItem.contextValue = element.type;
        treeItem.id = element.id;

        if (element.type === 'login-button') {
            // 登录按钮
            treeItem.iconPath = new vscode.ThemeIcon('account');
            treeItem.tooltip = '点击登录云效账号';
            treeItem.command = {
                command: 'yunxiao.login',
                title: '登录',
                arguments: []
            };
        } else if (element.type === TreeItemType.Project) {
            const project = element.data;
            treeItem.description = project.description;
            treeItem.tooltip = `项目: ${project.projectName}\n描述: ${project.description || '无'}\n收藏状态: ${project.isFavorite ? '已收藏' : '未收藏'}`;
            
            // 已收藏的项目使用星星图标，未收藏的使用项目图标
            if (project.isFavorite) {
                treeItem.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
            } else {
                treeItem.iconPath = new vscode.ThemeIcon('project');
            }
            
            // 设置 contextValue 区分收藏和未收藏状态，用于显示不同的内联按钮
            treeItem.contextValue = project.isFavorite ? 'project-favorited' : 'project';
            
            // 点击项目名称选择项目
            treeItem.command = {
                command: 'yunxiao.selectProjectFromTree',
                title: '选择项目',
                arguments: [project]
            };
        }

        return treeItem;
    }

    async getChildren(element) {
        if (!element) {
            // 根级：显示所有项目
            try {
                // 检查是否已登录
                if (!this.authManager.isAuthenticated()) {
                    // 未登录，显示登录按钮
                    return [{
                        type: 'login-button',
                        label: '🔑 点击登录云效',
                        id: 'login-button'
                    }];
                }
                
                const projects = await this.projectManager.getProjects();
                
                // 如果已登录但项目列表为空，也显示登录按钮（可能需要重新登录）
                if (!projects || projects.length === 0) {
                    return [{
                        type: 'login-button',
                        label: '🔑 点击登录云效',
                        id: 'login-button'
                    }];
                }
                
                const sorted = this.projectManager.sortProjects(projects);
                
                return sorted.map(p => ({
                    type: TreeItemType.Project,
                    label: p.projectName,
                    id: `project:${p.projectId}`,
                    data: p
                }));
            } catch (error) {
                vscode.window.showErrorMessage(`加载项目列表失败: ${error.message}`);
                // 发生错误时也显示登录按钮
                return [{
                    type: 'login-button',
                    label: '🔑 点击登录云效',
                    id: 'login-button'
                }];
            }
        }

        return element.children || [];
    }
}

/**
 * 工作项树视图提供者
 */
class WorkItemsTreeProvider {
    constructor(projectManager, workItemManager, context, stateManager) {
        this.projectManager = projectManager;
        this.workItemManager = workItemManager;
        this.context = context;
        this.stateManager = stateManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        
        // 懒加载状态
        this.isLoadingMore = false;
        
        // 搜索关键词（从缓存加载）
        this.searchKeyword = this.context.globalState.get('yunxiao.workItemSearchKeyword', '');
    }
    
    /**
     * 设置搜索关键词并缓存
     */
    setSearchKeyword(keyword) {
        this.searchKeyword = keyword || '';
        this.context.globalState.update('yunxiao.workItemSearchKeyword', this.searchKeyword);
    }
    
    /**
     * 获取当前搜索关键词
     */
    getSearchKeyword() {
        return this.searchKeyword;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        // 根据元素类型明确设置折叠状态，避免依赖 element.children 导致的不对齐
        let collapsibleState = vscode.TreeItemCollapsibleState.None;
        if (element.type === TreeItemType.WorkItemTypeGroup) {
            // 工作项类型分组：总是可展开（通过 getChildren 返回子节点）
            collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }
        
        const treeItem = new vscode.TreeItem(element.label, collapsibleState);

        treeItem.contextValue = element.type;
        treeItem.id = element.id;

        if (element.type === 'search-input') {
            // 搜索输入框
            treeItem.iconPath = new vscode.ThemeIcon('search');
            treeItem.description = element.description;
            treeItem.tooltip = '点击输入关键词搜索工作项，回车确认';
            treeItem.command = {
                command: 'yunxiao.workItemQuickFilter',
                title: '搜索工作项',
                arguments: []
            };
        } else if (element.type === 'clear-filter') {
            // 清除筛选按钮
            treeItem.iconPath = new vscode.ThemeIcon('clear-all');
            treeItem.tooltip = '清除搜索关键词';
            treeItem.command = {
                command: 'yunxiao.clearWorkItemFilter',
                title: '清除筛选',
                arguments: []
            };
        } else if (element.type === TreeItemType.WorkItemTypeGroup) {
            treeItem.iconPath = new vscode.ThemeIcon('folder');
            // 不再显示 description，因为数量已在 label 中
            // 注意：children 中包含“加载更多”按钮，不要用它来计数
        } else if (element.type === TreeItemType.WorkItem) {
            const workitem = element.data;
            const displayType = element.displayType || workitem.workitemType;
            
            treeItem.description = workitem.status;
            
            // 构建增强的tooltip，包含状态信息
            const stateDesc = this.stateManager ? this.stateManager.getStateDescription(workitem.workitemId) : '';
            treeItem.tooltip = `${workitem.identifier}
${workitem.subject}
类型: ${displayType}
状态: ${workitem.status}${stateDesc ? '\n\n使用状态:\n' + stateDesc : ''}`;
            
            treeItem.iconPath = this.getWorkItemIcon(workitem);
            
            treeItem.command = {
                command: 'yunxiao.viewWorkItemProperties',
                title: '查看工作项属性',
                arguments: [{ data: workitem }]
            };
        } else if (element.type === 'load-more') {
            // 加载更多按钮
            treeItem.iconPath = new vscode.ThemeIcon('sync');
            treeItem.description = element.description;
            treeItem.command = {
                command: 'yunxiao.loadMoreWorkItems',
                title: '加载更多',
                arguments: [element.workitemType]  // 传递类型参数
            };
        }

        return treeItem;
    }

    async getChildren(element) {
        const currentProject = this.projectManager.getCurrentProject();
        
        if (!currentProject) {
            return [{
                type: TreeItemType.WorkItemTypeGroup,
                label: '请先选择项目',
                id: 'no-project'
            }];
        }

        if (!element) {
            // 根级：显示搜索框 + 工作项列表
            const children = [];
            
            // 添加搜索输入框
            const searchLabel = this.searchKeyword 
                ? `🔍 搜索: ${this.searchKeyword}` 
                : '🔍 点击输入关键词过滤';
            children.push({
                type: 'search-input',
                label: searchLabel,
                description: this.searchKeyword ? '回车刷新' : '支持编号/标题/描述',
                id: 'search-input'
            });
            
            // 如果有搜索关键词，添加清除按钮
            if (this.searchKeyword) {
                children.push({
                    type: 'clear-filter',
                    label: '✖ 清除筛选',
                    id: 'clear-filter'
                });
            }
            
            try {
                let workitems;
                            
                // 无论是否有搜索关键词，都统一使用 initializeLazyLoad
                workitems = this.workItemManager.getLoadedWorkItems(currentProject.projectId);
                if (workitems.length === 0) {
                    // 初次加载，带上当前的 filter（包含 searchKeyword）
                    await this.workItemManager.initializeLazyLoad(
                        currentProject.projectId,
                        { keyword: this.searchKeyword }
                    );
                    workitems = this.workItemManager.getLoadedWorkItems(currentProject.projectId);
                }
                            
                // 构建分组（不需要 isFiltered 参数）
                const groups = await this.buildGroupsWithLoadMore(
                    currentProject.projectId, 
                    workitems
                );
                children.push(...groups);
                
                return children;
            } catch (error) {
                vscode.window.showErrorMessage(`加载工作项失败: ${error.message}`);
                return children;
            }
        }

        // 如果是工作项类型分组，返回其子节点
        if (element.type === TreeItemType.WorkItemTypeGroup) {
            return element._childrenCache || [];
        }

        return [];
    }
    
    /**
     * 本地过滤工作项
     */
    filterWorkItemsLocally(workitems, keyword) {
        if (!keyword) {
            return workitems;
        }
        
        const lowerKeyword = keyword.toLowerCase();
        return workitems.filter(w => {
            return (
                w.identifier?.toLowerCase().includes(lowerKeyword) ||
                w.subject?.toLowerCase().includes(lowerKeyword) ||
                w.description?.toLowerCase().includes(lowerKeyword)
            );
        });
    }

    /**
     * 构建分组并添加"加载更多"按钮
     * @param {string} projectId - 项目 ID
     * @param {Array} workitems - 工作项列表
     */
    async buildGroupsWithLoadMore(projectId, workitems) {
        const grouped = this.workItemManager.groupByType(workitems);
        const groups = [];
        
        grouped.forEach((items, typeName) => {
            // 使用统一的双向映射，支持中文和英文
            const typeKey = getCategoryId(typeName);
            
            // 添加工作项列表
            const children = items.map(w => {
                // 显示时优先使用次级分类（workitemTypeName）
                const displayType = w.workitemTypeName || w.workitemType;
                
                return {
                    type: TreeItemType.WorkItem,
                    label: `#${w.identifier} ${w.subject}`,
                    id: `workitem:${w.workitemId}`,
                    data: w,
                    displayType: displayType  // 保存显示用的类型
                };
            });
            
            // 获取加载进度（过滤和未过滤使用相同的状态）
            const progress = this.workItemManager.getLoadProgress(projectId, typeKey);
            const hasMore = this.workItemManager.hasMoreWorkItems(projectId, typeKey);
            
            // 服务端返回的 total 是应用「排除已结束」过滤后的精确总数，与云效网页「概览」一致（issue #1）。
            // 优先显示 total，未取得时才退回已加载数量。
            const displayCount = progress.total > 0 ? progress.total : progress.loaded;
            
            // 检查该类型是否还有更多
            if (hasMore) {
                children.push({
                    type: 'load-more',
                    label: `加载更多50项...`,
                    description: `已加载 ${progress.loaded}/${progress.total || '?'}`,
                    id: `load-more:${typeKey}`,
                    workitemType: typeKey  // 保存类型信息
                });
            }
            
            // 构建分组显示标签：直接显示精确总数，与云效网页「概览」保持一致
            let groupLabel = typeName;
            if (displayCount > 0) {
                groupLabel = `${typeName} (${displayCount})`;
            }
            
            // 关键修复：不要设置 children 属性，避免 VSCode 自动添加展开图标导致不对齐
            // 使用 _childrenCache 缓存子节点，在 getChildren 中返回
            groups.push({
                type: TreeItemType.WorkItemTypeGroup,
                label: groupLabel,
                id: `type:${typeName}`,
                _childrenCache: children  // 使用私有属性缓存，不使用 children
            });
        });
        
        return groups;
    }

    getWorkItemIcon(workitem) {
        return getWorkItemIconWithState(workitem, this.stateManager, false);
    }
}

/**
 * 最近使用树视图提供者
 */
class RecentTreeProvider {
    constructor(recentManager, stateManager) {
        this.recentManager = recentManager;
        this.stateManager = stateManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        const treeItem = new vscode.TreeItem(element.label);
        treeItem.contextValue = element.type;
        treeItem.id = element.id;

        if (element.type === TreeItemType.RecentProject) {
            const recentItem = element.data;
            const project = recentItem.data;
            if (project) {
                treeItem.description = `使用 ${recentItem.useCount} 次`;
                treeItem.tooltip = `项目：${project.projectName}\n描述：${project.description || '无'}\n使用次数: ${recentItem.useCount}\n最后使用: ${new Date(recentItem.lastUsedAt).toLocaleString('zh-CN')}`;
            }
            treeItem.iconPath = new vscode.ThemeIcon('project');
            
            // 设置 contextValue 为 'project' 以支持项目的右键菜单
            treeItem.contextValue = 'project';
            
            treeItem.command = {
                command: 'yunxiao.selectProjectFromTree',
                title: '选择项目',
                arguments: [project]
            };
        } else if (element.type === TreeItemType.RecentWorkItem) {
            const recentItem = element.data;
            const workitem = recentItem.data;
            
            // 如果 data 不存在，创建一个临时对象（用于恢复的情况）
            const workitemData = workitem || {
                workitemId: recentItem.itemId,
                identifier: recentItem.itemId,
                subject: '加载中...',
                workitemType: '',
                status: ''
            };
            
            treeItem.description = workitemData.workitemType || '';
            
            // 构建增强的tooltip
            const stateDesc = this.stateManager ? this.stateManager.getStateDescription(workitemData.workitemId) : '';
            treeItem.tooltip = `工作项：${workitemData.identifier}
标题：${workitemData.subject}
类型：${workitemData.workitemType}
状态：${workitemData.status}
使用次数: ${recentItem.useCount}
最后使用: ${new Date(recentItem.lastUsedAt).toLocaleString('zh-CN')}${stateDesc ? '\n\n使用状态:\n' + stateDesc : ''}`;
            
            treeItem.iconPath = this.getWorkItemIcon(workitemData);
            
            // 重要：设置 contextValue 为 'workitem' 以支持右键菜单
            treeItem.contextValue = 'workitem';
            
            treeItem.command = {
                command: 'yunxiao.viewWorkItemProperties',
                title: '查看工作项属性',
                arguments: [{ data: workitemData }]
            };
        } else if (element.type === TreeItemType.RecentSearchKeyword) {
            const recentItem = element.data;
            const searchData = recentItem.data;
            
            // 设置 contextValue 以支持右键菜单
            treeItem.contextValue = TreeItemType.RecentSearchKeyword;
            
            if (searchData) {
                treeItem.description = `${searchData.resultCount} 项 | ${searchData.projectName}`;
                treeItem.tooltip = `搜索关键词：${searchData.keyword}
项目：${searchData.projectName}
结果数：${searchData.resultCount}
使用次数: ${recentItem.useCount}
最后搜索: ${new Date(recentItem.lastUsedAt).toLocaleString('zh-CN')}`;
            }
            treeItem.iconPath = new vscode.ThemeIcon('search');
            
            treeItem.command = {
                command: 'yunxiao.reopenSearch',
                title: '重新搜索',
                arguments: [searchData]
            };
        }

        return treeItem;
    }

    async getChildren(element) {
        if (element) {
            return [];
        }

        const recentProjects = this.recentManager.getRecentProjects(5);
        const recentWorkItems = this.recentManager.getRecentWorkItems(10);
        const recentSearchKeywords = this.recentManager.getRecentSearchKeywords(5);

        const items = [];

        // 添加最近搜索关键词
        if (recentSearchKeywords.length > 0) {
            items.push(...recentSearchKeywords.map(item => ({
                type: TreeItemType.RecentSearchKeyword,
                label: `🔍 ${item.data?.keyword || item.itemId}`,
                id: `recent-search:${item.itemId}`,
                data: item
            })));
        }

        // 添加最近使用的项目
        if (recentProjects.length > 0) {
            items.push(...recentProjects.map(item => ({
                type: TreeItemType.RecentProject,
                label: item.data?.projectName || item.itemId,
                id: `recent-project:${item.itemId}`,
                data: item
            })));
        }

        // 添加最近使用的工作项
        if (recentWorkItems.length > 0) {
            items.push(...recentWorkItems.map(item => {
                const workitem = item.data;
                const label = workitem 
                    ? `#${workitem.identifier} ${workitem.subject}` 
                    : `#${item.itemId}`;
                
                return {
                    type: TreeItemType.RecentWorkItem,
                    label: label,
                    id: `recent-workitem:${item.itemId}`,
                    data: item
                };
            }));
        }

        if (items.length === 0) {
            return [{
                type: TreeItemType.WorkItemTypeGroup,
                label: '暂无最近使用记录',
                id: 'no-recent'
            }];
        }

        return items;
    }
    
    getWorkItemIcon(workitem) {
        return getWorkItemIconWithState(workitem, this.stateManager, true);
    }
}

/**
 * 搜索树视图提供者
 */
class SearchTreeProvider {
    constructor(projectManager, workItemManager, recentManager, stateManager) {
        this.projectManager = projectManager;
        this.workItemManager = workItemManager;
        this.recentManager = recentManager;
        this.stateManager = stateManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        
        // 搜索状态
        this.searchResults = [];
        this.searchKeyword = '';
        this.searchFilters = {};
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 设置搜索结果
     */
    setSearchResults(results, keyword, filters) {
        this.searchResults = results;
        this.searchKeyword = keyword;
        this.searchFilters = filters || {};
        this.refresh();
    }

    /**
     * 清除搜索结果
     */
    clearSearch() {
        this.searchResults = [];
        this.searchKeyword = '';
        this.searchFilters = {};
        this.refresh();
    }

    getTreeItem(element) {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        treeItem.contextValue = element.type;
        treeItem.id = element.id;

        if (element.type === 'search-input') {
            treeItem.iconPath = new vscode.ThemeIcon('search');
            treeItem.description = element.description;
            treeItem.command = {
                command: 'yunxiao.openSearchInput',
                title: '打开搜索',
                arguments: []
            };
        } else if (element.type === 'filter-option') {
            treeItem.iconPath = new vscode.ThemeIcon('filter');
            treeItem.description = element.description;
            treeItem.command = {
                command: 'yunxiao.openFilterOptions',
                title: '筛选选项',
                arguments: []
            };
        } else if (element.type === TreeItemType.WorkItem) {
            const workitem = element.data;
            const displayType = element.displayType || workitem.workitemType;
            
            treeItem.contextValue = 'workitem';
            treeItem.description = `${displayType} - ${workitem.status}`;
            
            // 构建增强的tooltip
            const stateDesc = this.stateManager ? this.stateManager.getStateDescription(workitem.workitemId) : '';
            treeItem.tooltip = `${workitem.identifier}
${workitem.subject}
类型: ${displayType}
状态: ${workitem.status}${stateDesc ? '\n\n使用状态:\n' + stateDesc : ''}`;
            treeItem.iconPath = this.getWorkItemIcon(workitem);
            
            treeItem.command = {
                command: 'yunxiao.viewWorkItemProperties',
                title: '查看工作项属性',
                arguments: [{ data: workitem }]
            };
        }

        return treeItem;
    }

    async getChildren(element) {
        const currentProject = this.projectManager.getCurrentProject();
        
        if (!currentProject) {
            return [{
                type: 'search-input',
                label: '请先选择项目',
                id: 'no-project'
            }];
        }

        if (!element) {
            // 根级：显示搜索框和结果
            const children = [];
            
            // 搜索输入框提示
            children.push({
                type: 'search-input',
                label: '🔍 点击搜索工作项',
                description: this.searchKeyword || '输入关键词搜索',
                id: 'search-input'
            });
            
            // 高级筛选选项
            const filterDesc = this.getFilterDescription();
            children.push({
                type: 'filter-option',
                label: '⚙️ 高级筛选',
                description: filterDesc || '点击设置筛选条件',
                id: 'filter-options'
            });
            
            // 显示搜索结果
            if (this.searchResults.length > 0) {
                children.push(...this.searchResults.map(w => {
                    const displayType = w.workitemTypeName || w.workitemType;
                    return {
                        type: TreeItemType.WorkItem,
                        label: `#${w.identifier} ${w.subject}`,
                        id: `search-result:${w.workitemId}`,
                        data: w,
                        displayType: displayType
                    };
                }));
            } else if (this.searchKeyword) {
                children.push({
                    type: 'search-input',
                    label: '没有找到匹配的工作项',
                    id: 'no-results'
                });
            }
            
            return children;
        }

        return element.children || [];
    }

    /**
     * 获取筛选条件描述
     */
    getFilterDescription() {
        const filters = [];
        
        if (this.searchFilters.workitemTypes && this.searchFilters.workitemTypes.length > 0) {
            filters.push(`类型: ${this.searchFilters.workitemTypes.join(', ')}`);
        }
        
        if (this.searchFilters.statuses && this.searchFilters.statuses.length > 0) {
            filters.push(`状态: ${this.searchFilters.statuses.join(', ')}`);
        }
        
        if (this.searchFilters.assignedTo) {
            filters.push(`指派人: ${this.searchFilters.assignedTo}`);
        }
        
        return filters.join(' | ');
    }

    /**
     * 获取工作项图标
     */
    getWorkItemIcon(workitem) {
        return getWorkItemIconWithState(workitem, this.stateManager, false);
    }
}

module.exports = { ProjectsTreeProvider, WorkItemsTreeProvider, RecentTreeProvider, SearchTreeProvider, getWorkItemIconName, getWorkItemIconWithState, getWorkItemIconLabel, getWorkItemStateDescription };
