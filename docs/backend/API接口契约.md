# API 接口契约

状态：v1.0 已实现并验收（2026-08-25）
Base path：`/v1`
机器事实来源：`openapi/openapi.json`

本文件解释使用方式，不复制所有 JSON Schema。字段、Required、Status Code 和示例发生冲突时，以 OpenAPI 和 `packages/contracts` 为准。

## 1. 通用格式

普通请求可发送：

```http
Content-Type: application/json
X-Request-ID: client-generated-id
```

服务端在响应头返回 `X-Request-ID`。成功信封使用 camelCase：

```json
{
  "data": {},
  "meta": { "requestId": "request-id" }
}
```

失败信封：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request contains invalid input.",
    "details": {},
    "retryable": false,
    "requestId": "request-id"
  }
}
```

Health Endpoint 直接返回 `{ "status": "ok" }`，不包信封。v0.5 新增两种认证方式：浏览器使用
HttpOnly `repovista_session` Cookie + `X-RepoVista-CSRF` Mutation Header，CLI/自动化使用
`Authorization: Bearer rv_...`。Bearer Token 绑定单一 Workspace，不读取 Cookie，也不需要 CSRF；
Cookie 与 Bearer 同时出现时统一返回 `AUTH_AMBIGUOUS`。完整机器契约见
[`openapi/openapi.json`](../../openapi/openapi.json)。

### v0.5 Auth/Workspace 路由

认证、Workspace、成员、Token、Audit 和 GitHub Installation 路由在基础版本共 49 个 Operation，
后续版本在此基础上增加 Guardrails、解释历史、Review 和导出路由。所有 UUID 资源查询先做 Workspace
Access Check；无权资源使用稳定 404，不把 ID 是否存在
泄露给其他 Workspace。私有 Share 只能由所属 Workspace 成员读取。

## 2. Operation 列表

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/health/live` | 进程存活 |
| GET | `/v1/health/ready` | 数据库可用 |
| GET | `/v1/auth/github/start` / `/v1/auth/github/callback` | GitHub OAuth 登录 |
| GET | `/v1/auth/session` / `POST /v1/auth/logout` | 读取/撤销当前会话 |
| GET/POST | `/v1/workspaces` | 列出或创建 Workspace |
| GET/POST/PATCH/DELETE | `/v1/workspaces/{workspaceId}/members[/{userId}]` | 成员读取与 Owner 管理 |
| PUT | `/v1/auth/session/workspace` | 切换当前 Session Workspace |
| GET | `/v1/audit-events` | 读取当前 Workspace 审计事件 |
| GET/POST/DELETE | `/v1/auth/tokens[/{tokenId}]` | 创建、列出、撤销 CLI Token |
| GET | `/v1/integrations/github/install-url` / `setup` | 连接 GitHub App Installation |
| GET/DELETE | `/v1/integrations/github/installations[/{installationId}]` | Installation 与授权仓库 |
| GET | `/v1/integrations/github` | 非敏感 GitHub 自动更新能力状态 |
| POST | `/v1/integrations/github/webhooks` | 验签、筛选并幂等处理 GitHub 事件 |
| POST | `/v1/repositories` | 创建/复用仓库并排队 Snapshot |
| GET | `/v1/repositories` | 列出当前 Principal Workspace 仓库 |
| GET | `/v1/repositories/{repositoryId}` | 仓库摘要和最新 Snapshot |
| GET | `/v1/repositories/{repositoryId}/snapshots` | 列出不可变 Snapshot |
| POST | `/v1/repositories/{repositoryId}/pull-requests` | 创建/复用固定 Base/Head 的 PR Impact Analysis |
| GET | `/v1/pull-request-analyses/{analysisId}` | 读取 PR Analysis 状态与汇总 |
| GET | `/v1/pull-request-analyses/{analysisId}/impact` | 分页读取 Changed/Direct/Transitive/Unknown Impact |
| GET | `/v1/pull-request-analyses/{analysisId}/events` | PR Analysis SSE 事件 |
| POST | `/v1/pull-request-analyses/{analysisId}/rerun` | 显式创建下一 Revision |
| GET | `/v1/snapshots/{snapshotId}` | Snapshot 状态与统计 |
| GET | `/v1/snapshots/{snapshotId}/exports/markdown` | 下载固定 Snapshot 的 Markdown 报告 |
| GET | `/v1/snapshots/{snapshotId}/exports/svg` | 下载固定 Snapshot 的 SVG 地图 |
| POST | `/v1/snapshots/{snapshotId}/cancel` | 请求取消活动任务 |
| GET | `/v1/jobs/{jobId}` | 当前任务状态 |
| GET | `/v1/jobs/{jobId}/events` | SSE 任务事件 |
| GET | `/v1/snapshots/{snapshotId}/map` | 包/文件/符号图 |
| GET | `/v1/snapshots/{snapshotId}/files` | 文件 Cursor 列表 |
| GET | `/v1/snapshots/{snapshotId}/source` | 固定 Snapshot 源码 |
| GET | `/v1/snapshots/{snapshotId}/symbols/{symbolId}` | 读取固定 Symbol Evidence |
| GET | `/v1/snapshots/{snapshotId}/retrieval` | Text/Symbol/Semantic 能力与 Profile 状态 |
| POST | `/v1/snapshots/{snapshotId}/embeddings` | 创建、复用或重试 Embedding Index Job |
| GET | `/v1/snapshots/{snapshotId}/search` | 执行 Text/Symbol/Semantic/Hybrid 检索并返回 Trace |
| POST | `/v1/repositories/{repositoryId}/ask` | 复用 Hybrid Retriever 的可信问答 |
| POST | `/v1/share-reports` | 创建 Architecture Story v2 |
| GET | `/v1/share-reports/{slug}` | 读取 v1 Tour 或 v2 Story |

