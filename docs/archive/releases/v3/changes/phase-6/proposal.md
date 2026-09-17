# Phase 6 提议 — 人工决定、Handoff、旧链收口

> 来源：`14_PHASE6_TASK.md`、`decisions.md §4/§7`（Phase 0 裁定）、`00_MASTER_EXECUTION.md §7`（V3_CORE 强制暂停）
> 状态：执行中

## 1. 目标

完成 V3 Core 收口：确认四态人工决定与「进入内容制作」Action 链路、Handoff 复用现有合同且门禁有效、Studio 不重建只验证、旧链按 Phase 0 裁定收口；完成 9 步 Core Smoke 矩阵；输出 `V3_CORE = DONE` 并按原合同强制暂停。

## 2. 范围（以验证与裁定收口为主，不做重构）

- **人工决定**：四态（pending/continue/need_info/rejected）继续复用；「进入内容制作」是人工 Action（creative-handoff 创建），不是状态（Phase 0 裁定 §2.1a 决策语义钉死保持）
- **Handoff**：复用 product-creative-handoff.v1 / listing-keyword-brief.v1 / listing-handoff / image-handoff 现有合同；验证 Action 前条件（facts 确认、Keyword Brief 确认、Unknown 未填、来源可追溯、humanReviewRequired）
- **Studio**：不重建；只验证 Listing 不越权、Image 不虚构、real AI gate 继续有效
- **旧链**：按 Phase 0 裁定核对现状（停新入口 / redirect / 只读兼容 / 退役候选）；风险 #1/#2/#4/#5/#9 统一裁定收口
- **Core Smoke**：9 步矩阵（自动化覆盖证据 + 本地人工页面步骤）

## 3. 不做

- 不删除旧 API（外部契约兼容，AGENTS.md Route 契约不批量改写）；旧链的退役 = 停止新入口（Phase 0 已生效）+ 不再扩展 + 文档化
- 不重构 creative-handoff / Studio；不改 research-decision 写合同；不新建 Prisma 表
- 不启动 V3.x；不公网部署

## 4. Gate（14_PHASE6_TASK）

- 四态复用 + 人工 Action 链路验证
- Handoff 门禁（facts/Keyword Brief/unknown/追溯/humanReviewRequired）
- Studio 三项验证
- 旧链收口核对
- 9 步 Core Smoke
- lint/tsc/test/build

## 5. 风险收口裁定（decisions.md §7）

| # | 风险 | Phase 6 裁定 |
|---|---|---|
| 1 | 任务级 AI Listing 不受 OPENAI_LISTING_ENABLED 控制 | **文档化裁定**：任务级 listing 属 handoff 链（确认事实 + humanReviewRequired + creativeHandoffGate + provider 治理），开关语义属于独立 Studio 模式 → 「handoff 后默认允许」正式文档化，不补开关检查；风险关闭 |
| 2 | 旧 AI 入口（/api/generate、/api/agents/*5） | 停新入口已生效（0 页面 import）；API 保留兼容不扩展；退役候选确认；风险关闭 |
| 4 | category_current 候选源快照硬编码 | **已按 Phase 1 裁定落实**：CC 只走批次链（product-batch-candidate-source.v1 动态 reportType，无硬编码）；旧链快照缺陷随旧链停用收口；风险关闭 |
| 5 | 旧 listing-copy 链无 gate | 页面已停新入口（/products/new 无站内入口）；API 保留兼容；退役候选；风险关闭 |
| 9 | 外部抓取出口 2 处无调用方 | crawl/source-import 无页面调用方（0 页面 import），保留兼容不扩展；视觉参考导入为受控出口；风险关闭 |

## 6. 产出

- proposal.md（本文件）、validation.md（验证矩阵 + Smoke）、learnings.md
- CURRENT_WORK 最终状态 + V3 Core 最终报告（24_FINAL_REPORT_TEMPLATE）
