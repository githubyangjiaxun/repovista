# RepoVista 工程文档

状态：v1.3 Review Timeline & Signed Notifications 已完成实现与本地发布门禁；远端 CI 结果以 v1.3 验收记录为准（2026-08-28）

本目录描述当前代码，而不是早期愿景。发生冲突时，事实来源优先级如下：

1. 可执行代码和 SQL Migration。
2. `openapi/openapi.json` 与 `packages/contracts`。
3. `docs/decisions` 中已接受的 ADR。
4. 本目录的说明文档。
5. `项目构思.md` 中保留的产品发现和长期设想。

## 架构与数据流

| 文档 | 内容 |
|---|---|
| [系统架构](./architecture/系统架构.md) | Web、API、Worker、PostgreSQL、CLI 和模型适配器的真实拓扑 |
| [领域模型与数据流](./architecture/领域模型与数据流.md) | 仓库、快照、任务、证据、答案与分享报告的生命周期 |
| [ADR 0001](./decisions/0001-implementation-baseline.md) | v0.1 技术选型和明确边界 |
| [ADR 0002](./decisions/0002-v02-update-pipeline.md) | v0.2 增量、多语言、Webhook 与导出的共同边界 |
| [ADR 0003](./decisions/0003-pr-impact-and-editor.md) | v0.3 双快照影响分析、固定 Commit 证据与编辑器安全边界 |
| [ADR 0004](./decisions/0004-transparent-hybrid-retrieval.md) | v0.4 派生向量索引、透明降级、RRF 与 Story 事实边界 |
| [ADR 0005](./decisions/0005-private-repository-auth.md) | GitHub App、短期安装令牌、Session/API Token 与 Workspace 强隔离 |

## v0.2 实施计划

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.2-开发计划.md) | 四项 Roadmap 能力的完整链路、成功标准与非目标 |
| [v0.2 前端开发文档](./frontend/v0.2前端开发文档.md) | Snapshot Delta、Automation 状态和下载交互 |
| [v0.2 后端开发文档](./backend/v0.2后端开发文档.md) | 增量 Planner、Python Adapter、Webhook 与 Export API |
| [v0.2 数据库设计](./database/v0.2数据库设计.md) | Snapshot 基线、Repository 自动更新和 Delivery 幂等表 |
| [v0.2 测试与发布计划](./operations/v0.2测试与发布计划.md) | 自动化、真实仓库、Compose 和发布门禁 |

## v0.3 实施计划（已完成）

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.3-开发计划.md) | Go Parser、PR 影响分析、Web 工作台与 VS Code 扩展的共同链路和完成标准 |
| [ADR 0003](./decisions/0003-pr-impact-and-editor.md) | 双快照、确定性影响图、固定 Commit 证据与编辑器边界 |
| [v0.3 后端开发文档](./backend/v0.3后端开发文档.md) | Parser、GitHub client、Worker、影响算法和 API 实施纪律 |
| [v0.3 数据库设计](./database/v0.3数据库设计.md) | PR Analysis、Impact、Path、Evidence 表与事务不变量 |
| [v0.3 前端开发文档](./frontend/v0.3前端开发文档.md) | Impact Workspace、证据抽屉、分页和可访问性 |
| [VS Code 扩展开发文档](./extensions/vscode扩展开发文档.md) | 固定快照导航、Repository Mapping、安全和打包 |
| [v0.3 测试与发布计划](./operations/v0.3测试与发布计划.md) | 自动化、真实仓库、PR fixture、扩展和 Compose 发布门禁 |
| [v0.3 验收记录](./releases/v0.3-验收记录.md) | 真实 Go、PR fixture、数据库兼容性、Web、扩展和发布审计证据 |

