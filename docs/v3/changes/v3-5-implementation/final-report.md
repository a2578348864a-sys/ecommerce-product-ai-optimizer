# V3.5 Implementation — Final Report

> 来源：唯一权威合同 `docs/v3/V3_5_PRE_IMPLEMENTATION_CONTRACT.md`；本目录各分项文档。
> 分支：`codex/v3-5-implementation`（worktree `电商工具-v3-5-impl`）；起点 bc639e2。

## 0. 一句话

**V3.5 Narrow Implementation 代码/测试/文档全部完成并已本地提交；真实 smoke 被 1688 风控暂停（CLI）与登录/前台浏览器（图搜）阻塞，按 overnight 协议记录 BLOCKER 并完成其余全部工作——只差用户最小动作即可最终验收。**

## 1. 最终正式架构

- **Keyword / Detail**：`LocalSession1688CliDriver`（本地外部工具 1688-cli v0.1.47，只读 allowlist search/offer/whoami，不进 npm 依赖，env `V35_1688_CLI_PATH`）。
- **Image Discovery**：`Local1688BrowserDriver`（Option A′：复用 V3.3 CDP 架构模式 + 1688 专用持久 profile + 前台窗口 + 版本化 resolver）。
- **Evidence 存储**：versioned taskResultJson（writer `sourcing-evidence` → `sourcingEvidence`，`sourcing-evidence.v1`），**零 DB migration**。
- **UI**：任务详情页"供应线索（1688）"面板（关键词/图片/URL 三入口 → Preview → Human Confirm → 证据列表 + 询盘问题）。

## 2. 浏览器架构选择（§86 摘要）

Option A′（复用 V3.3 CDP 模式 + 1688 专用持久 profile driver）；**未选** OpenCLI（图搜 fail-open 缺陷实测 IMAGE_SEARCH_WORKS=NO）、未选新 Extension（权限面）。理由与替换路径见 architecture-decision.md。

## 3. 逐项清单（§108 编号）

| # | 项 | 状态 |
|---|---|---|
| 1 | V3.5 Implementation 是否完成 | **代码完成；真实 smoke 待用户动作（见 37/38）** |
| 2-3 | 最终架构 / 浏览器裁决 | 见上 + architecture-decision.md |
| 4-6 | Keyword / Image / URL-detail | keyword-acquisition.md / image-acquisition.md |
| 7-9 | Preview / Human Confirm / Sourcing Evidence | sourcing-evidence.md |
| 10 | Evidence Matrix | 证据面板字段分类 + 对比对象标注（Amazon 侧仅身份信息，其余未知，不自动评分） |
| 11-12 | Unknowns / Inquiry Questions | 面板"未知项" + 确定性询盘问题（模板生成，不自动发送） |
| 13-14 | Price / MOQ 语义 | displayedPrice/priceRange/priceTiers 分离（实测 ¥21.30 vs ¥16.5 保留差异）；displayedMOQ 不归一化 |
| 15 | Supplier data minimization | 仅展示名；receiveAddress/账号标识丢弃；whoami 只透出 loggedIn |
| 16 | Prompt injection | 本轮无 AI 路径；1688 内容不进入任何 system prompt |
| 17 | Owner/Visitor isolation | route 全链 auth + sandbox 隔离（Visitor B→404 测试） |
| 18-19 | Read-only allowlist / arbitrary command | allowlist 硬编码；写命令零路径（测试拒绝 cart/order/checkout/inquiry action） |
| 20-22 | Browser security / localhost / foreground | browser-security.md；loopback CDP；BROWSER_FOREGROUND_REQUIRED |
| 23-25 | Wrong Entity / Upload / Click | 全部 0 目标：entityBinding 门禁 + Candidate Identity Proof + proof 门禁（测试锁定 fail-closed） |
| 26 | Manual fallback | URL 粘贴读取可用；CLI/浏览器故障时人工路径保留（独立"人工导入"入口未做，如实说明） |
| 27-32 | Unit/Integration/Full suite/lint/tsc/build | 见 #47；全量 4745 passed / 0 failed；lint PASS；tsc PASS；build PASS |
| 33-35 | 真实 keyword / image / confirm smoke | BLOCKED_BY_RISK_CONTROL / BLOCKED_BY_USER_ACTION / 单测全链覆盖（真实数据待解锁） |
| 36 | AI smoke | NOT_RUN（本轮不调用真实 AI） |
| 37 | real smoke status | **BLOCKED_BY_USER_ACTION**（CLI daemon 风控暂停 06:10 后过期；图搜需登录+前台） |
| 38 | blockers | 1688-cli daemon DAEMON_PAUSED（risk_challenge，至 08-16 06:10 北京）；图搜需用户登录 profile + 前台窗口 |
| 39 | DB changes | **无**（无 Prisma 变更） |
| 40 | dependencies | **无新增**（未触碰 package.json） |
| 41 | security findings | 0 未修复（见 security-review.md）；driver 失败信封映射改进已落地 |
| 42 | regressions | 0（全量对比 baseline；release-package 差异=build 产物环境，build 后通过；sandbox flaky 非本任务引入） |
| 43 | docs path | `docs/v3/changes/v3-5-implementation/`（proposal / architecture-decision / keyword-acquisition / image-acquisition / sourcing-evidence / browser-security / real-smoke / security-review / regression 并入 security-review / learnings 并入 browser-security） |
| 44 | commits | 8 个本地 commit（9a2e086 → 58ca47d），已全部并入 main 并 push |
| 45-47 | branch / main / origin main | branch `codex/v3-5-implementation`（已完成交付）；**main == origin/main == 58ca47d** |
| 48 | push status | **已 push**（2026-08-16 验收后 fast-forward 集成 main，bc639e2..58ca47d） |
| 49 | worktree cleanliness | 集成树 clean（既有 untracked 运行产物保持原样）；impl 树 clean |
| 50 | PUBLIC_DEPLOY | FORBIDDEN（不变） |

