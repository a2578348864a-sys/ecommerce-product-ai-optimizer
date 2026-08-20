# 契约 07 — 沙箱复用（PUBLIC_SANDBOX_REUSE）

## CURRENT_FACT

- **惰性**：`ensureVisitorDemoCopy` 唯一生产调用点 = `GET /api/demo/golden`（`app/api/demo/golden/route.ts:23`），
  首次访问才 seed（`goldenDemoTemplate.ts:125-199`）。
- **幂等 + 并发安全**：已有标记副本 → 直接返回；历史 THERMOS 副本 → backfill 一次；新建路径 check-then-act 已原子化——
  `createSeededSandboxTaskAndCandidate` 在 Store 写锁内重查固定 id（`demoSandbox.ts:368-403`）。
  测试证据：重复调用不新增（`goldenDemoTemplate.test.ts:62-69`）；并发双 seed 只产生 1 task + 1 candidate、
  同一 taskId（:72-88）；并发标记/证据完整（:90-100）。
- **身份绑定**：seed 写入的 task+candidate 全部带调用方 `demoAccessId`（`goldenDemoTemplate.ts:165-199`）；
  固定候选 id 也是 per-sandbox（`GOLDEN_DEMO_CANDIDATE_ID`）。跨访客隔离测试：A/B 各 1 个独立副本、taskId 不同（:102-111）。
- **隔离守卫（fail-closed，逐行核证）**：所有访问器按 `demoAccessId ===` 等值过滤：
  `demoSandbox.ts:315`（filter）、:321（find task）、:330/:415/:426-430（更新/删除/注入）、
  :824/:830/:843/:874/:888（candidate）、:375/:392（seed 重查）。跨访客隔离完全由字段过滤承担，
  写锁（`withStoreLock`，进程内 mutex）只是并发一致性机制。
- **passwordHash 与沙箱无关**：守卫/沙箱全链路只依赖 `demoAccessId`；passwordHash 仅在
  `createDemoAccess`（生成）与 `findDemoAccessByPassword`（校验）两处被引用。
  因此无 passwordHash 的匿名记录**一旦拿到 token，沙箱全链路零改动走通**；
  唯一断点是「匿名拿 token 的入口」（契约 02/03 解决）。
- **无过期清理机制**：demo-access 记录与 sandbox task/candidate 均无 TTL/定时清理；
  `isDemoAccessExpired` 恒 false（`demoAccess.ts:315-318`）。`cleanupExpiredSessions` 只清内存 session 且无生产调用者。
- 标记（供未来清理区分）：`resultJson.demoTemplate = { demoTemplateId:"thermos-funtainer-v1", ... }`
  （`goldenDemoTemplate.ts:21-23, 82-86`）；`readDemoTemplateMarker` 校验（:57-70）；历史副本 backfill 识别
  `isThermosTask`（:72-77）；固定候选 id `fixture-vr-cand-001`；副本 taskId 前缀 `sandbox_task_`。
- demo 数据与 Prisma 完全隔离（`demoSandbox.ts:4-7` 注释）。

## FROZEN_DECISION

1. **SANDBOX_REUSE_CONFIRMED = YES**：匿名 guest 复用现有 sandbox，**零改动**；
   `ensureVisitorDemoCopy` / demoAccessId 隔离 / 标记 / 写锁全部原样复用。
2. 匿名 guest 的最小启动流 = 契约 02/03（记录 + 铸 token + Cookie，12h）→ `GET /api/demo/golden` 惰性 seed →
   后续 CRUD 按 demoAccessId 过滤。**不引入第二套沙箱系统**。
3. 匿名记录对遗留密码登录 fail-closed（契约 02-9 已冻结）。
4. **GC 政策（FUTURE_IMPLEMENTATION，公开推广前必须立项）**：anonymous 记录 + 其 sandbox 副本需要过期回收；
   回收时金标副本用 demoTemplate 标记 + 固定候选 id 区分；机制冻结：按 `lastUsedAt` 超过阈值 + 总量上限双条件清理，
   值可调（建议 PRUNE_AFTER_DAYS=30、MAX_GUEST_RECORDS=500），实现期定值。
   （与契约 02-6 一致：若启用记录 expiresAt，必须 ≤ token 过期；GC 是独立回收机制，不改变访问门控。）
5. MVP 期间（未上 GC 前）数据增长由契约 05/08 的限流 + 铸造速率钳制；上线验收清单必须包含「记录数增长监控」。

## CONFIRMED_DEFECT

- 无（沙箱机制本身）。相关：C4 指出的「无清理机制」是功能缺位，不是缺陷；按第 4 条立项。

## FUTURE_IMPLEMENTATION

- 匿名铸 token 端点（契约 02/03）；guest 数据 GC（第 4 条）；GC 后保留金标副本标识的迁移脚本（若需要）。

## UNKNOWN

- 无阻断项。
