# 契约 04 — 公开配额语义（PUBLIC_QUOTA_SEMANTICS）

## CURRENT_FACT（配额字段矩阵，逐项代码核证）

| 字段 | 默认 | 用户动作含义 | 消耗点 | 原子性 |
|---|---|---|---|---|
| `productJourneyReservations` | 快照 `maxProducts=5`（`MAX_PRODUCT_CHAINS=5`，`lib/server/demoProductJourneyQuota.ts:13`） | 新建**一条商品研究链**（不是 AI 调用次数） | `app/api/workflows/product-analysis/route.ts:376` reserve → :692 commit；失败 :443/:669/:691 release | **无文件锁**（直读直写） |
| `maxAiCalls/usedAiCalls`（ai_jobs_v1） | 脚本默认 **0**（`scripts/create-demo-password.mjs:98`；`demoAccess.ts:284`） | 一次真实 AI 动作（12 处路由消费） | 唯一扣减 `reserveDemoAiImageCalls` → `usedAiCalls += count`（`demoAccess.ts:452`） | **无文件锁** |
| `standaloneListingUsed` | `DEMO_STANDALONE_LISTING_LIMIT=3`（`demoAccess.ts:38`） | 独立 Listing Studio 一次生成 | `markDemoStandaloneStudioProviderStarted`（`demoAccess.ts:741-777`） | **有文件锁**（`withDemoAccessStoreTransaction`，`demoAccess.ts:233-265`） |
| `standaloneImageUnitsUsed` | `DEMO_STANDALONE_IMAGE_UNIT_LIMIT=3`（`demoAccess.ts:39`） | 独立 Image Studio 一次生成（按张） | 同上（:772） | **有文件锁** |

- 配额耗尽 ≠ 身份失效：既有商品历史可读，新建动作在各自边界被拦（`login/route.ts:90` 注释语义）。
- 金标演示流程**不消耗**任何配额：`GET /api/demo/golden` 只做惰性静态模板副本（`goldenDemoTemplate.ts:133-200`），无 reserve 调用。
- `maxAiCalls=0` 的访客：所有 ai_jobs_v1 路径在 `reserveDemoAiImageCalls` 的
  `getRemainingAiCalls < count` 处 fail-closed（`demoAccess.ts:446-449`）。

## FROZEN_DECISION

1. **用户配额单位 ≠ Provider 成本单位**（不变，与契约 05 绑定）：
   - product_journeys_v1：1 单位 = 1 条研究链（Provider 成本 = 1~4 次调用，不随调用数波动）；
   - ai_jobs_v1：1 单位 = 1 次真实 AI 动作（Provider 成本 = 1，多数；重试型动作 = 2，见契约 05）；
   - standalone：1 单位 = 1 次生成（图片按张）。
2. **公开 guest（anonymous）配额默认值**：productJourneys=5、standaloneListing=3、standaloneImage=3（与现有访客一致）；
   **maxAiCalls 默认 = 0**（PUBLIC_SHOWCASE 出厂 = 真实 AI 全关闭，符合 DECISION B 范围；
   扩展档位见契约 05，禁止在代码里硬编码 5）。
3. 公开模式下 anonymous 记录的 scope deny-list（契约 01）先于配额判断执行：新建商品研究/导入/采集等 OFF 动作
   直接 403 `guest_scope_denied`，不消耗配额。
4. 配额判断保持现状语义：先预留 → 动作 → 结算/回补；失败路径必须回补（沿用现有 release/refund）。
5. **D1 治理 = 公开上线硬门槛**：任何 demo-mode 可触发真实 Provider 调用的路由，必须先过配额预留。
   具体：`tasks/[id]/listing-handoff` POST 与 `tasks/[id]/image-handoff` POST 必须接入配额
   （或在对 guest 的路径上 fail-closed 403），否则禁止 PUBLIC_SHOWCASE 上线。
6. **D2 治理 = 公开上线硬门槛**：`data/demo-access.json` 的全部配额写路径（usedAiCalls / productJourney / 创建记录）
   统一走 `withDemoAccessStoreTransaction` 文件锁事务；脚本不得再裸 `writeFileSync` 覆盖整个文件。
   在治理完成前，单实例部署（契约 06）是硬前提。
7. Banner/快照展示（`DemoAccessBanner`、`buildDemoAccessSnapshot`）对 anonymous 记录照常工作，不新增第二套展示系统。

## CONFIRMED_DEFECT

- **D1（成本失控缺口，生产已暴露）**：listing-handoff / image-handoff 交接链对访客**无任何配额、无 real-AI 门禁**。
  证据：`app/api/tasks/[id]/listing-handoff/route.ts:89-105` 仅 requireAuthenticated，
  :376 直接 `generateListingDraftFromHandoff` → `listingGenerationService.ts:482-500`（copyReady → 真实
  `generateTaskLinkedAiListing`，`taskLinkedAiListing.ts:178` 直调 `callAiJson`，全链 grep 无 quota/gate）；
  `image-handoff/route.ts:344-384` 同 → `imageGenerationService.ts:340-364`（`realImageProviderEnabled()` 只认
  IMAGE_PROVIDER_MODE）。生产 env 实测：`IMAGE_PROVIDER_MODE=real`、`OPENAI_IMAGE_VISITOR_ENABLED=true`、
  `OPENAI_LISTING_VISITOR_ENABLED=true` → 访客持 active handoff 可无限次触发真实 Listing/图片调用，
  **绕过共享体验额度与独立额度**。治理：见 FROZEN_DECISION 5。责任人：实现期后端工作树。
- **D2（跨进程非原子）**：demo-access 配额写路径仅 standalone 接了文件锁；productJourney 模块完全无锁；
  两进程读-改-写 → 后写覆盖先写（lost update）。治理：见 FROZEN_DECISION 6。当前单实例部署下进程内串行安全。
- **D3（契约文档漂移）**：`docs/architecture/auth-and-quota-contract.md:62-63` 称 ai_jobs_v1 仅作旧版
  standalone 兼容台账，但实际 12 处路由（generate/agents×5/keywords/ai-analysis/listing-copy/ai-evidence-summary/
  review-evidence/image-draft 等）仍在消费。治理：实现期二选一并更新文档——(a) 确认这些路由对访客继续用 ai_jobs_v1，
  修订文档；或 (b) 迁移到明确配额。新访客默认 0 → 目前这些动作对新码全部 403（fail-closed，行为安全，文档不准确）。

## FUTURE_IMPLEMENTATION

- 交接链配额接入（D1）+ 配额写事务化（D2）+ 文档对齐（D3）。
- anonymous 记录创建走文件锁事务（与契约 02/06 联动）。
- 公开模式 scope deny-list 路由表（契约 01）。

## UNKNOWN

- 无阻断项。