基础路由共 49 个 Operation；当前完整契约共 65 个 Operation。

v0.6 增加两个 Snapshot 派生读接口；v0.7 增加一个基线比较接口；v0.8 增加五个策略 Profile
接口；v0.9 增加两个解释接口；v1.0 增加历史和解释比较接口；v1.2 增加 Review/JSON 导出接口，
共 65 个 Operation：

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/snapshots/{snapshotId}/guardrails` | 计算并返回固定阈值的 Architecture Guardrails JSON 报告 |
| GET | `/v1/snapshots/{snapshotId}/guardrails/sarif` | 下载同一报告的 SARIF 2.1.0 表示 |
| GET | `/v1/snapshots/{snapshotId}/guardrails/json` | 下载确定性报告与独立 Review 元数据的 JSON 表示 |
| GET | `/v1/snapshots/{snapshotId}/guardrails/reviews` | 列出当前 Snapshot 每个 Finding 的 Review 状态 |
| PUT | `/v1/snapshots/{snapshotId}/guardrails/reviews/{findingId}` | 设置或清除一个 Finding 的 Review 状态和备注 |
| DELETE | `/v1/snapshots/{snapshotId}/guardrails/reviews/{findingId}` | 幂等清除 Review，恢复 `unreviewed` |
| GET | `/v1/snapshots/{snapshotId}/guardrails/compare?baseSnapshotId=...` | 比较同一 Repository 的两个 Ready Snapshot，返回 Finding 状态和回归摘要 |

v0.8 策略 Profile 路由：

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/guardrail-profiles` | 列出当前 Workspace 可见的内置 default 和自定义不可变版本 |
| POST | `/v1/guardrail-profiles` | 创建或幂等复用策略版本；只接受既有 Guardrails 阈值 |
| GET | `/v1/guardrail-profiles/{profileId}` | 读取单个策略版本 |
| GET | `/v1/repositories/{repositoryId}/guardrail-profile` | 读取仓库对未来 Snapshot 的当前绑定 |
| PUT | `/v1/repositories/{repositoryId}/guardrail-profile` | 为未来 Snapshot 绑定策略版本或清空回 default |

策略 Profile 是 Workspace 隔离的不可变读模型。完全相同的最新创建请求返回既有版本；内容变化
才递增版本。Repository 绑定只影响之后创建的 Snapshot，历史 Snapshot 报告读取自身保存的
策略 ID；迁移前的 `NULL guardrailProfileId` 回退内置 `default`。不同策略 fingerprint 的
Guardrails 基线比较返回 `409 GUARDRAIL_COMPARISON_INCOMPATIBLE`。策略接口的写请求遵循现有
Cookie + CSRF 或 Workspace-bound Bearer Token 权限，读取结果遵循公开/私有缓存策略。

