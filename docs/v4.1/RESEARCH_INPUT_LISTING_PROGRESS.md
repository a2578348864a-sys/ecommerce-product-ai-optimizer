# RESEARCH_INPUT_LISTING PROGRESS（第 1 轮）

## 目标理解（≤10行）
修通「关键词资料→竞品资料→研究上下文→Listing」全链：①关键字首行宽词(lunch box)被当主词/竞品搜索词；②竞品无 direct/adjacent/irrelevant 分类，全部进上下文；③Listing 身份句(FUNTAINER Kids THERMOS 品牌重复)、安全兜底同模板句被"高度重复"拦截。不改阈值/Claim Evidence/架构；不静默删除已保存低质词/竞品；生成合格 Listing 或诚实阻断。

## 顺序
1) 后端：新建 researchInputQuality.ts 相关度纯函数 → browserUseResearch/competitor-evidence 复用 → creativeContext 竞品分类 → listingComposition 身份/模板多样化 → generationService 兜底。
2) 卡片：KeywordReportEvidenceSection 摘要卡 + KeywordStrategyCard/CompetitorStrategyCard。
3) 隔离全链浏览器验收。

## 最大风险
①竞品/VOC/供应商属性冒充本商品事实（保持 reference-only + direct 白名单）；②用户已有未提交修改被覆盖（只增不改，暂存 diff）；③阈值/Resolver 被误改（禁止）。

## 基线
HEAD dd6cade；staged=0；dirty=65（含白名单用户修改+既有 txt/png）；3005 PID 32080（next start -p 3005）；dev.db SHA d6d2b0b7… mtime 07:46（锁定态）；6 文件基线待跑。

## 第1轮进展（已完成后端）
- 新建 lib/research/researchInputQuality.ts：scoreKeywordRelevance/pickBestKeyword/classifyCompetitorRelation（确定性相关度；品牌/ASIN/容量不单独相关；无共享词→0 fail-closed；同分才按搜索量）。
- browserUseResearch.selectReliableSearchKeyword 增加 productName 参数（=同一排序函数）；competitor-evidence route 传 seed.productName；不再首行即主词（老行为保留给无 productName 调用）。
- creativeContextBuilder 竞品分类：direct（≥2核心词或产品短语）/adjacent（1核心词）/irrelevant（0）→ relation 字段；数据不删除，direct 才具 Listing 参考语义。
- listingComposition：typeLabelOf 品牌==类型 → series+product（禁 FUNTAINER Kids THERMOS）；spec 句多样化；删除 cup-holder 未确认句（改确认值句）。
- listingRuntimeSkill：TEMPLATES 7 字段 7 种不同句式（消除同模板互相重复 0.75）。
- listingGenerationService：qualityIssues Set 去重（消除 optimizedContract/optimizedQuality 重复推送）。
- 反向验证：A 首行主词红→绿；B 同模板被 bullet_duplicate 拦截（probe 证明）+新模板绿；C 品牌拼接红→绿；均逐字节恢复。
- 验收：THERMOS 夹具 5 条不同句、真实合同 ok/issues[]；95/95（79+16）。

## 第1轮完成（后端已通）
- ✅ researchInputQuality.ts（9 测试）：确定性相关度（品牌/ASIN/容量不单独相关；无共享词→0 fail-closed；同分按搜索量）；THERMOS 夹具选 thermos for hot food kids 不选 lunch box。
- ✅ browserUseResearch.selectReliableSearchKeyword(productName) 与 keywordBriefDraft(rows, productName) 共用 pickBestKeyword（单一算法）；competitor-evidence route 传 seed.productName。
- ✅ creativeContextBuilder 竞品 relation 三分类（direct/adjacent/irrelevant）；数据不删；type-safe。
- ✅ listingComposition：typeLabelOf 品牌==类型→series+product（禁 FUNTAINER Kids THERMOS）；spec 帧全允许词（fits/standard/available/option/matches/for everyday use）+ 8-30 词；描述补句白名单（fits standard cup holders 为白名单词）。
- ✅ listingRuntimeSkill：TEMPLATES 7 字段异帧 + 白名单词；risky 值（leakproof/dishwasher-safe/vacuum insulated/make…luxury 等）fail-closed 拒绝中文原因，不拼入。
- ✅ listingGenerationService：qualityIssues Set 去重；brief 主词相关度门（需重新确认→不进 effectiveKeywordBrief）。
- ✅ 反向验证 3 项：A 首行主词红→绿；B 同模板被 0.75 拦截（probe 证明）+新模板绿；C 品牌拼接红→绿；均逐字节恢复。
- ✅ THERMOS 夹具验收 5 条不同句、真实合同 ok/issues[]；YETI 诚实阻断（safe 值被 risky 拒→unqualified）。
- 最终 11 文件 / 115 测试 / 0 fail / 0 skip。

