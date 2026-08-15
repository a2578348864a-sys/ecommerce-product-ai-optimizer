# V3.5 — Current State Audit（供应链遗产清单）

> 审计日期：2026-08-15；基线 origin/main=4656b0c。
> 目的：识别旧版供应链能力，防止 V3.5 误把旧 Agent 逻辑重新复活。

## 1. 遗产清单

| 旧能力 | 位置 | 当前是否还存在 | V3 是否允许 | 建议 | 分类 |
|---|---|---|---|---|---|
| 旧 AI 货源分析 Agent | `app/api/agents/sourcing/route.ts`（AI 生成 feasibility/summary/searchKeywords/priceBand/moqEstimate/complianceBarrier/logisticsDifficulty/beginnerFit） | 存在（仅被旧 SourcingForm 引用） | **否**（AI 猜测货源可行性/MOQ/合规/物流 = V3 禁止"AI 创造事实"） | 不复活；旧 UI 已迁移 LegacyMigratedPage | **MUST_NOT_REVIVE** |
| 旧利润计算器 | `lib/profit.ts` + `profitSnapshot.ts`（purchaseCost/salePrice/platformFeeRate/estimatedProfit/marginRate/decision=testable/caution/not_recommended） | 存在（被 ai-analysis/keywords/listing-copy/workflows/多个组件引用） | 部分（作为**用户手工输入假设的计算器**可保留；`decision` 字段有"判断"语义需谨慎） | 若保留必须标注 ASSUMPTION_ONLY；AI 不得调用它输出利润结论 | **REFERENCE_ONLY**（如仍活跃则 KEEP 但标注） |
| 旧货源页面 | `app/sourcing/page.tsx` + `components/SourcingForm.tsx` | 已迁移 LegacyMigratedPage（"货源判断已并入商品研究流程"） | 否（旧独立页面模式淘汰） | 不恢复独立页面 | **DEPRECATED** |
| 旧利润表单/卡片 | `components/ProductProfitForm.tsx` / `ProfitSnapshotCard.tsx` | 存在（manual_profit_mvp） | 部分（人工输入假设） | 同利润计算器：ASSUMPTION_ONLY 标注 | **REFERENCE_ONLY** |
| V3 Core 货源证据占位 | `decisionEvidence`（采购价/MOQ/logistics/compliance 全部 unknown） | 存在（主链事实） | 是（V3 主链"未收集=unknown"语义） | **KEEP**（V3.5 若接入应保持 unknown 语义） | **KEEP** |

## 2. V3 主链当前货源状态

- Evidence Workbench「货源 Evidence」区域：显示"货源证据未收集（采购价 / MOQ / 物流均 unknown）"——V3 Core 决策。
- amazon-product-research.v1 第 6 步：固定标记"货源证据未收集（类似产品/价格/MOQ/SKU/supplier 均未知）"；禁止编造采购价、供应商、MOQ。
- Phase 5 learnings 提及的旧 sourcing 输出（moqEstimate 等）在 V3 主链已不再作为事实展示。

## 3. 不得复活清单（MUST_NOT_REVIVE）

1. 旧「AI 供应商/货源分析」：AI 生成 feasibility / priceBand / moqEstimate / complianceBarrier / logisticsDifficulty / beginnerFit 结论。
2. 旧「AI 利润判断」：AI 基于估算自动输出 testable/caution/not_recommended 决策。
3. 旧「AI 合规判断」：complianceBarrier 等 AI 合规结论。
4. 旧独立货源页面模式（已并入工作台研究流程）。

## 4. 可保留/参考清单（REFERENCE_ONLY）

- 利润计算器（纯用户输入假设的计算器）：仅作为 Calculator，不伪装 AI 预测；`decision` 输出语义需在 V3.5 评估中明确限制。
- 旧 SourcingForm 的字段概念（searchKeywords/priceBand/moqEstimate）：仅作为"需要哪些输入"的参考，不复活其 AI 生成逻辑。
