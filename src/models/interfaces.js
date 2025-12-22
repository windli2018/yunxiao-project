/**
 * 接口定义文件（JavaScript 版本）
 * 
 * 注意：JavaScript 不支持接口，这些接口仅作为文档说明
 * 实际实现类应遵循这些接口定义的方法签名
 */

/**
 * 认证提供者接口
 * 
 * @interface IAuthProvider
 * @method login() - 登录，返回 Promise<AuthInfo>
 * @method logout() - 登出，返回 Promise<void>
 * @method refreshToken(authInfo) - 刷新令牌，返回 Promise<AuthInfo>
 * @method validateToken(authInfo) - 验证令牌，返回 Promise<boolean>
 * @method getAuthType() - 获取认证类型，返回 AuthType
 */

/**
 * 缓存提供者接口
 * 
 * @interface ICacheProvider
 * @method get(key) - 获取缓存，返回 T | undefined
 * @method set(key, value, ttl?) - 设置缓存，返回 void
 * @method delete(key) - 删除缓存，返回 void
 * @method clear() - 清空缓存，返回 void
 * @method isExpired(key) - 检查缓存是否过期，返回 boolean
 */

/**
 * 存储提供者接口
 * 
 * @interface IStorageProvider
 * @method get(key) - 获取值，返回 Promise<T | undefined>
 * @method set(key, value) - 设置值，返回 Promise<void>
 * @method delete(key) - 删除值，返回 Promise<void>
 * @method clear() - 清空所有值，返回 Promise<void>
 */

// JavaScript 不需要导出接口，这个文件仅作为文档
module.exports = {};
