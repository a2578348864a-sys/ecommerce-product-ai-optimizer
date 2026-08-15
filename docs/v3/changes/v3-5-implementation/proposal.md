# V3.5 Implementation — Proposal 与 Domain Contract

> 来源：`docs/v3/V3_5_PRE_IMPLEMENTATION_CONTRACT.md`（唯一权威合同，41 节）
> 状态：Phase 1-4 已实现（见 final-report.md）

## 1. Proposal（V3.5 Narrow Implementation）

最终用户体验：Candidate → 选择获取方式（关键词找货 / 图片找货 / 已有 1688 URL）→ 自动获取 1688 供应候选（Search Results）→ Preview → 用户 Human Confirm → Sourcing Evidence → 证据面板（相似点/差异/displayedPrice/priceRange/tiers/displayedMOQ/SKU/卖家自报/平台元数据/未知项）→ 下一步询盘问题。

系统负责：找 / 读 / 整理 / 追溯。用户负责：最终确认哪些候选值得加入供应线索。

## 2. 领域合同（sourcing-acquisition-contract.v1）

代码：`lib/upstream/1688/contracts.ts`（唯一类型来源，业务层不接触 CLI 原始输出 / DOM / CDP）。

| 概念 | 类型 | 语义 |
|---|---|---|
| AcquisitionCandidate | `acquisition-candidate.v1` | source=1688 / offerId（实体键）/ sourceUrl / capturedAt / acquisitionMethod（keyword\|image\|url）/ sourceProductRole / matchState（图搜五态） |
| OfferDetail | 详情模型 | 主驱动（CLI）+ 次驱动（浏览器）统一输出 |
| EvidenceClass | 六类 | source_snapshot / platform_metadata / seller_claim / derived_deterministic / human_confirmed / unknown_conflict |
| PriceNature | displayed_price / price_range / price_tier | 禁止 purchaseCost 命名 |
| MoqNature | displayed_moq / needs_confirmation | 不做归一化/解释 |
| ImageMatchState | exact_match / likely_similar / partial_match / different / unknown | 禁止百分比 |
| SourcingEvidenceV1 | `sourcing-evidence.v1` | 存储于 taskResultJson.sourcingEvidence（writer 所有权） |
| AcquisitionRunTrace | 运行轨迹 | 不含 Cookie/Token/账号标识 |

## 3. 数据流（§15）

```
External output（1688-cli JSON / 浏览器 DOM）
  → Raw Snapshot（driver 层暂存）
  → Parse（JSON/报告解析）
  → Validate（exit/ok/schema fail-closed）
  → Normalize（lib/upstream/1688/normalize.ts：字段映射 + PII 丢弃 + 分类）
  → Entity Binding（lib/upstream/1688/entityBinding.ts：offerId 门禁 + 交叉验证 + URL 白名单）
  → AcquisitionCandidate（业务层唯一消费形态）
  → Preview（内存 store，TTL 15min，subject+task 绑定）
  → Human Confirm（服务端 revalidate）
  → SourcingEvidenceV1（taskResultJson.sourcingEvidence）
```

## 4. 只读能力边界（§12/§25）

- 正式 allowlist：`search` / `offer` / `whoami`（`lib/server/sourcingAcquisition.ts`）。
- 写命令（login/inquiry/cart/order/checkout/seller/...）在业务层**无任何代码路径**；`FORBIDDEN_COMMANDS` 仅用于 deny 校验与文档。
- 业务层禁止 `run1688Command` / `executeCli(rawArgs)` / `rawOpenCliCommand` 类任意命令设计。
- 敏感字段丢弃清单：freight.receiveAddress（用户默认收货地址=PII）、supplier.loginId/memberId/userId（账号标识）、whoami 的 memberId/nick（只透出 loggedIn 布尔）。

## 5. 错误分类（§53，错误码）

`acquisition_tool_not_available` / `tool_version_unsupported` / `auth_required` / `risk_control_required` / `browser_not_ready` / `browser_foreground_required` / `page_identity_unknown` / `upload_target_not_found` / `upload_not_confirmed` / `search_trigger_not_confirmed` / `entity_binding_failed` / `schema_unsupported` / `preview_expired` / `candidate_mismatch` / `invalid_query` / `invalid_offer_id` / `invalid_url` / `invalid_image_url` / `timeout` / `tool_error`。

## 6. 已实现模块清单（含测试）

| 模块 | 路径 | 测试 |
|---|---|---|
| 领域契约 | lib/upstream/1688/contracts.ts | — |
| 规范化 | lib/upstream/1688/normalize.ts | normalize.test.ts（16 用例） |
| 实体绑定 | lib/upstream/1688/entityBinding.ts | entityBinding.test.ts（15 用例） |
| CLI 驱动 | lib/server/sourcingAcquisition.ts | sourcingAcquisition.test.ts（20 用例，假 CLI 端到端） |
| Evidence 存储 | lib/server/sourcingEvidence.ts | sourcingEvidence.test.ts（12 用例） |
| Sourcing API | app/api/tasks/[id]/sourcing/route.ts | route.test.ts（14 用例） |
| 图搜契约/Resolver | tools/collectors/1688/* | image-search-resolver.test.ts（21 用例） |
| 图搜驱动 | tools/collectors/1688/image-search-driver.ts + browser-session.ts | （表达式编译 + resolver 层覆盖） |
| 图搜业务门面 | lib/server/sourcingImageAcquisition.ts | （经 route 集成） |
| UI 面板 | components/cross-border/SourcingEvidencePanel.tsx | SourcingEvidencePanel.test.ts（5 用例） |
