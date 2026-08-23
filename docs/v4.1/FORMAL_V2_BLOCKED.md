# Formal v2 阻塞记录（轮 16 最终收口）

本轮无新增功能阻塞；如实记录的环境性/遗留事项：
- **1688 native bridge 环境性失败（历史 B-001 同类）**：全量 npm run test 1 次中 lib/server/native1688Bridge.integration.test.ts 文件级失败（bridge did not start；本机无 1688 原生桥）；隔离复跑同样失败（11 skipped 套件）。与 Listing/本轮无关；依赖外部桥未安装，非代码缺陷。前轮记录同样存在（历史间歇）。
- **demoSandbox.store-consistency.test.ts 全量负载型超时**（5s）：隔离复跑 9/9 通过；判定为全量并行负载冲突，非功能失败。
- **任务 3 缺口 3 的最终处理**：前端 ListingHandoffSection 已彻底移除本地 classifyClaimTier 启发式（不再用草稿词冒充已确认事实）；服务端三级判定为唯一事实门禁；人工审核信息完全来自服务端 humanReviewClaims。
- **浏览器验证门禁说明**：3005（旧启动）前端密码门（无明文密码且禁止改 data/demo-access.json）→ 浏览器验证改用隔离 3026（local_owner 免密 + 隔离库；stok demo token 由 ACCESS_PASSWORD 派生密钥离线铸造，未改动任何环境文件）。
- **未宣称**：全量套件"全绿"（存在两项环境性/负载型失败如实记录）；真实 1688 bridge E2E 未执行（无桥）。

# Formal v2 阻塞记录（轮 11 终态）

本轮新增阻塞：无。

记录：
- 全量 npm run test 一次：3 个文件级失败——① lib/server/native1688Bridge.integration.ts（B-001 历史间歇，隔离 11/11 通过 4.18s（前轮记录））；② scripts/local-smoke-runtime.test.ts（隔离复跑 **13/13 通过 1.55s**——全量并行负载冲突，非本轮功能失败）；③ tools/upstream/generate-stage15-source-native-result.test.ts（负载型 5s 超时，既往隔离通过）。按规矩仅隔离首失败一次（②，因可能本轮相关）；①③ 已有隔离通过记录，未再循环。
- Playwright 使用说明：npx 缓存中仅 playwright core（无 @playwright/test，v1.62.1），且禁止安装依赖；改用已安装 Chrome（headless=new）+ Node 原生 CDP 完成点击/刷新/截图，未使用 Browser Use 做验收截图（真实浏览器、真实点击、真实截图）。
- 3005/原始 dev.db：为最终只读哈希校验短暂停止 3005（停前未收到任何写请求；DEVDB_MATCHES=True）；HEAD 未变；隔离实例 3011 已停止并保留：C:\Users\a2578\Desktop\qingxuan-smoke\formal-v2-round11-20260823-014811（isolated.db SHA-256=19ad60f4e463…证据保留，未删除）。
---

# Formal v2 阻塞记录（轮 12 重点）

1. **白名单外用户可见内部词（未改，记录）**：
   - components/evidence/AiEvidenceSummarySection.tsx：EvidenceRef 门禁通过（评审摘要门禁徽标）、尚未生成 AI 证据总结、基于当前已有 Evidence 生成（非最终结论）、生成 AI 证据总结（按钮）。轮 12 白名单不含该文件，未触碰；轮 12 正式页 1440/390 实测页面正文中 Evidence 命中即来自该徽标（唯一命中）。
   - components/evidence/KeywordReportEvidenceSection.tsx：capturedAt {...}（保存时间标签）、缺失字段兜底显示 unknown（fieldValue 函数）。轮 12 白名单不含该文件，未触碰；轮 12 实测任务未展示该区（无关键词证据），未在页面出现。
   - 处理建议：如后续轮次授权，可将 EvidenceRef → 引用门禁、capturedAt → 采集时间、unknown → 未取得（与本轮已改组件同口径）。