## v0.4 实施计划（已完成）

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.4-开发计划.md) | 真实 Embedding、透明混合检索、Retrieval Lab 与 Architecture Story 的完整链路 |
| [ADR 0004](./decisions/0004-transparent-hybrid-retrieval.md) | Snapshot 派生索引、可变维度 pgvector、RRF 与降级决策 |
| [v0.4 后端开发文档](./backend/v0.4后端开发文档.md) | Provider、Embedding Worker、检索编排、API 与 Story Builder |
| [v0.4 数据库设计](./database/v0.4数据库设计.md) | Embedding Profile、Chunk Vector、Job、事务与查询不变量 |
| [v0.4 前端开发文档](./frontend/v0.4前端开发文档.md) | Evidence Retrieval Lab、Ask Trace、Story v2 与可访问性 |
| [v0.4 测试与发布计划](./operations/v0.4测试与发布计划.md) | 模型协议、数据库、真实 Ollama、检索质量、性能和发布门禁 |
| [v0.4 验收记录](./releases/v0.4-验收记录.md) | 真实 go-chi/chi、Ollama、查询排名、降级、SQL Plan、Story、质量门禁与 Git 审计 |

## v0.5 实施计划（已完成）

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.5-开发计划.md) | 私有 GitHub App、OAuth、Workspace 权限、CLI/Web 与安全完成标准 |
| [v0.5 后端开发文档](./backend/v0.5后端开发文档.md) | Principal、CSRF、Installation、Webhook、Worker 凭据链和 Access Query |
| [v0.5 数据库设计](./database/v0.5数据库设计.md) | User/Session/Token/Workspace/Installation/Audit Migration 与事务不变量 |
| [v0.5 前端开发文档](./frontend/v0.5前端开发文档.md) | Auth Header、Settings、私有 Import/Share、CSRF 与可访问性 |
| [v0.5 测试与发布计划](./operations/v0.5测试与发布计划.md) | 授权隔离、凭据不泄露、PostgreSQL、CLI/Web/API 与部署门禁 |
| [v0.5 验收记录](./releases/v0.5-验收记录.md) | 自动化安全矩阵、PostgreSQL、E2E、Docker、Benchmark、凭据扫描与真实 Fixture 边界 |

## v0.6 实施计划（已完成）

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.6-开发计划.md) | Architecture Guardrails 的规则、边界、完成定义与交付阶段 |
| [v0.6 后端开发文档](./backend/v0.6后端开发文档.md) | Snapshot 读取、确定性规则、API、SARIF 与权限/缓存契约 |
| [v0.6 前端开发文档](./frontend/v0.6前端开发文档.md) | Guardrails Workspace、证据跳转、加载/错误/下载交互 |
| [v0.6 测试与发布计划](./operations/v0.6测试与发布计划.md) | 单元、API、CLI、Web、OpenAPI、Compose 与 Git 发布门禁 |
| [v0.6 验收记录](./releases/v0.6-验收记录.md) | 可复现命令、结果、权限边界、已知限制和远端提交审计 |

## v0.7 实施计划（已完成）

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.7-开发计划.md) | Guardrails Snapshot 基线比较的范围、稳定性与完成定义 |
| [v0.7 后端开发文档](./backend/v0.7后端开发文档.md) | 双快照读取、兼容性/权限门禁、比较 API 与缓存策略 |
| [v0.7 前端开发文档](./frontend/v0.7前端开发文档.md) | 历史 Ready Snapshot 选择、比较状态与双侧证据导航 |
| [v0.7 测试与发布计划](./operations/v0.7测试与发布计划.md) | 单元、API、CLI、Web、E2E、契约与发布门禁 |
| [v0.7 验收记录](./releases/v0.7-验收记录.md) | 可复现结果、已知边界、数据库 Skip 和 Git 远端审计 |

## v0.8 实施完成

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.8-开发计划.md) | 版本化、可审查的 Guardrails Policy Profiles |
| [v0.8 后端开发文档](./backend/v0.8后端开发文档.md) | Profile API、Snapshot 快照、权限和兼容性 |
| [v0.8 数据库设计](./database/v0.8数据库设计.md) | 版本化策略表、外键和事务不变式 |
| [v0.8 前端开发文档](./frontend/v0.8前端开发文档.md) | Guardrails 页策略展示、切换和竞态保护 |
| [v0.8 测试与发布计划](./operations/v0.8测试与发布计划.md) | 各层测试、数据库、E2E、Compose 和 Git 门禁 |
| [v0.8 验收记录](./releases/v0.8-验收记录.md) | 实际门禁结果、数据库 Skip、Git 提交和远端审计 |

