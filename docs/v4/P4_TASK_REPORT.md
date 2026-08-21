# P4 TASK_REPORT — 商业可行性（V4-FINAL-R2）

- 判定：**PASS**（必测 6/6；B1 基线遗留单列）
- executionBatch：V4-FINAL-R2-P4-20260821-2220；authorityChecksum：`848bc4f0…`
- 报告时间：2026-08-21 14:56:33 +08:00；集成 HEAD（提交时）：待收口 commit（见 git log）
- 角色：Lead（契约/公式裁定/stale 语义/API/接线/E2E）；A（确定性 Calculator + 24 金标）；B（Commercial/Gate B UI + 12 测试）；C（费用来源/边界评审）

## 目标与达成
| 目标 | 达成 | 证据 |
|---|---|---|
| 无 LLM 算术的确定性三情景 | ✅ | calc.ts 纯函数；SCENARIO_MULTIPLIERS 冻结；live：三情景+敏感变量+MOQ 占款 |
| 输入分类（source/owner/assumption）+ 单位/币种/时间 | ✅ | CalcInput 类型；optional 未填→unknowns/未覆盖成本 |
| MVP 必需 + 可选情景 unknown | ✅ | 缺 freight/佣金/履约/尺寸/重量 → blocked_missing_input（live 400 列出缺失项） |
| 公式/规则带 version/marketplace/category/reviewedAt/sourceUrl + stale | ✅ | CalcRuleMeta；effectiveDate 语义（P4-C R1 裁定）；stale→RULES_STALE 阻止 content_ready |
| 乐观/基准/悲观 landed cost、广告前 margin、margin rate、break-even、MOQ 占款 | ✅ | ScenarioResult 全字段；live baseline margin 43.8% |
| 敏感变量 + unknown + 未覆盖成本 | ✅ | sensitiveVariables top3（fxRate/fulfillment/freight）；unknowns 显式 |
| Gate B 四选项（书内权威词汇） | ✅ | gateB.ts + GateBPanel：content_ready/revise_product/needs_information/abandon；stop=abandon 需原因；只由人提交 |
| Gate A/B 返回路径（needs_information/revise_product/abandon 路由） | ✅ | graph gateARoute/gateBRoute：needs_information→assess_gaps、revise_product→product_fact_gate、needs_information(B)→commercial_check、abandon→cancel |
| 不输出月赚金额；不做 ERP/会计 | ✅ | 无相关输出（测试断言） |
| product-strategy Skill（hypothesis 只读） | ✅ | skills/v4/product-strategy.md |

## 文件
A：lib/v4/calculator/calc.ts + calc.test.ts（24 金标）+ skills/v4/product-strategy.md；B：CommercialPanel + GateBPanel + 测试（12）；Lead：contract.ts（含 SCENARIO_MULTIPLIERS/effectiveDate/可空费率）、gateA/gateB 权威选项、graph commercial_check（读 commercialJson；waiting_input 路径）+ Gate 路由、commercial API + commercialJson 迁移、UI 接线、测试适配。

## 命令与结果
| 命令 | 结果 |
|---|---|
| npx tsc --noEmit | exit 0 |
| npx vitest run lib/v4 app/v4 components/v4 app/api/v4 | 36 files / 335 passed |
| npm test 全量 | 5674 passed / 1 failed（B1 基线）/ 89 skipped |
| 浏览器 E2E | 全链（P4_E2E_EVIDENCE.md） |

## 边界遵守
无 LLM 算术；第三方/历史销量不写未来；合规/IP 非法律结论（P5 范围外未开始）；Gate A/B 人工。

## 风险/下一步
- B1 基线待用户裁定（同前）。
- P4 PASS → 按授权进入 **P5（内容 Skills/Guards：ContentHandoff、Listing/Image Skills、合规/视觉核对、内容审核）**。
