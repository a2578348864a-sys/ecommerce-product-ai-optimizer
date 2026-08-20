# 契约 12 — 遗留访客兼容性（LEGACY_VISITOR_COMPATIBILITY）

## CURRENT_FACT

- 遗留访客（Visitor Code）流程：`POST /api/auth/login` 密码校验 → `findDemoAccessByPassword`
  （`demoAccess.ts:303-311`）→ `generateSignedToken("demo", id)`（`login/route.ts:60-94`）→ 12h token →
  sessionStorage → `buildAccessHeaders` 双头。全部继续工作。
- 匿名记录（无 passwordHash）对遗留登录 fail-closed 的四种取值矩阵（`demoAccess.ts:169-172` 恒等式比较）：
  ABSENT / null / 空串 / 空白 全部拒绝；`findDemoAccessByPassword` 无兜底分支；`getAccessContext` raw-password
  分支只对 env owner 密码（`accessPassword.ts:104-115`）。→ 匿名记录**不可能**被密码登录接受（契约 02 已冻结该保证）。
- 存量记录 schema 见契约 02 CURRENT_FACT；加载器无字段级校验（`demoAccess.ts:188-204`）。
- 文档漂移 D3：`docs/architecture/auth-and-quota-contract.md:62-63` 与实际 ai_jobs_v1 消费不一致（契约 04）。
- v3.0.1（40470a1）为不可变基线；生产运行构建 = 其产物（契约 11）。

## FROZEN_DECISION

1. **遗留访客零行为变化**：登录、12h TTL、双头、sessionStorage、Banner 展示、金标演示、配额显示全部原样。
   v3.1 只做**增量**（铸 token 端点 + Cookie 来源 + 模式开关 + 加固），不重写既有路径。
2. **Legacy Visitor 3/3 保持兼容（§3 裁定重申）**：standaloneListing=3 / standaloneImage=3 不变；
   **不得为了 Anonymous Guest 修改历史 Visitor 数据**（匿名记录 1/1 缺省只作用于新建 anonymous 记录，env 驱动）。
3. **productJourneys 语义不变（§4 裁定重申）**：继续 = 新建商品研究链计数；**不重解释为 AI Research Quota**；
   对 legacy Visitor 展示与消费路径照旧；仅 anonymous guest UI 隐藏无消费路径的 0/5 条目（契约 04-4）。
4. 存量数据**零迁移**：不批量改写 `data/demo-access.json`；credentialKind 归一化在加载器内存中完成
   （契约 02-1），不落盘改写存量记录。
5. 匿名记录继续对遗留密码登录 fail-closed（§9 裁定；回归测试固化，契约 13）。
6. 契约文档对齐（D3）：实现期在 v3.1 代码落地时同步修订 `docs/architecture/auth-and-quota-contract.md`
   （二选一：确认消费 / 迁移配额），保持「文档 = 代码」一致。
7. U1 核查（实现期）：只读脚本输出存量记录「passwordHash 是否存在」的布尔统计（不打印内容、不改写），
   确认无半成品记录被归一化误伤；发现异常记录只报告，不自动修复。
8. **签名密钥语义（§7 裁定）**：ACCESS_PASSWORD 降为内部签名密钥后，遗留 stok_v1 token 的验签行为不变
   （同一派生密钥）；遗留 Visitor 登录在密码 UX 移除前照旧，移除后按 Phase 4 顺序统一迁移（契约 11/13）。
9. v3.0.1 保持不可变：v3.1 任何发布都不移动/重写/force-push v3.0.1 与 40470a1 历史。

## CONFIRMED_DEFECT

- D3（文档漂移，治理见第 6 条）。不阻断 Phase 0（行为 fail-closed 安全，仅文档不准确）。

## FUTURE_IMPLEMENTATION

- U1 只读核查脚本；auth-and-quota-contract.md 修订；回归测试（契约 13）。

## UNKNOWN

- U1（非阻断，见契约 02 UNKNOWN 与第 7 条）。
