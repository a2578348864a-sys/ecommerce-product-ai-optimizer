# 文档索引

当前文档与历史文档已分离。**本文档为仓库文档入口**。

## 当前文档（权威）

| 文档 | 内容 |
| --- | --- |
| [快速开始](getting-started/installation.md) | 安装、数据库初始化、启动开发服务器 |
| [配置说明](guides/configuration.md) | 环境变量与 Provider 配置 |
| [工作流说明](guides/workflow.md) | 核心业务工作流 |
| [架构总览](architecture/overview.md) | 系统架构 |
| [AI 工作流](architecture/ai-workflow.md) | AI 研究与创作链路 |
| [数据模型](architecture/data-model.md) | Prisma 数据模型 |
| [认证与配额契约](architecture/auth-and-quota-contract.md) | Owner / Visitor 隔离、会话、商品名额的权威契约 |
| [部署手册](deployment/production-runbook.md) | 生产部署标准流程（权威） |
| [初始部署](deployment/initial-deploy.md) | 阿里云初始部署、Nginx、PM2 说明 |
| [参与贡献](development/contributing.md) | 贡献约定 |

## 历史文档（Archived / Not authoritative）

`docs/archive/` 存放开发历史：阶段报告、执行记录、早期设计、历史发布说明。**仅供参考追溯，不代表当前系统状态**；当前实现以代码、测试与上方当前文档为准。

> ⚠️ 注意：旧文档中引用的 `docs/AUTH_AND_QUOTA_CONTRACT.md`、`docs/PRODUCTION_RUNBOOK.md` 等路径，现位于 `docs/architecture/` 与 `docs/deployment/`。
