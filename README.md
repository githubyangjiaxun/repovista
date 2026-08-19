# RepoVista 开发文档

RepoVista 是一个 **AI 原生、Local-first 的代码仓库地图与新人上手助手**：

> 把代码迷宫，变成一张可以探索、验证和分享的地图。

项目的核心原则是：

> AI 负责解释代码，代码负责提供证据。

静态分析、Git 历史和符号关系是可信地基；AI 是可选的解释层。即使没有配置模型，用户也应该能够导入仓库、查看架构图、搜索符号和浏览源码。

## 文档入口

- [项目构思与产品路线](./项目构思.md)
- [文档导航](./docs/README.md)
- [系统架构](./docs/architecture/系统架构.md)
- [领域模型与数据流](./docs/architecture/领域模型与数据流.md)
- [前端开发文档](./docs/frontend/前端开发文档.md)
- [页面与交互规范](./docs/frontend/页面与交互规范.md)
- [后端开发文档](./docs/backend/后端开发文档.md)
- [API 接口契约](./docs/backend/API接口契约.md)
- [索引任务流水线](./docs/backend/任务与索引流水线.md)
- [数据库设计](./docs/database/数据库设计.md)
- [数据库迁移与查询规范](./docs/database/迁移与查询规范.md)
- [AI 可信问答设计](./docs/ai/AI可信问答设计.md)
- [本地开发与部署](./docs/operations/本地开发与部署.md)
- [测试与质量](./docs/operations/测试与质量.md)

## 推荐阅读顺序

1. 先看 [项目构思与产品路线](./项目构思.md)，理解为什么做和 v0.1 的边界。
2. 再看 [系统架构](./docs/architecture/系统架构.md)，理解组件职责和依赖方向。
3. 前端开发者阅读 [前端开发文档](./docs/frontend/前端开发文档.md) 和 [页面与交互规范](./docs/frontend/页面与交互规范.md)。
4. 后端开发者阅读 [后端开发文档](./docs/backend/后端开发文档.md)、[API 接口契约](./docs/backend/API接口契约.md) 和 [索引任务流水线](./docs/backend/任务与索引流水线.md)。
5. 涉及数据的改动先阅读 [数据库设计](./docs/database/数据库设计.md) 和 [数据库迁移与查询规范](./docs/database/迁移与查询规范.md)。
6. 涉及模型、检索或答案生成时阅读 [AI 可信问答设计](./docs/ai/AI可信问答设计.md)。
7. 开始开发前阅读 [本地开发与部署](./docs/operations/本地开发与部署.md) 和 [测试与质量](./docs/operations/测试与质量.md)。

## v0.1 开发边界

### 必须完成

- 导入公开 GitHub 仓库。
- 首批支持 TypeScript / JavaScript。
- 生成目录、文件、符号和基础依赖关系。
- 提供包级、文件级、符号级架构视图。
- 点击节点查看固定 Commit 的源码。
- 生成新人阅读导览。
- 提供带文件路径和行号的 AI 问答。
- 支持云端 OpenAI-compatible 模型和 Ollama 本地模型。
- 支持 Docker Compose 本地启动。
- 生成固定到 Commit 的公开分享页。

### 明确暂不做

- 执行被分析仓库中的代码。
- 自动修改用户代码。
- 同时支持十几种语言。
- 微服务拆分、计费和复杂企业权限。
- 把 AI 答案作为未经验证的事实。

## 贡献约定

- 文档先于大范围代码改动更新。
- 每个跨模块改动都要说明 API、数据迁移和回滚方案。
- 新增解析规则必须补 Golden Test。
- 新增 AI 能力必须说明证据来源、失败行为和隐私影响。
- 任何性能数字都要附测试数据集和机器配置。
