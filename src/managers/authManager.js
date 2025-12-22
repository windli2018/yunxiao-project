const vscode = require('vscode');
const { AuthType } = require('../models/types');
const { YunxiaoApiClient } = require('../services/yunxiaoApiClient');
const { OAuthService } = require('../services/oauthService');

/**
 * PAT 认证提供者
 */
class PATAuthProvider {
    constructor(context, apiClient) {
        this.context = context;
        this.apiClient = apiClient;
    }

    getAuthType() {
        return AuthType.PAT;
    }

    async login() {
        // 从加密存储读取组织 ID
        let organizationId = await this.context.secrets.get('yunxiao.organizationId');

        if (!organizationId) {
            const message = '⚠️ **未配置组织 ID**\n\n' +
                '组织 ID 是使用云效的必需配置，请按以下步骤获取：\n\n' +
                '1. 登录云效工作台\n' +
                '2. 在浏览器地址栏查看 URL：https://devops.aliyun.com/organization/**{organizationId}**\n' +
                '3. 或联系组织管理员获取';
            
            const choice = await vscode.window.showErrorMessage(
                message,
                '输入组织 ID',
                '查看帮助文档'
            );
            
            if (choice === '输入组织 ID') {
                // 打开浏览器到云效组织页面
                await vscode.env.openExternal(vscode.Uri.parse('https://devops.aliyun.com/organization'));
                
                organizationId = await vscode.window.showInputBox({
                    prompt: '请输入云效组织 ID（在云效网址中可找到：devops.aliyun.com/organization/您的组织ID）',
                    placeHolder: '例如：66a0326c1d2a2a350e263a7d',
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value || value.trim() === '') {
                            return '组织 ID 不能为空';
                        }
                        return null;
                    }
                });
                
                if (!organizationId) {
                    throw new Error('未提供组织 ID');
                }
                
                // 保存到加密存储
                await this.context.secrets.store('yunxiao.organizationId', organizationId.trim());
            } else if (choice === '查看帮助文档') {
                await vscode.env.openExternal(vscode.Uri.parse('https://help.aliyun.com/zh/yunxiao/user-guide/quick-start-4'));
                throw new Error('未配置组织 ID');
            } else {
                throw new Error('未配置组织 ID');
            }
        }

        // 从 SecretStorage 读取 PAT
        let token = await this.context.secrets.get('yunxiao.pat');

        if (!token) {
            // 打开浏览器到 PAT 生成页面
            await vscode.env.openExternal(vscode.Uri.parse('https://account-devops.aliyun.com/settings/personalAccessToken'));
            
            // 提示用户输入 PAT
            token = await vscode.window.showInputBox({
                prompt: '请输入云效个人访问令牌（Personal Access Token）',
                password: true,
                ignoreFocusOut: true,
                placeHolder: '在 https://account-devops.aliyun.com/settings/personalAccessToken 生成'
            });

            if (!token) {
                throw new Error('未提供访问令牌');
            }

            // 保存到 SecretStorage
            await this.context.secrets.store('yunxiao.pat', token);
        }

       // 验证令牌
        this.apiClient.setAuth(token, organizationId);
        const isValid = await this.apiClient.validateToken();

        if (!isValid) {
            await this.context.secrets.delete('yunxiao.pat');
            throw new Error('访问令牌无效，请重新输入');
        }

        // 获取用户信息
        try {
            const user = await this.apiClient.getCurrentUser();

            const authInfo = {
                authType: AuthType.PAT,
                accessToken: token,
                organizationId,
                userId: user.id,
                userName: user.name || user.nickName || user.username
            };

            return authInfo;
        } catch (error) {
            // 检查是否是权限错误
            if (error.message.includes('no permission to api')) {
                await this.context.secrets.delete('yunxiao.pat');
                
                const message = '⚠️ **Token 权限不足**\n\n' +
                    '当前 Personal Access Token 没有访问云效 API 的权限。\n\n' +
                    '请选择解决方案：';
                
                const choice = await vscode.window.showErrorMessage(
                    message,
                    '修改 Token 权限',
                    '切换组织 ID 和 Token'
                );
                
                if (choice === '修改 Token 权限') {
                    // 打开 PAT 管理页面
                    await vscode.env.openExternal(vscode.Uri.parse('https://account-devops.aliyun.com/settings/personalAccessToken'));
                    
                    const guideMessage = '💡 **权限配置指南**\n\n' +
                        '请在打开的页面中为您的 Token 添加以下权限：\n\n' +
                        '📋 **组织管理** > **用户和项目协作** > **项目、工作项**\n\n' +
                        '配置完成后，请点击"确定"重新输入 Token。';
                    
                    const confirmed = await vscode.window.showInformationMessage(
                        guideMessage,
                        { modal: true },
                        '确定',
                        '取消'
                    );
                    
                    if (confirmed === '确定') {
                        // 重新输入 Token（预填旧值）
                        const newToken = await vscode.window.showInputBox({
                            prompt: '请输入更新权限后的 Personal Access Token',
                            password: true,
                            value: token,  // 预填旧 token
                            ignoreFocusOut: true,
                            placeHolder: '在 https://account-devops.aliyun.com/settings/personalAccessToken 生成'
                        });
                        
                        if (newToken && newToken.trim()) {
                            // 保存新 token
                            await this.context.secrets.store('yunxiao.pat', newToken.trim());
                            // 递归调用 login，重新验证
                            return await this.login();
                        }
                    }
                } else if (choice === '切换组织 ID 和 Token') {
                    // 打开组织页面
                    await vscode.env.openExternal(vscode.Uri.parse('https://devops.aliyun.com/organization'));
                    
                    // 输入新的组织 ID（预填旧值）
                    const newOrgId = await vscode.window.showInputBox({
                        prompt: '请输入新的云效组织 ID',
                        value: organizationId,  // 预填旧组织 ID
                        placeHolder: '例如：66a0326c1d2a2a350e263a7d',
                        ignoreFocusOut: true,
                        validateInput: (value) => {
                            if (!value || value.trim() === '') {
                                return '组织 ID 不能为空';
                            }
                            return null;
                        }
                    });
                    
                    if (newOrgId && newOrgId.trim()) {
                        // 保存新组织 ID
                        await this.context.secrets.store('yunxiao.organizationId', newOrgId.trim());
                        
                        // 打开 PAT 页面
                        await vscode.env.openExternal(vscode.Uri.parse('https://account-devops.aliyun.com/settings/personalAccessToken'));
                        
                        // 输入新的 Token（预填旧值）
                        const newToken = await vscode.window.showInputBox({
                            prompt: '请输入新的 Personal Access Token（需包含"组织管理>用户和项目协作>项目、工作项"权限）',
                            password: true,
                            value: token,  // 预填旧 token
                            ignoreFocusOut: true,
                            placeHolder: '在 https://account-devops.aliyun.com/settings/personalAccessToken 生成'
                        });
                        
                        if (newToken && newToken.trim()) {
                            // 保存新 token
                            await this.context.secrets.store('yunxiao.pat', newToken.trim());
                            // 递归调用 login，重新验证
                            return await this.login();
                        }
                    }
                }
                
                throw new Error('登录已取消');
            }
            
            // 其他错误直接抛出
            throw error;
        }
    }

    async logout() {
        await this.context.secrets.delete('yunxiao.pat');
        this.apiClient.clearAuth();
    }

    async refreshToken(authInfo) {
        // PAT 不需要刷新
        return authInfo;
    }

    async validateToken(authInfo) {
        this.apiClient.setAuth(authInfo.accessToken, authInfo.organizationId);
        return await this.apiClient.validateToken();
    }
}

