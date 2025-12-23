const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
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

/**
 * AI 配置定义
 * 集中管理所有 AI 助手的配置信息
 */
const AI_CONFIGS = {
    qoder: {
        extensionId: '',//'aicoding.aicoding-agent',
        extensionName: 'Qoder',
        templateKey: 'qoderTemplate',
        defaultTemplate: '{type} #{id} {title}\n{description}',
        openCommand: '',
        attachCommand: 'aicoding.ide.inline.chat.addToChat',
        installUrl: ''
    },
    traeide: {
        extensionId: '',
        extensionName: 'Trae IDE',
        templateKey: 'traeideTemplate',
        defaultTemplate: '{type} #{id} {title}\n{description}',
        openCommand: '',
        attachCommand: 'workbench.action.chat.icube.open',
        installUrl: ''
    },
    tongyi: {
        extensionId: 'Alibaba-Cloud.tongyi-lingma',
        extensionName: '通义灵码',
        templateKey: 'tongyiTemplate',
        defaultTemplate: '{type} #{id} {title}\n{description}',
        openCommand: 'tongyi.show.panel.chat',
        attachCommand: undefined,
        installUrl: 'vscode:extension/Alibaba-Cloud.tongyi-lingma'
    },
    copilot: {
        extensionId: 'GitHub.copilot-chat',
        extensionName: 'GitHub Copilot',
        templateKey: 'copilotTemplate',
        defaultTemplate: '{type} #{id} {title}\n{description}',
        openCommand: 'workbench.action.chat.open',
        attachCommand: 'github.copilot.chat.attachSelection',
        installUrl: 'vscode:extension/GitHub.copilot-chat'
    },
    trae: {
        extensionId: 'MarsCode.marscode-extension',
        extensionName: 'TRAE AI',
        templateKey: 'traeTemplate',
        defaultTemplate: '{type} #{id} {title}\n{description}',
        openCommand: 'trae.chat.menu',
        attachCommand: 'trae.add.context.menu',  // TRAE 暂无附加命令，使用复制模式
        installUrl: 'vscode:extension/MarsCode.marscode-extension'
    }
};

/**
 * 检测 IDE 环境（Qoder 或 Trae IDE）
 * 通过 VSCode 运行时上下文的 appName 和特有命令来判断
 * @returns {Promise<{isQoder: boolean, isTraeIDE: boolean, appName: string}>}
 */
async function detectIDEEnvironment() {
    const appName = vscode.env.appName;
    
    // 判断是否为 Qoder 应用
    // 方法1: 检查 appName 是否为 'Qoder'
    let isQoder = appName === 'Qoder';
    
    // 方法2: 如果 appName 不是 'Qoder'，尝试通过检查 Qoder 特有命令来判断
    if (!isQoder) {
        const commands = await vscode.commands.getCommands();
        isQoder = commands.includes('aicoding.ide.inline.chat.addToChat');
    }
    
    // 判断是否为 Trae IDE
    const isTraeIDE = appName === 'Trae';
    
    return { isQoder, isTraeIDE, appName };
}

async function checkIDEEnvironment() {
    try {
        const { isQoder, isTraeIDE, appName } = await detectIDEEnvironment();
        
        await vscode.commands.executeCommand('setContext', 'yunxiao.qoderInstalled', isQoder);
        await vscode.commands.executeCommand('setContext', 'yunxiao.traeideInstalled', isTraeIDE);
        
        if (isQoder) {
            console.log(`运行在 Qoder 应用中 (appName: ${appName})`);
        } else if (isTraeIDE) {
            console.log(`运行在 Trae IDE 中 (appName: ${appName})`);
        } else {
            console.log(`运行在 ${appName} 中，不是 Qoder 或 Trae IDE`);
        }
    } catch (error) {
        // 出错时默认设置为 false
        await vscode.commands.executeCommand('setContext', 'yunxiao.qoderInstalled', false);
        await vscode.commands.executeCommand('setContext', 'yunxiao.traeideInstalled', false);
        console.error('检查 IDE 环境失败:', error);
    }
}

