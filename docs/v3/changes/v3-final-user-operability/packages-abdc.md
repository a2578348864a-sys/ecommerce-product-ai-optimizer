# V3 Final User Operability Correction — Package A/B/D/C 完成记录

> 基线 main == origin/main == 737b6bf；功能分支 `codex/v3-final-operability-correction`；全部改动已集成 main == b9683b3。

## Package A — Core Operability Bugs（Commit 178fa2f / 711dc18）

### OA6 — Amazon Browser `s is not defined`（P1，root cause 实证）
- 根因：`fn.toString()` 把模块函数序列化进 Runtime.evaluate 表达式；生产 SWC minify 把模块标识符压缩为单字母（build 产物实测 `${z(s)}`），内联函数体引用 minified 名 `s` → 页面作用域 `ReferenceError: s is not defined`。vitest 不 minify → 测试误绿。
- 修复：浏览器端代码维护为**显式字符串工件**（self-contained IIFE、固定名 function 声明、互调固定名、`__OPTIONS__` 占位替换；字符串不被 minifier 改写）：
  - `tools/collectors/amazon/detail-page-expression-source.ts`（新）：DETAIL_PAGE_EXTRACTOR_SOURCE（15 helper 手写 JS 版）+ buildAmazonDetailPageExtractionExpression
  - `tools/collectors/amazon/search-page-expression-source.ts`（新）：AMAZON_SEARCH_PAGE_EXTRACTOR_SOURCE + AMAZON_PAGE_CONTEXT_SOURCE
  - `detail-page-extract.ts` / `extract-search-page.ts`：删 functionSource+builder，re-export 新工件（API 兼容）
  - `page-diagnostics.ts`：19 helper 已有 fail-closed guard（try/catch → emptyDomSignals），仅标注不 gate 主链
  - 1688 legacy 路径 LEGACY_UNUSED 标注
- 测试：`detail-page-expression.test.ts`（8 用例：自包含/隔离作用域/与 TS 版 toEqual 同步/占位替换）；`production-bundle.invariant.test.ts`（build 后断言产物表达式完整、无 functionSource/`${` 拼接；webpack 共享 chunk 全量扫描）

### OA7 — 技术错误泄漏（P1，Top 10 清理）
- 机制：`lib/client/apiErrorMessage.ts`（新）：code → 用户文案表 + 未命中 fallback，永不直出 message；服务端 console.error 保留 detail
- 清理：browserEvidenceCollect（extraction_failed/collect_failed 固定用户文案，raw 进日志）；sourcingAcquisition（tool_error/not_available 去 V35_1688_CLI_PATH 与 CLI 原文）；sourcingImageAcquisition（mapBridgeFailure/extension_disconnected/page_identity_unknown/search_trigger_not_confirmed 去 detail=/pageKind/pageUrl/submit.code/raw message）；10 个 route 的 expectedStorageVersion 统一为"内容刚在其他位置更新，请刷新后重试。"
- 四区错误态：`EvidenceWorkbench.tsx` SectionStatusBar（loading/error/retry）+ keyword/browser/voc/aiSummary 插入；AiEvidenceSummarySection 已有总结时重新生成失败也渲染 error（role="alert"）
- fetch 超时：EvidenceWorkbench 各区 fetch + VocEvidenceSection 3 处 + BrowserEvidenceSection collect/save + SourcingEvidencePanel api()/loadInitial 全部 AbortSignal.timeout（普通 60s、AI 120s）

## Package B — Navigation / Active Research（Commit a41df29）
- /tasks 内部四 Tab（进行中/待补信息/已完成/已放弃/全部）：`TaskRecordsList.tsx` scope state + `app/api/tasks/route.ts` GET scope 参数（active=无 researchRecord 或 decisionStatus∈{pending,continue}；completed=continue+contains；abandoned=rejected）+ 空态（"当前没有正在研究的商品"+去待研究商品 CTA）
- 标题：TaskRecordDetail h1/breadcrumb 动态（有 researchRecord → "商品研究记录"，否则"商品研究"）
- CTA 统一 + AI gate 删除：F1 引导卡改"研究尚未运行 AI 分析"+"可以先收集证据…也可以让 AI 随时整理当前已有资料"+"AI 整理当前资料"
- Evidence Completion State：research-evidence-checklist（商品基础资料=已有/竞品=可选/关键词/Amazon 页面/买家评论=待补/供应线索=可选）

