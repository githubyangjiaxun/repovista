# API 接口契约

状态：proposal  
版本：v1

所有接口前缀为 /v1。除特别说明外，响应为 JSON。

## 1. 通用请求头

~~~http
Content-Type: application/json
X-Request-ID: 018f2a2e-...
Authorization: Bearer <token>
~~~

Authorization 对匿名公共读取可省略。服务端始终返回 X-Request-ID。

## 2. 通用响应

### 成功

~~~json
{
  "data": {},
  "meta": {
    "request_id": "018f..."
  }
}
~~~

### 失败

~~~json
{
  "error": {
    "code": "SNAPSHOT_NOT_READY",
    "message": "该快照还没有完成索引。",
    "details": {},
    "retryable": true
  }
}
~~~

## 3. 健康检查

### GET /v1/health/live

进程存活检查，不访问外部依赖。

### GET /v1/health/ready

检查数据库和必要对象存储。

## 4. 创建仓库

### POST /v1/repositories

请求：

~~~json
{
  "workspace_id": "018f...",
  "source": {
    "provider": "github",
    "url": "https://github.com/owner/repo"
  },
  "ref": {
    "type": "branch",
    "value": "main"
  },
  "options": {
    "local_only": false,
    "include_history": false,
    "ignore": ["docs/generated", "vendor"]
  }
}
~~~

响应 202：

~~~json
{
  "data": {
    "repository_id": "018f...",
    "snapshot_id": "018f...",
    "job_id": "018f...",
    "status": "queued"
  },
  "meta": { "request_id": "018f..." }
}
~~~

支持 Idempotency-Key，重复请求返回同一任务。

## 5. 仓库和快照

### GET /v1/repositories/{repository_id}

返回仓库元数据、最新 Snapshot 和权限。

### GET /v1/repositories/{repository_id}/snapshots

参数：

- page_size：默认 20，最大 100。
- cursor：游标。
- status：queued、indexing、ready 或 failed。

### GET /v1/snapshots/{snapshot_id}

返回固定 Commit、索引版本、统计和状态。

### POST /v1/snapshots/{snapshot_id}/cancel

取消未完成的分析任务。幂等。

## 6. 任务进度

### GET /v1/jobs/{job_id}

~~~json
{
  "data": {
    "id": "018f...",
    "type": "index_snapshot",
    "status": "parsing",
    "progress": 0.42,
    "phase": "解析 TypeScript 文件",
    "processed": 128,
    "total": 342,
    "retryable": false,
    "error": null
  }
}
~~~

### GET /v1/jobs/{job_id}/events

响应类型 text/event-stream：

~~~text
id: 42
event: progress
data: {"phase":"parsing","progress":0.42,"processed":128,"total":342}

id: 43
event: completed
data: {"snapshot_id":"018f...","status":"ready"}
~~~

事件类型为 started、progress、warning、completed、failed、cancelled。

## 7. 架构地图

### GET /v1/snapshots/{snapshot_id}/map

参数：

- level：package、file 或 symbol。
- root_id：可选，限制子图。
- depth：默认 1，最大 4。
- query：节点搜索。
- relation_types[]：关系过滤。
- cursor：大图分页。

响应：

~~~json
{
  "data": {
    "snapshot": {
      "id": "018f...",
      "commit_sha": "a81f2c7",
      "parser_version": "ts-v1"
    },
    "nodes": [
      {
        "id": "symbol:src/auth.ts:login",
        "kind": "function",
        "label": "login",
        "path": "src/auth.ts",
        "range": { "start_line": 18, "end_line": 42 },
        "importance": 0.87
      }
    ],
    "edges": [
      {
        "id": "edge:...",
        "from": "symbol:...",
        "to": "symbol:...",
        "type": "calls",
        "confidence": 0.98
      }
    ],
    "next_cursor": null
  }
}
~~~

## 8. 文件和源码

### GET /v1/snapshots/{snapshot_id}/files

参数：path、language、query、page_size、cursor。

### GET /v1/snapshots/{snapshot_id}/source

必填参数 path；可选 start_line 和 end_line。

~~~json
{
  "data": {
    "path": "src/routes/login.ts",
    "language": "typescript",
    "content": "export async function login...",
    "line_count": 92,
    "commit_sha": "a81f2c7",
    "blob_hash": "sha256:...",
    "truncated": false
  }
}
~~~

服务端必须校验 path 属于 snapshot，禁止目录穿越。

## 9. 搜索

### GET /v1/snapshots/{snapshot_id}/search

参数：

- q：必填。
- mode：text、symbol 或 hybrid，默认 hybrid。
- limit：默认 20，最大 100。

返回结果必须包含证据位置。

## 10. 对话和 AI 问答

### POST /v1/conversations

~~~json
{
  "workspace_id": "018f...",
  "repository_id": "018f...",
  "snapshot_id": "018f...",
  "title": "登录流程"
}
~~~

### POST /v1/conversations/{conversation_id}/messages

~~~json
{
  "content": "登录请求经过哪些模块？",
  "options": {
    "stream": true,
    "provider": "ollama",
    "model": "qwen3:8b",
    "max_tokens": 1200
  }
}
~~~

响应为 SSE。事件：

- retrieval_started
- evidence
- token
- citation
- answer_completed
- answer_failed

answer_completed 必须包含：

~~~json
{
  "message_id": "018f...",
  "answer_status": "grounded",
  "citation_count": 3,
  "snapshot_id": "018f..."
}
~~~

answer_status 只允许 grounded、partial、refused。

## 11. 分享报告

### POST /v1/share-reports

~~~json
{
  "snapshot_id": "018f...",
  "type": "architecture_tour",
  "visibility": "public",
  "sections": ["overview", "map", "reading_path", "qa"]
}
~~~

### GET /v1/share-reports/{slug}

匿名只读接口，只返回报告明确允许公开的内容。

## 12. API 安全要求

- 所有资源 ID 都做 workspace 权限检查。
- 所有分页设置上限。
- 所有用户文本设置长度上限。
- AI 请求设置 Token、并发和超时上限。
- 错误响应不返回堆栈。
- OpenAPI schema 在 CI 中校验。
