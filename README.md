<div align="center">

# 轻选工作台

**面向跨境电商（Amazon）的证据驱动型商品研究与 Listing 创作工作台**

<p align="center">
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16.3-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 16" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" /></a>
  <a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" /></a>
  <a href="https://www.prisma.io"><img src="https://img.shields.io/badge/Prisma-SQLite-2D3748?style=flat-square&logo=prisma&logoColor=white" alt="Prisma SQLite" /></a>
  <a href="https://vitest.dev"><img src="https://img.shields.io/badge/Tests-Vitest%20%7C%20Playwright-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" /></a>
</p>

</div>

---

## 项目定位

轻选工作台把跨境电商商品研究、证据核验和 Listing 创作放在同一个 Human-in-the-loop 工作台中。它帮助运营人员把分散的 Amazon、关键词/竞品、买家声音和供应链资料整理成可追溯的研究材料，再由人工确认哪些内容可以成为目标商品事实，最后进入受控的 Listing 与图片创作流程。

系统的核心边界是：**Evidence ≠ Fact**。采集到的页面内容、关键词、评论、竞品表达和 1688 供应商声明都先作为参考资料保存；只有经过人工核验的事实，才可以进入后续创作交接。

## 当前稳定主链

```text
Candidate Pool
    ↓
Product Research
    ↓
Research Collection Orchestrator
    ├─ Amazon 商品资料
    ├─ Keyword + Competitor
    ├─ VOC / 买家评论
    └─ 1688 Sourcing 状态与货源线索
    ↓
Evidence / Pending Review 摘要
    ↓
Fact Candidate
    ↓
Human Confirm
    ↓
Confirmed Facts
    ↓
Research Completion / Research Lifecycle
    ↓
Creative Handoff
    ├─ Listing Studio
    └─ Image Studio
```

Research Collection Orchestrator 统一管理 Amazon、关键词/竞品和 VOC 的采集状态、预览和失败反馈。1688 也会在研究页展示和聚合状态，但真正找货仍需要关键词、商品 URL 或图片等参数化 sourcing 流程；不能把四类来源理解为无条件的一键自动采集。

## 事实与人工确认

每个来源都遵循同一条证据边界：

```text
Evidence
   ↓
Fact Candidate
   ↓
Human Confirm
   ↓
Confirmed Facts
   ↓
Creative Handoff / Listing
```

- Amazon 页面资料可以产生规格候选，但候选仍需人工核对。
- Keyword、Competitor 和 VOC 用于搜索方向、市场表达和用户问题参考，不能未经确认升级为目标商品事实。
- 1688 供应商的材质、承重、包装和规格声明属于供应链参考，不能自动替代 Amazon 商品事实。
- 竞品内容只能作为参考，不能直接复制为本品卖点。

Listing Studio 的生成输入以确认后的事实和创作交接为准；Claim Evidence、事实门禁和文案质量检查会在输出前后继续校验，资料不足时使用受控的安全降级路径。

## 待确认资料与 Preview 边界

研究页会提供短时的待确认 Preview 和 **Pending Review 摘要**，帮助运营按来源查看资料并完成人工核验。这里的 review queue 是由当前研究资料派生出的待审列表，不是消息队列或跨进程持久化任务系统。

Preview 与 task/subject 绑定，确认成功后才会消费；失败时保留可重试路径。当前部分 Preview Store 仍是进程内短时状态，因此它不承诺 durable、跨进程或跨重启恢复能力。

## Research Lifecycle

Research Lifecycle Reader 为 Task List、Task Detail 和 Evidence Workbench 提供统一的核心研究状态快照，包括采集、待确认、人工决定、完成、stale 和创作就绪等状态，并以 fail-closed 方式处理损坏或过期合同。

核心研究页面已经统一使用该 reader；部分历史导航和兼容分类仍保留旧逻辑。它们属于兼容层，不代表全站所有页面已经完成同一字段迁移。

## Creative Handoff 与创作工作台

只有完成事实确认和研究完成条件的任务，才能进入 Creative Handoff。Creative Handoff 将本次创作实际使用的确认事实快照交给：

- **Listing Studio**：生成和复核 Title、Bullets、Description、Search Terms，并经过 Claim Evidence 和 Copy Quality 检查。
- **Image Studio**：基于确认事实和人工批准的视觉参考，组织图片提示词和分镜计划。

