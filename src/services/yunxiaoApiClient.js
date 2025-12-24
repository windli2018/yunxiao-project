const axios = require('axios');
const vscode = require('vscode');
const { getCategoryName } = require('../config/workitemTypes');

/**
 * 必需的云效 PAT 令牌权限列表
 * 按照云效API权限结构定义，展示到资源层级
 */
const REQUIRED_PERMISSIONS = {
    // 组织管理相关权限
    BASE: {
        appName: '组织管理',
        resources: [
            { name: '用户', permission: '只读' },
            { name: '组织成员', permission: '只读' }
        ]
    },
    // 项目协作相关权限
    PROJEX: {
        appName: '项目协作',
        resources: [
            { name: '项目', permission: '只读' },
            { name: '工作项', permission: '只读' }
        ]
    },
    // 代码管理相关权限
    CODEUP: {
        appName: '代码管理',
        resources: [
            { name: '代码组', permission: '只读' },
            { name: '代码仓库', permission: '只读' },
            { name: '分支', permission: '只读' },
            { name: '合并请求', permission: '读写' }
        ]
    },
    
    // 格式化单个应用的权限文本（格式：appName(资源1-权限1、资源2-权限2)）
    formatAppPermissions(app) {
        // 如果没有资源，返回空字符串
        if (!app.resources || app.resources.length === 0) {
            return '';
        }
        const items = app.resources.map(r => `${r.name}-${r.permission}`);
        return `${app.appName}(${items.join('、')})`;
    },
    
    // 获取所有权限的组合文本
    getAllText() {
        const apps = [
            this.formatAppPermissions(this.BASE),
            this.formatAppPermissions(this.PROJEX),
            this.formatAppPermissions(this.CODEUP)
        ].filter(text => text); // 过滤掉空字符串
        return '需要以下权限：' + apps.join('、');
    },
    
    // 仅获取项目管理权限文本（组织管理 + 项目协作）
    getProjectText() {
        const apps = [
            this.formatAppPermissions(this.BASE),
            this.formatAppPermissions(this.PROJEX)
        ].filter(text => text); // 过滤掉空字符串
        return '需要以下权限：' + apps.join('、');
    },
    
    // 仅获取代码管理权限文本
    getCodeText() {
        const text = this.formatAppPermissions(this.CODEUP);
        return text ? '需要以下权限：' + text : '需要以下权限：';
    }
};

/**
 * 云效 API 客户端
 */
