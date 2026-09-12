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

## 一分钟看懂（给非技术读者）

### 1. 它解决什么问题

在 Amazon 上架一个商品，运营者要同时做到两件互相拉扯的事：

- **说得动听**：标题和五点描述要有卖点，能让买家决定下单；
- **说得准确**：出现的每个数字、尺寸、材质、认证都必须有证据，不能编。

人工做这件事既慢又容易出事：抄竞品会踩侵权和虚假宣传，自由发挥会写出"防水""耐用"这类证明不了的话，最后被平台下架或被买家投诉。

轻选工作台把这两件事放进同一个受控流程：**先攒证据 → 人工确认哪些算事实 → AI 只许用这些事实写文案 → 机器校验通过才能用**。

### 2. 用户流程

1. **导入候选商品**：SellerSprite 榜单 Excel，或手工录入 ASIN
2. **采集证据**：Amazon 商品页、关键词与竞品、买家评论（VOC）、1688 货源状态
3. **人工复核**：把证据里的内容逐条确认成"商品事实"（Fact Candidate → Confirmed Fact）
4. **研究归档**：结论存档，生成"创作交接"（Creative Handoff）
5. **Listing 创作**：AI 写文案 → 机器校验 → 人工确认后使用
6. **图片创作**：走同一套受控交接与校验

每一步都留痕：谁确认的、依据哪条证据、用的是哪个版本。

### 3. AI 在哪里工作

| 角色 | 负责 |
| --- | --- |
| **AI（Writer）** | 整理买家声音、提炼卖点结构、把**已确认事实**写成 Listing 文案、生成图片提示词 |
| **人（Owner）** | 决定什么是事实、确认事实、放行最终内容 |
| **确定性代码** | 证据与事实的存储与追溯、文案校验（每句话必须能追到已确认事实）、失败时回退安全模板、权限与配额、失败即关闭 |

关键分工：**AI 负责表达，代码负责判定，人负责授权**。AI 没有任何"自己说了算"的环节。

### 4. 为什么不是"普通聊天机器人"

| 普通聊天机器人 | 轻选工作台 |
| --- | --- |
| 生成即结束，对错自负 | 生成后必须通过**确定性校验**；通不过就重试一次，再不行回退到安全模板 |
| 没有事实来源 | 只有**人工确认过的事实**能进入文案；数字、单位、材质、认证都要对得上 |
| 无法追溯 | 每条内容带证据引用与版本指纹（`contextFingerprint`），可回溯到某次研究修订 |
| 没有边界 | 越权写入、跨用户数据、未授权的真实 AI 调用一律 fail-closed |
| 只回答一次 | 有完整流程状态：候选 → 研究 → 复核 → 交接 → 创作 → 校验 |

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


---

## Listing V5.1 — Listing Intelligence Layer（2026-09-11）

**产品定位**：面向跨境电商新手/小团队的受控研究 + Listing 准备助手；AI 只做表达与组织，事实只能来自人工确认的 Confirmed Facts。

**AI Workflow（V5.1）**
`Research（人工确认）→ Confirmed Facts → Conversion Blueprint 2.0 → Strategy → Writer → Validator →（REPAIRABLE 时）Repair →（仍失败时）诚实 fallback → Studio 展示`

**Fact Authority**
`confirmedFacts`（handoff 中 usageScopes 含 listing）是唯一事实权威；VOC / 关键词 / 竞品 / sourcing 一律为 `UNTRUSTED_REFERENCE_DATA`，只影响表达框架，永不成事实；`references.sourcing` 在 Listing V5 上下文恒为空；Writer 提示不再携带竞品原文（只带可比维度 + 我方 factIds）。

**Conversion Intelligence（V5.1 新增，确定性、零 provider）**
- `Conversion Blueprint 2.0`：`purchaseTriggers[]` / `objectionHandling[]` / `benefitPriority[]` / `decisionSequence[]`，全部绑定 confirmedFacts；
- `Quality Evaluation`（Studio 展示）与 `Conversion Score`（基准测量器）分离，二者都不参与通过/阻断判定；
- Studio 只读展示 Conversion Strategy（购买触发含"有事实支撑"标记、疑虑处理、利益优先级、决策顺序）。