/**
 * 清理文件名中的特殊字符，确保可以安全写入文件系统
 * @param {string} filename - 原始文件名
 * @returns {string} 清理后的文件名
 */
function sanitizeFilename(filename) {
    // 移除或替换 Windows 和 Unix 文件系统不允许的字符
    return filename
        .replace(/[<>:"/\\|?*]/g, '_')  // 替换特殊字符为下划线
        .replace(/[\x00-\x1f]/g, '')     // 移除控制字符
        .replace(/\.+$/g, '')            // 移除末尾的点
        .trim();
}

/**
 * 生成唯一的文件路径，如果文件已存在则添加 (1), (2) 等后缀
 * @param {string} dirPath - 目录路径
 * @param {string} baseFilename - 基础文件名（不含扩展名）
 * @param {string} ext - 文件扩展名（含点号，如 '.txt'）
 * @returns {Promise<string>} 唯一的文件路径
 */
async function getUniqueFilePath(dirPath, baseFilename, ext) {
    let filePath = path.join(dirPath, baseFilename + ext);
    let counter = 1;
    
    // 检查文件是否存在，如果存在则添加编号
    while (true) {
        try {
            await fs.access(filePath);
            // 文件存在，生成新的文件名
            filePath = path.join(dirPath, `${baseFilename}(${counter})${ext}`);
            counter++;
        } catch {
            // 文件不存在，可以使用这个路径
            break;
        }
    }
    
    return filePath;
}

/**
 * 在工作区创建或获取 .yunxiao 目录下的文件
 * 如果已存在内容相同的文件，则直接返回该文件的 URI
 * @param {string} category - 工作项类型（如 'Req', 'Bug'）
 * @param {string} id - 工作项 ID
 * @param {string} subject - 工作项标题
 * @param {string} content - 文件内容
 * @returns {Promise<{uri: vscode.Uri, existed: boolean}>} 文件 URI 和是否已存在
 */
async function createWorkItemFile(category, id, subject, content) {
    // 获取工作区根目录
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('未打开工作区，无法创建文件');
    }
    
    const rootPath = workspaceFolders[0].uri.fsPath;
    
    // 创建 .yunxiao 目录
    const yunxiaoDir = path.join(rootPath, '.yunxiao');
    await fs.mkdir(yunxiaoDir, { recursive: true });
    
    // 创建类型子目录
    const categoryDir = path.join(yunxiaoDir, category);
    await fs.mkdir(categoryDir, { recursive: true });
    
    // 生成文件名：id + subject前60字符
    const subjectPart = subject.substring(0, 60);
    const baseFilename = sanitizeFilename(`${id}_${subjectPart}`);
    
    // 首先检查该目录下是否已存在内容相同的文件
    try {
        const files = await fs.readdir(categoryDir);
        
        // 遍历所有 .txt 文件
        for (const file of files) {
            if (file.endsWith('.txt') && file.includes(baseFilename)) {
                const filePath = path.join(categoryDir, file);
                try {
                    const existingContent = await fs.readFile(filePath, 'utf8');
                    
                    // 如果内容完全相同，直接返回该文件
                    if (existingContent === content) {
                        console.log(`找到内容相同的文件: ${file}`);
                        return {
                            uri: vscode.Uri.file(filePath),
                            existed: true
                        };
                    }
                } catch (readError) {
                    // 读取文件失败，跳过
                    console.warn(`读取文件失败: ${file}`, readError);
                }
            }
        }
    } catch (readdirError) {
        // 目录读取失败，可能目录不存在，继续创建文件
        console.warn('读取目录失败，继续创建新文件', readdirError);
    }
    
    // 没有找到内容相同的文件，创建新文件
    
    // 获取唯一文件路径
    const filePath = await getUniqueFilePath(categoryDir, baseFilename, '.txt');
    
    // 写入文件
    await fs.writeFile(filePath, content, 'utf8');
    
    return {
        uri: vscode.Uri.file(filePath),
        existed: false
    };
}

/**
 * 发送工作项到 AI 聊天工具的通用函数
 * @param {Object} workitem - 工作项对象
 * @param {Object} config - 配置对象
 * @param {string} config.extensionId - 扩展 ID（如 'GitHub.copilot-chat'）
 * @param {string} config.extensionName - 扩展显示名称（如 'GitHub Copilot'）
 * @param {string} config.templateKey - 模板配置键（如 'copilotTemplate'）
 * @param {string} config.defaultTemplate - 默认模板
 * @param {string} config.openCommand - 打开聊天面板的命令
 * @param {string} config.attachCommand - 附加选择的命令（可选）
 * @param {string} config.installUrl - 安装扩展的 URL
 * @returns {Promise<void>}
 */
async function sendToAIChat(workitem, config) {
    // 1. 获取并验证工作项数据
    const item = workitem.data?.data || workitem.data || workitem;
    
    if (!item || !item.identifier) {
        vscode.window.showErrorMessage('无法获取工作项信息');
        return;
    }
    
    // 2. 格式化工作项内容
    const message = await formatWorkItem(
        workitem,
        config.templateKey,
        config.defaultTemplate
    );
    
    // 始终复制到剪贴板
    await vscode.env.clipboard.writeText(message);
            
    // 3. 添加到最近使用
    recentManager.addItem(item.workitemId, RecentItemType.WorkItem, item);
    recentTreeProvider.refresh();
    
    // 4. 检查扩展是否安装（如果提供了 extensionId）
    if (config.extensionId && config.extensionId.trim() !== '') {
        const extension = vscode.extensions.getExtension(config.extensionId);
        if (!extension) {
            // 根据是否提供 installUrl 决定显示的按钮
            const hasInstallUrl = config.installUrl && config.installUrl.trim() !== '';
            const buttons = hasInstallUrl 
                ? ['前往安装', '复制消息到剪贴板']
                : ['复制消息到剪贴板'];
            
            const choice = await vscode.window.showWarningMessage(
                `未检测到 ${config.extensionName} 扩展。请先安装 ${config.extensionName}。`,
                ...buttons
            );
            
            if (choice === '前往安装' && hasInstallUrl) {
                vscode.env.openExternal(vscode.Uri.parse(config.installUrl));
            } else if (choice === '复制消息到剪贴板') {
                await vscode.env.clipboard.writeText(message);
                vscode.window.showInformationMessage('已复制到剪贴板');
            }
            return;
        }
        
        // 5. 激活扩展
        if (!extension.isActive) {
            await extension.activate();
        }
    }
    
    // 6. 统一创建文件流程（所有 AI 都创建文件）
    try {
        // 创建或获取持久化文件
        const fileResult = await createWorkItemFile(
            item.workitemType || 'WorkItem',
            item.identifier,
            item.subject,
            message
        );
        
        const fileUri = fileResult.uri;
        const fileExisted = fileResult.existed;
        
        // 打开文件
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(doc, {
            preview: false,
            preserveFocus: false,
            viewColumn: vscode.ViewColumn.Active
        });
        
        // 如果有 attachCommand，选中全部内容并执行附加命令
        if (config.attachCommand) {
            // 选中全部内容
            const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(doc.getText().length)
            );
            editor.selection = new vscode.Selection(fullRange.start, fullRange.end);
            
            // 等待编辑器就绪
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 调用附加选择命令
            await vscode.commands.executeCommand(config.attachCommand);
            
            // 等待附加完成
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // 打开聊天面板（如果提供了 openCommand）
        if (config.openCommand && config.openCommand.trim() !== '') {
            await vscode.commands.executeCommand(config.openCommand);
        }

        // 使用状态栏消息，3秒后自动消失
        vscode.window.setStatusBarMessage(
            `✅ ${config.extensionName} 已就绪，可以直接提问！`,
            3000
        );
        
        // // 提示用户（根据文件是否已存在显示不同消息）
        // if (fileExisted) {
        //     vscode.window.showInformationMessage(
        //         `✅ 工作项信息已保存到文件\n\n📁 找到相同内容的文件，已直接打开\n💡 文件已打开，${config.extensionName} 已就绪，可以直接提问！`
        //     );
        // } else {
        //     vscode.window.showInformationMessage(
        //         `✅ 工作项信息已保存到文件\n\n💡 文件已打开，${config.extensionName} 已就绪，可以直接提问！`
        //     );
        // }
        
    } catch (error) {
        console.error('创建文件失败，回退到手动方案:', error);
        
        // 如果有 openCommand 才尝试打开
        if (config.openCommand && config.openCommand.trim() !== '') {
            await vscode.commands.executeCommand(config.openCommand);
        }
        
        // 使用状态栏消息，3秒后自动消失
        vscode.window.setStatusBarMessage(
            `⚠️ 创建文件失败，已复制到剪贴板\n\n💡 请手动粘贴（Ctrl+V）到聊天框`,
            5000
        );
    }
}

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

    // 检查 Qoder 应用是否安装
    await checkIDEEnvironment();

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

    // 显示启动消息（使用状态栏消息，3秒后自动消失）
    if (authManager.isAuthenticated()) {
        const authInfo = authManager.getAuthInfo();
        const userName = authInfo?.userName || '用户';
        vscode.window.setStatusBarMessage(`✅ 云效工作项助手已就绪，欢迎 ${userName}！`, 3000);
    } else {
        vscode.window.setStatusBarMessage('✅ 云效工作项助手已就绪，请点击状态栏登录', 3000);
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
            const recentItems = recentManager.getRecentWorkItems(10);
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

        vscode.commands.registerCommand('yunxiao.pasteToCommit', async (workitem, sourceControl) => {
            if (workitem) {
                await pasteToCommit(workitem, sourceControl);
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
            await vscode.env.clipboard.writeText(await formatWorkItem(workitem));
            vscode.window.showInformationMessage('已复制到剪贴板');
        }),

        vscode.commands.registerCommand('yunxiao.sendToQoder', async (workitem) => {
            try {
                await sendToAIChat(workitem, AI_CONFIGS.qoder);
            } catch (error) {
                console.error('发送到 Qoder 失败:', error);
                vscode.window.showErrorMessage(`发送失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.sendToTraeIDE', async (workitem) => {
            try {
                await sendToAIChat(workitem, AI_CONFIGS.traeide);
            } catch (error) {
                console.error('发送到 Trae IDE 失败:', error);
                vscode.window.showErrorMessage(`发送失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.sendToTongyi', async (workitem) => {
            try {
                await sendToAIChat(workitem, AI_CONFIGS.tongyi);
            } catch (error) {
                console.error('发送到通义灵码失败:', error);
                vscode.window.showErrorMessage(`发送失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.sendToCopilot', async (workitem) => {
            try {
                await sendToAIChat(workitem, AI_CONFIGS.copilot);
            } catch (error) {
                console.error('发送到 GitHub Copilot 失败:', error);
                vscode.window.showErrorMessage(`发送失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.sendToTrae', async (workitem) => {
            try {
                await sendToAIChat(workitem, AI_CONFIGS.trae);
            } catch (error) {
                console.error('发送到 TRAE AI 失败:', error);
                vscode.window.showErrorMessage(`发送失败: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('yunxiao.sendToAI', async (workitem) => {
            try {
                // 读取配置
                const config = vscode.workspace.getConfiguration('yunxiao');
                let defaultAI = config.get('customAI.defaultAI', '');
                                
                // 如果是空字符串，说明是首次使用或未配置
                if (!defaultAI || defaultAI.trim() === '') {
                    // 检测 IDE 环境，在 Qoder/Trae IDE 环境下默认使用对应 AI，无需显示引导
                    const { isQoder, isTraeIDE } = await detectIDEEnvironment();
                    if (isQoder) {
                        console.log('在 Qoder 环境下，默认使用 Qoder AI');
                        await sendToAIChat(workitem, AI_CONFIGS.qoder);
                        return;
                    }
                    if (isTraeIDE) {
                        console.log('在 Trae IDE 环境下，默认使用 Trae IDE AI');
                        await sendToAIChat(workitem, AI_CONFIGS.traeide);
                        return;
                    }
                            
                    // 其他环境显示引导
                    const choice = await vscode.window.showInformationMessage(
                        '🚀 欢迎使用"发送到 AI 助手"功能！\n\n请先选择您喜欢的 AI 助手：',
                        {
                            modal: true,
                            detail: '您可以选择：\n\n🤖 Qoder - 内置 AI，自动附加文件（推荐）\n💙 GitHub Copilot - 自动附加文件，直接提问\n💡 通义灵码 - 复制粘贴模式\n🚀 TRAE AI - 自动附加文件，直接提问\n⚙️ 自定义 AI - 配置其他 AI 工具\n\n也可以点击"打开设置"进行更多自定义配置。'
                        },
                        'Qoder',
                        'GitHub Copilot',
                        '通义灵码',
                        'TRAE AI',
                        '自定义 AI',
                        '打开设置'
                    );
                                    
                    if (!choice) {
                        // 用户取消，不执行任何操作
                        return;
                    }
                                    
                    if (choice === '打开设置') {
                        // 打开设置页面，聚焦到 defaultAI 配置项
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'yunxiao.customAI');
                        vscode.window.showInformationMessage(
                            'ℹ️ 请在设置中选择 "Default AI" 并配置相关参数，然后重新使用“发送到 AI 助手”功能。'
                        );
                        return;
                    }
                                    
                    // 根据用户选择设置默认 AI
                    if (choice === 'Qoder') {
                        defaultAI = 'qoder';
                        await config.update('customAI.defaultAI', 'qoder', vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('✅ 已设置默认 AI 为 Qoder');
                    } else if (choice === 'GitHub Copilot') {
                        defaultAI = 'copilot';
                        await config.update('customAI.defaultAI', 'copilot', vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('✅ 已设置默认 AI 为 GitHub Copilot');
                    } else if (choice === '通义灵码') {
                        defaultAI = 'tongyi';
                        await config.update('customAI.defaultAI', 'tongyi', vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('✅ 已设置默认 AI 为通义灵码');
                    } else if (choice === 'TRAE AI') {
                        defaultAI = 'trae';
                        await config.update('customAI.defaultAI', 'trae', vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('✅ 已设置默认 AI 为 TRAE AI');
                    } else if (choice === '自定义 AI') {
                        defaultAI = 'custom';
                        await config.update('customAI.defaultAI', 'custom', vscode.ConfigurationTarget.Global);
                                        
                        // 提示用户配置自定义 AI 参数
                        const openSettings = await vscode.window.showInformationMessage(
                            '✅ 已设置默认 AI 为自定义\n\n请配置以下参数：\n- 扩展 ID\n- 扩展名称\n- 打开命令\n- 附加命令（可选）\n- 安装 URL',
                            '打开设置'
                        );
                                        
                        if (openSettings === '打开设置') {
                            await vscode.commands.executeCommand('workbench.action.openSettings', 'yunxiao.customAI');
                            return;
                        }
                    }
                }
                                
                let aiConfig;
                                
                // 根据配置选择对应的 AI
                if (defaultAI === 'qoder') {
                    aiConfig = AI_CONFIGS.qoder;
                } else if (defaultAI === 'tongyi') {
                    aiConfig = AI_CONFIGS.tongyi;
                } else if (defaultAI === 'copilot') {
                    aiConfig = AI_CONFIGS.copilot;
                } else if (defaultAI === 'trae') {
                    aiConfig = AI_CONFIGS.trae;
                } else if (defaultAI === 'custom') {
                    // 使用自定义 AI
                    const extensionId = config.get('customAI.extensionId', 'GitHub.copilot-chat');
                    const extensionName = config.get('customAI.extensionName', 'GitHub Copilot');
                    const openCommand = config.get('customAI.openCommand', 'workbench.action.chat.open');
                    const attachCommand = config.get('customAI.attachCommand', 'github.copilot.chat.attachSelection');
                    const installUrl = config.get('customAI.installUrl', 'vscode:extension/GitHub.copilot-chat');
                    const template = config.get('customAI.template', '{type} #{id} {title}\n{description}');
                                    
                    aiConfig = {
                        extensionId,
                        extensionName,
                        templateKey: 'customAI.template',
                        defaultTemplate: template,
                        openCommand,
                        attachCommand: attachCommand.trim() === '' ? undefined : attachCommand,
                        installUrl
                    };
                } else {
                    // 如果配置无效，提示用户
                    vscode.window.showErrorMessage('无效的 AI 配置，请检查设置');
                    return;
                }
                                
                await sendToAIChat(workitem, aiConfig);
            } catch (error) {
                console.error('发送到 AI 助手失败:', error);
                vscode.window.showErrorMessage(`发送失败: ${error.message}`);
            }
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
            // 从 item.id 提取类型和 ID
            let itemId, itemType;
                    
            if (item.id && item.id.startsWith('recent-')) {
                const parts = item.id.split(':');
                if (parts[0] === 'recent-project') {
                    itemId = parts[1];
                    itemType = RecentItemType.Project;
                } else if (parts[0] === 'recent-workitem') {
                    itemId = parts[1];
                    itemType = RecentItemType.WorkItem;
                } else if (parts[0] === 'recent-search') {
                    itemId = parts[1];
                    itemType = RecentItemType.SearchKeyword;
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
                let typeName = '项目';
                if (itemType === RecentItemType.WorkItem) {
                    typeName = '工作项';
                } else if (itemType === RecentItemType.SearchKeyword) {
                    typeName = '搜索历史';
                }
                        
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

        vscode.commands.registerCommand('yunxiao.quickSearchFromSCM', async (sourceControl) => {
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
                        // 粘贴到提交消息，传递 sourceControl 上下文
                        recentManager.addItem(item.workitem.workitemId, RecentItemType.WorkItem, item.workitem);
                        recentTreeProvider.refresh();
                        await pasteToCommit(item.workitem, sourceControl);
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
                        
                        // 粘贴到提交消息，传递 sourceControl 上下文
                        await pasteToCommit(selected.workitem, sourceControl);
                        
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

async function pasteToCommit(workitem, sourceControl) {
    const text = await formatWorkItem(workitem);
    const config = vscode.workspace.getConfiguration('yunxiao');
    const pasteTarget = config.get('pasteTarget', 'commit');
    
    // 方法1：使用 Git 扩展 API（最可靠）
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            const git = gitExtension.exports.getAPI(1);
            if (git && git.repositories && git.repositories.length > 0) {
                let repository;
                
                // 优先使用传入的 sourceControl 参数（从 SCM 输入框上下文传递）
                if (sourceControl && sourceControl.rootUri) {
                    // 根据 rootUri 找到对应的仓库
                    repository = git.repositories.find(repo => 
                        repo.rootUri.toString() === sourceControl.rootUri.toString()
                    );
                    console.log('使用 SCM 上下文指定的仓库:', sourceControl.rootUri.toString());
                }
                
                // 如果没有从 sourceControl 找到，则使用智能回退逻辑
                if (!repository) {
                    // 获取当前工作区的 Git 仓库
                    repository = git.repositories[0];
                    
                    // 如果有多个仓库，尝试找到当前活动编辑器所在的仓库
                    if (git.repositories.length > 1 && vscode.window.activeTextEditor) {
                        const activeUri = vscode.window.activeTextEditor.document.uri;
                        const repo = git.getRepository(activeUri);
                        if (repo) {
                            repository = repo;
                            console.log('使用当前活动编辑器所在的仓库');
                        }
                    }
                }
                
                // 检查当前提交消息是否已包含相同内容
                let currentMessage = repository.inputBox.value;
                if (currentMessage.includes(text)) {
                    vscode.window.showInformationMessage('提交消息中已包含此工作项信息');
                    return;
                }
                
                // 设置提交消息
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

/**
 * 统一的工作项格式化函数
 * @param {Object} workitem - 工作项对象
 * @param {string} templateKey - 模板配置项（默认: 'pasteTemplate'）
 * @param {string} defaultTemplate - 默认模板
 * @returns {Promise<string>} 格式化后的文本
 */
async function formatWorkItem(workitem, templateKey = 'pasteTemplate', defaultTemplate = '#{id} {title}') {
    const config = vscode.workspace.getConfiguration('yunxiao');
    const template = config.get(templateKey, defaultTemplate);
    
    // 统一获取工作项数据（处理嵌套的 data 属性）
    let item = workitem.data?.data || workitem.data || workitem;
    
    // 智能检测：只在模板需要 description 且当前没有时才获取
    if (template.includes('{description}') && !item.description && item.workitemId) {
        try {
            // 静默获取完整详情，不显示进度提示（避免干扰用户）
            const fullItem = await workItemManager.getWorkItem(item.workitemId);
            // 合并数据，保留原有字段
            item = { ...item, ...fullItem };
        } catch (error) {
            console.warn('获取工作项详情失败，将使用基本信息:', error.message);
        }
    }
    
    // 处理 description 字段：将 JSON 格式转为纯文本
    let descriptionText = '';
    if (item.description) {
        descriptionText = convertDescriptionToText(item.description);
    }
    
    // 使用正则表达式全局替换，支持多次出现
    return template
        .replace(/\{id\}/g, item.identifier || '')
        .replace(/\{title\}/g, item.subject || '')
        .replace(/\{description\}/g, descriptionText)
        .replace(/\{workitemType\}/g, item.workitemType || '')
        .replace(/\{type\}/g, item.workitemType || '')
        .replace(/\{status\}/g, item.status || '')
        .replace(/\{assignedTo\}/g, item.assignedTo?.name || '')
        .replace(/\{category\}/g, item.category || '');
}

/**
 * 将工作项的 description 转为纯文本
 * @param {string|Object} description - 原始 description 数据
 * @returns {string} 纯文本格式
 */
function convertDescriptionToText(description) {
    // 如果已经是字符串，尝试解析 JSON
    let descObj = description;
    if (typeof description === 'string') {
        try {
            descObj = JSON.parse(description);
        } catch (e) {
            // 不是 JSON，直接返回原文本
            return description;
        }
    }
    
    // 如果不是对象，直接转字符串
    if (typeof descObj !== 'object' || descObj === null) {
        return String(description);
    }
    
    // 优先使用 htmlValue，去除 HTML 标签
    if (descObj.htmlValue) {
        return htmlToText(descObj.htmlValue);
    }
    
    // 如果没有 htmlValue，尝试使用 jsonMLValue
    if (descObj.jsonMLValue) {
        return jsonMLToText(descObj.jsonMLValue);
    }
    
    // 都没有，返回空字符串
    return '';
}

/**
 * 将 HTML 转为纯文本
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本
 */
function htmlToText(html) {
    if (!html) return '';
    
    return html
        // 列表项前添加缩进和项目符号
        .replace(/<li[^>]*>/gi, '\n  • ')
        .replace(/<\/li>/gi, '')
        
        // 段落和换行
        .replace(/<\/p>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        
        // 删除所有 HTML 标签
        .replace(/<[^>]+>/g, '')
        
        // 解码 HTML 实体
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        
        // 清理多余的空行（保留最多一个连续换行）
        .replace(/\n{2,}/g, '\n')
        
        // 去除首尾空白
        .trim();
}

/**
 * 将 JsonML 格式转为纯文本
 * @param {Array} jsonML - JsonML 数据结构
 * @returns {string} 纯文本
 */
function jsonMLToText(jsonML) {
    if (!Array.isArray(jsonML)) return '';
    
    let result = [];
    
    function traverse(node, level = 0) {
        if (!Array.isArray(node)) {
            if (typeof node === 'string') {
                result.push(node);
            }
            return;
        }
        
        const [tag, attrs, ...children] = node;
        
        // 根据标签类型处理
        if (tag === 'p') {
            // 处理列表项
            if (attrs && attrs.list) {
                const indent = '  '.repeat(attrs.list.level || 0);
                const bullet = attrs.list.listStyle?.text || '•';
                result.push(`\n${indent}${bullet} `);
            } else {
                result.push('\n');
            }
        }
        
        // 递归处理子节点
        children.forEach(child => traverse(child, level + 1));
    }
    
    traverse(jsonML);
    
    return result.join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