两个接口只接受 Ready Snapshot，并复用既有 Workspace Access Check。报告从指定 Snapshot 的文件、
符号和关系重算，不写入可变 Finding 表；SARIF 不包含源码正文，私有 Snapshot 使用
`Cache-Control: private, no-store`。

比较接口同样不写入数据库，也不返回源码正文。Base/Head 必须通过各自的 Workspace Access Check，
属于同一 Repository、均为 Ready、Parser Version/Guardrails 算法/阈值一致；不兼容返回
`GUARDRAIL_COMPARISON_INCOMPATIBLE` 和 HTTP `409`。公开比较使用
`public, max-age=0, must-revalidate`，任一侧为私有则使用 `private, no-store`。

v0.9 Verified Guardrail Explanation 路由：

| Method | Path | 用途 |
|---|---|---|
| POST | `/v1/snapshots/{snapshotId}/guardrails/explanations` | 对服务端重新计算并选中的 Finding 生成或复用可核验解释 |
| GET | `/v1/snapshots/{snapshotId}/guardrails/explanations/{explanationId}` | 在 Snapshot/Workspace 边界内读取不可变解释 |

POST 严格只接受 `findingId` 和可选 `provider/model`；客户端不能上传 Finding、源码或 Prompt。
服务端固定 Snapshot/Commit/Profile/Finding provenance，并只从 Finding 的最多 20 个固定范围读取
每段最多 400 行、8,000 字符的 Evidence。模型输出经 citation verifier 过滤；没有有效引用时强制
`refused`。相同 Snapshot/Finding fingerprint/provider/model/prompt 的请求优先复用已有记录，并在
数据库唯一键下保证并发收敛。写请求沿用 Session CSRF、Viewer/Token Scope 和匿名公开 Demo
边界；私有响应为 `private, no-store`。

