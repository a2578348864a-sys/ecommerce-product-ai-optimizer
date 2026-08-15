# V3.3 — Browser Evidence Connector 验证与学习记录（validation / learnings）

> 状态：实现完成，验收证据见 `smoke-evidence/` 与各测试文件；本文档随验收结果更新。
> 验收门禁对照：任务书三十五节（Preview / Human Confirm / Provenance / Candidate-Task binding /
> ASIN mismatch hard reject / Wrong Entity=0 / 共存 / 隔离 / 无 credential / 无 CAPTCHA 绕过 /
> 无 LLM 猜字段 / 全测试 / tsc / lint / build / 真实 3 商品 Smoke / 对抗错 ASIN Smoke）。

## 1. 验收证据清单

| 门禁项 | 证据 | 结果 |
|---|---|---|
| Preview 服务端生成 | `app/api/tasks/[id]/browser-evidence/route.ts` collect 分支；PreviewStore 15 分钟 TTL | PASS |
| Human Confirm | save 必须 action=save + evidenceId + expectedStorageVersion；confirmedBy/confirmedAt 服务端记录 | PASS |
| Provenance | snapshot 含 pageUrl/capturedAt/collectorVersion/currency/entityBinding.proof | PASS |
| Candidate-Task binding | candidateId 从任务权威读取（`getResearchTaskCandidateId`）；targetAsin 从 task.productUrl 解析 | PASS |
| ASIN mismatch hard reject | `buildConfirmedSnapshot` 三一致硬门禁（route 与 Smoke 共用同一实现）；无"仍然保存"按钮 | PASS |
| Wrong Entity = 0 | Smoke D 对抗用例：任务绑定 A、页面为 B → asin_mismatch 拒绝 | PASS（见 smoke-result.json） |
| 共存不覆盖 | snapshot 追加模式（latest + history），与 competitorEvidence/keywordEvidence 等 namespace 并行 | PASS |
| 隔离 | 临时 Profile + loopback CDP + 白名单 origin + 会话结束清理（复用 browser-control） | PASS |
| 无 credential | collect 只读 DOM；不保存 Cookie/Token/HTML | PASS（代码审查） |
| 无 CAPTCHA 绕过 | captcha/login_wall → 422 明确错误，fail-closed | PASS（route 测试） |
| 无 LLM 猜字段 | 提取器纯确定性 DOM 提取；零 AI 调用；不消耗 quota | PASS |
| 全测试 / tsc / lint / build | 见下节 | PASS |
| 真实 3 商品 Smoke | A/B/C 三商品真实浏览器采集 → 绑定 → 保存 → 读回 | 见 smoke-result.json |
| 对抗错 ASIN Smoke | D 用例 | PASS |

## 2. 自动化测试

- `lib/server/browserEvidence.test.ts` — 13 用例：parse 往返/非法结构拒绝/correct 字段 null 值拒绝/数字类型校验/20 上限/快照构建映射（USD、JPY、unbound）/读取空态/保存绑定 candidateId/幂等 dedupe/追加/并发冲突/非 sandbox id 拒绝。
- `app/api/tasks/[id]/browser-evidence/route.test.ts` — 10 用例：GET 空态/未绑定 ASIN 拒绝/collect 返回 preview 不落库/save 落库/BrowserEvidenceCollectError 透传/preview 过期/invalid evidenceId/ASIN mismatch 硬拒绝 + 不落库/unbound 拒绝/并发冲突/幂等。
- `components/evidence/BrowserEvidenceSection.test.ts` — 9 用例：前端投影解析（正常/非法/JPY 币种）/preview 解析/渲染空态/未绑定提示/快照展示/无确认按钮条件。
- `tools/collectors/amazon/detail-page-extract.test.ts` — 11 用例（V3.1 吸收，全部通过）。
- `tools/collectors/amazon/v3-3-browser-evidence.smoke.test.ts` — 真实浏览器 Smoke（授权门禁，默认跳过）。

全量：`npm test` → **4575 passed / 0 failed / 72 skipped**（build 后 release-package 环境差异消除）。
`npx tsc --noEmit` → 0 errors；`npm run lint` → 0 errors（4 条既有 warning 与本任务无关）；`npm run build` → 成功。

## 3. 真实 Smoke 结果（2026-08-15）

> 明细见 `smoke-evidence/smoke-result.json`。真实浏览器（本机 Chrome/Edge，headless）导航 amazon.com。