Marketing Intelligence、Copy Strategy 和 Planner Strategy Preview 当前是 **sidecar / reference-only** 旁路能力，用于提供买家痛点、市场角度和写作结构参考。它们不直接修改 ListingPlan、不直接进入 deterministic renderer，也不会自动改写最终 Listing 正文。

## V4 / LangGraph 实验链

仓库同时保留一条由 `QX_V4_GRAPH_ENABLED` 控制的 V4 LangGraph 实验链，用于研究图编排、工具合同和回放兼容性探索。它是 feature-flagged secondary workflow；当前稳定商品研究主链仍以 `/tasks` Research Workflow 为准。

## 核心能力

| 能力 | 当前作用 | 边界 |
| --- | --- | --- |
| 多源研究 | 聚合 Amazon、关键词/竞品、VOC 和 1688 研究资料 | 采集结果先是 Evidence，不自动成为事实 |
| Human Confirm | 运营逐项确认 Fact Candidate | 未确认内容不能作为目标商品硬事实 |
| Research Lifecycle | 统一核心研究页面的状态读取 | 历史导航仍有兼容逻辑 |
| Creative Handoff | 把完成研究的确认事实交给创作工作台 | 服务端门禁先于生成和保存 |
| Listing Studio | 生成、质检、复核和导出 Listing | 以 Confirmed Facts 和 Claim Evidence 为依据 |
| Image Studio | 规划图片提示词和视觉交付 | 需要人工批准的视觉参考或符合门禁的事实 |
| Marketing Intelligence | 分析 VOC、关键词、竞品和供应链表达方向 | reference-only，不进入事实库或 renderer |
| V4 LangGraph | 实验性的研究图和工具合同 | 默认关闭，不是当前正式主链 |

## 快速上手

### 环境准备

- Node.js `≥ 20.9.0`
- npm `≥ 10.0.0`

### 安装

```bash
git clone https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer.git
cd ecommerce-product-ai-optimizer
npm install
```

### 初始化本地数据库与配置

```bash
npx prisma generate
npx prisma db push
cp .env.example .env.local
```

本地默认可以使用 Mock 模式完成离线流程演示；Amazon、1688 实时采集和真实图片生成需要相应的登录、环境配置或显式授权。

### 启动

```bash
npm run dev:local
# 或
npm run start:local
```

在终端输出的本地地址访问工作台，例如 `http://localhost:3000` 或 `http://127.0.0.1:3005`。

### 工程检查

```bash
npm run test
npx tsc --noEmit
npm run lint
npm run build
```

## 技术栈

| 领域 | 技术 |
| --- | --- |
| 前端 | Next.js App Router、React、TypeScript、Tailwind CSS |
| 服务端 | Next.js API Routes、Node.js、研究编排服务 |
| 数据 | Prisma、SQLite、CAS 版本控制 |
| 采集 | Chrome DevTools Protocol、受控 1688 sourcing CLI |
| 验证 | Vitest、Playwright、ESLint、TypeScript |

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [文档中心](docs/README.md) | 技术文档与操作指南总览 |
| [系统架构](docs/architecture/overview.md) | 分层设计、数据流和组件职责 |
| [证据链](docs/architecture/evidence-chain.md) | Evidence、Fact Candidate、Confirmed Facts 的边界 |
| [安全架构](docs/architecture/security.md) | 运行模式、CAS 和 fail-closed 契约 |
| [产品概览](docs/product/product-overview.md) | 产品流程和业务场景 |
| [本地开发](docs/development/local-development.md) | 环境搭建和贡献指南 |
| [工程决策](docs/decisions/engineering-decisions.md) | 关键设计权衡和 ADR |
| [生产运维](docs/deployment/production-runbook.md) | 生产部署参考手册 |

## 当前限制

- 1688 是参数化 sourcing 流程，不保证在没有关键词、URL 或图片输入时自动找货。
- Preview 是短时进程内状态，不是 durable storage。
- 核心研究页面已使用 Research Lifecycle Reader，但历史导航和兼容分类仍未完全迁移。
- V4 LangGraph 是 feature-flagged secondary workflow，默认不参与正式 `/tasks` 研究主链。
- Marketing Intelligence、Copy Strategy 和 Planner Strategy Preview 仅供人工策略参考，不自动修改 Listing。

## 许可证

本项目采用 [MIT License](LICENSE)。