v1.0 Explanation History 与结构比较路由：

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/snapshots/{snapshotId}/guardrails/explanations?findingId=...&limit=...&cursor=...` | 从当前 Snapshot 的服务端真实 Finding 出发，分页读取同 Repository 同逻辑 Finding 的解释摘要 |
| GET | `/v1/repositories/{repositoryId}/guardrails/explanations/compare?baseExplanationId=...&headExplanationId=...` | 对两条同逻辑 Finding 的不可变解释执行 provenance/Finding/Answer 结构比较 |

历史入口重新计算当前 Snapshot Guardrails，并由服务端生成 `subjectKey`；客户端不能提交逻辑身份、
Repository、Rule 或 Finding JSON。历史按 `createdAt DESC, id DESC` 使用 opaque cursor 分页，摘要不
返回 Citation Quote。比较只返回 `same/changed` 和 Base/Head 完整已验证解释，不调用 Provider、不
写入新解释或审计创建事件，也不输出“改进、退步、胜者”。两个 GET 均允许 Viewer 读取；跨
Workspace/Repository、缺失记录和不同 `subjectKey` 使用稳定 Not Found/Conflict 边界。私有响应为
`private, no-store`，公开 Demo 为 `public, max-age=0, must-revalidate`。

v1.2 Review 接口只接受服务端当前 Report 中存在的 Finding。Review metadata 与确定性分析分离，
不会改变 Finding、`pass/warn/fail`、SARIF `level` 或 CLI CI 退出码；匿名用户只能读取公开 Snapshot，
Bundled Demo 禁止写入。备注限制为 2,000 个 Unicode 字符，写入追加脱敏审计事件。

## 3. 创建分析

```http
POST /v1/repositories
```

```json
{
  "url": "https://github.com/owner/repository",
  "ref": "main",
  "ignore": ["dist", "docs/generated"]
}
```

`ref` 和 `ignore` 可省略。URL 必须是公共 HTTPS GitHub 两段路径，不能包含凭据、Query 或 Fragment。Ignore 必须是安全的仓库相对路径。

响应 202：

```json
{
  "data": {
    "repositoryId": "uuid",
    "snapshotId": "uuid",
    "jobId": "uuid",
    "status": "queued"
  },
  "meta": { "requestId": "request-id" }
}
```

## 4. Job 与 SSE

`GET /v1/jobs/{jobId}` 返回：`status`、`phase`、0～1 `progress`、`processed`、`total`、`retryable` 和可选 `error`。

SSE 支持：

- Query `after=<event-id>`。
- Header `Last-Event-ID`。
- `started`、`progress`、`completed`、`failed`、`cancelled` 等持久化事件。

```text
id: 42
event: progress
data: {"phase":"parsing","progress":0.62,"processed":120,"total":190}
```

客户端断线后应携带最后 Event ID 重连，并同时读取 Job 当前状态，避免错过终态。

Progress Event 的 `message` 是可展示的阶段说明。增量 Parsing 会明确报告本轮 Parsed 与 Reused
文件数；Embedding Job 报告 embedded/total Chunk 和 Provider/Model，客户端不能只根据百分比猜测。

## 5. 地图

```http
GET /v1/snapshots/{snapshotId}/map?level=file&query=server
```

Query：

- `level=package|file|symbol`，默认 package。
- `rootId` 限制根节点。
- `depth=0..4`，默认 1。
- `query` 按 Label/Path 过滤。
- `relationTypes` 可为逗号分隔或重复参数。

响应包含 Snapshot ID/Commit/Parser Version、Level、Nodes、Edges、`truncated`。Node 的 `range` 使用 `startLine/endLine`。

## 6. 文件与源码

文件列表参数：`cursor`、`language`、`pageSize`（1～100）、`path`、`query`。

源码请求：

```http
GET /v1/snapshots/{snapshotId}/source?path=src/server.ts&startLine=10&endLine=40
```

响应包含 `id`、`path`、`language`、`content`、`lineCount`、实际 `startLine`、`commitSha`、`blobHash`、`truncated`。Path 必须属于该 Snapshot，目录穿越返回 400。

## 7. Retrieval 状态与 Embedding Job

```http
GET /v1/snapshots/{snapshotId}/retrieval
POST /v1/snapshots/{snapshotId}/embeddings
```

Retrieval Status 返回 Text/Symbol Ready 状态，以及 Semantic 的 `configured`、`queryable`、
`reason`、`currentIndex` 和 `latestIndex`。Profile 包含 Provider、Model、Input Version、Status、
Dimensions、Total/Embedded Chunk、Revision、Job、Failure 和时间，不返回 Endpoint/API Key。

创建 Embedding 要求 Snapshot Ready 且服务显式配置真实 Provider/Model：

- 新 Profile/Job 返回 202；
- queued/running Profile 幂等返回原 Job；
- ready Profile 返回 200，不重新计算；
- failed/cancelled Profile 显式重试并复用 Hash 匹配的 Partial Vector；
- 未配置返回 `EMBEDDING_PROVIDER_DISABLED`，配置/维度/上游错误使用稳定 Error Code。

## 8. 搜索

```http
GET /v1/snapshots/{snapshotId}/search?q=createRouter&mode=hybrid&limit=20
```

`mode` 接受 `text|symbol|semantic|hybrid`，`limit` 为 1～100：

- `text`：PostgreSQL Full-text + Path；
- `symbol`：Symbol Name/Qualified Name/Path Exact/Fuzzy；
- `semantic`：当前 Provider/Model 的 Ready Profile + 真实 Query Vector；
- `hybrid`：可用通道的 Reciprocal Rank Fusion。

响应包含 `query`、`results[]` 和 `trace`。Trace 公开 Requested Mode、Used Channels、每个通道的
Status/Candidate Count/Latency/Reason、是否降级以及 Profile 来源。Semantic-only 不可用时返回错误；
Hybrid 在 Semantic 上游失败时仍可返回 Text/Symbol，但必须 `degraded=true` 并说明原因。

每条 Hit 包含 Snapshot、Commit、File、可选 Symbol、行号、内容、Hash、Fusion Score 和
`signals[]`；每个 Signal 带 Channel、1-based Rank 和 Raw Score。不同通道原始分数不直接相加。

## 9. 可信问答

```http
POST /v1/repositories/{repositoryId}/ask
```

```json
{
  "question": "Where does the application start?",
  "snapshotId": "optional-uuid",
  "provider": "fake",
  "model": "optional-model"
}
```

省略 Snapshot 时使用 Repository 最新 Ready Snapshot。Provider 可为 `fake`、`ollama`、`openai-compatible`；省略时使用服务配置。

响应 `data` 包含：

- `messageId`。
- `answer.summary/steps/limitations/status/citations/provider/model`。
- 服务端实际检索的 `evidence[]`。
- 与 Search 同结构的 `trace`，说明实际使用通道、降级和 Embedding Profile。

Ask 使用同一 Hybrid Retriever；Citation 的路径、行号和 Quote 来自服务端 Evidence，而不是模型
自由输出。`MODEL_PROVIDER=fake` 是确定性 Evidence Summarizer，不等于 Semantic 已配置。

## 10. 分享报告

```http
POST /v1/share-reports
```

```json
{
  "snapshotId": "uuid",
  "title": "owner/repository architecture story"
}
```

返回 201 和 `{id, slug}`。新记录写 `report_type=architecture_story`、`content_version=2`。
`GET /v1/share-reports/{slug}` 公开读取创建时固定的 Repository/Snapshot，以及 Metrics、Overview、
Package Map、Key Modules、Reading Path、Evidence Highlights 和 Provenance。旧 v1 Tour 继续读取。

## 11. GitHub 自动更新

`GET /v1/integrations/github` 只返回 `enabled/appSlug/events/scope`，永不返回 Secret。

Webhook 请求必须包含：

- `X-GitHub-Delivery`。
- `X-GitHub-Event`。
- `X-Hub-Signature-256: sha256=<hex>`。

服务端先对原始 JSON Bytes 做 HMAC-SHA256，再解析 Payload。`ping`、未知事件、Private、非默认分支和删除 Push 被安全忽略；Public 默认分支 Push 以完整 `after` SHA 创建 Snapshot/Job。同 Delivery/同 Body 返回 Duplicate；同 Delivery/不同 Body 返回 409。

## 12. Pull Request Impact

`POST /v1/repositories/{repositoryId}/pull-requests` 接受公共 GitHub PR Number 与可选 rerun 语义，
把 Base/Head Ref 解析为不可变 Snapshot。Analysis Status、SSE、Impact Cursor、Kind/Risk/Path Filter、
固定 Evidence、最短路径与 Revision 的机器字段以 OpenAPI 为准。

相同 Repository/PR/Base/Head/Parser/Algorithm 幂等复用；`rerun` 创建下一 Revision。GitHub 上游
Rate Limit 与无效 PR 使用稳定错误，不能回退到可变分支内容。

## 13. Snapshot 导出

Markdown 与 SVG 只允许 Ready Snapshot。它们是附件正文，不使用 JSON Success Envelope；错误仍使用统一失败信封。

```http
GET /v1/snapshots/{snapshotId}/exports/markdown
GET /v1/snapshots/{snapshotId}/exports/svg?level=package|file|symbol
```

响应设置安全 `Content-Disposition`、`ETag`、`X-Content-Type-Options`；SVG 额外设置 Sandbox CSP。输出固定完整 Commit SHA、Snapshot ID 和 Parser Version，不调用 AI Provider。

## 14. 状态码

- 200：读取或问答成功。
- 201：Share Report 创建成功。
- 202：Source/PR/Embedding 分析或取消请求被接受。
- 401：未认证、认证失效或 GitHub Webhook 签名错误。
- 403：已认证但没有当前 Workspace/Repository 的写权限。
- 400：输入、URL、Ref 或 Path 不合法。
- 404：资源不存在。
- 409：Snapshot/Embedding 未 Ready、Delivery Payload 冲突、配置不匹配等状态冲突。
- 429：匿名业务限流。
- 502：上游 Chat/Embedding 输出不合法或不可接受。
- 503：Readiness 数据库不可用、Webhook 未配置或可重试 Embedding 上游不可用。

调用方必须按 `error.code` 和 `retryable` 决策，不解析英文 Message。