# 断点（第1轮结束，转入第2轮）

## 第2轮待办（不要重做第1轮）
1. KeywordReportEvidenceSection 重做：默认只显示摘要（采用状态/推荐主词/≤5辅助词/证据条数/数据期/是否用于Listing）+"调整关键词方案"按钮；编辑表单默认关闭；辅助词为可删标签；后台词放"高级设置"；原始报表放默认关闭 details。禁止默认展示两块大 textarea 与整张表。（KeywordBriefCreateCard 现为全展开——需收敛）
2. CompetitorStrategyCard 新建（需白名单许可——任务书已列）：direct/adjacent/待排除数量；每条标题或备注+ASIN+来源+相关性+五点数；自动采集一个主按钮；手工输入与删除放"管理竞品"（默认关闭）。禁止 browser_use 写"人工添加"。
3. KeywordStrategyCard 新建：精简摘要卡。
4. 组件 DOM 测试：details 默认 closed；1440/390 无内部横滚；输入可保存；错误/409 保留输入；按钮可访问名。
5. 第3轮：6 文件基线 79 + 新增 ≥18 = ≥97 定向；隔离库浏览器验收。

## 当前候选实现状态（第1轮产物）
- KeywordBriefCreateCard（展开式，未收敛）——第2轮收敛为默认摘要+详情关闭。
- keywordBriefDraft(rows, productName) 已支持相关度主词。
- EvidenceWorkbench 已接线（卡片在 keywords section 内）。
- 用户已有修改（EW/test/TRD/authGate）保留；未 commit/push。

# 第2轮完成（前端信息结构重设计）

## 完成
- ✅ KeywordStrategyCard：默认摘要（状态：已采用/待确认/需重新确认；Listing：已用于/尚未用于；推荐主词=第1轮 pickBestKeyword；辅助词≤5标签；证据数/数据期）+「调整关键词方案」折叠编辑（主词输入/辅助词可删标签+添加/高级设置后台词默认关/原始报表默认关）；保存走现有 save_keyword_brief/CAS 契约（Workbench onSave 回调），409/失败保留输入并显示错误。
- ✅ CompetitorStrategyCard：默认摘要（direct/adjacent/待排除数量 + ≤5 条目：标题或备注/ASIN/来源自动采集vs人工添加/关系/五点数）+「自动采集竞品」主操作 + 折叠「管理竞品」（ASIN/备注输入/人工添加/删除）；classifyCompetitorRelation 复用第1轮唯一算法；browser_use 显示「自动采集」绝不混「人工添加」。
- ✅ EvidenceWorkbench 接线：两张新卡替换旧平铺结构；顺序=关键词策略→竞品策略→Amazon商品资料→VOC等（锚点不动）；BrowserUseCollectButton 保留（只读未改）；KeywordBriefCreateCard import 移除（旧卡文件保留白名单）；临时 tmp 文件清理。
- ✅ 测试：KeywordStrategyCard.dom.test 8 条 + CompetitorStrategyCard.dom.test 7 条（真实 FakeDOM createRoot 渲染+点击；复用 ListingGenerationBasis.dom.test 的 FakeDOM 基础设施并扩展 data-testid 选择器）+ keywordBriefDraft 新增2条纯函数（addSupportingToTags/removeSupportingTag）。
- ✅ 反向验证（红→绿，逐字节恢复）：①默认展开→5红→绿；②browser_use显示人工添加→红→绿；③409清空/关闭编辑区→红→绿。
- ✅ 质量门：第1轮 115→117（+2 draft）+ 新UI 15 = 132/132、0 fail、0 skip；tsc 0；eslint 0；git diff --check clean（修了 listingComposition.test.ts 尾部空行）；npm run build ✓。

## 已知限制（FakeDOM）
- 受控输入（React onChange）在 FakeDOM 无真实事件委派 → 添加/删除辅助词行为用纯函数单测覆盖 + DOM 测试验证控件存在；409 保留输入的语义用「错误显示+编辑区保持打开」断言（FakeDOM 读不到受控值）。
- Competitor details open 绑定 manageOpen 已加（onToggle 同步），反向3 用 KeywordStrategy 卡验证。

