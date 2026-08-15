# V3.3 — Amazon Product Detail Browser Evidence Connector 最终交付报告

> 状态：**V3_3 = PASS** ｜ **V3_3 = DONE**
> **V3_3_INTEGRATION_READY = TRUE**（Final Integration Precheck 通过，详见 integration-precheck.md）
> **V3_3_REMOTE_CLOSEOUT = PASS**（2026-08-15：已集成 main 并 push 至 origin/main，remote checkpoint HEAD = 49c76d2）
> **V3_4/5/6_AUTHORIZATION_REQUIRED = TRUE** ｜ **PUBLIC_DEPLOY = FORBIDDEN**
> Commit：`584fc04` + `49c76d2`（branch `codex/v3-3-amazon-browser-evidence`，基于 2e20581；fast-forward 集成 main，无冲突/无历史重写；已 push origin/main）

## 一、交付结论

V3.3 已按任务书三十五节完成产品化：Browser Evidence Connector（browser-evidence.v1 合同）实现并全链路验证。
**V3.3 已正式集成 main 并完成 Remote Closeout**（fast-forward 2e20581→49c76d2，无冲突）；V3.1 保持隔离；V3.4/5/6 未授权；未部署公网。

## 二、交付物

### 代码（V3.3 worktree，分支 codex/v3-3-amazon-browser-evidence，基线 2e20581 == main == origin/main）

| 文件 | 职责 |
|---|---|
| `lib/server/browserEvidence.ts` | browser-evidence.v1 合同：类型/parse（fail-soft）/快照构建/namespace 读写（mutateTaskResultJson writer 所有权） |
| `lib/server/browserEvidenceCollect.ts` | 单页受控浏览器采集（同步、fail-closed）+ 服务端 PreviewStore（TTL 15min、防篡改）+ ASIN 三一致硬门禁 `buildConfirmedSnapshot`（route 与 Smoke 共用） |
| `app/api/tasks/[id]/browser-evidence/route.ts` | GET 读 + POST collect（导航任务绑定 ASIN 单页→提取→Preview 不保存）+ POST save（凭 evidenceId 取回→三一致硬拒绝→confirmed:true 写入） |
| `components/evidence/BrowserEvidenceSection.tsx` | 前端采集区：采集入口 / Preview 人工确认 / 快照展示 / fail-closed 明确错误 / 无"仍然保存"按钮 |
| `components/evidence/EvidenceWorkbench.tsx` | 接入 BrowserEvidenceSection（仅展示层修改） |
| `lib/server/taskResultJsonMutation.ts` | 新增 writer `browser-evidence` → OWNED_NAMESPACES `["browserEvidence"]`（唯一修改的共享文件） |
| `tools/collectors/amazon/browser-control.ts` | 选择性吸收 V3.1 的 evaluateByValue 异常文本增强（诊断价值；maxNavigations 保持 10，V3.3 单页预算足够） |
| `tools/collectors/amazon/detail-page-extract.ts` + test | V3.1 吸收：6 字段确定性提取 + 实体绑定 + currency guard（11 测试全通过） |

### 测试（59 用例新增/吸收，全绿）

- `lib/server/browserEvidence.test.ts`（14：含 snapshots≤20 上限报错契约、dedupe、并发冲突）
- `lib/server/browserEvidenceCollect.test.ts`（9：ASIN 三一致硬门禁逐分支 + currency + confirmedBy）
- `app/api/tasks/[id]/browser-evidence/route.test.ts`（12：含 owner Prisma 路径、sandbox 前缀拒绝）
- `components/evidence/BrowserEvidenceSection.test.ts`（12：含"仍然保存"按钮缺失断言、JPY 提示、bound/unbound 渲染）
- `tools/collectors/amazon/detail-page-extract.test.ts`（11，吸收）
- `tools/collectors/amazon/v3-3-browser-evidence.smoke.test.ts`（1，真实浏览器，授权门禁）

### 文档

- `docs/v3/changes/v3-3-amazon-browser-connector/reuse-matrix.md`（V3.1→V3.3 资产矩阵 + EXTENSION_NOT_REQUIRED 论证）
- `docs/v3/changes/v3-3-amazon-browser-connector/contract.md`（browser-evidence.v1 冻结合同）
- `docs/v3/changes/v3-3-amazon-browser-connector/validation-and-learnings.md`（验收证据 + learnings）
- `docs/v3/changes/v3-3-amazon-browser-connector/smoke-evidence/smoke-result.json`（真实 Smoke 证据）

## 三、验证证据

- `npm test`：**4589 passed / 0 failed / 72 skipped**
- `npx tsc --noEmit`：0 errors
- `npm run lint`：0 errors（4 条既有 warning 与本任务无关）
- `npm run build`：成功（webpack，Next.js 16.3.0）
- 真实浏览器 Smoke（授权 `RUN_V33_BROWSER_SMOKE=authorized-once`）：3 商品实体绑定 100%（Wrong Entity=0）、价格 fail-closed（JPY `currency_not_usd` / `selector_not_found` 不保存）、对抗错 ASIN `asin_mismatch` 硬拒绝、快照保存/读回/幂等通过
- 双重独立审查（workflow 两路并行）：安全边界 A-F 全 PASS；测试覆盖审查发现的 3 个缺口（owner Prisma 路径、前端 bound/unbound 渲染断言、三一致逐分支用例）已补齐；审查 A 提示 PreviewStore 为进程内单实例（单机部署无影响，已记录遗留风险）

## 四、验收门禁对照（任务书三十五节）

| 门禁 | 结果 |
|---|---|
| Preview 服务端生成（可信，客户端不可伪造字段） | PASS（PreviewStore 服务端持有，save 凭 evidenceId 取回） |
| Human Confirm（confirmed:true + confirmedBy/confirmedAt 记录） | PASS |
| Provenance（pageUrl/capturedAt/collectorVersion/currency/bindingProof） | PASS |
| Candidate-Task binding（candidateId 任务权威 + targetAsin 任务 productUrl） | PASS |
| ASIN mismatch hard reject（无"仍然保存"） | PASS（route 测试 + Smoke D） |
| Wrong Entity = 0 | PASS（Smoke A/B/C 全绑定 + D 拒绝） |
| 与 XLSX Evidence 共存不覆盖（snapshot 追加） | PASS |
| V3.1 隔离（worktree 未 merge） | PASS |
| 无 credential（不读 Cookie/Token/密码） | PASS |
| 无 CAPTCHA 绕过（fail-closed 明确错误） | PASS |
| 无 LLM 猜字段（确定性 DOM 提取，零 AI） | PASS |
| 全测试 / tsc / lint / build | PASS |
| 真实 3 商品 Smoke | PASS |
| 对抗错 ASIN Smoke | PASS |

## 五、状态与授权

- `V3_3 = PASS`（最终状态，待用户独立审查确认后定稿为 DONE）
- `V3_4/5/6_AUTHORIZATION_REQUIRED = TRUE`：V3.4 VOC / V3.5 1688 / V3.6 Content Tools 均未授权，不实施
- `PUBLIC_DEPLOY = FORBIDDEN`：未部署、未 push
- 下一步：等待用户独立审查 V3.3 交付；批准后由集成树 merge + 全量验证 + 单独 commit/push；V3.1 worktree 归档决定待 V3.3 集成确认后单独处理
