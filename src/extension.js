const vscode = require('vscode');
const { YunxiaoApiClient } = require('./services/yunxiaoApiClient');
const { AuthManager } = require('./managers/authManager');
const { CacheManager } = require('./managers/cacheManager');
const { ProjectManager } = require('./managers/projectManager');
const { WorkItemManager } = require('./managers/workItemManager');
const { RecentManager } = require('./managers/recentManager');
const { ProjectsTreeProvider, WorkItemsTreeProvider, RecentTreeProvider, SearchTreeProvider } = require('./views/treeViewProviders');
const { RecentItemType } = require('./models/types');
const { getCategoryName } = require('./config/workitemTypes');

let apiClient;
let authManager;
let cacheManager;
let projectManager;
let workItemManager;
let recentManager;
let statusBarItem;

let projectsTreeProvider;
let workItemsTreeProvider;
let recentTreeProvider;
let searchTreeProvider;

async function activate(context) {
    console.log('云效工作项助手扩展已激活');

    const config = vscode.workspace.getConfiguration('yunxiao');
    const domain = config.get('domain', 'openapi-rdc.aliyuncs.com');
    
    apiClient = new YunxiaoApiClient(domain);
    authManager = new AuthManager(context, apiClient);
    cacheManager = new CacheManager();
    projectManager = new ProjectManager(context, apiClient, cacheManager);
    workItemManager = new WorkItemManager(context, apiClient, cacheManager);
    recentManager = new RecentManager(context);

    // 初始化认证（会自动恢复之前的登录状态）
    await authManager.initialize();

    projectsTreeProvider = new ProjectsTreeProvider(projectManager, authManager);
    workItemsTreeProvider = new WorkItemsTreeProvider(projectManager, workItemManager, context);
    recentTreeProvider = new RecentTreeProvider(recentManager);
    searchTreeProvider = new SearchTreeProvider(projectManager, workItemManager, recentManager);

    vscode.window.registerTreeDataProvider('yunxiao.projects', projectsTreeProvider);
    vscode.window.registerTreeDataProvider('yunxiao.workitems', workItemsTreeProvider);
    vscode.window.registerTreeDataProvider('yunxiao.recent', recentTreeProvider);
    //vscode.window.registerTreeDataProvider('yunxiao.search', searchTreeProvider);

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    // 初始命令设为登录,在 updateStatusBar 中会根据状态动态调整
    statusBarItem.command = 'yunxiao.statusBarClick';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    registerCommands(context);

    const cleanupInterval = setInterval(() => cacheManager.cleanExpired(), 5 * 60 * 1000);
    context.subscriptions.push(new vscode.Disposable(() => clearInterval(cleanupInterval)));

    // 显示启动消息
    if (authManager.isAuthenticated()) {
        const authInfo = authManager.getAuthInfo();
        const userName = authInfo?.userName || '用户';
        vscode.window.showInformationMessage(`云效工作项助手已就绪，欢迎 ${userName}！`);
    } else {
        vscode.window.showInformationMessage('云效工作项助手已就绪，请点击状态栏登录');
    }
}