/**
 * OAuth 认证提供者
 */
class OAuthAuthProvider {
    constructor(context, apiClient) {
        this.context = context;
        this.apiClient = apiClient;
        
        // 获取配置的 OAuth 参数，如果没有配置则使用默认值
        const config = vscode.workspace.getConfiguration('yunxiao');
        const clientId = config.get('oauth.clientId', '');
        const clientSecret = config.get('oauth.clientSecret', '');
        
        // 配置 OAuth 服务
        this.oauthService = new OAuthService({
            clientId: clientId,
            clientSecret: clientSecret,
            authorizationUrl: 'https://signin.aliyun.com/oauth2/v1/auth',
            tokenUrl: 'https://oauth.aliyun.com/v1/token',
            redirectUri: 'http://localhost:17890/callback',
            scopes: ['openid', '/acs/devops'] // 云效相关的 scope
        });
    }

    getAuthType() {
        return AuthType.OAuth;
    }

    async login() {
        // 从加密存储读取组织 ID
        let organizationId = await this.context.secrets.get('yunxiao.organizationId');
        
        if (!organizationId) {
            const message = '⚠️ **未配置组织 ID**\n\n' +
                '组织 ID 是使用云效的必需配置，请按以下步骤获取：\n\n' +
                '1. 登录云效工作台\n' +
                '2. 在浏览器地址栏查看 URL：https://devops.aliyun.com/organization/**{organizationId}**\n' +
                '3. 或联系组织管理员获取';
            
            const choice = await vscode.window.showErrorMessage(
                message,
                '输入组织 ID',
                '查看帮助文档'
            );
                    
            if (choice === '输入组织 ID') {
                // 打开浏览器到云效组织页面
                await vscode.env.openExternal(vscode.Uri.parse('https://devops.aliyun.com/organization'));
                        
                organizationId = await vscode.window.showInputBox({
                    prompt: '请输入云效组织 ID（在云效网址中可找到：devops.aliyun.com/organization/您的组织ID）',
                    placeHolder: '例如：66a0326c1d2a2a350e263a7d',
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value || value.trim() === '') {
                            return '组织 ID 不能为空';
                        }
                        return null;
                    }
                });
                        
                if (!organizationId) {
                    throw new Error('未提供组织 ID');
                }
                        
                // 保存到加密存储
                await this.context.secrets.store('yunxiao.organizationId', organizationId.trim());
            } else if (choice === '查看帮助文档') {
                await vscode.env.openExternal(vscode.Uri.parse('https://help.aliyun.com/zh/yunxiao/user-guide/quick-start-4'));
                throw new Error('未配置组织 ID');
            } else {
                throw new Error('未配置组织 ID');
            }
        }
                
        // 检查是否已配置 OAuth 参数
        const config = vscode.workspace.getConfiguration('yunxiao');
        const clientId = config.get('oauth.clientId', '');
        const clientSecret = config.get('oauth.clientSecret', '');
        
        if (!clientId || !clientSecret) {
            const message = '⚠️ **未配置 OAuth 客户端信息**\n\n' +
                '请先在阿里云访问控制(RAM)中创建应用，获取 Client ID 和 Client Secret，\n' +
                '然后在 VSCode 设置中配置：\n' +
                '- **yunxiao.oauth.clientId**\n' +
                '- **yunxiao.oauth.clientSecret**\n\n' +
                '参考文档：https://help.aliyun.com/zh/ram/user-guide/create-an-application';
            
            const choice = await vscode.window.showErrorMessage(
                message,
                '打开设置',
                '使用 PAT 登录'
            );
            
            if (choice === '打开设置') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'yunxiao.oauth');
            } else if (choice === '使用 PAT 登录') {
                // 切换到 PAT 认证
                await config.update('authType', 'PAT', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('已切换为 PAT 认证方式，请重新登录');
            }
            
            throw new Error('未配置 OAuth 客户端信息');
        }
        
        try {
            // 使用 OAuth 服务进行登录
            const authInfo = await this.oauthService.login();
            
            // 使用从 secrets 读取的 organizationId，而不是 API 返回的
            authInfo.organizationId = organizationId;
            
            // 保存令牌到 SecretStorage
            await this.context.secrets.store('yunxiao.oauth.accessToken', authInfo.accessToken);
            if (authInfo.refreshToken) {
                await this.context.secrets.store('yunxiao.oauth.refreshToken', authInfo.refreshToken);
            }
            
            // 设置 API 客户端认证信息
            this.apiClient.setAuth(authInfo.accessToken, authInfo.organizationId);
            
            vscode.window.showInformationMessage(`欢迎，${authInfo.userName || '用户'}！`);
            
            return authInfo;
        } catch (error) {
            throw new Error(`OAuth 登录失败: ${error.message}`);
        }
    }

    async logout() {
        await this.context.secrets.delete('yunxiao.oauth.accessToken');
        await this.context.secrets.delete('yunxiao.oauth.refreshToken');
        this.apiClient.clearAuth();
    }

    async refreshToken(authInfo) {
        if (!authInfo.refreshToken) {
            throw new Error('没有可用的刷新令牌');
        }
        
        try {
            const newAuthInfo = await this.oauthService.refreshToken(authInfo.refreshToken);
            
            // 更新 SecretStorage 中的令牌
            await this.context.secrets.store('yunxiao.oauth.accessToken', newAuthInfo.accessToken);
            if (newAuthInfo.refreshToken) {
                await this.context.secrets.store('yunxiao.oauth.refreshToken', newAuthInfo.refreshToken);
            }
            
            // 更新 API 客户端认证信息
            this.apiClient.setAuth(newAuthInfo.accessToken, newAuthInfo.organizationId);
            
            return newAuthInfo;
        } catch (error) {
            throw new Error(`刷新令牌失败: ${error.message}`);
        }
    }

    async validateToken(authInfo) {
        this.apiClient.setAuth(authInfo.accessToken, authInfo.organizationId);
        return await this.apiClient.validateToken();
    }
}