## 4. Commits（已并入 main 并 push）

```
58ca47d feat: degrade gracefully when detail enrichment is risk-controlled
86dffb4 docs: record acceptance findings (real keyword smoke PASS + 2 real bug fixes; ...)
1579918 fix: bind page session for Page/DOM/Input CDP commands
d333fde fix: raise SKU cap to 500 for real multi-spec offers
9b5f090 test: fix sandbox task input shape and resolver fixture completeness
1b316bc test/docs: close v3.5 implementation (docs + risk-control envelope mapping)
8cd781b feat: add sourcing evidence panel to task detail (preview -> human confirm)
2dc91c5 feat: add native 1688 image acquisition (persistent browser session + versioned resolvers)
bb84e0d feat: add sourcing evidence workflow (preview -> human confirm -> save)
9a2e086 feat: add v3.5 sourcing acquisition contracts and read-only CLI driver
```

## 5. 最终状态声明（§109-§111；2026-08-16 验收后更新）

```
V3_5_IMPLEMENTATION_CODE    = COMPLETE
V3_5_OFFLINE_VALIDATION     = PASS（4744+ tests / tsc / lint / build / 安全审计）
V3_5_REAL_SMOKE             = PARTIAL PASS（真实关键词链 PASS：1 search + 1 detail + API 全链 search→preview→save→GET 落盘；
                              真实图搜链 BLOCKED_BY_USER_ACTION：需用户登录专用 profile + 前台窗口）
V3_5_REMOTE_CLOSEOUT        = PASS（fast-forward 集成 main + push；origin/main == main == 58ca47d）
READY_FOR_FINAL_REAL_SMOKE  = FALSE（CLI 链已验收；仅图搜链待用户登录后补）
MORNING_ACTION_REQUIRED     = TRUE（图搜：打开专用 profile Chrome 登录 1688 后回复"继续图搜"）
main == origin/main         = 58ca47d
PUBLIC_DEPLOY               = FORBIDDEN（不变）
V3_6_AUTHORIZATION_REQUIRED = TRUE（不变）
```

## 6. 验收发现的真实 Bug 修复（2026-08-16）

| Commit | 问题（真实 smoke 发现） | 修复 |
|---|---|---|
| d333fde | offer 674035283676 有 128 SKU（颜色×容量），SKU 上限 100 误拒绝 | 上限放宽 500（仅防无限膨胀） |
| 1579918 | `PersistentBrowserSession.send` 未绑定 page session，Page/DOM/Input 域命令 -32601 | send 默认 page session + sendRoot 显式浏览器域 |
| 58ca47d | 1688 风控恢复窗口内第二次调用必 challenge，save 被 enrich 阻断 | enrich 降级：失败记录 platform_metadata 标记并继续落盘（§69 revalidate 对象是 preview 候选） |