function registerCommands(context) {
    context.subscriptions.push(
        // 状态栏点击命令 - 根据当前状态决定行为
        vscode.commands.registerCommand('yunxiao.statusBarClick', async () => {
            if (!authManager.isAuthenticated()) {
                // 未登录时，点击登录
                await vscode.commands.executeCommand('yunxiao.login');
                return;
            }
            
            // 已登录，使用与 SCM 云效图标相同的逻辑：快速搜索工作项
            await vscode.commands.executeCommand('yunxiao.quickSearchFromSCM');
        }),
        
        // 状态栏右键菜单命令
        vscode.commands.registerCommand('yunxiao.showStatusBarMenu', async () => {
            if (!authManager.isAuthenticated()) {
                // 未登录时，只显示登录选项
                await vscode.commands.executeCommand('yunxiao.login');
                return;
            }
            
            // 构建菜单项
            const menuItems = [];
            
            // 1. 添加最近使用的工作项（最多5个）
            const recentItems = recentManager.getRecentItems(RecentItemType.WorkItem, 5);
            if (recentItems.length > 0) {
                recentItems.forEach(item => {
                    const data = item.data;
                    menuItems.push({
                        label: `$(history) #${data.identifier} ${data.subject}`,
                        description: data.workitemType,
                        action: 'pasteWorkItem',
                        data: data
                    });
                });
                
                // 添加分隔符
                if (menuItems.length > 0) {
                    menuItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                }
            }
            
            // 2. 添加切换项目选项
            menuItems.push({
                label: '$(project) 切换项目',
                description: '选择其他项目',
                action: 'switchProject'
            });
            
            // 3. 添加分隔符
            menuItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            
            // 4. 添加退出登录选项
            menuItems.push({
                label: '$(sign-out) 退出登录',
                description: '切换账户或 Token',
                action: 'logout'
            });
            
            // 显示菜单
            const selected = await vscode.window.showQuickPick(menuItems, {
                placeHolder: '选择操作',
                ignoreFocusOut: true
            });
            
            if (!selected || !selected.action) {
                return;
            }
            
            // 执行选中的操作
            switch (selected.action) {
                case 'pasteWorkItem':
                    await pasteToCommit(selected.data);
                    recentManager.addItem(selected.data.workitemId, RecentItemType.WorkItem, selected.data);
                    recentTreeProvider.refresh();
                    break;
                    
                case 'switchProject':
                    await vscode.commands.executeCommand('yunxiao.selectProject');
                    break;
                    
                case 'logout':
                    await vscode.commands.executeCommand('yunxiao.logout');
                    break;
            }
        }),

        vscode.commands.registerCommand('yunxiao.login', async () => {
            try {
                await authManager.login();
                vscode.window.showInformationMessage('登录成功');
                updateStatusBar();
                refreshAllViews();
            } catch (error) {
                vscode.window.showErrorMessage(`登录失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.logout', async () => {
            try {
                // 确认退出
                const authInfo = authManager.getAuthInfo();
                const userName = authInfo?.userName || '当前账户';
                const authType = authInfo?.authType === 'PAT' ? 'PAT Token' : 'OAuth';
                
                const answer = await vscode.window.showWarningMessage(
                    `确定要退出登录吗？\n\n当前账户：${userName}\n认证方式：${authType}`,
                    { modal: true },
                    '确定退出'
                );
                
                if (answer !== '确定退出') {
                    return;
                }
                
                // 执行登出
                await authManager.logout();
                
                // 清空所有缓存和状态
                cacheManager.clear();
                projectManager.setCurrentProject(null);
                recentManager.clear();
                
                // 更新 UI
                updateStatusBar();
                refreshAllViews();
                
                // 提示用户重新登录
                const reloginAnswer = await vscode.window.showInformationMessage(
                    '已成功退出登录。是否重新登录？',
                    '立即登录',
                    '稍后'
                );
                
                if (reloginAnswer === '立即登录') {
                    await vscode.commands.executeCommand('yunxiao.login');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`退出登录失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.selectProject', async () => {
            try {
                await ensureAuthenticated();
                const projects = await projectManager.getProjects();
                const sorted = projectManager.sortProjects(projects);
                const selected = await vscode.window.showQuickPick(
                    sorted.map(p => ({
                        label: (p.isFavorite ? '⭐ ' : '') + p.projectName,
                        description: p.description,
                        project: p
                    })),
                    { placeHolder: '选择项目' }
                );
                if (selected) {
                    projectManager.setCurrentProject(selected.project);
                    recentManager.addItem(selected.project.projectId, RecentItemType.Project, selected.project);
                    updateStatusBar();
                    workItemsTreeProvider.refresh();
                    recentTreeProvider.refresh();
                }
            } catch (error) {
                vscode.window.showErrorMessage(`选择项目失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.selectProjectFromTree', async (project) => {
            projectManager.setCurrentProject(project);
            recentManager.addItem(project.projectId, RecentItemType.Project, project);
            updateStatusBar();
            workItemsTreeProvider.refresh();
            recentTreeProvider.refresh();
        }),

        vscode.commands.registerCommand('yunxiao.selectWorkItem', async () => {
            try {
                await ensureAuthenticated();
                const currentProject = projectManager.getCurrentProject();
                if (!currentProject) {
                    const answer = await vscode.window.showWarningMessage(
                        '请先选择项目',
                        '选择项目',
                        '取消'
                    );
                    
                    if (answer === '选择项目') {
                        await vscode.commands.executeCommand('yunxiao.selectProject');
                    }
                    return;
                }

                // 显示搜索输入框
                const keyword = await vscode.window.showInputBox({
                    prompt: '输入工作项关键词（编号、标题、描述）',
                    placeHolder: '例如：TEST-123、登录功能',
                    ignoreFocusOut: true
                });

                if (!keyword) {
                    return;
                }

                // 执行搜索
                const results = await workItemManager.searchWorkItems(
                    currentProject.projectId,
                    { keyword }
                );

                // 构建选项列表
                const items = [];
                
                // 添加搜索结果
                if (results.length > 0) {
                    results.forEach(w => {
                        items.push({
                            label: `#${w.identifier} ${w.subject}`,
                            description: `${w.workitemType} - ${w.status}`,
                            detail: `项目: ${currentProject.projectName}`,
                            workitem: w,
                            action: 'paste'
                        });
                    });
                    
                    // 添加分隔符
                    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                } else {
                    // 无结果时显示提示
                    items.push({
                        label: `$(info) 未找到包含 "${keyword}" 的工作项`,
                        description: '请尝试其他关键词',
                        action: 'none'
                    });
                    
                    // 添加分隔符
                    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                }
                
                // 添加切换项目
                items.push({
                    label: '$(project) 切换项目',
                    description: '选择其他项目',
                    action: 'switchProject'
                });
                
                // 添加退出登录
                items.push({
                    label: '$(sign-out) 退出登录',
                    description: '切换账户或 Token',
                    action: 'logout'
                });

                // 显示选择框
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: results.length > 0 
                        ? `找到 ${results.length} 个工作项，选择一个粘贴到提交消息`
                        : '未找到匹配的工作项',
                    ignoreFocusOut: true
                });

                if (!selected || !selected.action || selected.action === 'none') {
                    return;
                }
                
                // 根据操作类型执行不同逻辑
                switch (selected.action) {
                    case 'paste':
                        // 添加到最近使用
                        recentManager.addItem(selected.workitem.workitemId, RecentItemType.WorkItem, selected.workitem);
                        recentTreeProvider.refresh();
                        
                        // 粘贴到提交消息
                        await pasteToCommit(selected.workitem);
                        break;
                        
                    case 'switchProject':
                        await vscode.commands.executeCommand('yunxiao.selectProject');
                        break;
                        
                    case 'logout':
                        await vscode.commands.executeCommand('yunxiao.logout');
                        break;
                }
            } catch (error) {
                vscode.window.showErrorMessage(`选择工作项失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.pasteToCommit', async (workitem) => {
            if (workitem) {
                await pasteToCommit(workitem);
                recentManager.addItem(workitem.workitemId, RecentItemType.WorkItem, workitem);
                recentTreeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('yunxiao.refresh', () => {
            cacheManager.clear();
            refreshAllViews();
            vscode.window.showInformationMessage('缓存已清除');
        }),

        vscode.commands.registerCommand('yunxiao.refreshProjects', async () => {
            await projectManager.refresh();
            projectsTreeProvider.refresh();
        }),

        vscode.commands.registerCommand('yunxiao.refreshWorkItems', async () => {
            const p = projectManager.getCurrentProject();
            if (p) {
                await workItemManager.refresh(p.projectId);
                workItemsTreeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('yunxiao.toggleFavorite', async (item) => {
            const id = item.id?.replace('project:', '') || item.projectId;
            if (id) {
                await projectManager.toggleFavorite(id);
                projectsTreeProvider.refresh();
                recentTreeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('yunxiao.removeFavorite', async (item) => {
            // 与 toggleFavorite 相同，只是用于显示不同图标
            const id = item.id?.replace('project:', '') || item.projectId;
            if (id) {
                await projectManager.toggleFavorite(id);
                projectsTreeProvider.refresh();
                recentTreeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('yunxiao.configure', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'yunxiao');
        }),

        vscode.commands.registerCommand('yunxiao.manageOrganizationId', async () => {
            try {
                // 读取当前的组织 ID
                const currentOrgId = await context.secrets.get('yunxiao.organizationId');
                
                const options = [];
                
                if (currentOrgId) {
                    // 已配置的情况
                    options.push(
                        {
                            label: '查看当前组织 ID',
                            description: `${currentOrgId.substring(0, 8)}...`,
                            action: 'view'
                        },
                        {
                            label: '修改组织 ID',
                            description: '输入新的组织 ID',
                            action: 'edit'
                        },
                        {
                            label: '删除组织 ID',
                            description: '清除已保存的组织 ID',
                            action: 'delete'
                        }
                    );
                } else {
                    // 未配置的情况
                    options.push(
                        {
                            label: '设置组织 ID',
                            description: '输入云效组织 ID',
                            action: 'add'
                        }
                    );
                }
                
                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: '选择操作',
                    ignoreFocusOut: true
                });
                
                if (!selected) {
                    return;
                }
                
                switch (selected.action) {
                    case 'view':
                        await vscode.window.showInformationMessage(
                            `当前组织 ID: ${currentOrgId}`,
                            { modal: true },
                            '复制',
                            '关闭'
                        ).then(choice => {
                            if (choice === '复制') {
                                vscode.env.clipboard.writeText(currentOrgId);
                                vscode.window.showInformationMessage('已复制到剪贴板');
                            }
                        });
                        break;
                        
                    case 'add':
                    case 'edit':
                        // 打开浏览器到云效组织页面
                        await vscode.env.openExternal(vscode.Uri.parse('https://devops.aliyun.com/organization'));
                        
                        const newOrgId = await vscode.window.showInputBox({
                            prompt: '请输入云效组织 ID（在云效网址中可找到：devops.aliyun.com/organization/您的组织ID）',
                            value: currentOrgId || '',
                            placeHolder: '例如：66a0326c1d2a2a350e263a7d',
                            ignoreFocusOut: true,
                            validateInput: (value) => {
                                if (!value || value.trim() === '') {
                                    return '组织 ID 不能为空';
                                }
                                return null;
                            }
                        });
                        
                        if (newOrgId) {
                            await context.secrets.store('yunxiao.organizationId', newOrgId.trim());
                            vscode.window.showInformationMessage('组织 ID 已保存');
                        }
                        break;
                        
                    case 'delete':
                        const confirm = await vscode.window.showWarningMessage(
                            '确定要删除已保存的组织 ID 吗？删除后需要重新登录。',
                            { modal: true },
                            '确定删除',
                            '取消'
                        );
                        
                        if (confirm === '确定删除') {
                            await context.secrets.delete('yunxiao.organizationId');
                            vscode.window.showInformationMessage('组织 ID 已删除，下次登录时需要重新输入');
                        }
                        break;
                }
            } catch (error) {
                vscode.window.showErrorMessage(`管理组织 ID 失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.openInBrowser', (item) => {
            item = item.data?.data || item.data || item;
            if (item?.workitemId || item?.identifier) {
                // 工作项链接：包含 identifier 和 subject
                const identifier = item.identifier || item.workitemId;
                const subject = item.subject || '';
                const category = item.category || item.categoryIdentifier;
                // 构建 URL: id#subject (subject需要URL编码)
                //https://devops.aliyun.com/projex/req/CEXP-4964# 《【系统优化】代码提交必须带上需求或者缺陷编号，否则能推送》
                const url = `https://devops.aliyun.com/projex/${category}/${identifier}#${encodeURIComponent(' ' + subject)}`;
                vscode.env.openExternal(vscode.Uri.parse(url));
            } else if (item?.projectId) {
                // 项目链接
                vscode.env.openExternal(vscode.Uri.parse(`https://devops.aliyun.com/projex/project/${item.projectId}`));
            }
        }),

        vscode.commands.registerCommand('yunxiao.copyToClipboard', async (workitem) => {
            await vscode.env.clipboard.writeText(formatWorkItem(workitem));
            vscode.window.showInformationMessage('已复制到剪贴板');
        }),

        vscode.commands.registerCommand('yunxiao.searchWorkItems', async () => {
            const p = projectManager.getCurrentProject();
            if (!p) return;
            const keyword = await vscode.window.showInputBox({ prompt: '输入搜索关键词' });
            if (keyword) {
                const results = await workItemManager.searchWorkItems(p.projectId, { keyword });
                const selected = await vscode.window.showQuickPick(
                    results.map(w => ({ label: `#${w.identifier} ${w.subject}`, workitem: w }))
                );
                if (selected) {
                    // 添加到最近使用
                    recentManager.addItem(selected.workitem.workitemId, RecentItemType.WorkItem, selected.workitem);
                    recentTreeProvider.refresh();
                    
                    // 粘贴到提交消息
                    await pasteToCommit(selected.workitem);
                }
            }
        }),

        vscode.commands.registerCommand('yunxiao.openSearchInput', async () => {
            await ensureAuthenticated();
            const currentProject = projectManager.getCurrentProject();
            if (!currentProject) {
                vscode.window.showWarningMessage('请先选择项目');
                return;
            }

            const keyword = await vscode.window.showInputBox({
                prompt: '输入搜索关键词（支持编号、标题、描述）',
                placeHolder: '例如：登录功能、TEST-123',
                value: searchTreeProvider.searchKeyword
            });

            if (keyword !== undefined) {
                if (keyword === '') {
                    // 清除搜索
                    searchTreeProvider.clearSearch();
                    return;
                }

                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: '正在搜索工作项...',
                        cancellable: false
                    }, async () => {
                        // 获取当前筛选条件
                        const filters = searchTreeProvider.searchFilters || {};
                        filters.keyword = keyword;

                        // 执行搜索 - searchWorkItems 返回数组，不是对象
                        const results = await workItemManager.searchWorkItems(
                            currentProject.projectId,
                            filters
                        );

                        // 更新搜索结果
                        searchTreeProvider.setSearchResults(results, keyword, filters);

                        if (results.length === 0) {
                            vscode.window.showInformationMessage('未找到匹配的工作项');
                        } else {
                            vscode.window.showInformationMessage(`找到 ${results.length} 个工作项`);
                        }
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`搜索失败: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('yunxiao.openFilterOptions', async () => {
            await ensureAuthenticated();
            const currentProject = projectManager.getCurrentProject();
            if (!currentProject) {
                vscode.window.showWarningMessage('请先选择项目');
                return;
            }

            // 获取当前筛选条件
            const currentFilters = searchTreeProvider.searchFilters || {};

            // 显示筛选选项菜单
            const option = await vscode.window.showQuickPick(
                [
                    { label: '$(symbol-class) 工作项类型', value: 'types', description: currentFilters.workitemTypes?.join(', ') || '全部' },
                    { label: '$(circle-outline) 状态', value: 'status', description: currentFilters.statuses?.join(', ') || '全部' },
                    { label: '$(person) 指派人', value: 'assignee', description: currentFilters.assignedTo || '全部' },
                    { label: '$(label) 标签', value: 'tags', description: currentFilters.tags?.join(', ') || '全部' },
                    { label: '$(calendar) 创建时间', value: 'created', description: currentFilters.createdRange || '全部' },
                    { label: '$(clock) 更新时间', value: 'updated', description: currentFilters.updatedRange || '全部' },
                    { label: '$(clear-all) 清除所有筛选', value: 'clear' },
                    { label: '$(search) 执行搜索', value: 'search' }
                ],
                { placeHolder: '选择筛选条件' }
            );

            if (!option) return;

            if (option.value === 'clear') {
                searchTreeProvider.searchFilters = {};
                searchTreeProvider.refresh();
                vscode.window.showInformationMessage('已清除所有筛选条件');
                return;
            }

            if (option.value === 'search') {
                // 执行搜索（使用当前关键词和筛选条件）
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: '正在搜索工作项...',
                        cancellable: false
                    }, async () => {
                        // searchWorkItems 返回数组，不是对象
                        const results = await workItemManager.searchWorkItems(
                            currentProject.projectId,
                            currentFilters
                        );

                        searchTreeProvider.setSearchResults(results, currentFilters.keyword || '', currentFilters);

                        if (results.length === 0) {
                            vscode.window.showInformationMessage('未找到匹配的工作项');
                        } else {
                            vscode.window.showInformationMessage(`找到 ${results.length} 个工作项`);
                        }
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`搜索失败: ${error.message}`);
                }
                return;
            }

            // 处理具体的筛选选项
            switch (option.value) {
                case 'types':
                    await handleWorkitemTypeFilter(currentFilters);
                    break;
                case 'status':
                    await handleStatusFilter(currentFilters);
                    break;
                case 'assignee':
                    await handleAssigneeFilter(currentFilters);
                    break;
                case 'tags':
                    await handleTagsFilter(currentFilters);
                    break;
                case 'created':
                    await handleTimeRangeFilter(currentFilters, 'created');
                    break;
                case 'updated':
                    await handleTimeRangeFilter(currentFilters, 'updated');
                    break;
            }

            // 更新显示
            searchTreeProvider.refresh();
        }),

        vscode.commands.registerCommand('yunxiao.loadMoreWorkItems', async (workitemType) => {
            const p = projectManager.getCurrentProject();
            if (!p) return;
            
            if (!workitemType) {
                vscode.window.showErrorMessage('未指定工作项类型');
                return;
            }
            
            // 使用统一配置获取类型名称
            const typeName = getCategoryName(workitemType);
            
            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `加载更多${typeName}...`,
                    cancellable: false
                }, async () => {
                    const result = await workItemManager.loadNextPageForType(p.projectId, workitemType);
                    
                    if (result.items.length > 0) {
                        workItemsTreeProvider.refresh();
                        vscode.window.showInformationMessage(
                            `已加载 ${result.items.length} 个${typeName}，总计 ${result.loaded}`
                        );
                    } else {
                        vscode.window.showInformationMessage(result.message || `没有更多${typeName}了`);
                    }
                });
            } catch (error) {
                vscode.window.showErrorMessage(`加载更多失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.removeFromRecent', async (item) => {
            // 从item.id 提取类型和 ID
            let itemId, itemType;
            
            if (item.id && item.id.startsWith('recent-')) {
                const parts = item.id.split(':');
                if (parts[0] === 'recent-project') {
                    itemId = parts[1];
                    itemType = RecentItemType.Project;
                } else if (parts[0] === 'recent-workitem') {
                    itemId = parts[1];
                    itemType = RecentItemType.WorkItem;
                }
            } else {
                // 直接从 data 中提取
                if (item.data?.itemId && item.data?.itemType) {
                    itemId = item.data.itemId;
                    itemType = item.data.itemType;
                } else if (item.workitemId) {
                    itemId = item.workitemId;
                    itemType = RecentItemType.WorkItem;
                } else if (item.projectId) {
                    itemId = item.projectId;
                    itemType = RecentItemType.Project;
                }
            }
            
            if (itemId && itemType) {
                const typeName = itemType === RecentItemType.Project ? '项目' : '工作项';
                recentManager.removeItem(itemId, itemType);
                recentTreeProvider.refresh();
                vscode.window.showInformationMessage(`已从最近使用中移除${typeName}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.clearAllRecent', async () => {
            const answer = await vscode.window.showWarningMessage(
                '确定要清除所有最近使用记录吗？',
                { modal: true },
                '确定',
                '取消'
            );
            
            if (answer === '确定') {
                recentManager.clear();
                recentTreeProvider.refresh();
                vscode.window.showInformationMessage('已溅除所有最近使用记录');
            }
        }),
        
        vscode.commands.registerCommand('yunxiao.reopenSearch', async (searchData) => {
            if (!searchData) {
                vscode.window.showErrorMessage('搜索数据不存在');
                return;
            }
                    
            try {
                await ensureAuthenticated();
                        
                // 切换到此搜索的项目（如果需要）
                const currentProject = projectManager.getCurrentProject();
                if (!currentProject || currentProject.projectId !== searchData.projectId) {
                    // 需要切换项目，但我们不直接切换，而是提示用户
                    const answer = await vscode.window.showWarningMessage(
                        `此搜索是在项目 "${searchData.projectName}" 中进行的，当前项目为 "${currentProject?.projectName || '未选择'}"。`,
                        '继续当前项目',
                        '取消'
                    );
                            
                    if (answer !== '继续当前项目') {
                        return;
                    }
                }
                        
                // 重新执行搜索
                const project = currentProject || projectManager.getCurrentProject();
                if (!project) {
                    vscode.window.showWarningMessage('请先选择项目');
                    return;
                }
                        
                const results = await workItemManager.searchWorkItems(
                    project.projectId,
                    searchData.filter,
                    { page: 1, pageSize: 50 }
                );
                        
                // 更新最近搜索记录
                recentManager.addItem(
                    searchData.keyword,
                    RecentItemType.SearchKeyword,
                    {
                        ...searchData,
                        resultCount: results.length
                    }
                );
                recentTreeProvider.refresh();
                        
                // 如果有结果，显示在 QuickPick 中
                if (results.length > 0) {
                    const items = results.map(w => ({
                        label: `#${w.identifier} ${w.subject}`,
                        description: `${w.workitemType} - ${w.status}`,
                        workitem: w
                    }));
                            
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: `搜索 "${searchData.keyword}" 的结果 (${results.length} 项)`
                    });
                            
                    if (selected) {
                        // 添加到最近使用
                        recentManager.addItem(selected.workitem.workitemId, RecentItemType.WorkItem, selected.workitem);
                        recentTreeProvider.refresh();
                                
                        // 粘贴到提交消息
                        await pasteToCommit(selected.workitem);
                    }
                } else {
                    vscode.window.showInformationMessage(`未找到包含 "${searchData.keyword}" 的工作项`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`重新搜索失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.quickSearchFromSCM', async () => {
            try {
                await ensureAuthenticated();
                const currentProject = projectManager.getCurrentProject();
                
                if (!currentProject) {
                    const answer = await vscode.window.showWarningMessage(
                        '请先选择项目',
                        '选择项目',
                        '取消'
                    );
                    
                    if (answer === '选择项目') {
                        await vscode.commands.executeCommand('yunxiao.selectProject');
                    }
                    return;
                }

                // 创建可输入的 QuickPick
                const quickPick = vscode.window.createQuickPick();
                quickPick.placeholder = '输入关键词过滤工作项（编号、标题、描述）搜索工作项，或直接选择最近使用的工作项';
                
                // 禁用 QuickPick 的自动过滤和排序，保持我们设置的时间倒序
                quickPick.matchOnDescription = false;
                quickPick.matchOnDetail = false;
                
                quickPick.ignoreFocusOut = true;
                
                // 添加输入框清除按钮
                const clearButton = {
                    iconPath: new vscode.ThemeIcon('close'),
                    tooltip: '清除搜索条件'
                };
                quickPick.buttons = [clearButton];
                
                // 定义工作项的操作按钮
                const pasteToCommitButton = {
                    iconPath: new vscode.ThemeIcon('insert'),
                    tooltip: '粘贴到提交消息'
                };
                const openInBrowserButton = {
                    iconPath: new vscode.ThemeIcon('link-external'),
                    tooltip: '在浏览器中打开'
                };
                const copyToClipboardButton = {
                    iconPath: new vscode.ThemeIcon('copy'),
                    tooltip: '复制到剪贴板'
                };
                
                // 获取最近使用的工作项和最近搜索
                const recentWorkItems = recentManager.getRecentWorkItems(10);
                const recentSearchKeywords = recentManager.getRecentSearchKeywords(5);
                const recentItems = [];
                
                // 添加最近搜索关键词
                if (recentSearchKeywords.length > 0) {
                    recentItems.push({ 
                        label: '历史搜索', 
                        kind: vscode.QuickPickItemKind.Separator 
                    });
                    
                    recentSearchKeywords.forEach((item, index) => {
                        const searchData = item.data;
                        if (searchData) {
                            recentItems.push({
                                label: `🔍 ${searchData.keyword}`,
                                description: `${searchData.resultCount} 项 | ${searchData.projectName}`,
                                detail: `使用 ${item.useCount} 次 | 最后搜索: ${new Date(item.lastUsedAt).toLocaleString('zh-CN')}`,
                                searchData: searchData,
                                isSearchKeyword: true
                            });
                        }
                    });
                }
                
                if (recentWorkItems.length > 0) {
                    recentItems.push({ 
                        label: '最近使用', 
                        kind: vscode.QuickPickItemKind.Separator 
                    });
                    
                    // 计算序号的固定长度（最近使用最多10个，所以2位数字就够了）
                    const indexWidth = String(recentWorkItems.length + 1).length;
                    
                    recentWorkItems.forEach((item, index) => {
                        const workitem = item.data;
                        if (workitem) {
                            // 添加序号前缀（从01开始），保持排序
                            const indexPrefix = String(index + 1).padStart(indexWidth, '0');
                            recentItems.push({
                                label: `${indexPrefix}. #${workitem.identifier} ${workitem.subject}`,
                                description: `${workitem.workitemType} - ${workitem.status}`,
                                detail: `项目: ${currentProject.projectName} | 使用 ${item.useCount} 次`,
                                workitem: workitem,
                                isRecent: true,
                                buttons: [pasteToCommitButton, openInBrowserButton, copyToClipboardButton]
                            });
                        }
                    });
                }
                
                // 添加底部按钮到最近使用列表
                recentItems.push({ 
                    label: '', 
                    kind: vscode.QuickPickItemKind.Separator 
                });
                recentItems.push({
                    label: '$(project) 切换项目',
                    description: '选择其他项目',
                    alwaysShow: true,
                    isAction: true,
                    action: 'switchProject'
                });
                recentItems.push({
                    label: '$(organization) 切换组织',
                    description: '切换云效组织',
                    alwaysShow: true,
                    isAction: true,
                    action: 'switchOrganization'
                });
                
                // 设置初始项（最近使用）
                quickPick.items = recentItems;
                
                // 监听输入变化，实时搜索
                let searchTimeout;
                quickPick.onDidChangeValue(async (value) => {
                    // 清除之前的定时器
                    if (searchTimeout) {
                        clearTimeout(searchTimeout);
                    }
                    
                    // 如果输入为空，显示最近使用
                    if (!value || value.trim() === '') {
                        quickPick.items = recentItems;
                        quickPick.busy = false;
                        return;
                    }
                    
                    // 立即显示搜索中的提示
                    quickPick.busy = true;
                    quickPick.items = [{
                        label: '$(sync~spin) 正在搜索...',
                        description: `关键词: "${value.trim()}"`,
                        alwaysShow: true
                    }];
                    
                    // 防抖：500ms 后才搜索
                    searchTimeout = setTimeout(async () => {
                        try {
                            // 检测是否是工作项编号格式（例如 CEXP-4970 或 #CEXP-4970）
                            const trimmedValue = value.trim();
                            const identifierPattern = /^#?([A-Z]+-\d+)$/i;
                            const match = trimmedValue.match(identifierPattern);
                            
                            let filter;
                            if (match) {
                                // 是编号格式，使用 identifier 精确查询
                                const identifier = match[1].toUpperCase();
                                filter = { identifier: identifier };
                            } else {
                                // 不是编号格式，使用 keyword 模糊搜索
                                filter = { keyword: trimmedValue };
                            }
                            
                            // 使用 searchWorkItems 搜索所有类型的工作项
                            const results = await workItemManager.searchWorkItems(
                                currentProject.projectId,
                                filter,
                                { page: 1, pageSize: 50 }
                            );
                            
                            // 如果搜索成功且有结果，记录到最近搜索
                            if (results.length > 0) {
                                recentManager.addItem(
                                    trimmedValue,  // 使用搜索关键词作为 ID
                                    RecentItemType.SearchKeyword,
                                    {
                                        keyword: trimmedValue,
                                        filter: filter,  // 保存过滤条件以便重新搜索
                                        projectId: currentProject.projectId,
                                        projectName: currentProject.projectName,
                                        resultCount: results.length
                                    }
                                );
                                recentTreeProvider.refresh();
                            }
                            
                            // 构建搜索结果项
                            const searchItems = [];
                            
                            if (results.length > 0) {
                                searchItems.push({ 
                                    label: `搜索结果 (${results.length} 项)`, 
                                    kind: vscode.QuickPickItemKind.Separator 
                                });
                                
                                // 计算序号的固定长度（最多50个结果，所以2位数字就够了）
                                const indexWidth = String(results.length + 1).length;
                                
                                results.forEach((w, index) => {
                                    // 添加序号前缀（从01开始），保持创建时间倒序
                                    const indexPrefix = String(index + 1).padStart(indexWidth, '0');
                                    searchItems.push({
                                        label: `${indexPrefix}. #${w.identifier} ${w.subject}`,
                                        description: `${w.workitemType} - ${w.status}`,
                                        detail: `项目: ${currentProject.projectName}`,
                                        workitem: w,
                                        isRecent: false,
                                        buttons: [pasteToCommitButton, openInBrowserButton, copyToClipboardButton]
                                    });
                                });
                                
                                // 添加底部按钮
                                searchItems.push({ 
                                    label: '', 
                                    kind: vscode.QuickPickItemKind.Separator 
                                });
                                searchItems.push({
                                    label: '$(project) 切换项目',
                                    description: '选择其他项目',
                                    alwaysShow: true,
                                    isAction: true,
                                    action: 'switchProject'
                                });
                                searchItems.push({
                                    label: '$(organization) 切换组织',
                                    description: '切换云效组织',
                                    alwaysShow: true,
                                    isAction: true,
                                    action: 'switchOrganization'
                                });
                            } else {
                                searchItems.push({
                                    label: `$(info) 未找到包含 "${value}" 的工作项`,
                                    description: '请尝试其他关键词',
                                    alwaysShow: true
                                });
                            }
                            
                            quickPick.items = searchItems;
                            quickPick.busy = false;
                        } catch (error) {
                            console.error('搜索失败:', error);
                            quickPick.items = [{
                                label: `$(error) 搜索失败: ${error.message}`,
                                description: '请重试',
                                alwaysShow: true
                            }];
                            quickPick.busy = false;
                        }
                    }, 500);
                });
                
                // 监听输入框按钮点击（清除按钮）
                quickPick.onDidTriggerButton((button) => {
                    if (button === clearButton) {
                        // 清除输入框内容
                        quickPick.value = '';
                        // 恢复到最近使用列表
                        quickPick.items = recentItems;
                        quickPick.busy = false;
                    }
                });
                
                // 监听按钮点击
                quickPick.onDidTriggerItemButton(async (e) => {
                    const item = e.item;
                    const button = e.button;
                    
                    if (!item.workitem) return;
                    
                    if (button === pasteToCommitButton) {
                        // 粘贴到提交消息
                        recentManager.addItem(item.workitem.workitemId, RecentItemType.WorkItem, item.workitem);
                        recentTreeProvider.refresh();
                        await pasteToCommit(item.workitem);
                        quickPick.hide();
                    } else if (button === openInBrowserButton) {
                        // 在浏览器中打开
                        await vscode.commands.executeCommand('yunxiao.openInBrowser', item.workitem);
                    } else if (button === copyToClipboardButton) {
                        // 复制到剪贴板
                        await vscode.commands.executeCommand('yunxiao.copyToClipboard', item.workitem);
                    }
                });
                
                // 监听选择
                quickPick.onDidAccept(async () => {
                    const selected = quickPick.selectedItems[0];
                    
                    if (selected && selected.isAction) {
                        // 处理按钮操作
                        quickPick.hide();
                        
                        if (selected.action === 'switchProject') {
                            // 切换项目
                            await vscode.commands.executeCommand('yunxiao.selectProject');
                        } else if (selected.action === 'switchOrganization') {
                            // 切换组织
                            await vscode.commands.executeCommand('yunxiao.manageOrganizationId');
                        }
                    } else if (selected && selected.isSearchKeyword) {
                        // 处理历史搜索：直接应用搜索关键词
                        const searchData = selected.searchData;
                        if (searchData) {
                            // 设置 QuickPick 的输入框为搜索关键词，触发搜索
                            quickPick.value = searchData.keyword;
                            // 不隐藏 QuickPick，让用户看到搜索结果
                        }
                    } else if (selected && selected.workitem) {
                        // 添加到最近使用
                        recentManager.addItem(selected.workitem.workitemId, RecentItemType.WorkItem, selected.workitem);
                        recentTreeProvider.refresh();
                        
                        // 粘贴到提交消息
                        await pasteToCommit(selected.workitem);
                        
                        quickPick.hide();
                    }
                });
                
                // 监听隐藏
                quickPick.onDidHide(() => {
                    quickPick.dispose();
                    if (searchTimeout) {
                        clearTimeout(searchTimeout);
                    }
                });
                
                // 显示 QuickPick
                quickPick.show();
            } catch (error) {
                vscode.window.showErrorMessage(`搜索失败: ${error.message}`);
            }
        }),

        // 工作项列表快速过滤命令
        vscode.commands.registerCommand('yunxiao.workItemQuickFilter', async () => {
            try {
                await ensureAuthenticated();
                const currentProject = projectManager.getCurrentProject();
                
                if (!currentProject) {
                    vscode.window.showWarningMessage('请先选择项目');
                    return;
                }

                // 显示输入框，默认值为当前搜索关键词
                const keyword = await vscode.window.showInputBox({
                    prompt: '输入关键词过滤工作项（编号、标题、描述）',
                    placeHolder: '例如：TEST-123、登录功能',
                    value: workItemsTreeProvider.getSearchKeyword(),
                    ignoreFocusOut: true
                });

                // 用户取消输入
                if (keyword === undefined) {
                    return;
                }

                // 设置搜索关键词
                workItemsTreeProvider.setSearchKeyword(keyword);
                
                // 清除当前项目的加载状态,强制使用新的 filter 重新加载
                await workItemManager.initializeLazyLoad(
                    currentProject.projectId,
                    { keyword: keyword },
                    true  // forceRefresh = true
                );
                
                // 刷新视图
                workItemsTreeProvider.refresh();

                // 显示提示
                if (keyword) {
                    vscode.window.showInformationMessage(`已设置过滤关键词: ${keyword}`);
                } else {
                    vscode.window.showInformationMessage('已清除过滤关键词');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`设置过滤失败: ${error.message}`);
            }
        }),

        // 清除工作项过滤
        vscode.commands.registerCommand('yunxiao.clearWorkItemFilter', async () => {
            try {
                const currentProject = projectManager.getCurrentProject();
                
                workItemsTreeProvider.setSearchKeyword('');
                
                // 清除当前项目的加载状态,重新加载全部数据
                if (currentProject) {
                    await workItemManager.initializeLazyLoad(
                        currentProject.projectId,
                        { keyword: '' },
                        true  // forceRefresh = true
                    );
                }
                
                workItemsTreeProvider.refresh();
                vscode.window.showInformationMessage('已清除过滤关键词');
            } catch (error) {
                vscode.window.showErrorMessage(`清除过滤失败: ${error.message}`);
            }
        })
    );
}

