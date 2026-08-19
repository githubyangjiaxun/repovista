# RepoVista 工程文档

状态：v0.2 已实现并完成自动化、真实数据库、Compose、公共 Python 仓库与 Webhook 验收（2026-08-20）

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

## v0.2 实施计划

| 文档 | 内容 |
|---|---|
| [版本开发计划](./releases/v0.2-开发计划.md) | 四项 Roadmap 能力的完整链路、成功标准与非目标 |
| [v0.2 前端开发文档](./frontend/v0.2前端开发文档.md) | Snapshot Delta、Automation 状态和下载交互 |
| [v0.2 后端开发文档](./backend/v0.2后端开发文档.md) | 增量 Planner、Python Adapter、Webhook 与 Export API |
| [v0.2 数据库设计](./database/v0.2数据库设计.md) | Snapshot 基线、Repository 自动更新和 Delivery 幂等表 |
| [v0.2 测试与发布计划](./operations/v0.2测试与发布计划.md) | 自动化、真实仓库、Compose 和发布门禁 |

## 前端

| 文档 | 内容 |
|---|---|
| [前端开发文档](./frontend/前端开发文档.md) | Next.js 目录、数据访问、状态与测试规则 |
| [页面与交互规范](./frontend/页面与交互规范.md) | 已实现路由、关键旅程和错误体验 |

## 后端与索引

| 文档 | 内容 |
|---|---|
| [后端开发文档](./backend/后端开发文档.md) | Fastify 请求边界、配置、错误和模块职责 |
| [API 接口契约](./backend/API接口契约.md) | 21 个 v0.2 Operation、信封格式、SSE、Webhook 与导出 |
| [任务与索引流水线](./backend/任务与索引流水线.md) | 租约任务、安全克隆、扫描、解析和持久化 |

## 数据与可信 AI

| 文档 | 内容 |
|---|---|
| [数据库设计](./database/数据库设计.md) | PostgreSQL/pgvector 当前表结构、约束和索引 |
| [迁移与查询规范](./database/迁移与查询规范.md) | Migration、事务、集成测试和查询纪律 |
| [AI 可信问答设计](./ai/AI可信问答设计.md) | 检索、Provider、引用验证、拒答和隐私 |

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
