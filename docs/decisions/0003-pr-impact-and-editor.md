# ADR 0003：PR 影响分析与编辑器固定证据

状态：Accepted（v0.3）  
日期：2026-08-20

## 背景

RepoVista 已经能为单个 Commit 建立不可变代码图，但用户还不能回答“这个 PR 会影响什么”，也不能在编辑器内可靠地回到分析时的源码。若让 Web、Worker、VS Code 各自解析，会产生版本漂移、不可复现和无法审计的答案。

## 决策

1. Parser Version 是所有 Snapshot 和 PR Analysis 的组成部分。v0.3 使用 `tree-sitter-ts-js-py-go-v1`；不同版本不能互作增量基线或 PR 双快照。
2. PR Analysis 持久化 `base_snapshot_id`、`head_snapshot_id`、完整 SHA、parser version、算法版本和不可变结果。重新运行创建新 revision。
3. 影响计算只使用持久化图的反向静态关系和确定性 BFS。AI 可在未来解释结果，但不能决定 changed/impact/risk，也不能创建证据。
4. API 是 Web 与 VS Code 的唯一数据边界。扩展导航必须携带 snapshot/commit，并且不拥有源码写权限。
5. GitHub API 只读取公共 PR 元数据；网络失败、限流和缺少文件列表都进入可重试/可观测状态，不降级为猜测。

## 不变量

- `baseSnapshot.repositoryId === headSnapshot.repositoryId === analysis.repositoryId`。
- 两个 Snapshot 均 Ready、Commit SHA 为 40 位小写十六进制、Parser Version 相同且等于当前版本。
- Analysis 结果写入后不更新；任何查询只能读取同一 revision。
- Evidence 的 snapshot、path、symbol 和行范围必须来自对应快照数据库记录。
- 扩展禁止访问未绑定的 Repository、Snapshot 或绝对路径。

## 取舍

- 选择数据库存储结果而非实时计算，换取固定证据、分页和重放能力；代价是 Migration 与版本化算法字段。
- 选择 REST 元数据而非 GitHub App/OAuth，保持公共仓库边界；代价是 API rate limit 和 PR fixture 测试依赖。
- 选择 VS Code Webview/命令而非语言服务器，先交付跨语言固定证据；未来可在不改变 API 的情况下增加 LSP。

## 安全与隐私

不保存 GitHub Token；配置的只读 Token 只存在进程内请求头。PR body、标题和仓库文本均按不可信数据处理，不拼接到 shell 或模型系统指令。扩展 Webview 采用 CSP，链接和消息均白名单校验。