async function ensureAuthenticated() {
    if (!authManager.isAuthenticated()) {
        await vscode.commands.executeCommand('yunxiao.login');
    }
}

async function pasteToCommit(workitem) {
    const text = formatWorkItem(workitem);
    const config = vscode.workspace.getConfiguration('yunxiao');
    const pasteTarget = config.get('pasteTarget', 'commit');
    
    // 方法1：使用 Git 扩展 API（最可靠）
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            const git = gitExtension.exports.getAPI(1);
            if (git && git.repositories && git.repositories.length > 0) {
                // 获取当前工作区的 Git 仓库
                let repository = git.repositories[0];
                
                // 如果有多个仓库，尝试找到当前文件所在的仓库
                if (git.repositories.length > 1 && vscode.window.activeTextEditor) {
                    const activeUri = vscode.window.activeTextEditor.document.uri;
                    const repo = git.getRepository(activeUri);
                    if (repo) {
                        repository = repo;
                    }
                }
                
                // 设置提交消息
                const currentMessage = repository.inputBox.value;
                repository.inputBox.value = text + (currentMessage ? '\n\n' + currentMessage : '');
                
                // 聚焦到 SCM 视图
                await vscode.commands.executeCommand('workbench.view.scm');
                
                vscode.window.showInformationMessage('已粘贴到提交消息框');
                return;
            }
        }
    } catch (error) {
        console.warn('使用 Git API 粘贴失败:', error.message);
    }
    
    // 方法2：回退到剪贴板（如果 Git API 不可用）
    await vscode.env.clipboard.writeText(text);
    vscode.window.showWarningMessage('Git 扩展未找到，已复制到剪贴板。请手动粘贴到提交消息框。', '打开源代码管理')
        .then(selection => {
            if (selection === '打开源代码管理') {
                vscode.commands.executeCommand('workbench.view.scm');
            }
        });
}

