# API 接口契约

状态：v0.2 已实现并验收
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

Health Endpoint 直接返回 `{ "status": "ok" }`，不包信封。v0.2 仍没有 Authorization Header 约定。

## 2. Operation 列表

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/health/live` | 进程存活 |
| GET | `/v1/health/ready` | 数据库可用 |
| GET | `/v1/integrations/github` | 非敏感 GitHub 自动更新能力状态 |
| POST | `/v1/integrations/github/webhooks` | 验签、筛选并幂等处理 GitHub 事件 |
| POST | `/v1/repositories` | 创建/复用仓库并排队 Snapshot |
| GET | `/v1/repositories` | 列出 Public Workspace 仓库 |
| GET | `/v1/repositories/{repositoryId}` | 仓库摘要和最新 Snapshot |
| GET | `/v1/repositories/{repositoryId}/snapshots` | 列出不可变 Snapshot |
| GET | `/v1/snapshots/{snapshotId}` | Snapshot 状态与统计 |
| GET | `/v1/snapshots/{snapshotId}/exports/markdown` | 下载固定 Snapshot 的 Markdown 报告 |
| GET | `/v1/snapshots/{snapshotId}/exports/svg` | 下载固定 Snapshot 的 SVG 地图 |
| POST | `/v1/snapshots/{snapshotId}/cancel` | 请求取消活动任务 |
| GET | `/v1/jobs/{jobId}` | 当前任务状态 |
| GET | `/v1/jobs/{jobId}/events` | SSE 任务事件 |
| GET | `/v1/snapshots/{snapshotId}/map` | 包/文件/符号图 |
| GET | `/v1/snapshots/{snapshotId}/files` | 文件 Cursor 列表 |
| GET | `/v1/snapshots/{snapshotId}/source` | 固定 Snapshot 源码 |
| GET | `/v1/snapshots/{snapshotId}/search` | 证据搜索 |
| POST | `/v1/repositories/{repositoryId}/ask` | 可信问答 |
| POST | `/v1/share-reports` | 创建公开导览 |
| GET | `/v1/share-reports/{slug}` | 读取公开导览 |

共 21 个 Operation。

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

Progress Event 的 `message` 是可展示的阶段说明。增量 Parsing 会明确报告本轮 Parsed 与 Reused 文件数；客户端不能只根据百分比猜测。

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

## 7. 搜索

```http
GET /v1/snapshots/{snapshotId}/search?q=createRouter&mode=hybrid&limit=20
```

`mode` 接受 `text|symbol|hybrid`。当前存储层返回同一套全文/符号证据，Mode 会在响应中回显，为后续检索策略扩展保留 Contract。

每条 Evidence 包含 Snapshot、Commit、File、可选 Symbol、行号、内容、Hash 和 Score。

## 8. 可信问答

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

Citation 的路径、行号和 Quote 来自服务端 Evidence，而不是模型自由输出。

## 9. 分享报告

```http
POST /v1/share-reports
```

```json
{
  "snapshotId": "uuid",
  "title": "owner/repository architecture tour"
}
```

返回 201 和 `{id, slug}`。`GET /v1/share-reports/{slug}` 公开读取创建时固定的 Repository、Snapshot、Overview、Reading Path 和 Package Map。

## 10. GitHub 自动更新

`GET /v1/integrations/github` 只返回 `enabled/appSlug/events/scope`，永不返回 Secret。

Webhook 请求必须包含：

- `X-GitHub-Delivery`。
- `X-GitHub-Event`。
- `X-Hub-Signature-256: sha256=<hex>`。

服务端先对原始 JSON Bytes 做 HMAC-SHA256，再解析 Payload。`ping`、未知事件、Private、非默认分支和删除 Push 被安全忽略；Public 默认分支 Push 以完整 `after` SHA 创建 Snapshot/Job。同 Delivery/同 Body 返回 Duplicate；同 Delivery/不同 Body 返回 409。

## 11. Snapshot 导出

Markdown 与 SVG 只允许 Ready Snapshot。它们是附件正文，不使用 JSON Success Envelope；错误仍使用统一失败信封。

```http
GET /v1/snapshots/{snapshotId}/exports/markdown
GET /v1/snapshots/{snapshotId}/exports/svg?level=package|file|symbol
```

响应设置安全 `Content-Disposition`、`ETag`、`X-Content-Type-Options`；SVG 额外设置 Sandbox CSP。输出固定完整 Commit SHA、Snapshot ID 和 Parser Version，不调用 AI Provider。

## 12. 状态码

- 200：读取或问答成功。
- 201：Share Report 创建成功。
- 202：分析或取消请求被接受。
- 401：GitHub Webhook 签名错误。
- 400：输入、URL、Ref 或 Path 不合法。
- 404：资源不存在。
- 409：Snapshot 未 Ready、Delivery Payload 冲突等状态冲突。
- 429：匿名业务限流。
- 502：上游模型失败或输出不合法。
- 503：Readiness 数据库不可用或 Webhook 未配置。

调用方必须按 `error.code` 和 `retryable` 决策，不解析英文 Message。
