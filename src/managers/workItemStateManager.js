const vscode = require('vscode');

/**
 * 工作项状态管理器
 * 负责跟踪和持久化工作项的操作状态
 */
class WorkItemStateManager {
    constructor(context) {
        this.context = context;
        this.states = new Map();
        this.loadStates();
    }

    /**
     * 标记工作项已发送到AI
     */
    markSentToAI(workitemId) {
        const state = this.getState(workitemId);
        state.sentToAI = true;
        state.sentToAIAt = Date.now();
        this.setState(workitemId, state);
    }

    /**
     * 标记工作项已粘贴到提交记录
     */
    markPastedToCommit(workitemId, branchName = null) {
        const state = this.getState(workitemId);
        state.pastedToCommit = true;
        state.pastedToCommitAt = Date.now();
        if (branchName) {
            state.createdBranch = branchName;
            state.createdBranchAt = Date.now();
        }
        this.setState(workitemId, state);
    }

    /**
     * 获取工作项状态
     */
    getState(workitemId) {
        if (this.states.has(workitemId)) {
            return { ...this.states.get(workitemId) };
        }
        
        return {
            sentToAI: false,
            sentToAIAt: null,
            pastedToCommit: false,
            pastedToCommitAt: null,
            createdBranch: null,
            createdBranchAt: null
        };
    }

    /**
     * 设置工作项状态
     */
    setState(workitemId, state) {
        this.states.set(workitemId, state);
        this.saveStates();
    }

    /**
     * 判断工作项是否已发送到AI
     */
    isSentToAI(workitemId) {
        const state = this.getState(workitemId);
        return state.sentToAI === true;
    }

    /**
     * 判断工作项是否已粘贴到提交记录
     */
    isPastedToCommit(workitemId) {
        const state = this.getState(workitemId);
        return state.pastedToCommit === true;
    }

    /**
     * 获取工作项的显示状态（用于UI显示）
     * @returns {'ai' | 'commit' | 'none'} - ai=已发AI, commit=已发提交记录, none=未操作
     */
    getDisplayState(workitemId) {
        const state = this.getState(workitemId);
        
        // 优先级：已发提交记录 > 已发AI > 未操作
        if (state.pastedToCommit) {
            return 'commit';
        }
        if (state.sentToAI) {
            return 'ai';
        }
        return 'none';
    }

    /**
     * 获取工作项的状态描述文本
     */
    getStateDescription(workitemId) {
        const state = this.getState(workitemId);
        const descriptions = [];
        
        if (state.sentToAI) {
            const time = new Date(state.sentToAIAt).toLocaleString('zh-CN');
            descriptions.push(`已发AI (${time})`);
        }
        
        if (state.pastedToCommit) {
            const time = new Date(state.pastedToCommitAt).toLocaleString('zh-CN');
            descriptions.push(`已发提交记录 (${time})`);
            
            if (state.createdBranch) {
                descriptions.push(`关联分支: ${state.createdBranch}`);
            }
        }
        
        if (descriptions.length === 0) {
            return '未操作';
        }
        
        return descriptions.join('\n');
    }

    /**
     * 清除工作项状态
     */
    clearState(workitemId) {
        this.states.delete(workitemId);
        this.saveStates();
    }

    /**
     * 清除所有状态
     */
    clearAllStates() {
        this.states.clear();
        this.saveStates();
    }

    /**
     * 从持久化存储加载状态
     */
    loadStates() {
        const saved = this.context.globalState.get('yunxiao.workItemStates', {});
        this.states = new Map(Object.entries(saved));
    }

    /**
     * 保存状态到持久化存储
     */
    saveStates() {
        const obj = Object.fromEntries(this.states);
        this.context.globalState.update('yunxiao.workItemStates', obj);
    }
}

module.exports = { WorkItemStateManager };