function formatWorkItem(workitem) {
    const config = vscode.workspace.getConfiguration('yunxiao');
    const template = config.get('pasteTemplate', '#{id} {title}');
    workitem = workitem.data || workitem;
    return template.replace('{id}', workitem.identifier)
            .replace('{title}', workitem.subject)
            .replace('{description}', workitem.description)
            .replace('{workitemType}', workitem.workitemType)
            .replace('{status}', workitem.status)
            .replace('{assignedTo}', workitem.assignedTo)
            .replace('{category}', workitem.category);
}

function updateStatusBar() {
    if (!statusBarItem) return;
    if (authManager.isAuthenticated()) {
        const authInfo = authManager.getAuthInfo();
        const userName = authInfo?.userName || '用户';
        const p = projectManager.getCurrentProject();
        
        if (p) {
            statusBarItem.text = `$(cloud) 云效: ${p.projectName}`;
            statusBarItem.tooltip = `当前项目：${p.projectName}
登录账户：${userName}

点击选择工作项
Ctrl+Shift+Y M 显示菜单`;
        } else {
            statusBarItem.text = `$(cloud) 云效: 已登录`;
            statusBarItem.tooltip = `登录账户：${userName}\n\n点击选择项目\nCtrl+Shift+Y M 显示菜单`;
        }
        statusBarItem.command = {
            command: 'yunxiao.statusBarClick',
            title: '点击操作',
            arguments: []
        };
    } else {
        statusBarItem.text = `$(cloud) 云效: 未登录`;
        statusBarItem.tooltip = '点击登录到云效平台';
        statusBarItem.command = 'yunxiao.login';
    }
}

