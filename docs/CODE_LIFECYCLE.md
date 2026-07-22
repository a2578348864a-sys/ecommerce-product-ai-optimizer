# 生产代码生命周期

> Source baseline Commit：`e536c8bf9771af1b7d615511fdda8449034d3867`（短哈希 `e536c8b`）
> Source baseline Tree：`a6d8eaf991b6c733bbb862996fe0cf7d4c11b693`
> 审计日期：2026-07-23
> 事实来源：已 fetch 的 `origin/main`，以及基于该基线创建的 `codex/opportunities-form-governance-night` 候选分支；以 tracked 文件、静态 import 图、Route 生命周期和 package/test 配置为依据。
> 排除范围：其他分支的 dirty、未跟踪文件和 Provider 工具均为 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`，不计入生产代码统计。
> 复核要求：生产 Commit 或 Tree 变化后，文件清单、import 图和统计必须全部重算。
> 候选边界：本页统计纳入治理候选新增的 `lib/opportunityCandidateActions.ts`；合入 main 前该文件仍是 `IN-FLIGHT / NOT_PRODUCTION`，也不改变生产部署状态。

## 1. 分类定义

|分类|含义|
|-|-|
|`PRODUCTION`|被正式页面/API/运维合同到达，或属于高级隐藏生产入口。|
|`COMPATIBILITY`|只由旧页面/API 路径到达。|
|`EXPERIMENTAL`|只由 Alpha、诊断、development-only 或单独受控 smoke 路径到达。|
|`ARCHIVED`|已被明确替代且从 Route import 图不可达。|
|`UNKNOWN`|静态不可达、消费者未知或只有文件名暗示用途。|
|`IN-FLIGHT`|只存在于其他本地分支/工作树，不是 production main 文件。|

## 2. 统计口径

范围是 `components/`、`lib/`、`hooks/`、`scripts/` 中 tracked、非测试的 `.ts/.tsx/.js/.mjs` 文件。排除 `*.test.*`、`tests/`、JSON Fixture 和配置文件。

静态 import 图识别字面量 `import`、`export ... from`、动态 `import()` 和 `require()`，再从生产、兼容、实验、归档和未知 Route 入口分别计算可达集合。生产优先级最高。对完全不可达文件再根据替代证据人工区分 `ARCHIVED` 与 `UNKNOWN`。

|目录|PRODUCTION|COMPATIBILITY|EXPERIMENTAL|ARCHIVED|UNKNOWN|合计|
|-|-:|-:|-:|-:|-:|-:|
|`components/`|26|12|3|0|0|41|
|`lib/`|83|2|1|0|2|88|
|`hooks/`|2|0|0|0|1|3|
|`scripts/`|2|0|1|0|2|5|
|总计|113|14|5|0|5|137|

## 3. components/

`PRODUCTION` 是 41 个非测试文件中除下列非生产项外的 26 个文件。核心包括 `AgentRunClient`、`OpportunitiesForm`、`FamilyTop5Review`、`HomeDashboardClient`、`TaskRecordsList`、`TaskRecordDetail`、导航、登录与决策/Listing/图片卡片。

### COMPATIBILITY（12）

- `components/ConfidenceConfirmationCard.tsx`
- `components/cross-border/AiAnalysisPreview.tsx`
- `components/cross-border/KeywordPreview.tsx`
- `components/cross-border/ListingCopyPreview.tsx`
- `components/cross-border/ListingPreviewCard.tsx`
- `components/cross-border/MaterialsForm.tsx`
- `components/cross-border/ProductProfitForm.tsx`
- `components/cross-border/RiskCheckForm.tsx`
- `components/cross-border/SourcingForm.tsx`
- `components/cross-border/SummaryForm.tsx`
- `components/cross-border/listingCopyHistoryApi.ts`
- `components/cross-border/listingCopyStorage.ts`

### EXPERIMENTAL（3）

- `components/ViralMockAgent.tsx`
- `components/cross-border/WorkflowBatchClient.tsx`
- `components/cross-border/workflowBatchRunCache.ts`

### 已退役（4，不计入当前分支统计）

- `components/cross-border/WorkflowClient.tsx` 与 `components/CopyButton.tsx`：由 `a22548930748649fa44458c82d0daacfee75f885` 删除；`/workflow` 已 redirect 到 `/agent/run`，前者运行、动态、测试和配置引用为 0，后者唯一调用者是前者。
- `components/ResultSection.tsx` 与 `components/WorkspacePlaceholderPage.tsx`：由 `be07046920a09308410fb590be3170ceba0b205f` 删除；运行、动态、测试和配置引用均为 0，Git 历史分别证明旧首页引用已移除、所有占位页面消费者已被真实页面替换。

## 4. lib/

治理候选合入后，`PRODUCTION` 共 83 个非测试代码文件，包括：

- Candidate、Evidence、source proof、quality、R2.2 与 Task 领域模块；
- `lib/opportunityCandidateActions.ts`，提供 Candidate 删除 presentation 的纯 module interface；
- `lib/server/` 中认证、Owner/Visitor 分流、Candidate、workflow proof、Listing、图片与 AI gate；
- `lib/workflows/productAnalysis.ts`；
- `lib/upstream/family-top5-adapter.ts` 和 `family-top5-types.ts`，因为 `/opportunities/import` 是高级隐藏生产入口；
- `radarCrawler.ts`、`radarNormalize.ts`、`radarScore.ts`，因为 production source-import 和 opportunities 链仍直接复用。

非生产文件完整清单：

|分类|文件|证据|
|-|-|-|
|`COMPATIBILITY`|`lib/examples.ts`|旧产品页面路径可达。|
|`COMPATIBILITY`|`lib/server/listingCopyHistoryStore.ts`|旧 Listing API 可达。|
|`EXPERIMENTAL`|`lib/server/aiDiagnostics.ts`|只由 production 返回 404 的诊断 API 到达。|
|`UNKNOWN`|`lib/prompt.ts`|只由无站内静态消费者的 `/api/generate` 到达。|
|`UNKNOWN`|`lib/tasks/filterTaskRecords.ts`|0 个非测试 import。|

## 5. hooks/

|分类|文件|证据|
|-|-|-|
|`PRODUCTION`|`hooks/useLocalDraft.ts`|生产页面可达。|
|`PRODUCTION`|`hooks/useSharedProduct.ts`|生产/兼容页面可达，生产优先。|
|`UNKNOWN`|`hooks/useLocalStorage.ts`|0 个非测试 import。|

## 6. scripts/

|分类|文件|证据|
|-|-|-|
|`PRODUCTION`|`scripts/db/protect-sqlite-db.mjs`|package 的 summary/backup/predeploy/postdeploy 脚本直接调用。|
|`PRODUCTION`|`scripts/create-demo-password.mjs`|package `demo:create` 直接调用。|
|`EXPERIMENTAL`|`scripts/real-ai-listing-smoke.ts`|`vitest.real-ai-smoke.config.ts` 唯一指向；不属于默认 `npm test`，运行可能触发真实 AI。|
|`UNKNOWN`|`scripts/create-guest-codes.mjs`|package、生产代码和 tracked 文档中的精确文件引用为 0。|
|`UNKNOWN`|`scripts/release-gate-screenshots.mjs`|package、生产代码和 tracked 文档中的精确文件引用为 0；文件名不足以证明当前发布使用。|

`scripts/db/protect-sqlite-db.test.ts` 属 Testing，不计入上表。

## 7. Artifact 文件

`lib/upstream/fixtures/` 的 8 个 JSON/Sidecar 文件属于 `PRODUCTION / PROTECTED_ARTIFACT`，不计入当前 137 个运行时代码统计：

- Manifest + Manifest Sidecar；
- Family 数据 + Sidecar；
- Provenance + Sidecar；
- 人工审阅 schema + Sidecar。

它们是一个闭包，不能按单文件生命周期删除或修改。

## 8. tools/

Production baseline 中 tracked `tools/` 文件数为 0。

其他开发工作树中的未跟踪 Provider 工具只能标记为：

```text
IN-FLIGHT / LOCAL / NOT_PRODUCTION
```

它们不计入生产代码数量，不属于生产 Artifact 生成能力，也不进入退役候选清单。

## 9. 测试体系

治理候选有 125 个 `*.test.ts`，没有 `*.test.tsx`：

|根目录|数量|
|-|-:|
|`app/`|34|
|`components/`|9|
|`hooks/`|1|
|`lib/`|80|
|`scripts/`|1|

默认 `vitest.config.ts` 使用 Node environment，只包含 `**/*.test.ts`。`tests/helpers/` 有两个辅助模块，不是独立测试入口。真实 AI smoke 由单独配置引用，不能用默认测试通过代替真实调用证明。

## 10. 部署配置

生产 main 的部署文件是：

- `deploy/ecosystem.config.cjs`
- `deploy/nginx.conf.example`
- `deploy/app.service.example`
- `deploy/env.production.example`
- `scripts/db/protect-sqlite-db.mjs`
- `DEPLOY.md`
- `docs/PRODUCTION_RUNBOOK.md`

仓库根不存在 `ecosystem.config.cjs`。治理文档不得写成根路径。

## 11. 本地在途状态

其他开发分支的 16 项 dirty/未跟踪内容整体属于 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`。本文件不逐项继承其代码分类，避免把本地状态伪装成 production main。