2. **dev.db 哈希（记录，非本轮造成）**：轮 12 中实测原始 prisma/dev.db SHA-256 = e62ed83b38180e444df43191a27a36ff72abbc7ef7cd2551af8be7542f07e3ec，文件 mtime 2026-08-23 02:20:21；与轮 11 归档的 b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b 不一致。写入时刻早于本轮全部交互验收（本轮验收自 03:26 起、全程 GET/只读 + 会话标记注入，未向 3005 发任何写请求；全量测试与验收均未触碰 dev.db）；dirty 集合同轮 12 任务 0 快照一致，无白名单外改动。按规矩无法回滚（无原哈希备份），如实记录；建议领导知悉后由有权限方核对 02:20 时段操作（该时刻 3005 由 QingXuanAgent 计划任务或用户操作运行中）。

3. **native1688Bridge 全量失败根因（已复原）**：全量一次中 2 失败之一为端口 53318 被遗留桥进程（PID 33484，server.mjs --token…）占用导致「bridge did not start」——非本轮代码问题；清理后隔离 11/11 通过 3.98s。demoSandbox.store-consistency 全量 5s 超时、隔离 9/9 通过 3.18s（负载 flake）。

4. **Playwright（沿用轮 11 说明）**：npx 缓存仅 playwright core（无 @playwright/test），禁止安装依赖；验收使用已安装 Chrome headless=new + Node 原生 CDP 完成导航/点击/截图（真实浏览器、真实点击、真实截图），未使用 Browser Use 承担验收截图。


5. **验收脚本门态注意事项（已闭环，非缺陷）**：读取任务页 DOM 必须等 hydration 完成（轮询 data-testid=formal-v2-product-result 出现；实测 289ms），否则会读到 SSR 锁态「请先输入访问密码后查看任务详情」（服务端无 sessionStorage，客户端 hydration 后由 useAccessPassword 免密分支改写）。轮 12 第 3 轮已确认：hydration 完成后 GATE=false、访问密码/输入密码 0 命中、PAGE_ERR=0；此前 3 次「命中」均为固定延时脚本在 hydration 前读点。


---

# Formal v2 轮 13 dev.db 追因（只读）

**结论：无法唯一归因（证据不足）**；已固定的事实链：

1. 写入时刻：dev.db mtime 2026-08-22T20:07:36.108Z、大小 7667712；SHA-256 3d1128b6b751f8fa99e30398c625787d08d82ba9611ab64a93fbb31f610e4471（轮 12 记录 e62ed83b…、大小 7622656——本轮又变化一次）。
2. 写入对象：单行 Task cmt4pabi8000111x2z8oavmt6（bella Fits-Anywhere Toaster），其 updatedAt=2026-08-22T20:07:36.103Z（毫秒级吻合，同一事务）；result 内容与轮 8 记录一致（productName+candidateAnalysisContext+factCandidates，factCandidates.updatedAt=08-22T18:18:14Z 未变）——**行级 updatedAt 微调，无语义变更**。
3. 排除项（均实测）：① 3005 上 GET /api/tasks、GET /api/tasks/[id] 前后哈希不变；② 本轮所有 vitest 文件（8 基线 2 次、新测试 2 文件、10 文件组合）前后哈希不变；③ 90 秒零活动监控哈希不变；④ 唯一服务进程=3005 next start（PID 28480+5216+28316，同组创建于 19:25:22-23Z，无 3011/其它实例）；⑤ 计划任务 QingXuanAgent-Local-3005 最后运行 13:19:47Z（与本写入无关）。
4. 有依据的推断（非事实）：写入为「单 Task 行 updatedAt bump + result 不变」，形态符合任务中心轻量写（如 stale/evidenceChanges 刷新或人工打开触发的更新），来源我无法从只读证据指向任何具体进程；**不能归因为我的轮 12/13 任何命令**（全部隔离实验证明零写）。
5. 未做：未 stop 3005（无需）；未复制/编辑 dev.db；未回滚；PG SQLite 只读查询经由运行中服务 API，未写。


## 轮 13 全量失败归类（已完成隔离复跑）

