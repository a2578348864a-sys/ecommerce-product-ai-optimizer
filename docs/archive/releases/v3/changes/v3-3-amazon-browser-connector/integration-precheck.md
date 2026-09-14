# V3.3 — Final Integration Precheck（Closeout 记录）

> 状态：**V3_3_INTEGRATION_READY = TRUE**（本文件为 merge main 前的最小架构/安全 Closeout 证据）。
> 范围：不扩 V3.3 功能、不启动 V3.4/5/6、不做 Extension、不部署公网。

## 1. Browser Execution Model（钉死）

**A. 当前实现是否由轻选本地 Node/Next 服务通过 loopback CDP 启动/控制独立 Chrome？**
**是。** `lib/server/browserEvidenceCollect.ts` 的 `collectBrowserEvidencePreview`：
- `resolveSystemBrowser()` 解析本机 Chrome/Edge 可执行文件；
- `openIsolatedPublicBrowserSession()`（`tools/collectors/amazon/browser-control.ts`）`spawn()` **独立 Chrome 进程**，使用**临时隔离 profile**（系统 temp），`--remote-debugging-address=127.0.0.1` + 动态 loopback 端口 CDP；
- 会话结束强制关闭浏览器、清理 profile、释放端口（cleanup 断言）。

**B. 是否能够读取"用户已经在自己 Chrome 中打开的当前 Amazon Tab"？**
**否。** 当前实现不 attach 任何既有浏览器进程/会话/Profile，不读用户 Chrome 的 Tab、Cookie、会话。只能导航自己启动的隔离实例。

> 两个能力不得混淆。V3.3 v1 正式产品定位：

**Local Human-Assisted Amazon Browser Evidence Connector**

语义：用户选择当前 Candidate / Amazon 商品 → 本机轻选服务启动/控制**隔离**浏览器获取该页面 → deterministic extraction → Preview → Human Confirm → Evidence。

**UI / contract / docs 不得宣称"读取用户当前已打开的浏览器 Tab"**（当前代码不支持）。

### 部署边界（Local / Public）

- 当前能力适用于**本地运行环境**（轻选服务运行在用户本机）。
- 若未来轻选工作台部署到**远程公网服务器**，而产品需要读取用户本机当前 Tab，必须单独评估 client-side extension / local companion bridge。
- 本轮**不实现 Extension**。

```
EXTENSION_NOT_REQUIRED_FOR_LOCAL_V1 = TRUE
EXTENSION_NOT_REQUIRED_FOREVER   = （未设定；不得无条件宣称）
```

## 2. PreviewStore 安全绑定

`lib/server/browserEvidenceCollect.ts` PreviewStore 条目绑定（本轮新增）：

| 绑定项 | 实现 |
|---|---|
| authenticated actor / owner-vs-visitor | `subjectKey = owner:v1 或 visitor:{demoAccessId}`（`browserEvidenceSubjectKey`） |
| candidate/task identity | `taskId`（collect 时的任务 id） |
| ASIN | `asin`（collect 时的任务绑定 ASIN；与 preview 提取一致） |
| preview id/token | `evidenceId`（randomUUID） |
| capturedAt / expiresAt | 均有；TTL 15 分钟，`take` 前 prune |

`take(evidenceId, { subjectKey, taskId })`：**主体或任务任一不匹配 → 返回 null（fail-closed，视为 preview_expired 409）**。

已证明（route.test.ts "PreviewStore security binding"）：
- Visitor A 无法保存 Visitor B 的 Preview（跨主体 → 409 preview_expired）
- Preview 无法保存到其他任务（跨任务 → 409 preview_expired）
- Owner 无法用 Visitor 的 Preview（sandbox 任务 + owner → 404，不泄漏）
- Preview 过期后不能保存（TTL prune + take 后即失效）
- 前端修改 Preview values 无法影响服务端 authoritative save（save 只凭 evidenceId 从服务端取回）

## 3. Fail-soft / Fail-closed 边界

| 方向 | 行为 | 测试 |
|---|---|---|
| Read（旧 resultJson） | fail-soft：namespace 缺失/垃圾值/超限快照 → 安全忽略，返回 null，不抛错 | browserEvidence.test.ts "read fail-soft: garbage/unknown old browserEvidence value is safely ignored" |
| Write / save | fail-closed：`assertSnapshotWritable` 自校验——字段超白名单（>6）拒绝、binding proof 无效拒绝、序列化超 16KB 拒绝、结构非法拒绝；**不做任何自动清洗后继续保存** | browserEvidence.test.ts write-hard 三用例（第 7 字段 / proof 无效 / oversized） |

补充：`saveBrowserEvidence` 入口自校验（不依赖调用方），即使绕过 `buildConfirmedSnapshot` 直接调用也会被拒。

## 4. Navigation / Redirect 安全（final-page 复核）

