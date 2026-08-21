# P3 E2E 证据 — Gate A → 1688 → Fact Gate（V4-FINAL-R2）

- Journey：V4-P3-E2E-01；Commit 9e6109c；3005 local_owner flag on；recorded 工具
- runId（脱敏）：5fcf7b59-…（全链）、014a3286-…（Fact Gate 三态）

| # | 动作 | 结果 | PASS |
|---|---|---|---|
| 1 | POST /runs → PLAN_REVIEW | 201 rev4 | ✅ |
| 2 | resume continue → GATE_A | waiting_human@gate_a（rev14，决策+note 入事件） | ✅ |
| 3 | resume continue → FACT_GATE | waiting_human@product_fact_gate（rev17） | ✅ |
| 4 | resume continue → GATE_B | waiting_human@gate_b（rev20） | ✅ |
| 5 | GET report | 200（证据+缺口） | ✅ |
| 6 | Fact Gate 三态（run 014a3286） | 自动晋级→400 auto_promotion_blocked；伪造引用→400 fact_provenance_failed；人工确认(method=document+refs)→201 | ✅ |
| 7 | GET facts | 201 记录可见（field=material,status=confirmed,revision=1） | ✅ |
| 8 | FactGatePanel UI | 「产品事实」面板渲染（7 matches） | ✅ |
| 9 | flag off 恢复 | /api/v4/runs→404、V3.1 health 200 | ✅ |

截图：page-2026-08-21T14-07-13-904Z.png（Fact Gate 控制台）等存 `D:\Workspace\tmp\v4-p1-evidence\`。

## 结论
**PASS**。SupplierClaim 自动升级 0、variant 错配 0（adapter WE 测试）、Fact revision 历史完整（追加式，撤销/冲突可见）。
