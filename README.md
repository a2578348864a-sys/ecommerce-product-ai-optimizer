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

当前正式 Listing V5 链路为：`Confirmed Facts → Decision / Strategy → Writer → Validator → bounded Repair（必要时）→ Rewrite / Recovery（仅安全失败路径需要时）→ deterministic fallback（最后兜底）→ Human Review`。Confirmed Facts 是商品硬事实的唯一权威；VOC、关键词和竞品只作 reference-only 表达参考，1688 仅作采购参考，不会自动升级为商品事实。最终 Listing 仍需人工审核，本项目不宣称 CTR、CVR 或真实转化提升。

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

### Image Style Library V1（Image Studio 视觉方向）

Image Studio 在「图片用途」之外新增 **8 种视觉方向**，让同一商品事实可以产出视觉语言明显不同的商业图片方向：

| 视觉方向 | 一句话说明 |
| --- | --- |
| 高级白底 `amazon_clean_hero` | 干净棚拍，突出商品主体 |
| 杂志质感 `premium_editorial` | 克制侧光与高级商业摄影 |
| 家居生活 `lifestyle_home` | 自然窗光与真实家庭场景 |
| 户外故事 `outdoor_story` | 自然环境中的使用叙事 |
| 微距细节 `macro_detail` | 突出结构、纹理和工艺细节 |
| 卖点视觉 `feature_board` | 商品主体 + 信息留白 |
| 套装展示 `packaging_set` | 包装、组件和套装规整呈现 |
| Campaign `campaign_visual` | 更强主视觉和广告构图 |

**共享「怎么画」，不共享「什么是真的」**：只有一份风格注册表与一份风格通道构造器，两个入口都复用；事实权限各自独立。

| 入口 | 事实权威（authorityMode） | 事实/上下文块标题 |
| --- | --- | --- |
| `/image-studio?taskId=<id>`（主链：Research → Confirmed Facts → Creative Handoff → 图片） | 研究确认事实 + 已批准视觉参考（`task_confirmed`） | `[CONFIRMED PRODUCT FACTS]` |
| `/image-studio`（独立工具，无 taskId） | 仅用户本次输入 + 用户批准参考图（`user_supplied`） | `[USER PROVIDED PRODUCT CONTEXT]` |

边界（与 Listing 同一条事实纪律）：

- **Confirmed Facts 仍是唯一事实权威**：视觉方向只控制怎么画（构图、灯光、环境、色彩、镜头语言、道具与文字策略），不决定允许画什么。
- 视觉方向**不能**改变商品颜色、形状、材质、数量、配件或包装；缺失事实保持视觉中性，不由风格猜测补齐。
- 用户自由提示词降级为**最低优先级的创意偏好**：它被标记为不可信文本，永远不能覆盖事实安全、商品身份与已批准参考图。
- 冲突时的权威顺序（与 `lib/imagePromptComposer.ts` 写死的优先级一致）：
  **FACT SAFETY > PRODUCT IDENTITY > APPROVED VISUAL REFERENCE > IMAGE PURPOSE > STYLE PRESET > USER CREATIVE PREFERENCE**。
  图片用途高于视觉方向：当用途需要留白标注区、而预设的文字策略禁止文字时，以用途为准（标注区保持留空，不得自行补字）。
- **独立工具不得伪装成研究已确认**：没有 taskId 时不存在 Creative Handoff 与研究确认链，用户文本一律进入 `[USER PROVIDED PRODUCT CONTEXT]` 与不可信围栏段，绝不进入 Confirmed Facts；权限模式缺失或非法时一律 fail-closed 为 `user_supplied`。
- 主链请求体受严格字段白名单校验；视觉方向只作为纯视觉参数经校验后透传，不能替代或绕过 Creative Handoff、用途证据与已批准参考门禁。
- 生成结果仍是**待人工复核的草稿**，不代表真实商品实拍，也不构成认证、性能或上架依据。

实现入口：`lib/imageStyleLibrary.ts`（纯视觉数据）、`lib/imagePromptComposer.ts`（结构化 Prompt 合流 + 权限模式）、`lib/imageHandoff/imagePrompt.ts`（主链风格段，复用同一风格通道）。

Marketing Intelligence、Copy Strategy 和 Planner Strategy Preview 当前是 **sidecar / reference-only** 旁路能力，用于提供买家痛点、市场角度和写作结构参考。它们不直接修改 ListingPlan、不直接进入 deterministic renderer，也不会自动改写最终 Listing 正文。

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

## Demo 与截图

**本地演示（当前唯一正式运行方式）**

```bash
npm install
npm run check:local    # 本地运行门禁：校验 SQLite 与 3005 端口占用
npm run start:local    # 生产模式启动 http://127.0.0.1:3005
```

启动后有两个入口，对应两条能力不同的链路：

| 入口 | 说明 |
| --- | --- |
| `http://127.0.0.1:3005/tasks` → 「商品研究」 | 研究主链：采集证据 → AI 整理 → 人工确认事实 |
| `http://127.0.0.1:3005/image-studio?taskId=<任务ID>` | 研究驱动的图片工作台：使用已确认事实 + 已批准参考图生成候选 |
| `http://127.0.0.1:3005/image-studio`（无 taskId） | 独立图片工具：不依赖研究任务，直接输入创作描述 |

![工作台界面](docs/assets/workbench.png)

**关于在线 Demo**：本项目以本地受控运行为主（依赖本地 SQLite、服务端开关与真实的付费 AI Provider），因此不提供公网公开 Demo；上图为工作台实际界面截图，完整操作路径见 [docs/getting-started](docs/getting-started)。

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

## 历史版本记录

阶段性实验与冻结记录已移出本页，集中归档如下（内容未删除、未改写，仅迁移位置）：

| 历史内容 | 归档位置 |
| --- | --- |
| Listing V5.1 / V5.7 冻结数据与基准 | [docs/history/listing-v5-freeze-notes.md](docs/history/listing-v5-freeze-notes.md) |
| V4 / LangGraph 实验链说明 | [docs/history/v4-langgraph-experiment.md](docs/history/v4-langgraph-experiment.md) |
| V3 / V3.1 / V4 / V4.1 / Listing V5 历史文档目录 | [docs/HISTORY.md](docs/HISTORY.md) |

当前正式状态以本页「当前稳定主链」、`main` 分支与 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 为准。