allowlist 不只验证初始输入。采集链路在**导航完成后**重新确认：
- `session.navigate` 返回 `finalUrl / allowedFinalOrigin`（browser-control 对最终 origin 复核，redirect 链收集）；
- `allowedFinalOrigin=false`（redirect 出 https://www.amazon.com）→ `navigation_not_allowed`（502）fail-closed；
- `extraction.pageStatus` 复核：captcha / login_wall / error_page / unknown_page → 对应 fail-closed 错误码（422），不保存任何字段；
- save 时 ASIN 三一致（expectedAsin / urlAsin / pageAsin vs 任务绑定 ASIN）硬门禁，entity 未绑定 → 拒绝。

测试：route.test.ts（navigation_not_allowed 502 透传；login_wall/page_unknown/page_error 422 透传且未落库）、browserEvidenceCollect.test.ts（`browserEvidenceFailClosedCode` 全分类映射）、buildConfirmedSnapshot 三一致逐分支 9 用例。

## 5. Browser Evidence 有界存储（冻结）

| 规则 | 值 | 实现/测试 |
|---|---|---|
| allowed fields | 6（asin/title/price/bsr/rating/reviewCount） | extractor + parse + assertSnapshotWritable 白名单 |
| per snapshot payload 上限 | `BROWSER_EVIDENCE_SNAPSHOT_MAX_BYTES = 16KB` | write 拒绝（413 payload_too_large）+ read 忽略（fail-soft） |
| snapshot 数量上限 | `BROWSER_EVIDENCE_SNAPSHOT_LIMIT = 20`（latest+history 追加，超出报 409，不静默截断） | 既有测试 |
| dedupe | 同 capturedAt + pageUrl + asin → duplicate 幂等，不重复写入 | 既有测试 |
| malformed/oversized reject | invalid_snapshot（422）/ payload_too_large（413），不自动清洗 | 本轮新增测试 |

不新建 Prisma 表、不建设复杂历史数据库。

## 6. V3.1 → V3.3 证据边界（确认）

- V3.1 是 **Spike**（worktree `电商工具-v3-1`，3 commits，隔离保留）。
- V3.3 只**选择性复用** V3.1 已验证能力（entity binding / deterministic extraction / fail-closed / currency guard / captcha-login detection / cleanup / provenance / extractor tests），明细见 `reuse-matrix.md`；**不 merge V3.1 branch**。
- V3.1 实验结论保留：`BROWSER_EVIDENCE = APPROVED`，其准确含义为 **human-assisted browser evidence feasibility approved**；**不是** autonomous crawling approved。
- V3.3 产品定位为 Local Human-Assisted（见第 1 节），与 V3.1 结论一致。

## 7. 最终验证

- targeted：browser evidence tests（18）+ PreviewStore security（3）+ ASIN three-way binding（9）+ Owner/Visitor isolation（含 owner Prisma 2 用例）+ malformed write（3）+ redirect/final origin（4）+ bounded-history（20 上限、dedupe、16KB）——全部通过。
- 全量：`npm test` 全绿；`tsc --noEmit` 0 errors；`lint` 0 errors；`build` 成功。
- 真实 Smoke：本轮代码修改未触及 extractor/binding 提取逻辑（仅 PreviewStore 绑定 + 写入自校验），且已单独重跑授权 Smoke 确认链路（见 smoke-evidence/smoke-result.json）。

## 8. Commit

正式 V3.3 文件已在本 worktree `codex/v3-3-amazon-browser-evidence` 内形成 commit（hash 见最终报告）；未 push、未 merge main、未部署。未纳入 commit：TEMP / 浏览器 profile / credential / 真实 HTML / 真实业务数据（smoke 使用临时 sandbox store 与隔离 profile）。

## 9. 结论

**V3_3_INTEGRATION_READY = TRUE**

- Browser Execution Model：Local Human-Assisted（服务启动独立 Chrome，loopback CDP；**不**读取用户已开 Tab）
- Local / Public deployment boundary：当前仅本地；远程部署如需读本机 Tab 须另行评估 extension/bridge（本轮不实现）
- PreviewStore binding：actor（owner/visitor）+ taskId + ASIN + evidenceId + capturedAt/expiresAt 全绑定
- read-soft / write-hard：读 fail-soft 忽略坏记录；写 fail-closed 拒绝一切非法/超限/越白名单，不自动清洗
- redirect/final-origin validation：导航后复核 final origin + page classification + ASIN 三一致，全 fail-closed
- Evidence bounded-history：6 字段 + 16KB/快照 + 20 条 + dedupe + oversized reject
- tests / tsc / lint / build：全绿
- commit hashes：见最终报告
- worktree clean 状态：见最终报告

**继续暂停**：即使 INTEGRATION_READY=TRUE 也不自行 merge/push。保持：
V3_4_AUTHORIZATION_REQUIRED = TRUE ｜ V3_5_AUTHORIZATION_REQUIRED = TRUE ｜ V3_6_AUTHORIZATION_REQUIRED = TRUE ｜ PUBLIC_DEPLOY = FORBIDDEN

等待用户授权 V3.3 集成。
