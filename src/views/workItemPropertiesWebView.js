/**
 * 工作项属性WebView生成器
 * 负责生成工作项属性查看面板的HTML内容
 */

/**
 * 生成工作项属性WebView HTML
 * @param {Object} workitem - 工作项基础信息
 * @param {Object} details - 工作项详情（可选）
 * @param {Object} stateManager - 状态管理器
 * @param {Array} comments - 评论列表（可选）
 * @returns {string} HTML字符串
 */
function getWorkItemPropertiesHtml(workitem, details, stateManager, comments = []) {
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
    
    /**
     * 统一处理 htmlValue 内容
     * 适用于 description、comment.content 等字段
     * @param {*} content - 内容字段（可能是对象、JSON字符串或纯文本）
     * @param {string} defaultValue - 默认值
     * @returns {string} 处理后的 HTML 字符串
     */
    const extractHtmlValue = (content, defaultValue = '') => {
        if (!content) {
            return defaultValue;
        }
        
        // 如果是对象且有 htmlValue 属性
        if (typeof content === 'object' && content.htmlValue) {
            return content.htmlValue;
        }
        
        // 如果是字符串
        if (typeof content === 'string') {
            try {
                // 尝试解析为 JSON
                const parsed = JSON.parse(content);
                if (parsed.htmlValue) {
                    return parsed.htmlValue;
                }
            } catch (e) {
                // 不是有效的 JSON，按原始内容处理
                // 如果包含 HTML 标签，直接返回
                const hasHtmlTags = /<[^>]+>/.test(content);
                if (hasHtmlTags) {
                    return content;
                }
                // 纯文本，转义特殊字符后返回
                return content
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            }
        }
        
        return defaultValue;
    };
    
    // 检查描述是否包含htmlValue（处理对象或字符串格式）
    const hasDescriptionHtmlValue = () => {
        const htmlContent = extractHtmlValue(data.description);
        return htmlContent && htmlContent !== '无描述';
    };
    
    // 处理描述内容 - 使用统一的 extractHtmlValue 函数
    const getDescriptionContent = () => {
        return extractHtmlValue(data.description, '无描述');
    };
    
    // 处理评论内容 - 使用统一的 extractHtmlValue 函数
    const getCommentContent = (comment) => {
        if (!comment || !comment.content) {
            return '';
        }
        return extractHtmlValue(comment.content, '');
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
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            line-height: 1.6;
            display: flex;
            height: 100vh;
            overflow: hidden;
        }
        .container {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
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
            // width: 240px;
            // min-width: 240px;
            padding: 20px 16px;
            border-left: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBar-background);
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .action-group {
            margin-bottom: 24px;
        }
        .action-group-title {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 12px;
            color: var(--vscode-descriptionForeground);
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .button {
            display: block;
            width: 100%;
            padding: 10px 12px;
            margin-bottom: 8px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
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
        .json-view {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.8);
            z-index: 1000;
            padding: 40px;
            overflow: auto;
        }
        .json-view.active {
            display: block;
        }
        .json-container {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
            position: relative;
        }
        .json-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .json-title {
            font-size: 18px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .json-close {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        .json-close:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .json-content {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 16px;
            overflow: auto;
            max-height: calc(100vh - 200px);
        }
        .json-content pre {
            margin: 0;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            line-height: 1.6;
            color: var(--vscode-editor-foreground);
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .json-actions {
            margin-top: 16px;
            display: flex;
            gap: 8px;
        }
        .json-copy-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        .json-copy-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .comments-section {
            margin-bottom: 24px;
        }
        .comment-item {
            padding: 12px;
            margin-bottom: 12px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 4px;
        }
        .comment-item.top {
            border-left-color: #f59e0b;
            background-color: var(--vscode-inputValidation-warningBackground);
        }
        .comment-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .comment-user {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .comment-time {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .comment-content {
            line-height: 1.6;
            word-break: break-word;
        }
        .comment-content p {
            margin: 8px 0;
        }
        .comment-content ul, .comment-content ol {
            margin: 8px 0;
            padding-left: 24px;
        }
        .comment-content li {
            margin: 4px 0;
        }
        .comment-content img {
            max-width: 100%;
            height: auto;
            margin: 8px 0;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .comment-content pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
        }
        .comment-content code {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
        }
        .comment-content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .comment-content a:hover {
            text-decoration: underline;
        }
        .comment-top-badge {
            display: inline-block;
            padding: 2px 8px;
            background-color: #f59e0b;
            color: #fff;
            border-radius: 3px;
            font-size: 11px;
            margin-left: 8px;
        }
        .no-comments {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
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
                <div class="field-value">${data.workitemType?.name || data.workitemType || '加载中...'}</div>
            </div>
            <div class="field">
                <div class="field-label">编号：</div>
                <div class="field-value">${data.serialNumber || data.identifier || '加载中...'}</div>
            </div>
            <div class="field">
                <div class="field-label">状态：</div>
                <div class="field-value">${data.status?.displayName || data.status || '加载中...'}</div>
            </div>
            ${data.logicalStatus && data.logicalStatus === 'archived' ? `
                <div class="field">
                    <div class="field-label">逻辑状态：</div>
                    <div class="field-value">📦 已归档</div>
                </div>
            ` : ''}
            <div class="field">
                <div class="field-label">负责人：</div>
                <div class="field-value">${data.assignedTo?.name || '未指派'}</div>
            </div>
            ${data.creator?.name ? `
                <div class="field">
                    <div class="field-label">创建人：</div>
                    <div class="field-value">${data.creator.name}</div>
                </div>
            ` : ''}
            ${data.modifier?.name ? `
                <div class="field">
                    <div class="field-label">修改人：</div>
                    <div class="field-value">${data.modifier.name}</div>
                </div>
            ` : ''}
            ${data.verifier?.name ? `
                <div class="field">
                    <div class="field-label">验证人：</div>
                    <div class="field-value">${data.verifier.name}</div>
                </div>
            ` : ''}
            <div class="field">
                <div class="field-label">创建日期：</div>
                <div class="field-value">${formatDate(data.createdAt || data.gmtCreate)}</div>
            </div>
            <div class="field">
                <div class="field-label">更新日期：</div>
                <div class="field-value">${formatDate(data.updatedAt || data.gmtModified)}</div>
            </div>
            ${data.updateStatusAt ? `
                <div class="field">
                    <div class="field-label">状态更新时间：</div>
                    <div class="field-value">${formatDate(data.updateStatusAt)}</div>
                </div>
            ` : ''}
            ${data.sprint ? `
                <div class="field">
                    <div class="field-label">所属迭代：</div>
                    <div class="field-value">${data.sprint.name || data.sprint}</div>
                </div>
            ` : ''}
            ${data.space?.name ? `
                <div class="field">
                    <div class="field-label">所属空间：</div>
                    <div class="field-value">${data.space.name}</div>
                </div>
            ` : ''}
            ${data.parentId ? `
                <div class="field">
                    <div class="field-label">父工作项：</div>
                    <div class="field-value">${data.parentId}</div>
                </div>
            ` : ''}
        </div>
        
        ${data.participants && data.participants.length > 0 ? `
            <div class="section">
                <div class="section-title">参与人</div>
                <div class="field-value">${data.participants.map(p => p.name).join(', ')}</div>
            </div>
        ` : ''}
        
        ${data.trackers && data.trackers.length > 0 ? `
            <div class="section">
                <div class="section-title">跟踪人</div>
                <div class="field-value">${data.trackers.map(t => t.name).join(', ')}</div>
            </div>
        ` : ''}
        
        ${data.labels && data.labels.length > 0 ? `
            <div class="section">
                <div class="section-title">标签</div>
                <div class="field-value">${data.labels.map(l => `<span style="display: inline-block; padding: 2px 8px; margin: 2px; background-color: ${l.color || '#ccc'}; border-radius: 3px; font-size: 12px;">${l.name}</span>`).join('')}</div>
            </div>
        ` : ''}
        
        ${data.versions && data.versions.length > 0 ? `
            <div class="section">
                <div class="section-title">版本</div>
                <div class="field-value">${data.versions.map(v => v.name).join(', ')}</div>
            </div>
        ` : ''}
        
        ${data.customFieldValues && data.customFieldValues.length > 0 ? `
            <div class="section">
                <div class="section-title">自定义字段</div>
                ${data.customFieldValues.map(field => {
                    if (!field.values || field.values.length === 0) return '';
                    const displayValue = field.values.map(v => v.displayValue || v.identifier).filter(v => v).join(', ');
                    if (!displayValue) return '';
                    return `
                        <div class="field">
                            <div class="field-label">${field.fieldName}：</div>
                            <div class="field-value">${displayValue}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : ''}
        
        <div class="section">
            <div class="section-title">使用状态</div>
            <div class="field-value">${stateDesc.replace(/\n/g, '<br>')}</div>
        </div>
        
        ${details && hasDescriptionHtmlValue() && !hasError ? `
            <div class="section">
                <div class="section-title">描述</div>
                <div class="description">${getDescriptionContent()}</div>
            </div>
        ` : isLoading ? `
            <div class="loading">正在加载详细信息...</div>
        ` : ''}
                
        ${!isLoading && !hasError ? `
            <div class="section comments-section">
                <div class="section-title">评论 (${comments.length})</div>
                ${comments.length > 0 ? comments.map(comment => `
                    <div class="comment-item${comment.top ? ' top' : ''}">
                        <div class="comment-header">
                            <div>
                                <span class="comment-user">${comment.user?.name || '匿名用户'}</span>
                                ${comment.top ? '<span class="comment-top-badge">置顶</span>' : ''}
                            </div>
                            <span class="comment-time">${formatDate(comment.gmtCreate)}</span>
                        </div>
                        <div class="comment-content">${getCommentContent(comment)}</div>
                    </div>
                `).join('') : `
                    <div class="no-comments">暂无评论</div>
                `}
            </div>
        ` : ''}
    </div>
    
    <div class="actions">
            <div class="action-group">
                <div class="action-group-title">主要操作</div>
                <button class="button" onclick="sendCommand('createBranch')">新建分支并粘贴</button>
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
                <button class="button secondary" onclick="toggleJsonView()">详细信息 (JSON)</button>
            </div>
        </div>
    
    <div class="json-view" id="jsonView">
        <div class="json-container">
            <div class="json-header">
                <div class="json-title">工作项详细信息 (JSON)</div>
                <button class="json-close" onclick="toggleJsonView()">关闭</button>
            </div>
            <div class="json-content">
                <pre id="jsonData"></pre>
            </div>
            <div class="json-actions">
                <button class="json-copy-btn" onclick="copyJsonToClipboard()">复制 JSON</button>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        // 工作项数据
        const workitemData = ${JSON.stringify(data, null, 2)};
        
        function toggleJsonView() {
            const jsonView = document.getElementById('jsonView');
            const jsonData = document.getElementById('jsonData');
            
            if (jsonView.classList.contains('active')) {
                jsonView.classList.remove('active');
            } else {
                jsonData.textContent = JSON.stringify(workitemData, null, 2);
                jsonView.classList.add('active');
            }
        }
        
        function copyJsonToClipboard() {
            const jsonText = JSON.stringify(workitemData, null, 2);
            navigator.clipboard.writeText(jsonText).then(() => {
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '已复制!';
                btn.style.backgroundColor = 'var(--vscode-button-background)';
                btn.style.color = 'var(--vscode-button-foreground)';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.backgroundColor = '';
                    btn.style.color = '';
                }, 2000);
            }).catch(err => {
                console.error('复制失败:', err);
                alert('复制失败，请手动复制');
            });
        }
        
        function sendCommand(command) {
            vscode.postMessage({ command: command });
        }
        
        // ESC键关闭JSON视图
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const jsonView = document.getElementById('jsonView');
                if (jsonView.classList.contains('active')) {
                    toggleJsonView();
                }
            }
        });
        
        // 点击背景关闭JSON视图
        document.getElementById('jsonView').addEventListener('click', function(e) {
            if (e.target === this) {
                toggleJsonView();
            }
        });
        
        // 处理图片加载错误
        document.addEventListener('DOMContentLoaded', function() {
            const images = document.querySelectorAll('.description img');
            images.forEach(img => {
                img.addEventListener('error', function() {
                    // 图片加载失败，显示提示
                    this.classList.add('img-error');
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'img-error-msg';
                    // 构建工作项链接，与openInBrowser命令使用相同格式
                    const category = '${data.category || data.categoryIdentifier || data.workitemType || "workitem"}' || 'workitem';
                    const identifier = '${data.identifier || data.workitemId}' || 'unknown';
                    const subject = '${data.subject || ""}' || '';
                    const encodedSubject = encodeURIComponent(' ' + subject);
                    const workItemLink = 'https://devops.aliyun.com/projex/' + category + '/' + identifier + '#' + encodedSubject;
                    errorMsg.innerHTML = '⚠️ 图片加载失败（可能需要登录云效查看）: <a href="' + workItemLink + '" target="_blank" style="color: var(--vscode-textLink-foreground);">在浏览器中打开工作项</a>';
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
