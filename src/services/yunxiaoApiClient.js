const axios = require('axios');
const { getCategoryName } = require('../config/workitemTypes');

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
                if (error.response?.status === 401) {
                    // 认证失败，需要重新登录
                    throw new Error('认证失败，请重新登录');
                } else if (error.response?.status === 429) {
                    // 请求限流
                    throw new Error('请求过于频繁，请稍后重试');
                } else if (error.code === 'ECONNABORTED') {
                    // 超时
                    throw new Error('请求超时，请检查网络连接');
                } else {
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
            throw new Error(`搜索工作项失败: ${error.message}，${error.response.data}`);
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
}

module.exports = { YunxiaoApiClient };