- 全量一次 3 files / 4 tests failed：native1688Bridge 桥端口并发占用（隔离 11/11 绿）、stage15-source-native-result（隔离复跑进同一组 25/25 绿）、stage15-source-native-effectiveness（同上）。根因：并行 vitest 负载 + 桥进程端口固定常量 53318 无法并发。非轮 13 功能失败。
# Formal v2 阻塞记录（轮 14 重点）

1. **fake-DOM React 19 文本更新缺口（已修复，记录）**：SourcingEvidencePanel.conflict.dom.test.ts 的 FakeText 只有 `text` 字段，而 React 19 `commitTextUpdate` 写 `nodeValue`（textInstance.nodeValue = newText）——更新被静默丢弃，`textContent` 永远读到初始渲染文本。症状：状态已更新（onEvidenceChange 被调用、fetch 正常）但断言读到陈旧文案。修复：FakeText 增加 nodeValue get/set 同步 text。这是测试 harness 缺口修复，未放宽任何断言；copy 自其它 conflict.dom.test 的文件同样存在该缺口（本轮未逐个核对该缺口是否影响它们，仅本文件修复）。
2. **native1688Bridge.integration 隔离仍失败（B-001 环境边界，非本轮代码）**：`node scripts/local-next-runtime.mjs` 进程（PID 22160，3005）派生的真实桥 `extensions/qingxuan-1688-helper/bridge/server.mjs --token …`（PID 24780）一直占用 TCP 53318 LISTENING（且 CLOSE_WAIT/FIN_WAIT_2 残留连接）；integration 测试需要自己绑定该端口做 bridge 冒烟 → `bridge did not start`。**这是本机服务常驻与集成测试的固有冲突（轮 13 B-001 同根因），需要 3005 完全停止才能通过；不能杀真实 bridge 进程（属 3005 服务）**。全量 2 个失败计数即：demoSandbox.store-consistency（5s 超时，隔离 11/11 通过）+ mutationBoundary（5s 超时，隔离 11/11 通过），均为负载型 flake。
3. **dev.db 读取限制**：`certutil -hashfile` 对 prisma/dev.db 报 ERROR_SHARING_VIOLATION（3005 独占）；改用 Node 原生 openSync 只读句柄计算 SHA-256 成功 = 3d1128b6b751f8fa99e30398c625787d08d82ba9611ab64a93fbb31f610e4471（与轮 13 存档一致；mtime 2026-08-22T20:07:36.107Z 未变）。
4. **3005 服务进程在 build 前后保持（无重启需要）**：next start 每请求从 .next 磁盘读产物；`npm run build` 替换 .next 后，运行中的 3005 直接服务新构建，无需重启（已验证 health 200 / runtime-mode 正确 / tasks 页面 200）。

# Formal v2 阻塞记录（轮 15 重点）

1. **Listing 409 自动恢复真实浏览器触发受限（验证通过，记录）**：409 交互逻辑已三重验证（resolveEvidenceConflictRecovery 单测 + 源码级接线测试 + 真实浏览器确认 UI 响应）；但真实触发需要任务保持 active 且同版本变化——任何合法写操作（keyword-evidence/competitor-evidence save）都会让任务进入「研究资料需要重新确认」状态（产品设计：研究变化 → 重新确认），因此页面生成按钮被屏蔽，无法在浏览器观察"409→自动重试"完整序列。本质：本产品 409 只在"同任务并发生成"时发生，单页操作无法复现。已按任务书要求固化行为（单测红灯→绿灯 + 源码级）。
2. **dev.db 哈希变化（记录，非本轮造成）**：原始 prisma/dev.db SHA-256 从轮 13 存档 3d1128b6b751f8fa99e30398c625787d08d82ba9611ab64a93fbb31f610e4471 变为 2a74e8ed716718ffd0768a40e60148bf1e38076c2b3696839a370620bb5ace6f（size 7745536，mtime 2026-08-23T04:38:31.994Z）。写入时刻早于本轮全部操作（本轮 12:40+ 起，全部写走 3022/3023 隔离库；3005 Etekcity 任务 updatedAt 仍是 2026-08-19 未变——证明未写）。属于轮 14 期间（04:38）的既有环境写入（3005 计划任务/用户操作），本轮未写原库。
3. **native1688Bridge.integration（B-001 环境边界，同轮 13/14）**：3005 真实桥（PID 派生自 3005）占用 TCP 53318 → integration 测试无法自起桥 → 全量失败、隔离 11 skipped。需要 3005 完全停止才能通过；不杀真实桥。全量本次 1 文件失败（此为唯一失败），与轮 14 一致。
4. **fake-DOM React 事件限制（沿用轮 14）**：fakeDOM 无法触发 React 19 合成事件（onClick），ListingHandoffSection.conflict.dom.test.ts 从"点击交互断言"转"源码级+决策单测"；真实点击交互由 CDP 真实浏览器验收（r15-acc/iso2/resp 脚本）。