/**
 * 认证管理器
 */
class AuthManager {
    constructor(context, apiClient) {
        this.context = context;
        this.apiClient = apiClient;
        this.currentAuthInfo = undefined;
        this.authProvider = undefined;
    }

    /**
     * 初始化认证
     */
    async initialize() {
        const config = vscode.workspace.getConfiguration('yunxiao');
        const authType = config.get('authType', 'OAuth');

        // 创建认证提供者
        if (authType === 'PAT') {
            this.authProvider = new PATAuthProvider(this.context, this.apiClient);
        } else {
            this.authProvider = new OAuthAuthProvider(this.context, this.apiClient);
        }

        // 尝试恢复之前的登录状态
        await this.restoreAuth();
    }

    /**
     * 登录
     */
    async login() {
        if (!this.authProvider) {
            throw new Error('认证提供者未初始化');
        }

        try {
            this.currentAuthInfo = await this.authProvider.login();
            await this.saveAuth(this.currentAuthInfo);
            return this.currentAuthInfo;
        } catch (error) {
            throw new Error(`登录失败: ${error.message}`);
        }
    }

    /**
     * 登出
     */
    async logout() {
        if (this.authProvider) {
            await this.authProvider.logout();
        }
        this.currentAuthInfo = undefined;
        await this.context.globalState.update('yunxiao.authInfo', undefined);
    }