## Package D — 1688 Onboarding（Commit f2b320d）
- 三入口就绪徽章：关键词找货/已有 1688 链接 →「1688 登录 ✓/需登录 1688」；图片找货 →「浏览器助手 ✓/需加载扩展」
- need_login 横幅 → 2 步登录引导：`lib/server/sourcingAcquisition.ts` 新增 `buildCliLoginHint()`（固定命令 `node "<cliPath>" login`，仅 UI 展示/复制；业务层不执行 login——FORBIDDEN_COMMANDS 保持零代码路径）；route GET toolStatus.loginHint；UI [复制命令] + [我已登录，重新检测]（refreshTools 重跑 loadInitial，登录成功自动退出 need_login）
- Image 扩展 3 步引导（chrome://extensions → 开发者模式 → 加载已解压的扩展程序选择 qingxuan-1688-helper）+ [已加载，重新检测]
- 术语隐藏：UI 与用户可见服务端消息彻底移除 1688-cli / Qingxuan / V35 / CDP（测试断言锁定：not.toContain("1688-cli")）

## Package C — VOC / Automation UX（Commit 5b09c8c）
- 批量粘贴显性化：表单说明"每行一条，一次可粘贴多条"+ 实时"当前识别 N 条"（data-testid=voc-import-line-count）+ 确认按钮显示条数 + 结果"已导入 X 条；重复 Y 条；忽略 Z 条"
- ASIN 预填：review-evidence GET 返回 taskAsin（复用 readBrowserEvidenceTaskAsin）；VocEvidenceSection 新增 taskAsin prop（EvidenceWorkbench 传 browserTaskAsin）；角色=当前商品且未填时自动预填
- 半自动 Review Collector：
  - `tools/collectors/amazon/review-snippet-extract.ts`（新）：REVIEW_SNIPPET_EXTRACTOR_SOURCE 自包含字符串工件（P1-A 机制）+ buildReviewSnippetExtractionExpression（maxItems ≤20 校验）+ 测试（4 用例）
  - `lib/server/reviewCollector.ts`（新）：collectReviewSnippets（resolveSystemBrowser + openIsolatedPublicBrowserSession，白名单 amazon.com，登录墙 fail-closed）+ createReviewCollectPreview（服务端缓存 Preview，subjectKey+taskId 绑定、TTL 15 分钟、单次 1-3 ASIN）+ assertReviewCollectRequest
  - route：action=collect（返回 preview + duplicate 标记，不写入）/ collect-confirm（previewId + selectedIndices + storageVersion → 服务端从缓存重建 ReviewImportInput，sourceType=browser、bindingKind=browser_verified、collectorVersion=amazon-review-snippet-collector.v1 → importReviews 去重/上限）——字段值全部服务端重建，客户端只传 selection
  - reviewEvidence.buildReviewItem 参数化（sourceType/bindingKind/collectorVersion）
  - UI：「采集评论」按钮 + 采集面板（ASIN 预填/角色/开始采集/预览列表 checkbox 默认选中非重复项/确认加入）+ 登录墙与无结果如实提示
  - 测试：route.test.ts +5（dedupe 标记、browser 绑定写入、preview 单次使用、invalid payload、browser unavailable fail-closed）
- 样本量语义保持：N 条 / M 个 ASIN / 当前 X / 竞品 Y（stats 已含 sourceProductCount/currentCandidateCount/competitorCount）

## 验证矩阵（实际运行）
| 项 | 结果 |
|---|---|
| Package A targeted（detail-page-expression 8 + invariant 2 + 92 受影响） | PASS |
| Package B（tasks route 41 + 导航/收敛/历史 92） | PASS |
| Package D targeted（SourcingEvidencePanel 6 + sourcingAcquisition 20 + sourcing route 15） | PASS |
| Package C targeted（review-snippet 4 + review-evidence route 14 + reviewEvidence 13 + vocAnalysis 13 + VocEvidenceSection 7） | PASS |
| tsc --noEmit | PASS |
| eslint（改动文件） | 0 errors（既有 warnings 除外） |
| 全量 npm test | 419 文件 / 4810 测试 PASS；3 环境类失败已归因（native1688Bridge 端口被集成树 bridge 占用；SQLite 并行 EPERM 单独重跑 PASS；release-package Windows tar 基线已知） |
| npm run build + production-bundle.invariant（3 用例，全 chunk 扫描） | PASS |
| 真实浏览器 Amazon smoke（RUN_V33_BROWSER_SMOKE） | PASS（3 ASIN 实体绑定+字段提取 correct；JPY fail-closed；mismatch 硬拒绝） |
