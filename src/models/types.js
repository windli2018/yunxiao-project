/**
 * 认证类型
 */
const AuthType = {
    PAT: 'PAT',
    OAuth: 'OAuth'
};

/**
 * 粘贴目标类型
 */
const PasteTarget = {
    Commit: 'commit',
    Cursor: 'cursor',
    Clipboard: 'clipboard',
    Input: 'input'
};

/**
 * 工作项类型
 */
const WorkItemType = {
    Req: 'Req',
    Task: 'Task',
    Bug: 'Bug',
    Risk: 'Risk',
    SubTask: 'SubTask'
};

/**
 * 最近使用项类型
 */
const RecentItemType = {
    Project: 'project',
    WorkItem: 'workitem',
    SearchKeyword: 'search-keyword',  // 最近搜索关键词
    CodeGroup: 'code-group',  // 代码分组
    CodeRepo: 'code-repo',  // 代码仓库
    CodeBranch: 'code-branch'  // 代码分支
};

module.exports = {
    AuthType,
    PasteTarget,
    WorkItemType,
    RecentItemType
};
