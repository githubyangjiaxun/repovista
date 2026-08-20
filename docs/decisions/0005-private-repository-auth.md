# ADR 0005：GitHub App、不持久化安装令牌与 Workspace 强隔离

状态：Accepted  
日期：2026-08-20

## 背景

RepoVista v0.4 将所有 API 资源放在固定 Public Workspace 中，只允许公开 GitHub Repository。
数据库虽然已存在 User、Workspace、Membership、Repository Visibility 和 GitHub Installation ID，
但这些字段尚未成为安全边界。

私有仓库引入了三种不同的凭据：用户登录凭据、CLI 凭据、GitHub Installation 凭据。它们的生命周期、
权限和暴露面完全不同，不能用一个长期 GitHub PAT 同时解决。

## 决策

### 1. GitHub App 是唯一的私有仓库凭据来源

- 部署时提供 App ID、Client ID/Secret、Webhook Secret 和 PEM Private Key。
- App Private Key 不进入数据库，不通过 API 传输，不进入 Log。
- API 和 Worker 使用 App JWT 请求 Installation Access Token。
- Installation Token 仅在内存中缓存，在 GitHub 过期时间前至少 60 秒主动失效。
- 数据库和 Job 只持久化 Installation ID，不持久化 Token。

### 2. Clone 凭据不进入 URL 和 Argv

Worker 为每次 Private Clone 创建一个权限为 `0700` 的临时 AskPass Script。Git 通过限制环境变量读取
`x-access-token` 和短期 Token。无论成功、超时或失败，Script 在 `finally` 中删除。

Git 子进程同时使用：

```text
GIT_TERMINAL_PROMPT=0
GIT_CONFIG_NOSYSTEM=1
GIT_ASKPASS=<ephemeral path>
GIT_CONFIG_COUNT=1
GIT_CONFIG_KEY_0=credential.helper
GIT_CONFIG_VALUE_0=
```

RepoVista 不执行 Clone 下来的 Hook、Build、Package Script 或任意 Repository Command。

### 3. Browser 与 CLI 使用不同的一方凭据

- Browser：不透明随机 Session Token，存放在 Host-only HttpOnly Cookie。
- CLI：`rv_` 前缀的随机 API Token，创建时只返回一次，必须绑定 Workspace。
- 两者在数据库只保存 `sha256:<hex>` Hash，使用 Timing-safe Compare。
- Browser Mutation 需要 SameSite Cookie、允许 Origin 和 Double-submit CSRF Header 三者一致。
- Bearer Token 不使用 Cookie，不需 CSRF，但要验证 Scope、Workspace、Expiry 和 Revocation。

### 4. Workspace 是所有私有资源的根授权边界

每个 Principal 被解析为：

```ts
type Principal =
  | { kind: "anonymous"; workspaceId: PUBLIC_WORKSPACE_ID; role: "viewer" }
  | { kind: "session"; userId: string; workspaceId: string; role: WorkspaceRole }
  | { kind: "token"; userId: string; workspaceId: string; role: WorkspaceRole; scopes: Scope[] };
```

资源访问条件是“Principal 对资源 Workspace 有 Membership”，或“资源位于 Public Workspace 且 Repository
为 Public”。Private Workspace 中的 Public GitHub Repository 仍然是 Workspace-private，因为 RepoVista 派生数据、
问答和分享可能包含团队上下文。

所有无权的资源 ID 返回 404，只有“已认证但角色不允许执行已知操作”返回 403。

### 5. Share 不得成为旁路

- Public Repository 在 Public Workspace 中可继续创建 Public Share。
- Private Workspace 或 Private Repository 默认创建 Private Share。
- v0.5 不允许将 Private Repository Report 设为 Public/Unlisted。
- Private Share 读取必须经过同一 Repository Workspace 权限验证。

## 被拒绝的方案

### 长期 GitHub PAT

权限过宽、难以安装级撤销、无法精确表达仓库选择，且容易被保存到配置或日志。

### 将 Installation Token 加密后存数据库

Token 本身只有短生命周期，持久化不带来可用性收益，反而扩大了密钥管理和泄露面。

### 只在 API Route 验证 UUID

单纯验证 ID 格式不能防止跨 Workspace 访问。必须在查询中连接 Repository/Workspace 或在执行业务查询前
先获得同一事务内的 Access Context。

### 私有仓库使用 Unlisted Share

随机 Slug 是位置秘密，不是身份验证。源码证据不得依赖 Slug 难猜来保护。

## 后果

- 自部署需要正确配置 GitHub App 回调、Webhook 和 Private Key Secret。
- API 和 Worker 都需要 GitHub App Client，但只有 API 需要 Client Secret，Worker 只需 App ID/Private Key。
- 测试需覆盖凭据红洗、跨 Workspace 尝试、Token 过期与 Installation 撤销。
- Public Mode 保持可用，未配置 GitHub App 的开发环境不需伪造私有凭据。
