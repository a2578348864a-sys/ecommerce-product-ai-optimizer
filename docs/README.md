# 轻选工作台文档中心

这里是当前公开文档的入口。当前产品行为与稳定主链以根目录 [README.md](../README.md)、`main` 分支和本目录的活跃文档为准。

```text
docs/
├── architecture/     # 当前系统架构、证据链和安全设计
├── development/      # 本地开发与贡献
├── deployment/       # 泛化后的部署说明
├── guides/            # 配置与工作流指南
├── decisions/         # 工程决策记录
├── getting-started/   # 安装与首次启动
├── listing-v5/        # 当前 Listing V5 正式收口文档
├── assets/            # 公开截图与静态资源规范
└── archive/           # 历史版本、证据和内部冻结记录
```

## 当前架构与产品

- [系统架构总览](architecture/overview.md)
- [证据链与事实隔离](architecture/evidence-chain.md)
- [安全体系与并发控制](architecture/security.md)
- [AI 工作流机制](architecture/ai-workflow.md)
- [数据模型设计](architecture/data-model.md)
- [认证与配额契约](architecture/auth-and-quota-contract.md)
- [产品全景与业务场景](product/product-overview.md)
- [核心工作流指南](guides/workflow.md)
- [Listing V5 最终收口说明](listing-v5/FINAL_CLOSE_V9.md)

## 开发与贡献

- [快速安装指南](getting-started/installation.md)
- [本地开发与贡献指南](development/local-development.md)
- [参与贡献约定](development/contributing.md)
- [维护者与 Agent 协作规则](development/AGENTS.md)
- [环境变量配置](guides/configuration.md)
- [工程决策记录](decisions/engineering-decisions.md)

## 部署与静态资源

- [初始部署指南](deployment/initial-deploy.md)
- [生产运维手册](deployment/production-runbook.md)
- [静态资源规范与索引](assets/README.md)

部署文档只提供可泛化的流程示例。真实服务器地址、账号、路径、端口和密钥应通过部署环境的私有资料管理，不应写入仓库。

## 历史归档

- [归档总说明](archive/README.md)

`archive/` 下的内容仅用于项目演进记录，不代表当前生产架构、当前数据或当前运行状态。
