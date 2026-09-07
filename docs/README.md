# 轻选工作台文档中心 (Documentation Center)

欢迎查阅轻选工作台技术与产品文档库。本文档为仓库完整文档入口与结构索引。

---

## 🧭 文档全景导航

```text
docs/
├── architecture/            # 系统架构、证据链治理与安全设计
├── product/                 # 产品全景、业务旅程与用户角色
├── development/             # 本地开发、环境搭建与代码规范
├── decisions/               # 关键工程技术决策记录 (ADR)
├── assets/                  # 静态截图与架构图资源规范
├── getting-started/         # 极简上手指引
├── guides/                  # 业务配置与详细操作指南
├── deployment/              # 生产环境运维与部署手册
└── archive/                 # 历史演进版本与归档记录 (非权威)
```

---

## 1. 架构与设计 (Architecture & Design)

| 文档 | 核心主题 | 说明 |
| :--- | :--- | :--- |
| [系统架构总览](architecture/overview.md) | 分层设计、数据流向、模块划分 | 系统的整体分层、前后端交互与组件职责划分 |
| [证据链与事实隔离](architecture/evidence-chain.md) | Evidence ≠ Fact、Positive-Allow | 多源客观数据摄取、去噪清洗与不可逆的事实隔离红线 |
| [安全体系与并发控制](architecture/security.md) | CAS 乐观锁、双运行模式、Fail-Closed | 并发零脏写保障、访客沙箱物理切断与命令行白名单 |
| [AI 工作流机制](architecture/ai-workflow.md) | 阶段 A 语义渲染 + 阶段 B 运营润色 | 跨境 Listing 英文受控生成流水线与质量校验 |
| [数据模型设计](architecture/data-model.md) | Prisma ORM Schema 关系 | 候选商品、研究任务、原子事实与版本号模型 |
| [认证与配额契约](architecture/auth-and-quota-contract.md) | Owner / Visitor 权限模型 | 运行模式切换、访问令牌与演示配额机制 |

---

## 2. 产品与场景 (Product & Scenarios)

| 文档 | 核心主题 | 说明 |
| :--- | :--- | :--- |
| [产品全景与业务场景](product/product-overview.md) | 业务定位、用户角色、五大旅程 | 跨境选品操盘手与运营人员的真实工作流与商业价值 |
| [核心业务工作流指南](guides/workflow.md) | 选品导入到 Listing 交付 | 端到端实操指导与各阶段核心输出物说明 |

---

## 3. 开发与贡献 (Development & Contributing)

| 文档 | 核心主题 | 说明 |
| :--- | :--- | :--- |
| [本地开发与贡献指南](development/local-development.md) | 环境搭建、本地启动、测试验证 | 快速开始本地研发、Vitest 测试、代码规范与脱敏约定 |
| [快速安装指南](getting-started/installation.md) | 依赖安装与数据库初始化 | 3 步完成开发环境基础配置与数据库生成 |
| [环境变量配置说明](guides/configuration.md) | Provider 切换与参数详解 | Mock 模式与 Real 模式下的 API 密钥与存储配置 |
| [参与贡献约定](development/contributing.md) | PR 流程与分支规范 | 开源协作流程与提交规范 |

---

## 4. 技术决策 (Engineering Decisions)

| 文档 | 核心主题 | 说明 |
| :--- | :--- | :--- |
| [关键工程决策记录 (ADR)](decisions/engineering-decisions.md) | 架构权衡、技术选型与论证 | 记录为何做 Evidence ≠ Fact、自研 Copy Quality 语法引擎、SQLite CAS 等关键决策 |

---

## 5. 生产与运维 (Deployment & Operations)

| 文档 | 核心主题 | 说明 |
| :--- | :--- | :--- |
| [生产部署标准手册](deployment/production-runbook.md) | 生产部署流水线与运维 | PM2 进程管理、Nginx 反向代理配置与健康检查 |
| [初始部署指南](deployment/initial-deploy.md) | 云服务器初始化与基础环境 | Linux 服务器环境准备与依赖安装 |

---

## 6. 静态资源与历史归档 (Assets & Archive)

- **[静态资源规范与索引](assets/README.md)**：包含工作台截图、架构示意图的规范与引用路径；
- **[历史归档库](archive/README.md)**：存放早期开发阶段报告、演进快照与历史结项记录（仅供追溯参考，不代表当前最新实现）。