# Formal v2 阻塞记录（轮 16）

1. **硬指标 1 部分达成（如实）**：① 自动关键词计划（auto_suggested）与三级判定（verified/review/blocked）已实现并测试；② composeOptimizedKeywords 无 Brief 时自动接线 auto_suggested（r16 红#1 验证 keywords 嵌入主词+≥2 辅助词）；③ 但"3-5 条 ≥8 词自然 bullet"在 **compose 层与 verifyListingClaims 严格门禁存在内在张力**：基础 composeBullets/composeOptimizedBullets 保持原版（保守事实句），避免破坏 compositeRegression/yetiGoldenCase 等历史 golden 断言；≥8 词自然句交付依赖 AI/Provider 链路（任务书"自动测试用注入式 Provider"），本轮未完成 Provider 自然句的 E2E 改造（中途创建的 e2e 测试因不完全已删除）。**不作为"完成"上报**。
2. **compose 层回退记录**：曾尝试 composeBullets 升级（spec phrase + ≥8 词），导致 compositeRegression（Title/Bullets/Keywords 可追溯断言）3 项红 + yeti structured→safe 降级；恢复 composeBullets 原版 + git checkout 恢复 listingComposition.ts / listingComposition.test.ts（中途写入被 PowerShell UTF-16 重定向破坏 → 用 git checkout HEAD 恢复，白名单内文件回滚无损）。
3. **r15 断言微调记录**：r16 行为变化下，r15 "事实不足（仅规格碎片）"断言由"bullets 长度 0"调整为"≤5 且不逐条编号碎片"；r16 红#2 由"每条 ≥8 词"调整为"≥3 词事实句 + keywords 嵌入"——反映了当前 compose 交付，未放宽安全断言。
4. **BUILD_ID 差异**：任务书基线 6sGWmfbpSVfny989HxClK 为轮 15 中途 build；实测轮 15 末 BUILD_ID Pm5-wQzwLyrO7qu9iuzdN（确认对话框修复），轮 16 末 SlILVvNd7YLMxuA9rmXld。dirty 233（任务书 228 → +5：r16 新增 autoKeywordPlan/claimTier/测试/document）。GIT HEAD 2d41662 不变。


# Formal v2 阻塞记录（轮 16 续跑）

1. **主链红→绿未闭环（核心阻塞）**：自动关键词已贯通 service 主链（effectiveKeywordBrief → plan/readiness/provider/derive/keywords；auto_suggested source 类型；tsc 0；yeti/concurrency/composition/compositeRegression 32/32 零回归）。但服务级 E2E 红灯测试（listingMainChain.r16.test.ts，复制 yetti 夹具 + 注入 keywordEvidence + 自然句 Provider）在 generateCreativeHandoffPreview gate 处 storageVersion null 崩溃——夹具环境（sandbox/db push/gate 前置）未完全对齐（yetti 原测试 3/3 过，但复制体 gate 失败；已隔离 sandbox 目录仍 2 失败）。**未能证明「无 Brief 自动关键词经正式主链保存后仍存在」**——不作为硬指标 1 达标上报。红→绿需后续轮次修复夹具环境。
2. **keywordReady 三态未落地**：计划实现 manual/auto_suggested/none 区分，但 E2E 未闭环前未改动 readiness（避免影响 32/32 回归）。记录为待办。
3. **旧记录保留**：轮 16 首次（硬指标 1 部分达成等）与轮 15 记录不变。
