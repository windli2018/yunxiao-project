/**
 * 工作项类型配置
 * 统一管理工作项类型的映射关系
 */

/**
 * 工作项类型映射表
 * categoryId (英文) -> 中文名称
 */
const CATEGORY_MAP = {
    'Req': '需求',
    'Bug': '缺陷',
    'Task': '任务',
    'Risk': '风险',
    'SubTask': '子任务'
};

/**
 * 反向映射：中文名称 -> categoryId
 */
const CATEGORY_REVERSE_MAP = {
    '需求': 'Req',
    '缺陷': 'Bug',
    '任务': 'Task',
    '风险': 'Risk',
    '子任务': 'SubTask'
};

/**
 * 双向映射：支持中文和英文互相映射
 */
const CATEGORY_BI_MAP = {
    ...CATEGORY_MAP,
    ...CATEGORY_REVERSE_MAP
};

/**
 * 工作项类型图标映射
 */
const CATEGORY_ICONS = {
    'Req': '💡',
    'Bug': '🐛',
    'Task': '✓',
    'Risk': '⚠️',
    'SubTask': '▫️',
    '需求': '💡',
    '缺陷': '🐛',
    '任务': '✓',
    '风险': '⚠️',
    '子任务': '▫️'
};

/**
 * 获取工作项类型的中文名称
 * @param {string} categoryId - 工作项类型 ID（英文）
 * @returns {string} 中文名称
 */
function getCategoryName(categoryId) {
    return CATEGORY_MAP[categoryId] || categoryId;
}

/**
 * 获取工作项类型的 ID
 * @param {string} name - 工作项类型名称（中文或英文）
 * @returns {string} categoryId
 */
function getCategoryId(name) {
    return CATEGORY_REVERSE_MAP[name] || name;
}

/**
 * 获取工作项类型的图标
 * @param {string} typeKey - 工作项类型（中文或英文）
 * @returns {string} 图标
 */
function getCategoryIcon(typeKey) {
    return CATEGORY_ICONS[typeKey] || '📋';
}

/**
 * 判断是否为有效的工作项类型
 * @param {string} type - 工作项类型
 * @returns {boolean}
 */
function isValidCategory(type) {
    return CATEGORY_MAP.hasOwnProperty(type) || CATEGORY_REVERSE_MAP.hasOwnProperty(type);
}

/**
 * 获取所有支持的工作项类型列表（英文 ID）
 * @returns {Array<string>}
 */
function getAllCategoryIds() {
    return Object.keys(CATEGORY_MAP);
}

/**
 * 获取所有支持的工作项类型名称（中文）
 * @returns {Array<string>}
 */
function getAllCategoryNames() {
    return Object.values(CATEGORY_MAP);
}

module.exports = {
    CATEGORY_MAP,
    CATEGORY_REVERSE_MAP,
    CATEGORY_BI_MAP,
    CATEGORY_ICONS,
    getCategoryName,
    getCategoryId,
    getCategoryIcon,
    isValidCategory,
    getAllCategoryIds,
    getAllCategoryNames
};
