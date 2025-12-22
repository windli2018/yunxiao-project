const vscode = require('vscode');
const http = require('http');
const { AuthType } = require('../models/types');

/**
 * OAuth 服务
 */
class OAuthService {
    constructor(config) {
        this.config = config;
        this.server = undefined;
        this.port = 17890; // 本地回调端口
    }

    /**
     * 启动 OAuth 登录流程
     */
    async login() {
        return new Promise(async (resolve, reject) => {
            try {
                // 1. 启动本地服务器监听回调
                const authorizationCode = await this.startCallbackServer();

                // 2. 打开浏览器进行授权
                const authUrl = this.buildAuthorizationUrl();
                const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
                
                if (!opened) {
                    throw new Error('无法打开浏览器，请手动访问授权页面');
                }

                // 显示提示
                vscode.window.showInformationMessage(
                    '已在浏览器中打开云效登录页面，请完成登录授权',
                    '取消'
                ).then(selection => {
                    if (selection === '取消') {
                        this.stopCallbackServer();
                        reject(new Error('用户取消登录'));
                    }
                });

                // 3. 等待授权码
                const code = await authorizationCode;

                // 4. 使用授权码换取访问令牌
                const tokenResponse = await this.exchangeCodeForToken(code);

                // 5. 构建认证信息
                const authInfo = {
                    authType: AuthType.OAuth,
                    accessToken: tokenResponse.access_token,
                    refreshToken: tokenResponse.refresh_token,
                    tokenExpiry: Date.now() + (tokenResponse.expires_in * 1000),
                    organizationId: this.extractOrganizationId(tokenResponse),
                    userId: tokenResponse.user_id,
                    userName: tokenResponse.user_name
                };

                resolve(authInfo);
            } catch (error) {
                reject(error);
            } finally {
                this.stopCallbackServer();
            }
        });
    }

