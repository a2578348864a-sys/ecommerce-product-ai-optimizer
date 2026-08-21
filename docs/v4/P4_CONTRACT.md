# P4 Commercial Feasibility — 冻结契约（Wave 0）

- executionBatch：V4-FINAL-R2-P4-20260821-2220；authorityChecksum：`848bc4f0…`
- baseCommit：`f9657f9`（P3 PASS 后 main）

## 0. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | Calculator 为纯确定性函数（无 LLM 算术）：`calc-commercial.v1`；公式版本/marketplace/category/reviewedAt/sourceUrl 随输出返回 | 06 Commercial Calculator |
| D2 | 输入分类：source value（有来源）/owner input（用户录入）/assumption（假设）；每项带单位/币种/时间；MVP 必需=采购价、MOQ、售价、尺寸重量、基础头程、平台佣金/履约费、币种、汇率；可选（包装/样品/仓储/退货/关税/广告）未填→unknown+显示未覆盖成本 | P4 卡 |
| D3 | 三情景：baseline=输入原值；optimistic=头程×0.9+汇率有利+退货率 0；pessimistic=头程×1.3+汇率不利+退货率应用；全部确定性 | P4 卡 |
| D4 | 输出：三情景 landed cost、广告前贡献利润、margin rate、break-even（销量）、MOQ 最低占款；敏感变量=各输入±10% 对 margin 影响排序；unknowns 列表 | P4 卡 |
| D5 | 规则 stale：reviewedAt 超过 90 天（now 注入）→ rules_stale 状态，阻止 content_ready 或需人工确认 | P4 卡必测 |
| D6 | Gate B 四选项：proceed / get_more_info / modify_product / stop；记录理由+revision；只由人提交 | P4 卡 |
| D7 | product-strategy Skill：只输出 hypothesis/差距/验证动作（不做 Strategy Agent） | P4 卡 |
| D8 | 不输出月赚金额（除非用户输入销量并标 scenario）；不做 ERP/库存/会计 | P4 卡 |

## 1. 文件所有权
| Owner | 路径 |
|---|---|
| Lead | docs/v4/P4_*、lib/v4/calculator/contract.ts（类型+版本冻结）、lib/v4/gateB.ts、graph commercial_check/gate_b 接线、app/api/v4 计算端点、stale 门禁 |
| A（worktree codex/v4-p4-calc） | lib/v4/calculator/calc.ts（纯函数实现）+ calc.test.ts（金标：币种/单位/零/负数/缺失/区间/四舍五入/确定性/敏感变量/stale）+ skills/v4/product-strategy.md |
| B（worktree codex/v4-p4-ui） | components/v4/CommercialPanel.tsx + GateBPanel.tsx + 测试（三情景展示/公式展开/选项表单） |
| C（只读） | 官方费用来源（Amazon fee 文档 URL 基准）、边界与 unknown fixtures 评审 |

## 2. 必测（Gate）
1. 公式金标+边界（币种/单位/零/负数/缺失/区间/四舍五入）；2. 同输入同版本结果确定一致；3. 缺尺寸/重量/category→unknown/blocked；4. 敏感变量影响材料但不自动决定；5. 规则 stale 阻止 content_ready/要求确认；6. 真实浏览器三情景+公式展开+Gate B，刷新一致。
## 3. 边界：无 LLM 算术；第三方/历史销量不写未来；合规/IP 非法律结论；不开始 Listing/Image。
