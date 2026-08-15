# V3.5 — Proposal（1688 Sourcing Evidence Value Assessment）

> 状态：评估提案（非开发授权）。第一性原理：先拆"去 1688 找货"包含哪些完全不同任务，再逐项判断可支持性。

## 1. 任务拆解（任务书三节）

| 任务 | 页面 Evidence 可支持 | 只能形成线索 | 必须人工确认 | 需要真实询盘 | 需要业务经验 | 当前不该做 |
|---|---|---|---|---|---|---|
| A. 找相似商品 | ✓（用户搜索） | — | — | — | — | — |
| B. 找供应来源 | ✓（URL/店铺） | — | — | — | — | — |
| C. 比较页面报价 | ✓（displayedPrice 三态） | — | — | — | — | — |
| D. 比较 MOQ | ✓（displayedMOQ 原文） | — | 语义确认 | ✓ | — | — |
| E. 比较规格 | ✓（specs 快照） | — | 口径确认 | ✓ | — | — |
| F. 比较材质 | — | ✓（Seller Claim） | ✓ | ✓ | — | — |
| G. 包装/定制能力 | — | ✓（Seller Claim） | ✓ | ✓ | — | — |
| H. 判断供应商可信度 | — | ✓（Platform Metadata 仅展示） | ✓ | ✓ | ✓ | **不做自动判断** |
| I. 判断真实采购成本 | — | — | ✓ | ✓ | ✓ | **不做（页面价≠成本）** |
| J. 判断国际物流成本 | — | — | — | ✓ | ✓ | **不做（unknown）** |
| K. 判断是否适合出口 | — | — | — | ✓ | ✓ | **不做（合规 unknown）** |
| L. 判断最终利润 | — | — | — | — | ✓ | **不做（PROFIT=ASSUMPTION_ONLY）** |
| M. 判断是否值得采购 | — | — | — | — | ✓ | **不做（V3 铁律）** |

**关键结论**：页面 Evidence 只支持 C/D/E 的"展示层"；H-M 全部超出页面证据能力。

## 2. 评估结论（V3_5_VALUE）

**V3_5_VALUE = NARROW_APPROVAL**（待用户独立审查确认）

理由：
- 供应线索（人工导入 URL/页面快照 + 匹配证据 + unknown + 询盘问题）价值明确、边界清楚、小白可懂、与 V3 Evidence 架构一致（DO_NOW）。
- 自动搜索/匹配/评分/利润/推荐在当前数据真实性下**不可做**（登录墙实测 + 同款误判风险 + 无真实成本）。
- 不重建旧 Supplier/Profit/Compliance Agent。

## 3. 最大允许范围（若推进正式开发，任务书四十节冻结）

**允许**：
- 用户提供 1688 URL / 人工粘贴页面数据（人工导入）
- 保存页面快照：displayedPrice（三态）/displayedMOQ（原文）/specs/Seller Claims/Platform Metadata（仅展示）
- 匹配证据清单（consistent/inconsistent/unknown）+ 五态 matchAssessment（无概率）
- Evidence Matrix 多候选对比（标注"非推荐"）
- unknowns + 人工询盘问题清单（Question Generation）
- AI（若引入）：中文解释/差异提取/生成询问问题——白名单 + evidenceRefs/fail-closed 模式

**禁止**：
- 自动选供应商 / 自动推荐采购 / 真实利润 / 自动询盘 / 自动下单 / 合规判断
- Supplier Score / 匹配概率 / AI 宣称可靠或同款
- 自动搜索/翻页/图片搜同款（登录墙 + 误导风险）
- 复活旧 Supplier/Profit/Compliance Agent

## 4. 变更包（本 Change Package）

proposal / current-state-audit / field-availability / real-case-study / risk-analysis / product-options / recommended-contract / value-assessment / browser-feasibility / final-report
