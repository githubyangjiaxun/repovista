# ADR 0004：透明混合检索与 Snapshot 派生向量索引

状态：Accepted（v0.4）  
日期：2026-08-20

## 背景

RepoVista v0.3 的 `text | symbol | hybrid` 只是 API 预留，三个 Mode 实际走同一条全文/符号
查询；`code_chunks.embedding vector(1536)` 也从未写入。若直接把“Hybrid”宣传成语义 RAG，
用户无法判断是否真的调用了 Embedding、结果为何排名、模型停机后发生了什么。

另一个问题是 Vector Dimension。Ollama 和 OpenAI-compatible 模型的维度并不统一，把所有
Chunk 强塞进固定 `vector(1536)` 会限制模型选择，并可能让同一 Snapshot 混入不同语义空间。

## 决策

1. Embedding Index 是 Ready Snapshot 的版本化派生资源，不改变 Snapshot 的 Commit、Parser、
   Source、Graph 或 Ready 状态。
2. 以 `(snapshot, provider, model, inputVersion)` 定义唯一语义空间。一个 Index 内 Vector 维度
   必须一致，不同 Index 可以有不同维度。
3. 新 Vector 存储在 `code_chunk_embeddings.embedding vector`（无固定 typmod）中；通过
   `embedding_index_id` 先缩小到单一维度空间，再执行 Cosine Distance。v0.4 不建立跨模型 ANN。
4. Full-text、Symbol 和 Semantic 是独立候选通道。Hybrid 使用确定性 Reciprocal Rank Fusion，
   Response 暴露每个通道的状态、排名、Raw Score 与 Profile。
5. Semantic-only 在没有可查询 Index 时失败；Hybrid 允许透明降级，但必须返回
   `degraded=true` 与稳定原因。任何降级都不能伪装成使用过 Embedding。
6. Ask 与 Search 共享同一 Retriever；模型只消费选出的 Evidence，Citation 仍由服务端按 ID
   重建。
7. Architecture Story 的事实由纯 Story Builder 从固定图生成。Embedding Profile 只作为
   Provenance，不允许模型或 Vector Search 发明系统结构。

## 不变量

- `embeddingIndex.snapshotId === codeChunk.snapshotId === embeddingRow.snapshotId`。
- Index Ready 时 `embeddedChunks === totalChunks`，且每行 `content_hash` 等于当前 Code Chunk。
- 同一 Index 的所有 Vector `vector_dims` 与 Index `dimensions` 相等，数值有限且非零。
- Query Vector 的 Provider、Model 和 Dimensions 必须与 Ready Index 完全相同。
- Search Hit 必须来自请求 Snapshot；Path、Commit、Range 与 Content Hash 由数据库返回。
- RRF 排序使用稳定 Tie-breaker，不能依赖数据库未指定顺序。
- Provider Secret 不持久化，不出现在 Event、Error、Trace、Story 或日志正文中。

## 取舍

- 选择 Snapshot 范围 Exact pgvector Search，换取可变维度、简单一致性和小仓库可复现结果；
  代价是超大型仓库暂时没有 ANN 加速。真实基准将决定后续是否按维度/Profile 建 HNSW。
- 选择显式 Build Job，而不是索引完成后自动调用模型，避免未授权成本和本地模型依赖；代价是
  用户需要一次点击或 CLI 命令。
- 选择 RRF 而不是手调 Text/Vector 权重，避免不同评分尺度直接相加；代价是 Raw Score 只用于
  解释通道内部排序，不代表统一概率。
- 选择独立 Embedding Provider 配置，不复用 Chat Provider，避免 `fake` Chat 被误认为真实 AI。
- 选择 Story 的确定性事实模板而不是自由模型写作，优先保证可验证、可重建和可公开分享。

## 兼容性

- 旧 Migration 和 `code_chunks.embedding vector(1536)` 保留但不再作为 v0.4 事实来源。
- v0.1-v0.3 Ready Snapshot 无需重建即可创建新的派生 Embedding Index。
- 旧 Search 客户端仍可读取 `results`，但 OpenAPI 和共享 Contract 升级后应使用 Trace。
- v1 `architecture_tour` JSON 继续通过 Union Contract 读取；新 Share 写 v2。

## 安全与隐私

Embedding 会把截断后的公开仓库源码发送到用户配置的 Endpoint。RepoVista 必须在 UI、README
和配置文档中说明该边界。Provider URL 只来自进程配置，Repository 内容不得影响 URL/Header。
本版本仍只支持公共 GitHub 仓库，不保存 API Key，也不会下载或执行仓库代码。