    /**
     * 获取当前认证信息
     */
    getAuthInfo() {
        return this.currentAuthInfo;
    }

    /**
     * 检查是否已登录
     */
    isAuthenticated() {
        return this.currentAuthInfo !== undefined;
    }

    /**
     * 验证并刷新令牌
     */
    async ensureAuthenticated() {
        if (!this.currentAuthInfo) {
            throw new Error('未登录');
        }

        if (!this.authProvider) {
            throw new Error('认证提供者未初始化');
        }

        // 验证令牌是否有效
        const isValid = await this.authProvider.validateToken(this.currentAuthInfo);

        if (!isValid) {
            // 尝试刷新令牌
            try {
                this.currentAuthInfo = await this.authProvider.refreshToken(this.currentAuthInfo);
                await this.saveAuth(this.currentAuthInfo);
            } catch (error) {
                // 刷新失败，清除认证信息
                await this.logout();
                throw new Error('登录已过期，请重新登录');
            }
        }

        return this.currentAuthInfo;
    }

    /**
     * 恢复认证状态
     */
    async restoreAuth() {
        const savedAuth = this.context.globalState.get('yunxiao.authInfo');
        
        if (savedAuth && this.authProvider) {
            try {
                // 从 SecretStorage 恢复 accessToken
                let accessToken;
                if (savedAuth.authType === AuthType.PAT) {
                    accessToken = await this.context.secrets.get('yunxiao.pat');
                } else if (savedAuth.authType === AuthType.OAuth) {
                    accessToken = await this.context.secrets.get('yunxiao.oauth.accessToken');
                }
                
                if (!accessToken) {
                    console.log('未找到保存的访问令牌，需要重新登录');
                    return;
                }
                
                // 恢复完整的认证信息
                savedAuth.accessToken = accessToken;
                
                // 如果是 OAuth，还需要恢复 refreshToken
                if (savedAuth.authType === AuthType.OAuth) {
                    const refreshToken = await this.context.secrets.get('yunxiao.oauth.refreshToken');
                    if (refreshToken) {
                        savedAuth.refreshToken = refreshToken;
                    }
                }
                
                // 设置 API 客户端认证信息
                this.apiClient.setAuth(savedAuth.accessToken, savedAuth.organizationId);
                
                // 验证令牌是否有效
                const isValid = await this.authProvider.validateToken(savedAuth);
                if (isValid) {
                    this.currentAuthInfo = savedAuth;
                    console.log('成功恢复登录状态');
                } else {
                    console.log('保存的令牌已失效，需要重新登录');
                    await this.logout();
                }
            } catch (error) {
                console.error('恢复认证状态失败:', error);
                // 验证失败，清除保存的认证信息
                await this.logout();
            }
        }
    }

    /**
     * 保存认证信息
     */
    async saveAuth(authInfo) {
        // 保存到 globalState（不包含敏感令牌信息）
        const safeAuthInfo = {
            authType: authInfo.authType,
            organizationId: authInfo.organizationId,
            userId: authInfo.userId,
            userName: authInfo.userName,
            tokenExpiry: authInfo.tokenExpiry
        };
        
        await this.context.globalState.update('yunxiao.authInfo', safeAuthInfo);
        
        // 令牌已经在各自的 AuthProvider 中保存到 SecretStorage
        // PAT: 保存在 'yunxiao.pat'
        // OAuth: 保存在 'yunxiao.oauth.accessToken' 和 'yunxiao.oauth.refreshToken'
    }
}

module.exports = { PATAuthProvider, OAuthAuthProvider, AuthManager };