## v0.9 实施完成

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.9-开发计划.md) | Verified Guardrail Explanations 的范围、信任边界和完成定义 |
| [v0.9 后端开发文档](./backend/v0.9后端开发文档.md) | 解释 API、权限、证据边界、幂等和错误契约 |
| [v0.9 数据库设计](./database/v0.9数据库设计.md) | 不可变解释、显式 provenance、复合外键和并发唯一键 |
| [v0.9 前端开发文档](./frontend/v0.9前端开发文档.md) | Finding 内解释交互、状态、固定引用和竞态保护 |
| [v0.9 AI 可信解释设计](./ai/v0.9可信解释设计.md) | 固定 Prompt、模型不可信输入、Citation verifier 和拒答 |
| [v0.9 测试与发布计划](./operations/v0.9测试与发布计划.md) | 单元、API、数据库、E2E、Compose 和 Git 门禁 |
| [v0.9 验收记录](./releases/v0.9-验收记录.md) | 实际命令、结果、已知边界、提交和远端审计 |

## v1.0 实施完成

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v1.0-开发计划.md) | Explanation History、逻辑 Finding 身份、结构比较与完成定义 |
| [v1.0 后端开发文档](./backend/v1.0后端开发文档.md) | 历史/比较 API、权限、缓存、cursor 和稳定错误 |
| [v1.0 数据库设计](./database/v1.0数据库设计.md) | `subject_key` 回填、历史索引、查询与迁移不变量 |
| [v1.0 前端开发文档](./frontend/v1.0前端开发文档.md) | 按需历史、分页、双版本比较、竞态和固定 Citation |
| [v1.0 解释历史可信边界](./ai/v1.0解释历史可信边界.md) | 不调用模型、不评判质量、不可伪造逻辑 Finding 身份 |
| [v1.0 测试与发布计划](./operations/v1.0测试与发布计划.md) | 单元、API、数据库、E2E、Compose 和 Git 门禁 |
| [v1.0 验收记录](./releases/v1.0-验收记录.md) | 实际命令、测试结果、边界、提交和远端审计 |

## v1.1 实施完成

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v1.1-开发计划.md) | 两版多语言 Fixture、幂等 Seed、一键 Demo、贡献与部署完成定义 |
| [v1.1 后端开发文档](./backend/v1.1后端开发文档.md) | 离线 Worker Seed、精确 Job Claim、Fake Explanation 和 Compose 生命周期 |
| [v1.1 数据库设计](./database/v1.1数据库设计.md) | 无新 Migration 的正式模型复用、幂等、恢复与保留规则 |
| [v1.1 前端开发文档](./frontend/v1.1前端开发文档.md) | 首页入口、Fixture 标识、能力边界和可访问性 |
| [v1.1 Demo AI 可信边界](./ai/v1.1演示可信边界.md) | Fake Provider 能证明和不能证明的范围 |
| [v1.1 测试与发布计划](./operations/v1.1测试与发布计划.md) | Fixture、PostgreSQL、Compose Smoke、Hardened Overlay 与 Git 门禁 |
| [v1.1 验收记录](./releases/v1.1-验收记录.md) | 实际门禁结果、Compose/数据库证据、边界与 Git 审计 |

