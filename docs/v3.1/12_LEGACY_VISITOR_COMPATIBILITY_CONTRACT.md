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
2. **存量数据零迁移**：不批量改写 `data/demo-access.json`；credentialKind 归一化在加载器内存中完成
   （契约 02-1），不落盘改写存量记录。
3. 匿名记录继续对遗留密码登录 fail-closed（回归测试固化，契约 13）。
4. 契约文档对齐（D3）：实现期在 v3.1 代码落地时同步修订 `docs/architecture/auth-and-quota-contract.md`
   （二选一：确认消费 / 迁移配额），保持「文档 = 代码」一致。
5. U1 核查（实现期）：只读脚本输出存量记录「passwordHash 是否存在」的布尔统计（不打印内容、不改写），
   确认无半成品记录被归一化误伤；发现异常记录只报告，不自动修复。
6. v3.0.1 保持不可变：v3.1 任何发布都不移动/重写/force-push v3.0.1 与 40470a1 历史。

## CONFIRMED_DEFECT

- D3（文档漂移，治理见第 4 条）。不阻断 Phase 0（行为 fail-closed 安全，仅文档不准确）。

## FUTURE_IMPLEMENTATION

- U1 只读核查脚本；auth-and-quota-contract.md 修订；回归测试（契约 13）。

## UNKNOWN

- U1（非阻断，见契约 02 UNKNOWN 与第 5 条）。
