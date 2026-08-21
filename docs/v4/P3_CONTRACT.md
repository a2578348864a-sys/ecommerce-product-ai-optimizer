# P3 Supplier & Fact Gate — 冻结契约（Wave 0）

- executionBatch：V4-FINAL-R2-P3-20260821-2135；authorityChecksum：`848bc4f0…`
- baseCommit：`97d15c7`（P2 PASS 后 main）

## 0. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | SupplierClaim→ConfirmedFact 规则：只有人工在 Fact Gate 逐项确认才晋级；validator 阻断任何自动晋级（claimRefs 必须有对应人工 confirmationMethod + actor + revision）；页面 304/宣传 ≠ Confirmed 304 | P3 卡 + 00 冻结语义 |
| D2 | 事实存储 = 追加式 `V4FactRecord`（每项确认/reject/unknown/conflict/revoke 一行，revision 单调）；当前事实 = 每 (runId, offerIdentity, variantKey, field) 最新行；撤销产生新 revision，历史完整可读 | P3 卡「Fact revision 历史完整」 |
| D3 | variant/offer identity 复用 1688 contracts（lib/upstream/1688/contracts.ts）：offerIdentity + variantKey + 价格梯度/阶梯价/MOQ 不归一；variant 错配→WRONG_ENTITY 阻断（接受数 0） | P3 卡 |
| D4 | supplier_research 节点复用现有 1688 Search→Preview→Human Confirm→Evidence 语义：adapter（recorded/live）输出 SupplierCandidate/SupplierClaim/待询问题，读 1688 contracts 类型；不另造平行流程 | P3 卡 |
| D5 | Gate A：resume 载荷记录 decision（continue_sourcing / stop / revise）+ reason + revision；Gate A 不自动通过 | P3 卡 |
| D6 | Fact Gate UI：按 SKU/variant 分组逐项确认（材质/尺寸/颜色/功能/包装/数量/配件/限制）；操作=confirm/reject/unknown/conflict/revoke；禁止一键全确认关键字段 | P3 卡 |
| D7 | stale 传播接口：factRevision 变更时标记依赖产物 stale（接口预留，不实现内容链） | P3 卡 |

## 1. 数据模型（Lead 独占，additive migration）

```prisma
model V4FactRecord {
  id                String   @id @default(cuid())
  runId             String
  candidateId       String
  offerIdentity     String   // 1688 offer 身份
  variantKey        String   // 具体 variant（SKU/规格指纹）
  field             String   // 材质/尺寸/颜色/功能/包装/数量/配件/限制…
  value             String
  status            String   // confirmed | rejected | unknown | conflict | revoked
  confirmationMethod String? // 人工确认方法（document/sample/expert/other）
  claimRefsJson     String   @default("[]")
  documentRefsJson  String   @default("[]")
  actor             String   // owner 或 demoAccessId
  revision          Int
  revokedByRevision Int?
  detailJson        String   @default("{}")
  createdAt         DateTime @default(now())

  @@unique([runId, offerIdentity, variantKey, field, revision])
  @@index([runId, offerIdentity, variantKey, field])
  @@index([runId, revision])
}
```

## 2. 文件所有权

| Owner | 路径 |
|---|---|
| Lead | docs/v4/P3_*、prisma 模型+迁移、lib/v4/factStore.ts（V4FactRecord 存取 + validator + revision）、lib/v4/gateA.ts（Gate A 载荷）、graph.ts supplier_research/product_fact_gate 接线、app/api/v4 事实端点、Fact UI 收口 |
| A（worktree codex/v4-p3-1688） | lib/v4/adapters/1688.ts（offer/variant identity，recorded/live，复用 upstream/1688 contracts）+ 测试 + fixtures + skills/v4/supplier-research.md |
| B（worktree codex/v4-p3-facts） | components/v4/FactGatePanel.tsx 等 Fact UI + 测试（独立测试文件） |
| C（只读） | Claim 污染/登录态/安全 fixtures 评审 |

## 3. 必测（Gate）
1. 不同 offer/variant 选择身份正确；2. SupplierClaim 自动晋级被 validator 阻断（次数 0）；3. claim 与文件/样品冲突→双显+停止相关声明；4. 撤销→新 revision，历史完整；5. 登录/验证码暂停恢复/取消；6. 真实浏览器 Gate A→完成 Facts，刷新持久化。
## 4. 边界：不自动联系/下单/批量采集；页面 304 不自动晋级；不做 Strategy Agent；Gate A/Fact Gate 不自动通过。