- A 标准商品（B0C3NFB3CZ OtterBox 杯）：实体绑定 ✓；title/BSR/rating/reviews 全部 correct 保存；**price 本次未命中选择器（`selector_not_found`）→ 不保存价格**（fail-closed；V3.1 曾观测到该商品 USD 价格，页面结构/价格区块随渲染变化，验证了"拿不到就不存"）。
- B 动态 BSR/评论商品（B0BG3C7CNJ Igloo 午餐盒）：实体绑定 ✓；reviews=597、BSR=5899 快照保存；页面币种 JPY → price `currency_not_usd:JPY` 不保存 ✓。
- C 币种异常商品（B07G4VTV2F KINTO 杯）：实体绑定 ✓；页面币种 JPY → price `currency_not_usd:JPY` 不保存 ✓；rating/reviews 正常保存。
- D 对抗错 ASIN：任务绑定 A、采集页面 B → `asin_mismatch` 硬拒绝 ✓（Wrong Entity = 0）。

结论：三商品实体绑定全部成功（Wrong Entity = 0）；价格在币种非 USD 或选择器未命中时一律不保存；快照保存/读回/幂等全链路通过。

## 4. 学习记录（learnings）

1. **页面结构比预期更易变**：V3.1 验证过的 USD 商品（B0C3NFB3CZ）本次价格选择器未命中（`selector_not_found`），V3.1 观测为 JPY 的 B0BG3C7CNJ 本次确认 JPY。验证了 fail-closed 的价值：无论原因（币种/结构/渲染延迟），price 一律不保存，绝不猜测。**后续维护方向是 selector 容错，不是放宽保存**。
2. **Preview 必须服务端生成并持有**：若允许客户端回传字段值，恶意客户端可篡改 preview 后保存伪造字段。实现采用服务端 PreviewStore（TTL 15 分钟、上限 64 条、取走即失效），save 只凭 evidenceId 取回，客户端回传值不被信任。
3. **`requireAuthenticated` 是同步 Guard**：测试中误用 async mock 导致 `auth.ok` 恒为 undefined（Promise.ok），表现为 `{"ok":false,"error":{}}` 空错误。恢复同步 mock 后通过——Route 调用契约以真实 Guard 的同步签名为准。
4. **三一致硬门禁必须与 Smoke 共用实现**：`buildConfirmedSnapshot` 提取到 `lib/server/browserEvidenceCollect.ts` 后，route 测试（mock preview）与真实浏览器 Smoke 验证的是同一段门禁代码，避免"测试通过但真实路径不同"的偏差。
5. **vitest include 只匹配 `*.test.ts`**：组件测试需命名为 `.test.ts`（组件内不使用 JSX 语法时）或调整 include；本次用 `createElement + renderToStaticMarkup` 保持纯 ts。
6. **Smoke 默认跳过**：真实浏览器用例用 `runIf(RUN_V33_BROWSER_SMOKE === "authorized-once")` 门禁，默认 `npm test` 不触发，避免 CI/日常全量测试打开浏览器访问 Amazon。
7. **双重审查发现并闭环 3 个测试缺口**：owner Prisma 读写路径零测试（新增 route 测试 2 用例，mock prisma findUnique/updateMany 并断言 confirmedBy.mode="owner"）；前端 bound/unbound 渲染无正向断言与"仍然保存"按钮无缺失断言（新增 4 用例）；三一致门禁无逐分支单测（新增 `browserEvidenceCollect.test.ts` 9 用例，URL/page/expected 三 ASIN 各自失配均拒绝）。审查还发现 `saveBrowserEvidence` 中 slice(0,20) 使上限报错成为死代码——已修复为 priorCount≥20 直接报错并补测试。

## 5. 遗留风险

- 本机 3005 集成树尚未包含 V3.3 代码（worktree 隔离）；UI 端到端人工验收需集成后执行。
- 真实 Amazon 页面结构与反爬策略可能随时间变化；collect 失败时 fail-closed 并引导人工自查，不自动重试规避。
- PreviewStore 为进程内内存缓存（单实例约束）：多实例部署时 save 可能取不到 collect 的 preview；TTL 15 分钟，过期提示重新采集。
- Browser 与 XLSX Evidence 并存：时间差异不判 conflict（快照语义），由人工决定采纳哪个来源。

## 6. 决策记录（V3.3 架构）

- **EXTENSION_NOT_REQUIRED**（详见 `reuse-matrix.md`）：不新增 Prisma 表、不扩字段（6 字段上限）、不引入 SellerSprite、不自动爬取、不读 credential、不绕 CAPTCHA、不调 AI。
- 字段性质：6 字段全为 `snapshot`（页面观察值），不升级为 business fact；price 仅 USD 保存。
- 自动导航范围：仅任务绑定 ASIN 单页（`/dp/{ASIN}?language=en_US`），不自动搜索、不批量。
