# V3.5 Implementation — Security Review / Regression Review

## 1. Spec Compliance Review（§74，逐条对照）

| 检查项 | 结果 |
|---|---|
| Supplier Score | ✅ 无（排序仅来源顺序/deterministic UI 顺序；platform_metadata 不计分） |
| purchaseCost / realCost | ✅ 无（价格仅 displayedPrice/priceRange/priceTiers） |
| 推荐供应商 / 最优货源 / 靠谱指数 / 成功率 / 建议购买 | ✅ 无（UI 测试断言零出现） |
| auto inquiry | ✅ 无（询盘问题仅生成，无发送代码路径） |
| arbitrary CLI command | ✅ 无（allowlist 硬编码 search/offer/whoami；写命令业务层零路径；route 测试拒绝写命令名 action） |
| background crawler | ✅ 无（bounded 单次操作 + 前台硬前置 + cooldown） |
| displayedMOQ 归一化 | ✅ 无（保持展示语义） |
| 相似度百分比 | ✅ 无（五态 ImageMatchState） |
| Search Result 自动升级 Evidence | ✅ 无（Preview + Human Confirm 强制） |

## 2. Engineering / Security Review（§75）

| 项 | 结果 |
|---|---|
| command / shell injection | ✅ args array + shell:false + 参数白名单（关键词控制字符/长度、offerId 数字） |
| path traversal | ✅ 无用户路径输入进入文件操作（temp 目录自建 + 有界清理） |
| SSRF / URL origin bypass / redirect | ✅ 图片 URL https+公网 DNS 校验（ssrfGuard）；offer URL 白名单域 + https + 无凭据；无任意 URL fetch |
| browser scope / localhost exposure | ✅ loopback CDP + 域白名单 + 专用 profile |
| actor isolation / preview replay | ✅ subjectKey+taskId 绑定 + 一次性 take + TTL；Visitor B 读取 A 的任务 404 |
| stale session / credential logging | ✅ 不读取/复制 Cookie/Token；trace 不含凭据；whoami 只透出 loggedIn |
| PII leakage | ✅ receiveAddress/账号标识 normalize 层丢弃；测试断言零泄漏 |
| prompt injection | ✅ 1688 内容本轮不进 AI 路径（无 AI 调用）；未来接入需隔离+refs（记录在 sourcing-evidence.md） |
| oversized payload | ✅ stdout 2MB/stderr 256KB/图片 ≤30MB/结果 ≤60 卡/关键词 ≤50 字符 |
| process leak / zombie | ✅ timeout kill（SIGTERM→SIGKILL）；浏览器会话 close；临时目录 finally 清理 |
| external dependency failure | ✅ 工具缺失/版本不支持/exit 非 0/非 JSON 全部归一化 |
| schema drift | ✅ 版本探测 0.1.* + schema fail-closed（不 silent parse） |

## 3. Regression Review（§79/§80）

- 全量 `npm test`：**4745 passed / 76 skipped / 0 failed**（412 文件）。
- 基线对比（集成树 main @ bc639e2）：
  - `scripts/release-package.test.ts`：impl 树首次失败原因=缺 `.next/BUILD_ID`（未 build）；**build 后 3/3 通过**，与 baseline（集成树已 build）一致 → 环境差异，非回归。
  - `lib/server/demoSandbox.store-consistency.test.ts`：全量并发时偶发失败 1 次；**单独跑通过**；baseline 同样通过 → 已知 flaky，非本任务引入（本任务未触碰 demoSandbox）。
- `tsc --noEmit`：PASS；`eslint`（新增文件）：PASS；`npm run build`：PASS。
- 无新增依赖、无 DB migration、无共享文件修改（package.json/package-lock/AGENTS.md/tsconfig/next.config/prisma 未动）。

## 4. 最终验收门禁（§90）

Wrong Entity=0 ✅（entityBinding 门禁+交叉验证+测试）／Wrong Upload=0 ✅（Candidate Identity Proof+测试）／Wrong Click=0 ✅（proof 门禁+stale 重验证+测试）／Read-only allowlist ✅／Arbitrary command impossible ✅／Preview+Human Confirm ✅／Search Result 不自动升级 Evidence ✅／Owner/Visitor isolation ✅／Sensitive data stripped ✅／Prompt injection isolation ✅（无 AI 路径）／No Supplier Score ✅／No purchaseCost ✅／No auto inquiry ✅／No cart/order/payment ✅／Fail-closed ✅／Manual fallback ✅（UI 保留 URL 粘贴+说明）／Provenance ✅（source/sourceUrl/offerId/capturedAt/method/refs）／Acquisition Trace ✅／Browser failure recovery ✅（attach/launch 双路径+错误归一化）。
