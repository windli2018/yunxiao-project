# 云效工作项助手

将阿里云效（Alibaba Cloud DevOps）的项目管理功能深度集成到 VSCode 中，帮助开发者快速关联工作项到代码提交消息。

## 功能特性

### 📋 项目与工作项管理
- 浏览云效项目列表
- 查看项目下的所有工作项（需求、任务、缺陷等）
- 支持搜索和筛选工作项

### 📝 快速粘贴提交消息
- 一键粘贴工作项到 Git 提交消息框
- 自动格式化为 `#工作项编号 工作项标题`
- 支持多种粘贴目标：提交消息框、光标位置、剪贴板
- 可自定义粘贴格式模板

### ⏱️ 最近使用
- 记录最近访问的项目和工作项
- 智能排序，提升工作效率

### 🌐 浏览器集成
- 快速在浏览器中打开工作项详情
- 一键跳转到项目看板

## 安装

1. 在 VSCode 扩展市场搜索"云效工作项助手" [云效工作项助手](https://marketplace.visualstudio.com/items?itemName=WindLi.yunxiao-workitem-helper)
2. 点击安装
3. 重启 VSCode
## 截屏
![Screenshot](./doc/screenshot.png)
## 快速开始
---

### 个人访问令牌登录

1. 点击状态栏的“云效: 未登录”
2. 或使用命令面板（`Ctrl+Shift+P`）执行“云效：登录”，自动打开浏览器打开 https://devops.aliyun.com/organization/ ，登录之后可以看到url里包含 orgId
3. 如果首次登录，会提示输入组织 ID（例如：`66a0326c1d2a2a350e263a7d`）
4. 输入个人访问令牌  
    4.1. 自动打开，访问并登录 https://account-devops.aliyun.com/settings/personalAccessToken  
    4.2. 点击"新建访问令牌"  
    4.3. 填写名称、描述、有效期  
    4.4. 选择权限：组织（用户只读），项目（项目只读、工作项管理只读）  
    4.5. 保存生成的令牌
5. 登录成功后状态栏显示用户名

🔑 **管理组织 ID**：使用 `云效：管理组织 ID` 命令可查看、修改或删除组织 ID。

### 源代码管理，云效快速搜索粘贴
快速搜索选择工作项并粘贴到提交消息的开头
![Screenshot](./doc/git-commit.png)
### 云效工作项
工具栏左侧，云效工作项面板包含全部功能。可以浏览项目和工作项，使用历史。可以快速复制、打开、插入到提交记录。
### 使用工作项

1. 执行命令"云效：选择项目"（`Ctrl+Shift+Y P`）
2. 选择你的项目
3. 执行命令"云效：选择工作项"（`Ctrl+Shift+Y W`）
4. 选择工作项，自动粘贴到提交消息框

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+Y P` | 选择项目 |
| `Ctrl+Shift+Y C` | 粘贴到提交消息 |
| `Ctrl+Shift+Y R` | 刷新工作项列表 |

*Mac 用户请将 `Ctrl` 替换为 `Cmd`*

## 配置选项

### 认证配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `yunxiao.domain` | 云效 API 服务域名 | "openapi-rdc.aliyuncs.com" |

🔒 **组织 ID 已加密存储**：使用 `云效：管理组织 ID` 命令管理。

### 界面配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `yunxiao.pasteTarget` | 粘贴目标位置 | "commit" |
| `yunxiao.pasteTemplate` | 粘贴格式模板 | "#{id} {title}" |
| `yunxiao.includeTypeLabel` | 包含工作项类型标签 | false |
| `yunxiao.includeStatus` | 包含工作项状态 | false |
| `yunxiao.includeLink` | 包含工作项链接 | false |

### 缓存配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `yunxiao.projectCacheDuration` | 项目列表缓存时长（分钟） | 30 |
| `yunxiao.workitemCacheDuration` | 工作项列表缓存时长（分钟） | 10 |

## 粘贴格式模板

粘贴格式模板支持以下变量：

- `{id}` - 工作项编号
- `{title}` - 工作项标题
- `{catetory}` - 工作项类型:Req,Bug...
- `{status}` - 工作项状态
- `{workitemType} ` - 工作项类型:需求、缺陷...

示例模板：

```
#{id} {title}
```

输出：
```
#TEST-123 实现用户登录功能
```

带类型标签的模板：
```
[{workitemType}]#{id} {title}
```

输出：
```
[需求]#TEST-123 实现用户登录功能
```

## 常见问题

### Q: 如何获取组织 ID？

A: 
1. 登录云效后，在浏览器地址栏查看 URL：`https://devops.aliyun.com/organization/`
2. 或联系组织管理员获取
3. 首次登录时会自动提示输入
4. 使用 `云效：管理组织 ID` 命令可查看、修改或删除

ℹ️ **安全性**：组织 ID 已加密存储，不会显示在配置文件中。

### Q: PAT 令牌需要哪些权限？

A: 至少需要以下权限：
- 组织用户: 读取权限
- 项目管理：读取权限
- 工作项管理：读取权限

### Q: 如何刷新项目和工作项列表？

A: 使用快捷键 `Ctrl+Shift+Y R` 或执行命令"云效：刷新"清除缓存，下次访问会重新加载。

### Q: 粘贴后提交消息框没有内容？

A: 请确保：
1. 已经初始化 Git 仓库
2. VSCode 的源代码管理面板已打开
3. 配置中的粘贴目标设置为"commit"

### Q: 支持哪些工作项类型？

A: 支持云效中的所有工作项类型，包括：
- 需求（Req）
- 任务（Task）
- 缺陷（Bug）
- 风险（Risk）
- 子任务（SubTask）
- 以及组织自定义的工作项类型

## 版本历史

### 1.0.0 (2025-12-19)

- ✨ 初始版本发布
- 🔐 支持 PAT 认证
- 📋 项目和工作项浏览
- 📝 快速粘贴提交消息
- ⚙️ 灵活的配置选项
- 🌐 浏览器集成

## 反馈与支持

如果您遇到问题或有功能建议，请：

- 提交 Issue：[GitHub Issues](https://github.com/windli2018/yunxiao-project/issues)
- yunxiao@alot.pw

## 许可证

[MIT License](LICENSE)

## 致谢

感谢阿里云效团队提供的优秀项目管理平台。

---

**享受高效的开发体验！** 🚀
