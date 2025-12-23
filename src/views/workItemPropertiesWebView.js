/**
 * 工作项属性WebView生成器
 * 负责生成工作项属性查看面板的HTML内容
 */

/**
 * 生成工作项属性WebView HTML
 * @param {Object} workitem - 工作项基础信息
 * @param {Object} details - 工作项详情（可选）
 * @param {Object} stateManager - 状态管理器
 * @returns {string} HTML字符串
 */
function getWorkItemPropertiesHtml(workitem, details, stateManager) {
    const isLoading = !details;
    const hasError = details?.error;
    
    // 使用details或workitem
    const data = details || workitem;
    
    // 格式化日期
    const formatDate = (timestamp) => {
        if (!timestamp) return '未知';
        return new Date(timestamp).toLocaleString('zh-CN');
    };
    
    // 获取状态描述
    const stateDesc = stateManager ? stateManager.getStateDescription(workitem.workitemId) : '未操作';
    
    // 处理描述内容 - 优先使用htmlValue字段
    const getDescriptionContent = () => {
        // 优先使用 description.htmlValue（云效标准HTML格式）
        if (data.description?.htmlValue) {
            return data.description.htmlValue;
        }
        
        // 降级方案：使用description字符串
        if (typeof data.description === 'string') {
            // 如果包含HTML标签，直接返回
            const hasHtmlTags = /<[^>]+>/.test(data.description);
            if (hasHtmlTags) {
                return data.description;
            }
            // 纯文本，转义特殊字符后返回
            return data.description
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
        
        return '无描述';
    };
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: http: data:;">
    <title>工作项属性</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 16px;
            margin-bottom: 24px;
        }
        .title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 8px;
        }
        .identifier {
            color: var(--vscode-textLink-foreground);
            font-size: 16px;
        }
        .section {
            margin-bottom: 24px;
        }
        .section-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 12px;
            color: var(--vscode-textLink-foreground);
        }
        .field {
            margin-bottom: 12px;
            display: flex;
        }
        .field-label {
            min-width: 100px;
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
        }
        .field-value {
            flex: 1;
            word-break: break-word;
        }
        .description {
            padding: 12px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            margin-top: 8px;
            line-height: 1.6;
        }
        /* 描述中的HTML样式 */
        .description p {
            margin: 8px 0;
        }
        .description ul, .description ol {
            margin: 8px 0;
            padding-left: 24px;
        }
        .description li {
            margin: 4px 0;
        }
        .description img {
            max-width: 100%;
            height: auto;
            margin: 8px 0;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .description img.img-error {
            display: none;
        }
        .img-error-msg {
            display: inline-block;
            padding: 8px 12px;
            background-color: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            border-radius: 4px;
            color: var(--vscode-inputValidation-warningForeground);
            margin: 8px 0;
        }
        .description pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
        }
        .description code {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
        }
        .description a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .description a:hover {
            text-decoration: underline;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .error {
            color: var(--vscode-errorForeground);
            padding: 12px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
        }
        .actions {
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .action-group {
            margin-bottom: 16px;
        }
        .action-group-title {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--vscode-descriptionForeground);
        }
        .button {
            display: inline-block;
            padding: 8px 16px;
            margin: 4px 8px 4px 0;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            text-align: center;
        }
        .button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="identifier">#${data.identifier}</div>
            <div class="title">${data.subject || '加载中...'}</div>
        </div>
        
        ${hasError ? `
            <div class="error">
                加载失败: ${details.error}
            </div>
        ` : ''}
        
        <div class="section">
            <div class="section-title">基本信息</div>
            <div class="field">
                <div class="field-label">类型：</div>
                <div class="field-value">${data.workitemType || '加载中...'}</div>
            </div>
            <div class="field">
                <div class="field-label">状态：</div>
                <div class="field-value">${data.status || '加载中...'}</div>
            </div>
            <div class="field">
                <div class="field-label">负责人：</div>
                <div class="field-value">${data.assignedTo?.name || '未指派'}</div>
            </div>
            <div class="field">
                <div class="field-label">创建日期：</div>
                <div class="field-value">${formatDate(data.createdAt)}</div>
            </div>
            <div class="field">
                <div class="field-label">更新日期：</div>
                <div class="field-value">${formatDate(data.updatedAt)}</div>
            </div>
            ${data.sprint ? `
                <div class="field">
                    <div class="field-label">所属迭代：</div>
                    <div class="field-value">${data.sprint}</div>
                </div>
            ` : ''}
        </div>
        
        <div class="section">
            <div class="section-title">使用状态</div>
            <div class="field-value">${stateDesc.replace(/\n/g, '<br>')}</div>
        </div>
        
        ${details && details.description && !hasError ? `
            <div class="section">
                <div class="section-title">描述</div>
                <div class="description">${getDescriptionContent()}</div>
            </div>
        ` : isLoading ? `
            <div class="loading">正在加载详细信息...</div>
        ` : ''}
        
        <div class="actions">
            <div class="action-group">
                <div class="action-group-title">主要操作</div>
                <button class="button" onclick="sendCommand('createBranch')">新建分支并粘贴到提交记录</button>
                <button class="button" onclick="sendCommand('pasteToCommit')">粘贴到提交消息</button>
                <button class="button" onclick="sendCommand('openInBrowser')">在浏览器打开</button>
                <button class="button" onclick="sendCommand('copyToClipboard')">复制到剪贴板</button>
            </div>
            
            <div class="action-group">
                <div class="action-group-title">AI 助手</div>
                <button class="button secondary" onclick="sendCommand('sendToQoder')">Qoder</button>
                <button class="button secondary" onclick="sendCommand('sendToTraeIDE')">Trae IDE</button>
                <button class="button secondary" onclick="sendCommand('sendToTongyi')">通义灵码</button>
                <button class="button secondary" onclick="sendCommand('sendToCopilot')">GitHub Copilot</button>
                <button class="button secondary" onclick="sendCommand('sendToTrae')">TRAE AI</button>
                <button class="button secondary" onclick="sendCommand('sendToAI')">AI 助手</button>
            </div>
            
            <div class="action-group">
                <div class="action-group-title">其他</div>
                <button class="button secondary" onclick="sendCommand('removeFromRecent')">从最近使用中移除</button>
                <button class="button secondary" onclick="sendCommand('close')">关闭</button>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function sendCommand(command) {
            vscode.postMessage({ command: command });
        }
        
        // 处理图片加载错误
        document.addEventListener('DOMContentLoaded', function() {
            const images = document.querySelectorAll('.description img');
            images.forEach(img => {
                img.addEventListener('error', function() {
                    // 图片加载失败，显示提示
                    this.classList.add('img-error');
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'img-error-msg';
                    errorMsg.innerHTML = '⚠️ 图片加载失败（可能需要登录云效查看）: <a href="' + this.src + '" target="_blank" style="color: var(--vscode-textLink-foreground);">点击在浏览器打开</a>';
                    this.parentNode.insertBefore(errorMsg, this.nextSibling);
                });
                
                // 图片加载成功，添加点击放大功能
                img.addEventListener('load', function() {
                    this.style.cursor = 'pointer';
                    this.title = '点击在浏览器中查看大图';
                    this.addEventListener('click', function() {
                        window.open(this.src, '_blank');
                    });
                });
            });
        });
    </script>
</body>
</html>`;
}

module.exports = {
    getWorkItemPropertiesHtml
};