**Benchmark（实测记录，不修饰）**
- V5（writer v4）：3 案真实 provider，平均 Conversion Score **81.3/100**（阈值 75）；
- V5.1（writer v5 决策序列提示）：5 案冻结池实测 **AI 直交 0/5、fallback 5/5**（unsupported claims 3/6/8 条）⇒ 提示**已回滚至 v4**，失败证据留档于 `holdout-evidence/benchmark-v51/`；
- 结论：Blueprint 2.0 保留为附加上下文，Writer 提示仍以 v4 的"事实锚定优先"为基线，后续迭代必须做单变量对照。

**安全不变量**：Validator 是唯一安全门；任何报告层（Quality Evaluation / Conversion Score / 未来 Recovery）不得改写 `validation.status`；确定性代码只做校验/归一/持久化/回退，不重写营销句以求通过。

**回滚**：每个增量独立提交；`/listing-studio-legacy` 回退路由保留；把 `LISTING_V5_WRITER_PROMPT_VERSION` 保持 `v4` 即维持已验证质量。

---

## Listing V5.7 — 冻结里程碑（2026-09-11，历史记录）

> **当前版本已前进到 v6（2026-09-12）**：Validator `listing-v5.validation.v6`、Writer prompt `listing-v5-writer.v6`、Strategy prompt `listing-v5-strategy.v6`（Repair 仍为 `listing-v5-repair.v3`）。
> 最新冻结记录见 `docs/listing-v5/FINAL_FREEZE_V6.md`；本节保留 V5.7 当时的冻结事实，不改写。

**冻结提交**：`235e11b`（其上为 `6f8d6a5`、`e017018`）；分支 `feat/listing-v5-rebuild`。
**版本（V5.7 当时）**：Validator `listing-v5.validation.v4`、Writer `listing-v5-writer.v4`、Strategy `listing-v5-strategy.v4`。

**生成链路（有界，不无限重试）**：
`writer → validate →（REPAIRABLE）repair ≤1 → validate →（未 PASS）rewrite ≤1 → validate →（REPAIRABLE 且 repair 未用过）repair ≤1 → validate →（未 PASS）recovery ≤1 → validate → 确定性 fallback`

**V5.7 三案基线（离线 runner，每案 writer 1 次，无 repair/rewrite/recovery/fallback）**：

| 案 | ASIN | status | unsupported | hardClaim | Conversion Score |
| --- | --- | --- | --- | --- | --- |
| C4 | B0F831L31B | REPAIRABLE | 1 | 0 | 94 |
| C7 | B07CZBNV27 | REPAIRABLE | 2 | 1 | 86 |
| C1 | B0F7K4N6Z3 | REPAIRABLE | 2 | 0 | 87 |
| 合计 | — | PASS 0/3 | 5 | 1 | 平均 89.0 |

**本轮交付的两处 Validator 修复**：
- `6f8d6a5` — model 证据只认 `canonicalField === "series_or_model"`，并新增**伪造型号检测**（`unsupported_model_code`）；
- `235e11b` — hard 词表的**数量枚举语境**不再误报（`in total` / `a total of` / `Total: 4 Pcs` / `total pack size`），绝对语境（`total coverage`、`complete coverage`）继续拦截。同 draft 归因复验：**C1 由 BLOCK → REPAIRABLE**。

**已验证**：`vitest run lib/listingV5` 145/145、两处修复专项测试 15/15、`tsc --noEmit` 0 error。
**已知限制与证据位置**：见 `docs/listing-v57/V57_STATE.md`；实验过程与结论索引见 `docs/listing-v57/RESEARCH_LOG.md`。
**注意**：`contextFingerprint` 计入提示词与校验版本，任何版本变更都会使既有冻结指纹失效，需重新执行 `decision → complete → handoff` 冻结。