function refreshAllViews() {
    projectsTreeProvider?.refresh();
    workItemsTreeProvider?.refresh();
    recentTreeProvider?.refresh();
}

/**
 * 处理工作项类型筛选
 */
async function handleWorkitemTypeFilter(filters) {
    const { getAllCategoryIds, getCategoryName } = require('./config/workitemTypes');
    const types = getAllCategoryIds().map(id => ({
        label: getCategoryName(id),
        value: id,
        picked: filters.workitemTypes?.includes(id)
    }));

    const selected = await vscode.window.showQuickPick(types, {
        canPickMany: true,
        placeHolder: '选择工作项类型（多选）'
    });

    if (selected) {
        if (selected.length === 0) {
            delete filters.workitemTypes;
        } else {
            filters.workitemTypes = selected.map(s => s.value);
        }
    }
}

/**
 * 处理状态筛选
 */
async function handleStatusFilter(filters) {
    // 常见状态选项
    const statuses = [
        { label: '未开始', value: '未开始', picked: filters.statuses?.includes('未开始') },
        { label: '进行中', value: '进行中', picked: filters.statuses?.includes('进行中') },
        { label: '已完成', value: '已完成', picked: filters.statuses?.includes('已完成') },
        { label: '已关闭', value: '已关闭', picked: filters.statuses?.includes('已关闭') },
        { label: '已解决', value: '已解决', picked: filters.statuses?.includes('已解决') },
        { label: '重新打开', value: '重新打开', picked: filters.statuses?.includes('重新打开') },
        { label: '测试中', value: '测试中', picked: filters.statuses?.includes('测试中') },
        { label: '待审核', value: '待审核', picked: filters.statuses?.includes('待审核') }
    ];

    const selected = await vscode.window.showQuickPick(statuses, {
        canPickMany: true,
        placeHolder: '选择状态（多选）'
    });

    if (selected) {
        if (selected.length === 0) {
            delete filters.statuses;
        } else {
            filters.statuses = selected.map(s => s.value);
        }
    }
}

