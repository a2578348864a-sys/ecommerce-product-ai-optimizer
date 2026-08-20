# 契约 06 — 文件存储原子性（PUBLIC_FILE_STORE_ATOMICITY）

## CURRENT_FACT（并发审计结论）

- **demo-access.json**：`saveDemoAccessStore` = 临时文件 + `renameSync`（EPERM/EEXIST 退化为 unlink+rename），
  **无 fsync**（`demoAccess.ts:206-223`）。`withDemoAccessStoreTransaction` = 跨进程文件锁
  （`openSync(lockPath,"wx")` + 100×10ms 重试 + 2 分钟 mtime 陈旧锁清理，`demoAccess.ts:233-265`）——
  但**只有 standalone 配额三函数使用**（:692/:748/:787）。
- 其余配额写路径（usedAiCalls / productJourney / createDemoAccess / 所有 update）为**无锁同步 read-modify-write**。
  `scripts/create-demo-password.mjs:82` 甚至裸 `writeFileSync` 覆盖整个文件。
- 锁等待用 `Atomics.wait`（`demoAccess.ts:229-231`）→ **阻塞整个事件循环最长 ~1s**（单实例可接受）。
- **demo-sandbox.json**：全部写路径收敛 `mutateDemoSandboxStore` → `withStoreLock`（**进程内 async mutex**，
  `demoSandboxStore.internal.ts:117-131`）→ `saveStoreAtomic` = temp + **fsyncSync** + rename + EPERM/EEXIST 时
  .backup 换入与回滚（:77-115）——比 demo-access 更稳（有 fsync 与 backup 恢复），但**无跨进程文件锁**。
- 单进程内：demo-access 写全同步 → 事件循环天然串行，无 lost update；sandbox 有显式 mutex → 安全。
- 生产部署：PM2 fork_mode **单实例**（服务器只读审计确认 pid 69943）→ 当前无跨进程竞争面。

**FILE_STORE_CONCURRENCY_RESULT = NOT_ATOMIC（跨进程）**；进程内 = ATOMIC。

## FROZEN_DECISION

1. **公开上线必须单实例**（当前部署已满足）：`PUBLIC_SHOWCASE_NODE_INSTANCES = 1`，多实例禁止（契约 01-6）。
2. **D2 治理 = 多实例前置条件**：任何扩容（PM2 cluster / 多进程 / 多机）前，demo-access 全部配额写路径必须
   改走 `withDemoAccessStoreTransaction`；productJourney 模块补同一把锁；`createDemoAccess`（guest 铸造会高频调用）同样入锁。
3. 管理脚本（建码等）必须经 store API 入锁写，禁止裸 `writeFileSync`（改造 `create-demo-password.mjs:82` 路径）。
4. 单实例下 `Atomics.wait` 阻塞 ≤1s 可接受；多实例化时改成异步锁（避免请求路径阻塞）——多实例前必改。
5. demo-sandbox.json 在单实例下已满足原子性要求（mutex + fsync + backup），**无需改动**。
6. 锁语义不引入分布式事务、不引入 Redis/DB 迁移（范围冻结）。

## CONFIRMED_DEFECT

- D2（见契约 04）：跨进程非原子。当前单实例部署下**未触发**；公开模式会提高并发写频率（guest 铸造/配额结算），
  单实例下仍安全；多实例前必须治理。

## FUTURE_IMPLEMENTATION

- demo-access 全路径入锁（D2）；脚本改造；锁等待改异步（多实例时）；锁竞争监控（busy 计数日志）。

## UNKNOWN

- 无阻断项。