class YunxiaoApiClient {
    constructor(domain) {
        this.domain = domain;
        this.accessToken = '';
        this.organizationId = '';
        
        this.axiosInstance = axios.create({
            baseURL: `https://${domain}`,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // 请求拦截器
        this.axiosInstance.interceptors.request.use(
            (config) => {
                if (this.accessToken) {
                    // 云效使用 x-yunxiao-token 作为认证 header
                    config.headers['x-yunxiao-token'] = this.accessToken;
                }
                return config;
            },
            (error) => {
                return Promise.reject(error);
            }
        );

        // 响应拦截器
        this.axiosInstance.interceptors.response.use(
            (response) => {
                return response;
            },
            async (error) => {
                // 提取云效API返回的详细错误信息
                const responseData = error.response?.data;
                const errorMessage = responseData?.errorMessage 
                    || responseData?.errorMsg 
                    || responseData?.message 
                    || '';
                const errorDescription = responseData?.errorDescription || '';
                const errorCode = responseData?.errorCode || responseData?.code || '';
                
                if (error.response?.status === 401) {
                    // 认证失败，需要重新登录
                    const msg = errorMessage || '认证失败，请重新登录';
                    throw new Error(msg);
                } else if (error.response?.status === 403) {
                    // 权限不足错误，判断API类型并添加标记
                    const url = error.config?.url || '';
                    const isCodeApi = url.includes('/codeup/') || 
                                     url.includes('/repositories') || 
                                     url.includes('/branches') || 
                                     url.includes('/changeRequests');
                    
                    const err = new Error(errorMessage || '权限不足');
                    err.code = 'PERMISSION_DENIED';
                    err.status = 403;
                    err.url = url;
                    err.isCodeApi = isCodeApi;
                    err.errorCode = errorCode;
                    err.errorDescription = errorDescription;
                    err.responseData = responseData;  // 保存完整的响应数据
                    throw err;
                } else if (error.response?.status === 429) {
                    // 请求限流
                    const msg = errorMessage || '请求过于频繁，请稍后重试';
                    throw new Error(msg);
                } else if (error.response?.status === 409) {
                    // 冲突错误（如创建MR时已存在）
                    const err = new Error(errorMessage || '操作冲突');
                    err.status = 409;
                    err.errorCode = errorCode;
                    err.errorDescription = errorDescription;
                    err.responseData = responseData;
                    throw err;
                } else if (error.code === 'ECONNABORTED') {
                    // 超时
                    throw new Error('请求超时，请检查网络连接');
                } else {
                    // 其他错误，尝试提取详细信息
                    if (errorMessage) {
                        const originalMsg = error.message || '';
                        error.message = `${originalMsg}${originalMsg && errorMessage ? ' - ' : ''}${errorMessage}`;
                    }
                    if (responseData) {
                        error.responseData = responseData;
                        error.errorCode = errorCode;
                        error.errorDescription = errorDescription;
                    }
                    throw error;
                }
            }
        );
    }

    /**
     * 设置认证信息
     */
    setAuth(accessToken, organizationId) {
        this.accessToken = accessToken;
        this.organizationId = organizationId;
    }

    /**
     * 清除认证信息
     */
    clearAuth() {
        this.accessToken = '';
        this.organizationId = '';
    }

    /**
     * 统一处理403权限错误
     * @param {Error} error - 错误对象
     */
    async handle403Error(error) {
        if (error.code === 'PERMISSION_DENIED' && error.status === 403) {
            // 根据API类型选择权限提示
            let permissionText;
            if (error.isCodeApi) {
                // 代码管理API：显示所有权限
                permissionText = REQUIRED_PERMISSIONS.getAllText();
            } else {
                // 项目管理API：仅显示项目管理权限
                permissionText = REQUIRED_PERMISSIONS.getProjectText();
            }

            const selection = await vscode.window.showErrorMessage(
                `您的个人访问令牌缺少必要的权限。\n\n${permissionText}`,
                '打开令牌设置',
                '取消'
            );

            if (selection === '打开令牌设置') {
                vscode.env.openExternal(vscode.Uri.parse('https://account-devops.aliyun.com/settings/personalAccessToken'));
            }
        }
    }

    /**
     * 获取项目列表
     */
    async getProjects(page = { page: 1, pageSize: 50 }) {
        try {
            // 使用云效 Projex API 的 projects:search 端点
            const response = await this.axiosInstance.post(
                `/oapi/v1/projex/organizations/${this.organizationId}/projects:search`,
                {
                    conditions: "",  // 空条件表示获取所有项目
                    extraConditions: "",
                    orderBy: "gmtCreate",
                    page: page.page,
                    perPage: page.pageSize,
                    sort: "desc"
                }
            );

            const data = response.data;
            const projects = (data || []).map((item) => ({
                projectId: item.identifier || item.id,
                projectName: item.name,
                description: item.description,
                icon: item.icon || item.logo,
                createTime: item.gmtCreate ? new Date(item.gmtCreate).getTime() : undefined,
                modifiedTime: item.gmtModified ? new Date(item.gmtModified).getTime() : undefined,
                memberCount: item.memberCount,
                status: item.status,
                customCode: item.customCode,
                isFavorite: false // 需要单独查询收藏状态
            }));

            return {
                items: projects,
                total: data.total || projects.length,
                page: page.page,
                pageSize: page.pageSize,
                hasMore: (data.total || 0) > page.page * page.pageSize
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取项目列表失败: ${error.message}`);
        }
    }

    /**
     * 获取项目详情
     */
    async getProject(projectId) {
        try {
            const response = await this.axiosInstance.get(
                `/api/organization/${this.organizationId}/projects/${projectId}`
            );

            const item = response.data.result || response.data;
            return {
                projectId: item.identifier || item.id,
                projectName: item.name,
                description: item.description,
                icon: item.icon || item.logo,
                createTime: item.gmtCreate ? new Date(item.gmtCreate).getTime() : undefined,
                modifiedTime: item.gmtModified ? new Date(item.gmtModified).getTime() : undefined,
                memberCount: item.memberCount,
                isFavorite: false
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取项目详情失败: ${error.message}`);
        }
    }

    /**
     * 获取工作项列表
     * 
     * 使用 SearchWorkitems API 获取指定项目的工作项
     */
    async getWorkItems(projectId, page = { page: 1, pageSize: 50 }) {
        try {
            const response = await this.axiosInstance.post(
                `/oapi/v1/projex/organizations/${this.organizationId}/workitems:search`,
                {
                    spaceId: projectId,
                    category: 'Req,Bug,Task', // 空表示获取所有类型的工作项
                    // conditions: '',
                    orderBy: 'gmtCreate',
                    page: page.page,
                    perPage: page.pageSize,
                    sort: 'desc'
                }
            );

            const data = response.data;
            const workitems = (Array.isArray(data) ? data : []).map((item) => ({
                workitemId: item.id,
                identifier: item.serialNumber,
                subject: item.subject,
                workitemType: item.workitemType?.name || item.categoryId,
                category: item.categoryId,
                status: item.status?.displayName || item.status?.name,
                assignedTo: item.assignedTo ? {
                    id: item.assignedTo.id,
                    name: item.assignedTo.name
                } : undefined,
                priority: item.priority,
                tags: item.labels ? item.labels.map(label => label.name) : [],
                createdAt: item.gmtCreate ? new Date(item.gmtCreate).getTime() : undefined,
                updatedAt: item.gmtModified ? new Date(item.gmtModified).getTime() : undefined,
                projectId: projectId
            }));

            // 从响应头获取分页信息
            const headers = response.headers;
            const total = parseInt(headers['x-total'] || '0');
            const totalPages = parseInt(headers['x-total-pages'] || '1');

            return {
                items: workitems,
                total: total || workitems.length,
                page: page.page,
                pageSize: page.pageSize,
                hasMore: page.page < totalPages
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取工作项列表失败: ${error.message}`);
        }
    }

    /**
     * 获取工作项详情
     * 
     * 使用 GetWorkitem API 获取单个工作项的详细信息
     */
    async getWorkItem(workitemId) {
        try {
            const response = await this.axiosInstance.get(
                `/oapi/v1/projex/organizations/${this.organizationId}/workitems/${workitemId}`
            );

            const item = response.data;
            return {
                workitemId: item.id,
                identifier: item.serialNumber,
                subject: item.subject,
                description: item.description,
                workitemType: item.workitemType?.name || item.categoryId,
                status: item.status?.displayName || item.status?.name,
                assignedTo: item.assignedTo ? {
                    id: item.assignedTo.id,
                    name: item.assignedTo.name
                } : undefined,
                creator: item.creator ? {
                    id: item.creator.id,
                    name: item.creator.name
                } : undefined,
                modifier: item.modifier ? {
                    id: item.modifier.id,
                    name: item.modifier.name
                } : undefined,
                priority: item.priority,
                category: item.categoryId,
                tags: item.labels ? item.labels.map(label => label.name) : [],
                createdAt: item.gmtCreate ? new Date(item.gmtCreate).getTime() : undefined,
                updatedAt: item.gmtModified ? new Date(item.gmtModified).getTime() : undefined,
                projectId: item.space?.id || '',
                sprint: item.sprint,
                participants: item.participants || [],
                customFieldValues: item.customFieldValues || [],
                formatType: item.formatType
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取工作项详情失败: ${error.message}`);
        }
    }

    /**
     * 搜索工作项
     * 
     * 使用 SearchWorkitems API 进行高级搜索
     */
    async searchWorkItems(projectId, filter, page = { page: 1, pageSize: 50 }) {
        try {
            // 构建过滤条件
            // conditionGroups 是 OR 关系，每个 group 内部是 AND 关系
            const conditionGroups = [];

            // 如果有 identifier，优先使用 serialNumber 精确匹配
            if (filter.identifier) {
                conditionGroups.push([{
                    fieldIdentifier: 'serialNumber',
                    operator: 'EQUAL',
                    value: [filter.identifier],
                    className: 'string',
                    toValue: null,
                    format: 'input'
                }]);
            } else if (filter.keyword) {
                // 关键词搜索：同时在 subject 和 description 中搜索
                // 创建两个条件组（OR 关系）：匹配 subject 或 description
                conditionGroups.push([{
                    fieldIdentifier: 'subject',
                    operator: 'CONTAINS',
                    value: [filter.keyword],
                    className: 'string',
                    toValue: null,
                    format: 'input'
                }]);
                conditionGroups.push([{
                    fieldIdentifier: 'description',
                    operator: 'CONTAINS',
                    value: [filter.keyword],
                    className: 'string',
                    toValue: null,
                    format: 'input'
                }]);
            }

            // 添加其他过滤条件（如果有）
            const additionalConditions = [];
            
            if (filter.statuses && filter.statuses.length > 0) {
                additionalConditions.push({
                    fieldIdentifier: 'status',
                    operator: 'CONTAINS',
                    value: filter.statuses,
                    className: 'status',
                    format: 'list'
                });
            }

            if (filter.assignedTo) {
                additionalConditions.push({
                    fieldIdentifier: 'assignedTo',
                    operator: 'EQUAL',
                    value: [filter.assignedTo],
                    className: 'assignedTo',
                    format: 'user'
                });
            }
            
            // 如果有附加条件，将它们添加到每个 conditionGroup 中（AND 关系）
            if (additionalConditions.length > 0 && conditionGroups.length > 0) {
                conditionGroups.forEach(group => {
                    group.push(...additionalConditions);
                });
            } else if (additionalConditions.length > 0) {
                // 如果没有 keyword/identifier，但有其他条件
                conditionGroups.push(additionalConditions);
            }

            const conditions = conditionGroups.length > 0 
                ? JSON.stringify({ conditionGroups }) 
                : '';

            // 设置 category（工作项类型）
            // 如果没有指定，则自动加上所有 category: Req,Bug,Task,Risk,SubTask
            const { getAllCategoryIds } = require('../config/workitemTypes');
            const category = filter.workitemTypes && filter.workitemTypes.length > 0
                ? filter.workitemTypes.join(',')
                : getAllCategoryIds().join(',');  // 默认包含所有类型

            const response = await this.axiosInstance.post(
                `/oapi/v1/projex/organizations/${this.organizationId}/workitems:search`,
                {
                    spaceId: projectId,
                    category: category,
                    conditions: conditions,
                    orderBy: 'gmtCreate',
                    page: page.page,
                    perPage: page.pageSize,
                    sort: 'desc'
                }
            );

            const data = response.data;
            const workitems = (Array.isArray(data) ? data : []).map((item) => {
                // 使用统一的类型映射配置
                const categoryId = item.categoryId || item.category;
                const categoryName = getCategoryName(categoryId);
                
                return {
                    workitemId: item.id,
                    identifier: item.serialNumber,
                    subject: item.subject,
                    category: categoryId,
                    workitemType: categoryName,  // 使用 categoryMap 映射的中文名称
                    workitemTypeName: item.workitemType?.name,  // 保存 API 返回的原始类型名称，作为次级分类
                    status: item.status?.displayName || item.status?.name,
                    assignedTo: item.assignedTo ? {
                        id: item.assignedTo.id,
                        name: item.assignedTo.name
                    } : undefined,
                    priority: item.priority,
                    tags: item.labels ? item.labels.map(label => label.name) : [],
                    createdAt: item.gmtCreate ? new Date(item.gmtCreate).getTime() : undefined,
                    updatedAt: item.gmtModified ? new Date(item.gmtModified).getTime() : undefined,
                    projectId: projectId
                };
            });

            // 从响应头获取分页信息
            const headers = response.headers;
            const total = parseInt(headers['x-total'] || headers['X-Total'] || '0');
            const totalPages = parseInt(headers['x-total-pages'] || headers['X-Total-Pages'] || '1');
            
            // 如果没有响应头，尝试从响应体中获取
            let actualTotal = total;
            let actualHasMore = page.page < totalPages;
            
            // 如果 total 为 0，但有数据返回，则使用启发式判断
            if (actualTotal === 0 && workitems.length > 0) {
                actualTotal = workitems.length;
                // 如果返回的数据等于请求的 pageSize，则可能还有更多
                actualHasMore = workitems.length === page.pageSize;
            }

            return {
                items: workitems,
                total: actualTotal,
                page: page.page,
                pageSize: page.pageSize,
                hasMore: actualHasMore
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`搜索工作项失败: ${error.message}`);
        }
    }

    /**
     * 获取工作项类型配置
     */
    async getWorkItemTypes(projectId) {
        try {
            const response = await this.axiosInstance.get(
                `/api/organization/${this.organizationId}/projects/${projectId}/workitem-types`
            );
            const data = response.data;
            return (data.workitemTypes || []).map((item) => ({
                typeId: item.identifier,
                typeName: item.name,
                icon: item.icon,
                description: item.description
            }));
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取工作项类型失败: ${error.message}`);
        }
    }

    /**
     * 验证令牌有效性
     * 
     * 云效没有专门的验证令牌 API，这里通过获取项目列表来验证
     * 如果令牌有效且有权限访问，则返回 true
     */
    async validateToken() {
        try {
            // 使用项目搜索 API 验证令牌
            // 使用最小的请求参数减少开销
            const response = await this.axiosInstance.post(
                `/oapi/v1/projex/organizations/${this.organizationId}/projects:search`,
                {
                    conditions: "",
                    extraConditions: "",
                    orderBy: "gmtCreate",
                    page: 1,
                    perPage: 1,  // 只获取1条数据，减少网络开销
                    sort: "desc"
                }
            );
            console.log('令牌验证成功');
            return response.status === 200;
        } catch (error) {
            // 如果返回 401/403，说明令牌无效或无权限
            if (error.response?.status === 401 || error.response?.status === 403) {
                console.error('令牌无效或无权限');
                return false;
            }
            // 如果返回 404，说明组织不存在或 API 端点不存在
            if (error.response?.status === 404) {
                console.warn('组织 ID 不存在或无权访问，请检查配置的 organizationId');
                return false;
            }
            // 其他错误（网络问题等）也返回 false
            console.error('验证令牌失败:', error.message);
            return false;
        }
    }

    /**
     * 获取当前用户信息
     * 
     * 根据个人访问令牌查询对应用户信息
     */
    async getCurrentUser() {
        try {
            const response = await this.axiosInstance.get(
                '/oapi/v1/platform/user'
            );
            
            const user = response.data;
            return {
                id: user.id,
                username: user.username,
                name: user.name,
                nickName: user.nickName,
                email: user.email,
                staffId: user.staffId,
                lastOrganization: user.lastOrganization,
                sysDeptIds: user.sysDeptIds || [],
                createdAt: user.createdAt,
                authenticated: true
            };
        } catch (error) {
            throw new Error(`获取用户信息失败: ${error.response?.data?.errorMessage || error.message}`);
        }
    }

    /**
     * 获取工作项评论列表
     * 
     * @param {string} workitemId - 工作项唯一标识
     * @returns {Promise<Array>} 评论列表
     */
    async getWorkItemComments(workitemId) {
        try {
            const response = await this.axiosInstance.get(
                `/oapi/v1/projex/organizations/${this.organizationId}/workitems/${workitemId}/comments`
            );
            
            const comments = response.data || [];
            return comments.map(comment => ({
                id: comment.id,
                content: comment.content,
                contentFormat: comment.contentFormat, // RICHTEXT 或 MARKDOWN
                parentId: comment.parentId,
                top: comment.top,
                topTime: comment.topTime,
                gmtCreate: comment.gmtCreate ? new Date(comment.gmtCreate).getTime() : undefined,
                gmtModified: comment.gmtModified ? new Date(comment.gmtModified).getTime() : undefined,
                user: comment.user ? {
                    id: comment.user.id,
                    name: comment.user.name
                } : undefined
            }));
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取工作项评论失败: ${error.message}`);
        }
    }

    /**
     * 获取代码分组列表
     * 
     * @param {Object} params - 查询参数
     * @param {number} params.parentId - 父分组ID，查询组织下的顶级分组时可为空
     * @param {number} params.page - 页码，默认1
     * @param {number} params.perPage - 每页大小，默认20
     * @param {string} params.search - 搜索关键字
     * @param {string} params.orderBy - 排序字段（created_at/updated_at），默认updated_at
     * @param {string} params.sort - 排序方式（asc/desc），默认desc
     * @returns {Promise<Object>} 分组列表及分页信息
     */
    async getCodeGroups(params = {}) {
        try {
            const { parentId, page = 1, perPage = 20, search, orderBy = 'updated_at', sort = 'desc' } = params;
            
            const queryParams = new URLSearchParams();
            if (parentId !== undefined && parentId !== null) {
                queryParams.append('parentId', parentId);
            }
            queryParams.append('page', page);
            queryParams.append('perPage', perPage);
            if (search) {
                queryParams.append('search', search);
            }
            queryParams.append('orderBy', orderBy);
            queryParams.append('sort', sort);

            const response = await this.axiosInstance.get(
                `/oapi/v1/codeup/organizations/${this.organizationId}/namespaces?${queryParams.toString()}`
            );

            const data = response.data || [];
            const groups = data.map(item => ({
                id: item.id,
                name: item.name,
                path: item.path,
                fullPath: item.fullPath,
                nameWithNamespace: item.nameWithNamespace,
                pathWithNamespace: item.pathWithNamespace,
                parentId: item.parentId,
                avatarUrl: item.avatarUrl,
                visibility: item.visibility,
                webUrl: item.webUrl,
                isFavorite: false  // 本地状态
            }));

            // 从响应头获取分页信息
            const headers = response.headers;
            const total = parseInt(headers['x-total'] || headers['X-Total'] || '0');
            const totalPages = parseInt(headers['x-total-pages'] || headers['X-Total-Pages'] || '1');

            return {
                items: groups,
                total: total || groups.length,
                page: page,
                pageSize: perPage,
                hasMore: page < totalPages
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取代码分组列表失败: ${error.message}`);
        }
    }

    /**
     * 获取代码分组详情
     * 
     * @param {number} groupId - 分组ID
     * @returns {Promise<Object>} 分组详情
     */
    async getCodeGroupById(groupId) {
        try {
            const response = await this.axiosInstance.get(
                `/oapi/v1/codeup/organizations/${this.organizationId}/namespaces/${groupId}`
            );

            const item = response.data;
            return {
                id: item.id,
                name: item.name,
                path: item.path,
                fullPath: item.fullPath,
                nameWithNamespace: item.nameWithNamespace,
                pathWithNamespace: item.pathWithNamespace,
                parentId: item.parentId,
                avatarUrl: item.avatarUrl,
                visibility: item.visibility,
                webUrl: item.webUrl,
                isFavorite: false  // 本地状态
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取代码分组详情失败: ${error.message}`);
        }
    }

    /**
     * 获取子分组列表
     * 
     * @param {number} parentId - 父分组ID
     * @param {Object} page - 分页参数
     * @returns {Promise<Object>} 子分组列表及分页信息
     */
    async getSubGroups(parentId, page = { page: 1, pageSize: 20 }) {
        return this.getCodeGroups({
            parentId: parentId,
            page: page.page,
            perPage: page.pageSize
        });
    }

    /**
     * 获取代码仓库列表
     * 
     * @param {Object} params - 查询参数
     * @param {number} params.page - 页码，默认1
     * @param {number} params.perPage - 每页大小，默认20
     * @param {string} params.search - 搜索关键字，模糊匹配代码库路径
     * @param {boolean} params.archived - 是否归档
     * @param {string} params.orderBy - 排序字段，默认created_at
     * @param {string} params.sort - 排序方式，默认desc
     * @returns {Promise<Object>} 仓库列表及分页信息
     */
    async getCodeRepositories(params = {}) {
        try {
            const { page = 1, perPage = 20, search, archived, orderBy = 'created_at', sort = 'desc' } = params;
            
            const queryParams = new URLSearchParams();
            queryParams.append('page', page);
            queryParams.append('perPage', perPage);
            if (search) {
                queryParams.append('search', search);
            }
            if (archived !== undefined) {
                queryParams.append('archived', archived);
            }
            queryParams.append('orderBy', orderBy);
            queryParams.append('sort', sort);

            const response = await this.axiosInstance.get(
                `/oapi/v1/codeup/organizations/${this.organizationId}/repositories?${queryParams.toString()}`
            );

            const data = response.data || [];
            const repositories = data.map(item => ({
                id: item.id,
                name: item.name,
                path: item.path,
                nameWithNamespace: item.nameWithNamespace,
                pathWithNamespace: item.pathWithNamespace,
                namespaceId: item.namespaceId,
                description: item.description,
                avatarUrl: item.avatarUrl,
                visibility: item.visibility,
                archived: item.archived,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                lastActivityAt: item.lastActivityAt,
                repositorySize: item.repositorySize,
                starred: item.starred,
                starCount: item.starCount,
                webUrl: item.webUrl,
                accessLevel: item.accessLevel,
                isFavorite: false  // 本地状态
            }));

            // 从响应头获取分页信息
            const headers = response.headers;
            const total = parseInt(headers['x-total'] || headers['X-Total'] || '0');
            const totalPages = parseInt(headers['x-total-pages'] || headers['X-Total-Pages'] || '1');

            return {
                items: repositories,
                total: total || repositories.length,
                page: page,
                pageSize: perPage,
                hasMore: page < totalPages
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取代码仓库列表失败: ${error.message}`);
        }
    }

    /**
     * 获取分组下的代码仓库列表
     * 
     * @param {number} groupId - 代码组ID
     * @param {Object} page - 分页参数
     * @returns {Promise<Object>} 仓库列表及分页信息
     */
    async getCodeRepositoriesByGroup(groupId, page = { page: 1, pageSize: 50 }) {
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('page', page.page);
            queryParams.append('perPage', page.pageSize);

            const response = await this.axiosInstance.get(
                `/oapi/v1/codeup/organizations/${this.organizationId}/groups/${groupId}/repositories?${queryParams.toString()}`
            );

            const data = response.data || [];
            const repositories = data.map(item => ({
                id: item.id,
                name: item.name,
                path: item.path,
                nameWithNamespace: item.nameWithNamespace,
                pathWithNamespace: item.pathWithNamespace,
                namespaceId: item.namespaceId,
                description: item.description,
                avatarUrl: item.avatarUrl,
                visibility: item.visibility,
                archived: item.archived,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                lastActivityAt: item.lastActivityAt,
                repositorySize: item.repositorySize,
                starred: item.starred,
                starCount: item.starCount,
                webUrl: item.webUrl,
                accessLevel: item.accessLevel,
                isFavorite: false  // 本地状态
            }));

            // 从响应头获取分页信息
            const headers = response.headers;
            const total = parseInt(headers['x-total'] || headers['X-Total'] || '0');
            const totalPages = parseInt(headers['x-total-pages'] || headers['X-Total-Pages'] || '1');

            return {
                items: repositories,
                total: total || repositories.length,
                page: page.page,
                pageSize: page.pageSize,
                hasMore: page.page < totalPages
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取分组下的代码仓库列表失败: ${error.message}`);
        }
    }

    /**
     * 获取代码仓库详情
     * 
     * @param {number} repoId - 仓库ID
     * @returns {Promise<Object>} 仓库详情
     */
    async getCodeRepositoryById(repoId) {
        try {
            const response = await this.axiosInstance.get(
                `/oapi/v1/codeup/organizations/${this.organizationId}/repositories/${repoId}`
            );

            const item = response.data;
            return {
                id: item.id,
                name: item.name,
                path: item.path,
                nameWithNamespace: item.nameWithNamespace,
                pathWithNamespace: item.pathWithNamespace,
                namespaceId: item.namespaceId,
                description: item.description,
                avatarUrl: item.avatarUrl,
                visibility: item.visibility,
                archived: item.archived,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                lastActivityAt: item.lastActivityAt,
                repositorySize: item.repositorySize,
                starred: item.starred,
                starCount: item.starCount,
                webUrl: item.webUrl,
                accessLevel: item.accessLevel,
                httpUrlToRepo: item.httpUrlToRepo,  // HTTP克隆URL
                sshUrlToRepo: item.sshUrlToRepo,    // SSH克隆URL
                defaultBranch: item.defaultBranch,  // 默认分支
                isFavorite: false  // 本地状态
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取代码仓库详情失败: ${error.message}`);
        }
    }

    /**
     * 获取代码分支列表
     * 
     * @param {number} repoId - 仓库ID
     * @param {Object} params - 查询参数
     * @param {number} params.page - 页码
     * @param {number} params.perPage - 每页大小
     * @param {string} params.sort - 排序方式（name_asc/name_desc/updated_asc/updated_desc）
     * @param {string} params.search - 查询条件
     * @returns {Promise<Object>} 分支列表及分页信息
     */
    async getCodeBranches(repoId, params = {}) {
        try {
            const { page = 1, perPage = 20, sort, search } = params;
            
            const queryParams = new URLSearchParams();
            queryParams.append('page', page);
            queryParams.append('perPage', perPage);
            if (sort) {
                queryParams.append('sort', sort);
            }
            if (search) {
                queryParams.append('search', search);
            }

            const response = await this.axiosInstance.get(
                `/oapi/v1/codeup/organizations/${this.organizationId}/repositories/${repoId}/branches?${queryParams.toString()}`
            );

            const data = response.data || [];
            const branches = data.map(item => ({
                name: item.name,
                repositoryId: repoId,
                defaultBranch: item.defaultBranch,
                protected: item.protected,
                webUrl: item.webUrl,
                commit: item.commit ? {
                    id: item.commit.id,
                    shortId: item.commit.shortId,
                    title: item.commit.title,
                    message: item.commit.message,
                    authorName: item.commit.authorName,
                    authorEmail: item.commit.authorEmail,
                    authoredDate: item.commit.authoredDate,
                    committerName: item.commit.committerName,
                    committerEmail: item.commit.committerEmail,
                    committedDate: item.commit.committedDate
                } : null,
                isFavorite: false  // 本地状态
            }));

            // 从响应头获取分页信息
            const headers = response.headers;
            const total = parseInt(headers['x-total'] || headers['X-Total'] || '0');
            const totalPages = parseInt(headers['x-total-pages'] || headers['X-Total-Pages'] || '1');

            return {
                items: branches,
                total: total || branches.length,
                page: page,
                pageSize: perPage,
                hasMore: page < totalPages
            };
        } catch (error) {
            await this.handle403Error(error);
            throw new Error(`获取代码分支列表失败: ${error.message}`);
        }
    }

    /**
     * 创建合并请求
     * 
     * @param {number} repoId - 仓库ID
     * @param {Object} params - 合并请求参数
     * @param {string} params.sourceBranch - 源分支名称
     * @param {number} params.sourceProjectId - 源仓库ID
     * @param {string} params.targetBranch - 目标分支名称
     * @param {number} params.targetProjectId - 目标仓库ID
     * @param {string} params.title - 合并请求标题（不超过256字符）
     * @param {string} params.description - 合并请求描述（不超过10000字符）
     * @param {Array<string>} params.reviewerUserIds - 评审人用户ID列表
     * @param {Array<string>} params.workItemIds - 关联工作项ID列表
     * @returns {Promise<Object>} 创建的合并请求
     */
    async createMergeRequest(repoId, params) {
        try {
            // 参数校验
            if (!params.sourceBranch) {
                throw new Error('源分支不能为空');
            }
            if (!params.targetBranch) {
                throw new Error('目标分支不能为空');
            }
            if (!params.title) {
                throw new Error('标题不能为空');
            }
            if (params.title.length > 256) {
                throw new Error('标题长度不能超过256字符');
            }
            if (params.description && params.description.length > 10000) {
                throw new Error('描述长度不能超过10000字符');
            }
            if (params.sourceBranch === params.targetBranch) {
                throw new Error('源分支和目标分支不能相同');
            }

            const requestBody = {
                sourceBranch: params.sourceBranch,
                sourceProjectId: parseInt(params.sourceProjectId || repoId, 10),
                targetBranch: params.targetBranch,
                targetProjectId: parseInt(params.targetProjectId || repoId, 10),
                title: params.title,
                description: params.description || '',
                reviewerUserIds: params.reviewerUserIds || [],
                workItemIds: params.workItemIds || [],
                triggerAIReviewRun: params.triggerAIReviewRun || false
            };
            
            // 调试日志：输出请求参数
            console.log('[CreateMergeRequest] Request Body:', JSON.stringify(requestBody, null, 2));
            console.log('[CreateMergeRequest] RepoId:', repoId, 'Type:', typeof repoId);

            const response = await this.axiosInstance.post(
                `/oapi/v1/codeup/organizations/${this.organizationId}/repositories/${repoId}/changeRequests`,
                requestBody
            );

            const mrData = response.data;
            
            // 如果API返回的webUrl不正确或为空，需要手动构建URL
            // URL格式: https://codeup.aliyun.com/{orgId}/{路径}/change/{localId}
            if (!mrData.detailUrl || mrData.detailUrl === '""') {
                // 获取仓库信息以构建完整URL
                try {
                    const repoResponse = await this.axiosInstance.get(
                        `/oapi/v1/codeup/organizations/${this.organizationId}/repositories/${repoId}`
                    );
                    const repo = repoResponse.data;
                    
                    // 构建合并请求详情URL
                    // 格式: https://codeup.aliyun.com/{pathWithNamespace}/change/{localId}
                    if (repo.pathWithNamespace && mrData.localId) {
                        mrData.webUrl = `https://codeup.aliyun.com/${repo.pathWithNamespace}/change/${mrData.localId}`;
                        mrData.detailUrl = mrData.webUrl;
                    }
                } catch (repoError) {
                    console.warn('获取仓库信息失败，无法构建合并请求URL:', repoError.message);
                }
            } else {
                // 使用API返回的detailUrl
                mrData.webUrl = mrData.detailUrl;
            }

            return mrData;
        } catch (error) {
            // 只处理403权限错误
            if (error.status === 403 || error.code === 'PERMISSION_DENIED') {
                await this.handle403Error(error);
            }
            
            // 对于400错误，提供更详细的错误信息
            if (error.response?.status === 400 || error.status === 400) {
                const errorMsg = error.errorDescription || error.message;
                const newError = new Error(`创建合并请求失败（参数错误）: ${errorMsg}`);
                newError.status = error.status;
                newError.errorCode = error.errorCode;
                newError.errorDescription = error.errorDescription;
                newError.responseData = error.responseData;
                throw newError;
            }
            
            // 其他错误直接抛出，不要包装（特别是409冲突错误）
            throw error;
        }
    }
}

module.exports = { YunxiaoApiClient };