    /**
     * 刷新访问令牌
     */
    async refreshToken(refreshToken) {
        try {
            const response = await fetch(this.config.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret
                })
            });

            if (!response.ok) {
                throw new Error('刷新令牌失败');
            }

            const tokenResponse = await response.json();

            return {
                authType: AuthType.OAuth,
                accessToken: tokenResponse.access_token,
                refreshToken: tokenResponse.refresh_token || refreshToken,
                tokenExpiry: Date.now() + (tokenResponse.expires_in * 1000),
                organizationId: this.extractOrganizationId(tokenResponse),
                userId: tokenResponse.user_id,
                userName: tokenResponse.user_name
            };
        } catch (error) {
            throw new Error(`刷新令牌失败: ${error.message}`);
        }
    }

    /**
     * 构建授权 URL
     */
    buildAuthorizationUrl() {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: 'code',
            scope: this.config.scopes.join(' '),
            state: this.generateState()
        });

        return `${this.config.authorizationUrl}?${params.toString()}`;
    }

    /**
     * 启动本地回调服务器
     */
    startCallbackServer() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                const url = new URL(req.url, `http://localhost:${this.port}`);
                const code = url.searchParams.get('code');
                const error = url.searchParams.get('error');
                const errorDescription = url.searchParams.get('error_description');

                if (error) {
                    // 返回错误页面
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(this.getErrorHtml(errorDescription || error));
                    reject(new Error(errorDescription || error));
                    return;
                }

                if (code) {
                    // 返回成功页面
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(this.getSuccessHtml());
                    resolve(code);
                    return;
                }

                // 其他请求返回404
                res.writeHead(404);
                res.end();
            });

            this.server.listen(this.port, 'localhost', () => {
                console.log(`OAuth 回调服务器已启动，监听端口 ${this.port}`);
            });

            this.server.on('error', (error) => {
                reject(new Error(`无法启动回调服务器: ${error.message}`));
            });

            // 设置超时（5分钟）
            setTimeout(() => {
                this.stopCallbackServer();
                reject(new Error('登录超时，请重试'));
            }, 5 * 60 * 1000);
        });
    }

    /**
     * 停止回调服务器
     */
    stopCallbackServer() {
        if (this.server) {
            this.server.close();
            this.server = undefined;
            console.log('OAuth 回调服务器已停止');
        }
    }

    /**
     * 使用授权码换取访问令牌
     */
    async exchangeCodeForToken(code) {
        try {
            const response = await fetch(this.config.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: this.config.redirectUri,
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`获取访问令牌失败: ${errorText}`);
            }

            return await response.json();
        } catch (error) {
            throw new Error(`获取访问令牌失败: ${error.message}`);
        }
    }

    /**
     * 生成状态参数（防止 CSRF 攻击）
     */
    generateState() {
        return Math.random().toString(36).substring(2, 15);
    }

    /**
     * 从令牌响应中提取组织 ID
     * 注意：此方法在 OAuthService 中，无法直接访问 context.secrets
     * 组织 ID 应该在 OAuthAuthProvider.login() 中从 secrets 读取并传入
     */
    extractOrganizationId(tokenResponse) {
        // 根据实际 API 响应调整
        return tokenResponse.organization_id || 
               tokenResponse.org_id || 
               '';
    }

    /**
     * 获取成功页面 HTML
     */
    getSuccessHtml() {
        return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录成功</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
                'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            color: #333;
        }
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            padding: 48px;
            text-align: center;
            max-width: 500px;
            animation: slideIn 0.5s ease-out;
        }
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .success-icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            animation: scaleIn 0.5s ease-out 0.2s both;
        }
        @keyframes scaleIn {
            from {
                transform: scale(0);
            }
            to {
                transform: scale(1);
            }
        }
        .checkmark {
            width: 40px;
            height: 40px;
            border: 4px solid white;
            border-radius: 50%;
            position: relative;
        }
        .checkmark:after {
            content: '';
            position: absolute;
            left: 8px;
            top: 2px;
            width: 12px;
            height: 20px;
            border: solid white;
            border-width: 0 4px 4px 0;
            transform: rotate(45deg);
        }
        h1 {
            font-size: 28px;
            color: #333;
            margin-bottom: 16px;
            font-weight: 600;
        }
        p {
            font-size: 16px;
            color: #666;
            line-height: 1.6;
            margin-bottom: 12px;
        }
        .tip {
            font-size: 14px;
            color: #999;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #eee;
        }
        .countdown {
            color: #667eea;
            font-weight: 600;
        }
    </style>
    <script>
        let seconds = 3;
        function updateCountdown() {
            const element = document.getElementById('countdown');
            if (element && seconds > 0) {
                element.textContent = seconds;
                seconds--;
                setTimeout(updateCountdown, 1000);
            } else {
                window.close();
            }
        }
        window.onload = updateCountdown;
    </script>
</head>
<body>
    <div class="container">
        <div class="success-icon">
            <div class="checkmark"></div>
        </div>
        <h1>✨ 登录成功！</h1>
        <p>您已成功登录云效工作项助手</p>
        <p>正在返回 VSCode...</p>
        <div class="tip">
            此页面将在 <span class="countdown" id="countdown">3</span> 秒后自动关闭
            <br>您可以直接关闭此页面
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * 获取错误页面 HTML
     */
    getErrorHtml(error) {
        return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录失败</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
                'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            color: #333;
        }
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            padding: 48px;
            text-align: center;
            max-width: 500px;
            animation: slideIn 0.5s ease-out;
        }
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .error-icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 24px;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 48px;
            color: white;
            animation: scaleIn 0.5s ease-out 0.2s both;
        }
        @keyframes scaleIn {
            from {
                transform: scale(0);
            }
            to {
                transform: scale(1);
            }
        }
        h1 {
            font-size: 28px;
            color: #333;
            margin-bottom: 16px;
            font-weight: 600;
        }
        p {
            font-size: 16px;
            color: #666;
            line-height: 1.6;
            margin-bottom: 12px;
        }
        .error-message {
            background: #fff5f5;
            border: 1px solid #feb2b2;
            border-radius: 8px;
            padding: 16px;
            margin: 24px 0;
            color: #c53030;
            font-size: 14px;
            word-break: break-word;
        }
        .tip {
            font-size: 14px;
            color: #999;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #eee;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">✖</div>
        <h1>登录失败</h1>
        <p>很抱歉，登录过程中出现了问题</p>
        <div class="error-message">
            ${this.escapeHtml(error)}
        </div>
        <div class="tip">
            请返回 VSCode 重试登录<br>
            或联系管理员获取帮助
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
}

module.exports = { OAuthService };
