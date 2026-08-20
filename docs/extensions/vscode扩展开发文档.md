# VS Code Extension v0.3 开发文档

## 结构

新增独立 `extensions/vscode` Node/TypeScript 工程：`src/extension.ts`（命令与生命周期）、`src/api.ts`（fetch 与 schema）、`src/mapping.ts`（工作区映射）、`src/webview/*`（Impact 面板）、`src/security.ts`（URL/path/CSP 校验）。扩展拥有自己的 package scripts 和测试，不加入 Web/根 Git。

## 命令与视图

- `RepoVista: Select Repository`、`Select Snapshot`、`Show Pull Request Impact`、`Open Evidence`、`Copy Fixed Evidence Link`。
- TreeView 展示 PR、风险等级、受影响文件/符号；CodeLens/装饰器只在固定 snapshot 与本地映射有效时启用。
- `Open Evidence` 使用 `workspace.openTextDocument` + `showTextDocument` 的只读导航；不修改编辑器内容。

## 固定与安全

每个 mapping 保存 `repositoryId`, `snapshotId`, `commitSha`, `workspaceFolderUri`。API 响应的 commit 必须与 mapping 完全一致；路径必须 `workspaceFolder` 内相对、无 `..`、无绝对路径，行号必须为正整数。Webview nonce/CSP 每次随机生成，消息用 Zod schema 校验；网络仅访问配置 Origin。

## 测试与打包

使用 `@vscode/test-electron` 或轻量 mock host 覆盖命令、状态栏、TreeView、路径逃逸、Commit mismatch、离线缓存和 API 错误。`vsce package` 生成可复现 `.vsix`，不把源码、Token 或数据库凭据打进包；README 明确公共仓库和只读边界。