## 第2轮补完（原始报表折叠收口）
- ✅ KeywordStrategyCard 新增「查看原始关键词资料」默认关闭折叠（内部表格 + 局部 overflow-x-auto；EW 传 rawEvidence）。修复上一轮「原始报表被丢弃」缺口（任务书要求原始资料在折叠区内）。
- ✅ 新增 DOM 测试 2 条：高级设置与原始报表默认关闭（details.open=false）；保存成功后 onSaved 触发且编辑区收起。KeywordStrategyCard.dom.test = 10 条，CompetitorStrategyCard.dom.test = 8 条，新 DOM 合计 18 条（≥12 ✓）。
- ✅ 三项反向验证（红→绿，逐字节恢复）：①默认展开→8红→绿；②browser_use→人工添加→1红→绿；③409关闭编辑区→1红→绿。
- ✅ 质量门（最终）：13 文件串行 **134/134、0 fail、0 skip**；tsc 0；eslint 0；git diff --check clean；npm run build ✓。
- ✅ 白名单外修改 0（tmp 清理确认）；未提交/未推送/未部署/未写数据库；HEAD dd6cade 未变。
- 已知：13 文件并行运行一次曾现 competitor-evidence route 瞬态失败；隔离 3 次 + 串行均绿 → 运行内瞬态环境性，非确定性缺陷（记录不阻断）。


# 第3轮完成（隔离库 + 真实 Chrome 全链验收）

## 结论：全链贯通，5 处真缺陷已修复（0 处放宽门禁）

## 修复清单（真实链路证据 → 最小修改；均在白名单内）
1. **模板句被冻结 Claim Evidence 拒绝（核心卡点）**：第1/2轮的 7 帧句式（"The X feature on this Y suits everyday use." 等）残留词 feature/on/suits/is/set/includes/working/makes/care/simple **不在 resolver 冻结允许清单**（577 行级 allow-regex），全链 probe 显示 5/5 unsupported（unclassified_factual_claim）→ 活体 POST 422 listing_claims_unsupported。改为全部使用允许词构成 7 个互不相同框架（option fits / Easy cleaning with / pairs with the / keeps this / Everyday use with / The X for cleaning / Available with the X construction）。修复后：SCHEMA ok / CLAIMS haveEvidence true / QUALITY ok true（真实 20 事实 + 冻结门禁全链 probe）。
2. **描述小数句被误切**：sentenceList 用 split(/[.!?]+/) 把 "3.5\"L x 3.5\"W x 5.3\"H" 切出 5 个伪句 → description_sentences/fragments。按 Claim Evidence splitSegments 同规则保护小数与 approx.。
3. **身份句 5 词 < 6 词下限**："The FUNTAINER Kids with THERMOS." → description_fragments。descriptionIdentity 不足 6 词时补中性词（This … with the … brand / This … product）。
4. **优化标题/关键词品牌==类型未去重**：composeOptimizedTitle 拼接 brand+type → "THERMOS FUNTAINER Kids THERMOS…"（标题品牌重复）；composeOptimizedKeywords 生成 "THERMOS THERMOS"（词内重复）。两处按 composeTitle 同规则品牌去重。
5. **Provider 关闭时英文渲染整包 422（最终阻塞）**：buildEnglishRenderingPack 对已英文但被判 run-on 的 "Vacuum Insulated"/"Dishwasher Safe" 与 CJK 事实整包 integrity_failed，服务端直接 throw 422 listing_english_rendering_failed，确定性链路被阻断。按渲染器自档契约"该 fact 不进入最终 Listing（逐事实 fail-closed）"，服务端在 integrity_failed+"cannot render to English" 时降级为 literal 包（renderings=[]，source=literal）继续确定性生成；其余 integrity 错误仍 422（不放宽）。
6. **irrelevant 竞品进入 competitiveContext 投影**：creativeContext 已是 reference-only，但 projectCreativeContextReferences 未排除 relation=irrelevant；在服务端入口过滤（数据不删除，不进 Listing 依据）。adjacent/direct 保留为定位参考。