/**
 * 处理指派人筛选
 */
async function handleAssigneeFilter(filters) {
    const input = await vscode.window.showInputBox({
        prompt: '输入指派人姓名或 ID（留空清除）',
        value: filters.assignedTo || ''
    });

    if (input !== undefined) {
        if (input === '') {
            delete filters.assignedTo;
        } else {
            filters.assignedTo = input;
        }
    }
}

/**
 * 处理标签筛选
 */
async function handleTagsFilter(filters) {
    const input = await vscode.window.showInputBox({
        prompt: '输入标签，多个标签用逗号分隔（留空清除）',
        value: filters.tags?.join(',') || ''
    });

    if (input !== undefined) {
        if (input === '') {
            delete filters.tags;
        } else {
            filters.tags = input.split(',').map(t => t.trim()).filter(t => t);
        }
    }
}

/**
 * 处理时间范围筛选
 */
async function handleTimeRangeFilter(filters, type) {
    const label = type === 'created' ? '创建时间' : '更新时间';
    const ranges = [
        { label: '最近 7 天', value: '7d' },
        { label: '最近 30 天', value: '30d' },
        { label: '最近 90 天', value: '90d' },
        { label: '本周', value: 'this-week' },
        { label: '本月', value: 'this-month' },
        { label: '清除筛选', value: 'clear' }
    ];

    const selected = await vscode.window.showQuickPick(ranges, {
        placeHolder: `选择${label}范围`
    });

    if (selected) {
        const filterKey = type === 'created' ? 'createdRange' : 'updatedRange';
        
        if (selected.value === 'clear') {
            delete filters[filterKey];
        } else {
            filters[filterKey] = selected.value;
        }
    }
}

function deactivate() {}

module.exports = { activate, deactivate };