## v1.3 实施完成

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v1.3-开发计划.md) | Review Timeline、Signed Notifications 范围、非目标和完成定义 |
| [v1.3 后端开发文档](./backend/v1.3后端开发文档.md) | 历史查询、Endpoint CRUD、Outbox、Worker 和错误契约 |
| [v1.3 数据库设计](./database/v1.3数据库设计.md) | `workspace_notification_endpoints`、`notification_deliveries`、事务和租约不变量 |
| [v1.3 前端开发文档](./frontend/v1.3前端开发文档.md) | Finding 时间线、Webhook 设置、一次性 Secret 和可访问性 |
| [v1.3 人审与 AI 可信边界](./ai/v1.3人审与AI可信边界.md) | 人审、通知、确定性分析和 AI 的隔离边界 |
| [v1.3 测试与发布计划](./operations/v1.3测试与发布计划.md) | 自动化矩阵、SSRF/重试测试和发布门禁 |
| [v1.3 验收记录](./releases/v1.3-验收记录.md) | 实际命令、数据库、CI、Compose 和 Git 证据 |

## v1.2 实施完成

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v1.2-开发计划.md) | Reviewable Guardrails 范围、非目标和完成定义 |
| [v1.2 后端开发文档](./backend/v1.2后端开发文档.md) | Review API、授权、CSRF、审计和错误契约 |
| [v1.2 数据库设计](./database/v1.2数据库设计.md) | `guardrail_reviews`、Migration 0009 和事务不变量 |
| [v1.2 前端开发文档](./frontend/v1.2前端开发文档.md) | Finding 审阅控件、竞态、Viewer 只读和可访问性 |
| [v1.2 人审与 AI 可信边界](./ai/v1.2人审与AI可信边界.md) | Deterministic、Verified Explanation、Human Metadata 分层 |
| [v1.2 测试与发布计划](./operations/v1.2测试与发布计划.md) | API、数据库、CLI、Web、导出和发布门禁 |
| [v1.2 验收记录](./releases/v1.2-验收记录.md) | 实际命令、CI、Migration 和 Git 证据 |

## 前端

| 文档 | 内容 |
|---|---|
| [前端开发文档](./frontend/前端开发文档.md) | Next.js 目录、数据访问、状态与测试规则 |
| [页面与交互规范](./frontend/页面与交互规范.md) | 已实现路由、关键旅程和错误体验 |

## 后端与索引

| 文档 | 内容 |
|---|---|
| [后端开发文档](./backend/后端开发文档.md) | Fastify 请求边界、配置、错误和模块职责 |
| [API 接口契约](./backend/API接口契约.md) | 72 个当前 Operation、Cookie/Bearer、Workspace、策略 Profile、Guardrails/Review/通知/导出/解释历史/结构比较/SARIF、SSE、Retrieval、Story 与 PR Impact |
| [任务与索引流水线](./backend/任务与索引流水线.md) | 租约任务、安全克隆、扫描、解析和持久化 |

## 数据与可信 AI

| 文档 | 内容 |
|---|---|
| [数据库设计](./database/数据库设计.md) | PostgreSQL/pgvector 当前表结构、约束和索引 |
| [迁移与查询规范](./database/迁移与查询规范.md) | Migration、事务、集成测试和查询纪律 |
| [AI 可信问答设计](./ai/AI可信问答设计.md) | 检索、Provider、引用验证、拒答和隐私 |
| [v0.9 AI 可信解释设计](./ai/v0.9可信解释设计.md) | 确定性 Finding 上的可核验辅助解释与 provenance 边界 |
| [v1.0 解释历史可信边界](./ai/v1.0解释历史可信边界.md) | 已验证解释的只读历史与纯结构差异边界 |

## 工程与发布

| 文档 | 内容 |
|---|---|
| [本地开发与部署](./operations/本地开发与部署.md) | pnpm、Docker Compose、环境变量和排错 |
| [测试与质量](./operations/测试与质量.md) | 当前测试矩阵、CI 门禁和发布验收 |

## 维护规则

- HTTP 行为变化必须同步 OpenAPI、共享 Zod Contract 和测试。
- 数据结构变化必须新增前向 SQL Migration，不覆盖已经发布的 Migration。
- Parser 变化必须证明符号、边和行号结果。
- AI 变化必须证明伪造引用会被移除，并记录源码发送边界。
- 文档不能把 Roadmap 能力写成已实现能力。
- 性能数字只有附带数据集、机器和命令后才能成为对外声明。