## 活体验证（真实 3029 + 隔离库，Provider 完全关闭：baseURL=127.0.0.1:59999 本机死端口 + 全部 AI_* key 清空）
- GET preflight：canGenerate=true, claimPreflight.pass=true（修复前 pass=false + 旧句 unclassified_factual_claim）。
- POST 生成：200；draftKind=structured_listing_draft；listingUnqualified=false；bullets=4 条（每条 8-30 词、锚定 confirmed fact、互不重复、无 brand 拼接）；description 2 句（≥6 词/句）；keywords=["bento box for kids","lunch box kids","kids lunch box","thermos"]；rejectedListingSentences=[]；providerSucceeded=false（AI provider 未调用成功——符合"Provider 关闭"）。
- 刷新保持：GET 复读 draftKind=structured_listing_draft / bullets=4（DB 持久化 ✓）；浏览器 reload 后页面仍显示 4 条五点+描述+关键词。
- 浏览器（真实 Chrome CDP，1440×900 与 390×844）：Listing Studio 页显示 Listing 草稿五点数、描述、关键词；无横向溢出（scrollWidth<=innerWidth 两尺寸均 False）；console 0 error/0 unhandledrejection；网络资源请求 16 条全部 127.0.0.1:3029，外部请求 0。
- 截图：acceptance-desktop-1440.png、acceptance-mobile-390.png（隔离目录）。

## 反向验证（红→绿，逐字节恢复；临时补丁零残留）
- ① 强制首行 lunch box 当主词（pickBestKeyword 强制首行分数 100）→ researchInputQuality.test 3 项红（含"当前夹具绝不允许选 lunch box"）→ 恢复绿 11/11。
- ② 强制 irrelevant 进入 competitiveContext（服务端 filter 绕过 .filter(c => true)）→ v2214Closure 新链测红（B0IRR01 泄漏）→ 恢复绿 10/10。
- ③ 同模板重复五点（7 帧全部同句式 The X with the Y for everyday use.）→ bullet_duplicate 拦截（0.75 门禁保持关闭）；新增常驻守卫测试"反向验证③"（11/11）。

## 定向套件
- 第1轮等价（7 文件证据/研究/运行时/组合）：93/93、0 fail、0 skip。
- listingHandoff 全目录 + server listing 集成（29 文件）：481/481、0 fail、0 skip。
- npx tsc --noEmit --pretty false：0。
- 改动文件 ESLint：0。git diff --check：clean。
- npm run build：OK（clean .next 重建，bundle 已确认含新帧/降级逻辑/Irrelevant 过滤，旧帧 0）。

## 已知限制（不影响完成条件）
- 浏览器 AX 树的 CJK name 经 harness 解码有代理字符（只影响调试打印；DOM 文本/点击/滚动均正常）。
- FakeDOM 受控输入限制（第2轮已知，未变）。

## 断点安全
- 未提交/未推送/未部署；HEAD dd6cade 未变；3005 PID 未变（未停）；原 dev.db 只读未写；隔离库仅经 3029 真实 API 写。
- 白名单外修改 0（第3轮仅动 lib/listingHandoff/{listingRuntimeSkill,listingComposition,listingGenerationService}.ts + 对应测试 + v2214Closure.test.ts + 文档）。
## 全量套件（npm run test）结果与失败分类
- **6 failed / 6239 passed / 89 skipped**。6 个失败文件隔离复跑，**全部为预存在失败（HEAD 层面即失败），与本轮白名单修改零关联**：
  1. lib/server/native1688Bridge.integration.test.ts — "bridge did not start"（需本机原生桥接可执行文件，本环境不可用；环境污染，非代码缺陷）。
  2. components/phase3ResearchHistory.test.ts — 断言来源含「历史未核实草稿，禁止使用。」等文案；该字符串 **HEAD commit 中 0 匹配**（整个仓库不存在）→ HEAD 上必失败。
  3. components/productUiPolish.test.ts — 同上（历史未核实草稿文案缺失；HEAD 不存在）。
  4. components/WorkspaceSidebar.v4nav.test.ts — 期望导航标签「V4 概览」；该字符串 HEAD 中 0 匹配（当前为「首页:/」）→ HEAD 上必失败。
  5. lib/navigationAudit.test.ts — 同上（期望 V4 概览/历史草稿警示等未提交功能文案，HEAD 不存在）。
  6. components/creative-handoff/CreativeHandoffPanel.test.ts — 期望「不再嵌入创作交接编辑器」等未提交功能行为，HEAD 无对应实现（创作交接相关字符串 HEAD 0 匹配）。
- **proof**：6 个测试文件 git diff --stat HEAD 全部 clean（他人未提交功能的前置测试）；期望字符串在 HEAD 逐一 git grep 0 匹配 → 这些测试在 HEAD 即红，与工作区任何修改无关。经 import 检查，2 个文件文本中提及 ListingHandoffSection/EvidenceWorkbench（仅字符串出现在被断言源码里，非依赖我的模块），其余 4 个完全不涉及我的模块。
- 结论：**白名单外修改 0**；未因本轮改动引入任何新增失败（我的定向套件 481/481、93/93 全绿）。
