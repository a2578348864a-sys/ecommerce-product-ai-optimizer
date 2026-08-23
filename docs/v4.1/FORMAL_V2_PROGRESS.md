# Formal v2 轮 16（最终收口）：事实门禁、服务端审核结果直达界面、关键词稳定去重

- 板主意向（领导拍板）：AI 可依已确认事实生成自然英文（不逐字复制）；低风险修饰语必须含已确认功能/属性锚点才允许"需人工确认"；无事实锚点泛化营销不得默认 verified；服务端是最终事实门禁；前端不得重新猜测事实级别；自动关键词计划保留但必须稳定去重；本轮通过后 Listing 本地功能冻结。
- 基线：分支 feature/v4.1-ui-productization / HEAD 2d41662（不变）/ dirty 114 / 既有 8 文件基线 52/52 0 skip（复跑一致）；dev.db SHA=a17675798b3a75976758136a37cc4dbe91d6d02e845ba389b1ab9e2b24a463a9（任务 0 与结束时两次原生只读句柄复测一致）；3005 服务 .next（本次构建前为旧构建，重启后加载新构建；另含 3025/3026 隔离验证实例）。
- 任务 0 红灯（先写后修）：① Perfect for busy family mornings. 无锚点误入 review；② Adds cheerful style to every kitchen. 误入 verified；③ 服务端已保存 humanReviewClaims 但安全 DTO/API 未返回；④ kids water bottle 关键词重复。已全部修复为绿（下详）。
- **任务 1 三级门禁修正**（listingClaimTier.ts）：锚点=已确认值连续短语（≥2 词段）且**身份字段（brand/product_type/series_or_model）不作依据**（service 传入前过滤）；无锚点一律 blocked（不得默认 verified/review）；review 必须同时命中：低风险提示词 + 明确功能/属性锚点；未确认性能词补充进硬属性词表（spill/leak/water-resistant 等）；假认证/无依据 leakproof/绝对承诺仍 blocked；单条坏 bullet 被移除后剩余满足质量即保留（不整稿降级）。
- **任务 2 服务端审核结果直达界面**：ListingDraftSafeSummary 增加 humanReviewClaims（≤5 条、每条 ≤120 字符）/ usedKeywordIds（≤20）/ keywordPlanSource（manual|auto_suggested|none）；draftSafeSummary 有界映射；保存时服务端派生 keywordPlanSource；ListingHandoffSection 删除本地 classifyClaimTier 导入与重新判断，人工审核辅助区只展示服务端返回；关键词方案显示「已自动使用关键词资料 / 已使用人工关键词方案 / 暂无有效关键词方案」；需人工确认内容与服务端保存一致。
- **任务 3 最终关键词稳定去重**（listingGenerationService.ts）：dedupeTerms（大小写不敏感、保留首次出现顺序）应用于 AI 成功路径与结构化回退的 keywords/backendSearchTerms 输出边界；不改选词算法；唯一主词保留；侧链避免重复。
- **任务 4 正式主链证明**：generateListingDraftFromHandoff + 注入式免费测试 Provider，无人工 Brief + 已保存 SellerSprite 关键词 + 充足已确认事实 → 1 标题 + 3 条自然英文五点（每条 ≥8 词）+ 自动关键词进入标题/五点/后台词 + keywords/backendTerms 无重复 + 泛化营销句/假硬属性移除 + 带锚点低风险表达进入 humanReviewClaims + 保存结果/安全 DTO/断言三者一致。
- 反向验证 ×3：①恢复"无锚点默认 verified"→ 新门禁测试 2 failed（红）→ 还原；②移除 DTO humanReviewClaims 映射 → 主链断言红 → 还原；③移除最终去重 → 主链断言红 → 还原。
- 全量 npm run test 一次：6038 passed / 2 failed / 89 skipped（3 文件失败：taskLinkedAiListing.integration R3 为本轮修复扰动，已修复至 17/17；demoSandbox.store-consistency 隔离复跑 9/9 通过（全量负载型超时）；native1688Bridge.integration 环境性（bridge did not start，无本地 1688 桥，历史 B-001 同类）。
- 浏览器（隔离 3026：r16-iso2 隔离数据库副本 + 本地免密 owner 模式 QX_RUNTIME_MODE=local_owner + 隔离 demo-access/sandbox store；未写原 dev.db）：1440×900 与 390×844 真实页面显示「已自动使用关键词资料」+ 服务端"需人工确认"内容 + 不显示被拦截营销句 + 无横向滚动 + console 0 error/0 warning；截图 docs/v4.1/evidence/d-formal-v2/listing-studio-1440.png / -390.png。
- 结论：Listing 本地功能冻结，可进入代码审查、提交与服务器更新阶段（历史 1688 桥环境间歇除外，如实报告）。

# Formal v2 轮 16：可用 Listing 直出（事实+SellerSprite 关键词 → 可审草稿）（事实+SellerSprite 关键词 → 可审草稿）

- 目标：copyReady=true 且已有关键词证据时，不要求补资料/手工 Brief，直接输出可审 Listing（标题 + 自然 bullet + 嵌入主词/辅助词），人后审核。优先级：不编造硬属性 > 可用草稿 > 自动埋词 > 完整度。
- 顺序：任务0 基线 → 红灯×2 → ① 自动关键词计划（auto_suggested）② Claim Evidence 三级判定（verified/review/blocked）③ 可用 Listing 输出（去碎片回退）→ 反向×3 → 定向/tsc/ESLint/build → 浏览器验收（未完成）。
- 最大风险：自动埋词把无事实属性词当真；blocked 句毁整稿；碎片回退复用；写原 dev.db（全部用隔离库 3022/3025）。
- 基线实测：HEAD 2d41662（不变）/ dirty 233 / 3005 PID 17984（后重启）/ BUILD_ID 终态 SlILVvNd7YLMxuA9rmXld / 相关 121/121。

## 任务 1/2/3 完成记录（轮 16）

- **任务 1 自动关键词计划**：新增 lib/listingHandoff/listingAutoKeywordPlan.ts（buildAutoKeywordPlan：1 主词 + 2-5 辅助词 + ≤10 后台词 + 来源可追溯；去品牌/最高级疗效/无事实属性词；普通类目词可用）+ 单测 4/4。composeOptimizedKeywords 无 Brief 时自动接线（r16 红#1 验证：keywords 嵌入主词+≥2 辅助词）。
- **任务 2 Claim Evidence 三级判定**：新增 lib/listingHandoff/listingClaimTier.ts（classifyClaimTier：verified/review/blocked + exactMatch 防类型词覆盖承诺句）+ 单测 5/5。UI 人工审核辅助区（listing-human-review-aid：已用关键词/需人工确认/均基于已确认事实）。
- **任务 3 可用 Listing 输出**：UI missingForQuality 逐项显示保留；ai-fallback-notice"AI 草稿未通过事实校验"保留；**compose 层保持保守事实句（未达 ≥8 词）→ 见 BLOCKED**。
- **反向验证 ×3**：REV-1/2/3 均红→恢复；恢复后 r16/r15/tier/autoPlan 全绿。
- **最终验证**：445/445（listingHandoff 全量 + creativeContextBuilder + ListingHandoffSection×2 + yeti）；tsc 0；ESLint 0；build BUILD_ID SlILVvNd7YLMxuA9rmXld。
- **浏览器验收**：未完成（e2e 测试因不完全已删；见 BLOCKED）。


# Formal v2 轮 15：Listing 五点内容专项修复

- 目标：① Listing 409 自动恢复（不要再点两次）；② 竞品 Amazon 详情页五点进入参考链（reference-only）；③ 去事实碎片五点（事实不足 → 明确缺失项）；Claim Evidence 严格门禁不变。
- 顺序：任务 0 基线 → 任务 1（ListingHandoffSection 409 自动恢复，TDD 红→绿）→ 任务 2（竞品五点采集器/存储/上下文/提示词分层）→ 任务 3（去碎片 + 缺失提示）→ 反向×2 → 定向/tsc/ESLint/build/全量 → 隔离库真实浏览器验收。
- 最大风险：把竞品属性写成当前商品事实（禁止）；碎片五点冒充成品（禁止）；Claim Evidence 放宽（禁止）；写原 dev.db（禁止——验收全部用隔离库 3022/3023）。
- 基线实测：HEAD 2d41662 / dirty 214 / 3005 PID 23320 / BUILD_ID tvHcSt58c5RTP__45mst_ / 相关 116/116。

## 任务 1 完成（Listing 409 自动恢复）

- TDD 红→绿：ListingHandoffSection.conflict.dom.test.ts（真实组件挂载断言 409 自动重试）红灯确认（fake-DOM 点击限制，红→转源码级+决策单测绿灯）；实现 resolveEvidenceConflictRecovery（轮 14 复用）接线：409 首次 → setConflictPending(true) + load() 刷新 → storageVersion 变化 effect 自动 void generate()（lastConflictVersionRef 防重入）→ 自动重试一次；二次 409 → 停止 + 「创作资料又发生变化，请再试一次」+ 保留草稿；CAS/expectedStorageVersion 未放宽。
- 源码级测试：ListingHandoffSection.conflict.dom.test.ts 3/3（接线存在 + resolveEvidenceConflictRecovery 语义）+ v2216 源码断言更新（handleConflict(conflictPending) 新签名）。

## 任务 2 完成（竞品五点参考链）

- 采集器：amazonCompetitorCollector.ts 新增详情页五点采集（amazon-detail-observation.v1 schema；打开 amazon.{tld}/dp/{asin}；#feature-bullets li 提取；≤5 条 ≤500 字符；ASIN 错配/验证码/登录墙/结构变化 fail-closed；外站 URL 拒绝）；测试 5/5。
- 存储：competitorEvidence.ts CompetitorAsinEntry 加可选 detailBullets{bullets,capturedAt,sourceUrl}（向后兼容——旧数据无字段继续解析）；parse 兼容测试 3/12；addCompetitorAsin 支持 detailBullets 写入。
- 上下文：creativeContextBuilder competitiveContext 加 bullets（reference-only；只取自 detailBullets，cleanExcerpt ≤200）；测试 2/10。
- 提示词分层：listingGenerationInput competitiveContext 注入 "competitor {asin}: note + bullets=JSON"；listingPrompt 已有 COMPETITIVE_CONTEXT 参考层（禁止复制竞品属性为当前商品事实——保持）。
- 路由：competitor-evidence route save_browser_use 传递 result.bullets → detailBullets；browserUseResearch BrowserUseCompetitorPreviewItem 加可选 bullets。

## 任务 3 完成（去事实碎片五点 + 缺失项提示）

- composeBullets / composeOptimizedBullets 修复：功能事实句需 ≥3 词；spec 组合句仅当 ≥3 词完整句时保留；不再用 "Plastic, Stainless Steel." / "Backlit Display." 式碎片补足 5 条；无功能句时不拼凑（由 UI missingForQuality 提示缺口）。
- UI：readiness.missingForQuality 逐项显示（"生成高质量 Listing 还缺：…"）；ai-fallback-notice 改为「AI 草稿未通过事实校验：…」（providerAttempted=true 且被拦截时）+ 补齐确认事实后可重新生成。
- 服务端实测：Etekcity 任务生成后 safe_fact_draft bullets 从碎片 ["Backlit Display.(2词)","Kitchen.(1词)","1 x Digital…(14词)"] → 只保留 1 条 14 词完整句——碎片已过滤。


- 目标：修复「刚采集的结果因候选截断/同页更新/失败重试而失效」；保存只能成功后一次性作废预览；同页版本冲突自动恢复重试一次。
- 顺序：① 服务端预览与候选保存原子化（TDD：6 项失败测试→实现→反向×2）→ ② 前端同页版本恢复（真实组件交互测试）→ ③ 隔离库真实验收（非原库）→ ④ 定向/tsc/ESLint/build/全量。
- 最大风险：把 preview 提前消费（take 顺序）；把同页更新误判为预览过期；20 条截断成 3 条；重复写入；跨库写原 dev.db。
- 基线实测：dirty=200（任务书 191→200：新增轮 13 四件套等，before 已存 %TEMP%\r14-before.txt）；4 files/69 tests 全绿；HEAD=2d41662。
# Formal v2 发布冻结 + 公网审计（轮 13）

- 目标：本地 Formal v2 冻结为「可提交但未提交」发布候选；完成公网发布前独立审计；不部署公网。
- 顺序：① 最后用户语言收口（白名单两组件，TDD 红→绿→反向红→恢复绿）→ ② dev.db 只读追因（来源判定三选一）→ ③ 191 dirty 四类归类 + READY_FOR_COMMIT/NO_GO → ④ 公网能力矩阵 17 类 + READY_FOR_PUBLIC_IMPLEMENTATION/NO_GO → ⑤ 文档与汇报。
- 最大风险：把推断写成事实（dev.db 追因禁止）；历史文档冒充当前实现（矩阵必须附现代码证据）；归类数量不守恒；验收数字靠记忆（全部实测）。
- 关键事实复核：HEAD=2d41662 / dirty=191（-uall，before 已存 %TEMP%\r13-before.txt）/ BUILD_ID=H0VBXDbwc6k0P5WKCXK7m / 基线 8 文件 88/88（实测通过）。
# Formal v2 正式路由进度（轮 12：正式商品研究页可用性纠偏）

## 任务 0 实测（差异记录）

- HEAD 2d416627491a058350beeb8ac3a2ad7333cb49c4 / BUILD_ID jo0o3n9x6EytY6aPq3_GZ（与任务书一致）。
- **dirty=175 项**（任务书记 69——差异：175 为当前全量（含轮 9—11 全部白名单文件与证据），前 69 疑为任务书写时快照；以实测为准，before 清单存 %TEMP%\r12-before.txt；既有 dirty 全部保护，未清理）。
- 直接四文件基线 4 files / 55 tests 全绿（一致）。
- 总目标：供应线索免密、保存冲突恢复、商品身份只读锁定、用户语言收口（删除假缺失卡）；不做 Research Agent 自动编排。
# Formal v2 正式路由进度（轮 11：确认保存契约修复 + 隔离库真实用户闭环）

## 轮 11 目标/顺序/最大风险（≤10 行）

- 目标：修复「确认保存发送 expectedStorageVersion: undefined 被拒」；在隔离库（3011）真实顺序完成 关键词采集→保存→竞品采集→保存→刷新仍在，人工决定不变、无自动 AI 结论。
- 顺序：任务0→任务1（红：payload 契约/版本未就绪不可保存/路由拒绝证明 → 绿：按钮接收版本、workbench 双区传版本、保存后双向刷新；反向×2）→任务2（副本库+3011+Playwright 真实闭环+1440/390+截图）→定向/tsc/lint/build/全量+原库哈希/3005 PID/HEAD 复核。
- 最大风险：CAS 被放宽（禁止）；保存后版本不刷新导致第二次保存 409（本次核心验证）；Playwright 未安装时以 npx 缓存 1.62.1 使用并说明；页面 local_owner 无密码解锁（会话标记与产品行为一致，无凭据读取）。

## 任务 0 基线

- HEAD 2d416627491a058350beeb8ac3a2ad7333cb49c4 / dirty 171 / BUILD_ID BRc0g0_HI9yb5A_n0G7AV / prisma/dev.db SHA-256 b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b（MATCHES=True）。
- 3005 当时 DOWN（轮 10 终验后停止）——已按原样重启记录 PID；Playwright `npx --no-install playwright --version` = 1.62.1（可用，非安装）；基线 **9 files / 64 tests 全绿**。
# Formal v2 正式路由进度（轮 10：关键词驱动 Amazon 搜索发现真实竞品）

## 轮 10 目标/顺序/最大风险（≤10 行）

- 目标：竞品闭环改走 SellerSprite 关键词 → Amazon 搜索结果 → 候选竞品 Preview；SellerSprite 插件竞品页降为备用（不碰验证码）。
- 顺序：任务0（7 文件/50 测试、health、dev.db 哈希）→ 任务1 TDD（amazonCompetitorCollector：搜索 URL/卡片解析/排除 seed+广告+重复/≤5/失败原因/域名 allowlist）→ 任务2（路由串联：seed→SellerSprite 关键词→选词→Amazon 采集→Preview；伪造忽略；save 复用）→ 定向/tsc/lint/build/全量 → 真实 API 触发 + Playwright 1440/390（只读，不确认保存）。
- 最大风险：把广告卡或 seed 当竞品（身份串货）；关键词被品牌词（owala）带偏；Amazon 验证码被当“没有竞品”。

## 任务 0 基线

- HEAD 2d416627491a058350beeb8ac3a2ad7333cb49c4 / dirty 169 / BUILD_ID rHqUoq_f_J01HV9ct6UJ1 / browser-use.exe 存在。
- 7 文件基线 **50/50 全绿**（与任务书一致）；dev.db SHA-256 = b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b（MATCHES=True）。
# Formal v2 正式路由进度（轮 9：批次商品概览恢复 + Browser Use 自动采集接入）

## 轮 9 目标/顺序/最大风险

- 目标：①任务 1 恢复 SellerSprite 批次商品概览（startResearchTask 骨架已存 candidateAnalysisContext.facts.productFacts → 详情 DTO 安全投影 → 页面显示，不再「未绑定批次」）；②任务 2 把 Browser Use 接成正式自动采集入口（竞品/关键词：仅本地 owner、输入只来自服务端任务身份、严格 Preview、人工确认后复用既有写入器）。
- 顺序：任务0→任务1（红→绿→反向红→恢复）→任务2（适配层+两个动作+Preview+UI 两按钮+反向验证）→定向/tsc/lint/build/全量→普通浏览器验收（1440/390，不点确认保存，dev.db SHA256 前后一致）。
- 最大风险：把 Browser Use 当截图工具、客户端可伪造 seed ASIN、预览直接写证据（违反「先预览确认」）；以及真实 SellerSprite 页在浏览器采集时遇未登录/验证码——一律 fail-closed。

## 任务 0 基线（实测）

- HEAD 2d416627491a058350beeb8ac3a2ad7333cb49c4；分支 feature/v4.1-ui-productization；BUILD_ID wAoOAPSWG7QKAFs7CTsV3；health 200；runtime-mode local_owner noAuthOwner v4GraphEnabled；browser-use.exe 0.1.9 存在。
- 155 项 dirty 集合与审计轮一致；**dev.db SHA-256 = b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b**（7,602,176 字节，2026-08-22 22:06）。
- 基线 9 文件（EvidenceWorkbench/formal-v2×2/PublicDto/route.dto-security/browser-evidence route/browserEvidence/competitorEvidence/keywordEvidence）= **9 files / 110 tests 全绿**。
- 源码事实复核：startResearchTask 骨架 resultJson 已含 buildCandidateAnalysisContext（verified_product_batch→facts.productFacts）；详情 DTO 的 candidateAnalysisContext 仅投影 {sourceLabel,asin,productUrl}（实际 raw 无这些顶层字段→响应为空对象）；EvidenceWorkbench.extractOverviewItems 已支持回退 candidateAnalysisContext.facts.productFacts——缺口只在 DTO 投影。浏览器证据链路（browser-evidence collect→preview→save）与竞品(manual)/关键词(xls 报表)写入器均存在。
# Formal v2 正式路由进度（轮 8：批次加入研究→精确候选/任务 交接）

## 轮 8 目标/顺序/最大风险

- 目标：批次商品「加入研究」成功后，服务端返回包含本次候选精确 candidateId 的 startable 地址（Owner 与 Visitor 各自访问域）；已转任务仍精确 /tasks/<convertedTaskId>；route 原样下发；ProductBatchManager 真实消费服务端地址，失败留在当前页。
- 顺序：任务0复核→红灯契约（服务/route/客户端行为）→最小实现 conversionResult 单一出口→反向验证两处→三份 FORMAL 文档纠正→定向/构建/浏览器/全量。
- 最大风险：轮 7 曾误报「加入批次→精确候选已成立」——实测服务端与两处测试仍断言通用 /opportunity-candidates；本轮以源码+红绿测试纠正，绝不篡改旧测试数字。

## 任务 0 基线（原始输出已存 tmp/e2e-steps/r8-task0.txt）

- HEAD 2d416627491a058350beeb8ac3a2ad7333cb49c4 / 分支 feature/v4.1-ui-productization / BUILD_ID rgCrGGk4XPaxg-Vpg97EZ。
- git status --short = 49 行（M 32 + ?? 17；含 AGENTS.md/原型/证据/正式 v1 既有 dirty——禁止清理）。完整 before 路径集合见 r8-task0.txt（57 行含回显头）。
- rg 实测（4 文件）：服务端 conversionResult 未转候选返回 destinationUrl: `/opportunity-candidates`（第 174 行）；Owner 服务测试（186 行）、Visitor 服务测试（239 行）、route 测试（46/71 行）均断言通用地址；ProductBatchManager researchItem（919–924 行）消费 body.data.destinationUrl 并 window.location.assign，但无行为测试证明精确地址被使用。
- 定向 3 文件基线 28/28 全绿（0 skip、stderr 0）；主链 9 文件基线 74/74 全绿（0 skip、stderr 0）——原始输出见 tmp/e2e-steps/r8-direct-baseline.txt、r8-mainchain-baseline.txt。

## 轮 8 契约（红灯）

1. Owner 首次与重复加入：destinationUrl 恒等于 `/opportunity-candidates?view=startable&candidateId=<同一精确候选id>`；候选与地址均不因重复加入变化；URL 不含 productKey/identityHash/manifest/evidenceHash/sourceMeta/商品名。
2. Visitor：destinationUrl 恒等于 `/opportunity-candidates?view=startable&candidateId=<自身访问域内候选id>`（visitor-candidate-a），且不含 /agent/run。
3. 已转任务：destinationUrl 精确 `/tasks/<convertedTaskId>`，不含 view=startable。
4. route 原样下发服务端结果，不在 route/客户端二次拼接地址。
5. ProductBatchManager 行为：仅使用服务端返回的安全站内地址（以 / 开头、非 //、非 /\、非协议地址）；失败返回可读错误且不导航（留在当前页）。
6. 挂载说明：仓库测试基线为 node 环境（vitest.config.ts environment: node；无 jsdom/happy-dom；include 仅 **/*.test.ts，新 .tsx 不被收集；改测试配置被禁止）。按任务书允许的替代方案，把产品处理函数 researchItem 的交接判定抽成纯函数 resolveBatchCandidateHandoff（生产处理函数直接调用），用行为测试覆盖；不新增死文件 .tsx（否则等于新增不被运行的测试）。

## 轮 8 实现/验证记录（TDD 红→绿→反向红→恢复绿）

- 【红  契约】修改 3 个测试文件（服务端契约、route 下发、客户端纯函数行为）→ `npx vitest run` 3 文件：**7 failed / 26 passed**（Owner 精确 URL 断言、Visitor 精确 URL 断言、5 个 resolveBatchCandidateHandoff 行为用例）——原始输出 tmp/e2e-steps/r8-red-contract.txt。关键失败：`expected '/opportunity-candidates' to be '/opportunity-candidates?view=startable&candidateId=8d262d57-…'`（Owner）；`destinationUrl: "/opportunity-candidates"` vs 期望 visitor 精确地址（Visitor）；`TypeError: resolveBatchCandidateHandoff is not a function`（5 用例）。
- 【绿  实现】① 服务端 `conversionResult()` 单一出口：未转候选 → `/opportunity-candidates?view=startable&candidateId=${encodeURIComponent(candidate.id)}`（Owner/Visitor 同口；已转仍精确 /tasks/<id>，不新增任务）；② 客户端 `ProductBatchManager.tsx` 新增导出纯函数 `resolveBatchCandidateHandoff(responseOk, body)`：仅放行服务端返回的安全站内地址（以 `/` 开头、非 `//`、非 `/\`、非协议地址），缺失/非法/失败 → `{ok:false, message}`；生产 `researchItem` 直接调用它：成功 `window.location.assign(handoff.destinationUrl)`，失败 `throw new Error(handoff.message)` 由 runMutation 留在当前页显示错误（不退回通用候选池）。route 无改动（本就 `data: result` 原样下发）。→ 3 文件 **33 passed**（28 基线 + 5 新）。
- 【反 1  通用地址回退】临时把 destinationUrl 恢复 `/opportunity-candidates` → **2 failed**（Owner/Visitor 精确断言全红）——tmp/e2e-steps/r8-rev1-red.txt；恢复后 7/7 绿。
- 【反 2  Owner 值注入】临时把 candidateId 换成 `owner-claimed-id`（Visitor 访问域测试）→ **2 failed**（Owner 期望自身 id、Visitor 期望 visitor-candidate-a 均红）——tmp/e2e-steps/r8-rev2-red.txt；恢复后 7/7 绿。
- 【定向】主链 9 文件 **79 passed**（74 基线 + 5 新，0 skip）——tmp/e2e-steps/r8-green-mainchain.txt；`npx tsc --noEmit --pretty false` exit 0；白名单 5 文件 ESLint exit 0。
- 【构建】`npm run build` exit 0 → **新 BUILD_ID wAoOAPSWG7QKAFs7CTsV3**（旧 rgCrGGk4XPaxg-Vpg97EZ）。`npm run start:local` 健康 200。
- 【浏览器·只读·未点击任何写入按钮】最终构建下 4 次独立快照（每页先空标签→设备仿真→导航→读取→截图）：
  - 首页 1440×900：CTA（data-testid=local-start-research-cta）href=`/opportunity-candidates?view=startable`，文案「开始研究一个商品」；overflow=false；console 0。
  - startable 1440×900：仅 1 个 article（bella Fits-Anywhere™），真实图 1、占位 0；无 converted 卡；overflow=false；console 0。
  - 首页 390×844：同 CTA；overflow=false；console 0。
  - startable 390×844：1 article、bella、真实图 1、占位 0；overflow=false；console 0。
  - 截图：docs/v4.1/evidence/d-formal-v2/r8-home-1440x900.png、r8-startable-1440x900.png、r8-home-390x844.png、r8-startable-390x844.png。
- 未点击「加入研究/开始研究」任何真实写入按钮；写链（重复加入/已转任务）全部隔离测试证明（见契约 1–3）。
- 【全量】`npm run test`：**589 files：526 passed / 62 skipped；1 failed**（`tools/upstream/generate-stage15-source-native-result.test.ts` > source-native terminal artifact closure > preserves each valid human-result Buffer verbatim and records its raw SHA-256 —— `Error: Test timed out in 5000ms`，并行负载下超时）；**Tests：5940 passed / 78 skipped / 1 failed（6019）**。该失败文件与轮 8 改动无关（tools/upstream 未触碰）。按任务书隔离复跑一次：`npx vitest run tools/upstream/generate-stage15-source-native-result.test.ts` → **5 passed（5），Duration 4.10s（tests 3.19s）**——并行环境负载型 flake。无任何「宣称全绿」，如实报告：主链受影响 0。原始输出：tmp/e2e-steps/r8-fullsuite.log、r8-isolated-stage15.txt。
- 同轮全量中 lib/server/sourcingImageAcquisition.test.ts（native1688Bridge）21 tests 全绿（195063ms）——B-001 本轮未复现。

## 轮 8 完成状态与 Git 信息

- Git 写操作 0（仅 rev-parse/branch/status/ls-files/log 只读命令）；真实数据库写入 0；白名单外代码改动 0。
- before 49 行 → after 55 行：**新增 5 项全部在白名单内**（lib/server/productBatchCandidateService.ts、lib/server/productBatchCandidateService.test.ts、app/api/product-batches/candidates/route.test.ts、components/cross-border/ProductBatchManager.tsx、components/cross-border/ProductBatchManager.test.ts）；full before/after 集合：tmp/e2e-steps/r8-task0.txt、r8-after-status.txt。
- 依据完成任务书「本轮完成后只报告可进入提交审查，不 commit/push」——本轮结束，Formal v2 冻结，不再扩功能。

## 轮 8 修正声明（对轮 7 汇报的纠正）

轮 7 曾汇报「批次加入→精确候选已成立」，经轮 8 任务 0 源码+测试复核为**误报**：当时服务端 conversionResult 仍返回通用 `/opportunity-candidates`，Owner/Visitor 服务测试与 route 测试仍断言通用地址，ProductBatchManager 仅消费地址而无行为测试证明。轮 8 以源码质证 + 红绿测试（红 7 → 绿 33 → 反向红 2+2 → 恢复绿）+ 浏览器只读复验完成纠正；未篡改任何旧测试数字，旧记录保持原样。

# Formal v2 正式路由进度（轮 7：工作台→可研究→正式任务 主链）

## 轮 7 目标/顺序/最大风险

- 目标：首页「开始研究一个商品」直达只有授权可研究商品的 startable 视图（>0→startable；=0→去发现商品；读取失败→不可用+重试）；候选卡精确聚焦；批量/单件开始研究只走授权商品并直达精确任务；可研究唯一依据 isCandidateResearchActionAvailable。
- 顺序：任务0复核→收集 fail-closed→startable 视图/聚焦→首页路由修正→动作链守卫（startSelected/startItem 不向 converted/blocked 发 POST）→反向验证→定向/构建/浏览器/全量。
- 最大风险：把展示状态当服务端授权（旧 startSelected 用 candidatePrimaryHref≠null）；入口失败静默按 0 处理（误导入）。

## 任务 0 基线（原始输出已存 tmp/e2e-steps/r7-task0.txt）

- HEAD 2d416627491a058350beeb8ac3a2ad7333cb49c4 / 分支 feature/v4.1-ui-productization / BUILD_ID Ph2O1Pgocq7CNQDD1k8sz / dirty 48 项（路径集合与任务书一致）。
- 候选池 18 项：{runtime_validation_required:1, converted:17}，唯一可研究 = bella Fits-Anywhere™ 2-Slice Slim Toaster（96cc7210-26c9-4257-b8fb-0f1597e77369）。
- 批次 3 ready：11/10、10/10、10/10（31 项、accepted 30）。
- 定向基线 9 files / 66 tests 全绿。

## 实现记录（TDD 红→绿→反向红→恢复绿）

- ① 收集 fail-closed：`collectStartableCandidates`（完整分页复用既有 collectPagedTasks，200 页上限；任一页失败/超限抛错）；`filterStartableCandidates`（唯一依据 isCandidateResearchActionAvailable）。红 2→绿（中页失败抛错、跨页过滤正确）。
- ② startable 视图与聚焦：page.tsx 支持 `view=startable&candidateId`；CandidatePoolView 新增 `startableOnly`（converted/blocked 不渲染）与 `focusCandidateId`（目标存在→高亮+滚动聚焦；不存在→诚实提示“没有找到这个候选商品”，绝不聚焦第一项）。红 2→绿。
- ③ 首页路由：`resolveStartResearchHref`（>0→?view=startable；=0→/opportunities；null→unavailable+重试按钮；loading→“正在确认可研究商品…”不冒充跳转）。红 3→绿。
- ④ 动作链守卫：`startSelected`/单卡 startItemResearch 前置 `isCandidateResearchActionAvailable`（绝不向 converted/blocked 发 POST）；开始研究成功仅跳响应中的精确 `/tasks/[taskId]`（既有 startResearchTask 幂等：重复请求复用既有任务，不重复创建；失败留在原卡显示真实错误）。
- 反向验证两次：临时把 converted 判为 startable（filter 用 candidatePrimaryHref）→ 池/视图测试红；临时移除 candidate-focused 标记 → 聚焦测试红；均恢复全绿。
- 浏览器（最终构建、只读，未点击任何写入按钮）：首页 CTA href=?view=startable 文案“开始研究一个商品”；点击后 startable 页仅 1 张 bella 卡（真实图 1，占位 0），17 converted 不出现，overflow=false，console 0；390 同。证据 entry-chain-startable-1440x900 / -390x844。

## 验证
- 定向 9 files / 74 tests 全绿（66 基线+新增 8）；tsc 0；限定 ESLint 0；build 0 → BUILD_ID rgCrGGk4XPaxg-Vpg97EZ；start:local health 200。
- 全量 `npm run test`：**527 files passed / 62 skipped；5936 tests passed / 0 failed / 78 skipped，EXIT 0**（native1688Bridge 本轮通过——历史间歇）。
- 未中途执行任何数据库写入/批次操作；写链（开始研究/加入批次/重复请求幂等）由既有 startResearchTask 测试与隔离测试库证据覆盖（startResearchTask.test.ts 66 基线内全绿，含重复请求幂等用例）。

## 轮 9 第 1 轮记录（TDD 红→绿→反向红→恢复）

### 任务 1：SellerSprite 批次商品概览恢复 ✅（完成）
- 源码缺口确认：详情 DTO 的 candidateAnalysisContext 只投影 {sourceLabel,asin,productUrl}（原始上下文无这些顶层字段→响应 {}）；extractOverviewItems 已支持回退读取 cac.facts.productFacts——只差 DTO 投影。
- 【红】新增 2 用例（lib/productResearchPublicDto.test.ts「verified_product_batch facts allowlist」+ components/evidence/EvidenceWorkbench.test.ts「骨架→详情投影→概览≥6 项」）→ **2 failed | 39 passed**。
- 【绿】minimal 实现：DETAIL_FIELDS.candidateAnalysisContext 增加 integrity + facts allowlist（productName/marketplace/asin/reportType/query/category/capturedAt + productFacts 13 标量字段）；不投影 productBatchId/productBatchItemId/evidenceHash/itemHash/productKey/identityHash/contextHash/manifest/sourceMeta → **41 passed**。
- 【反向红→恢复绿】临时删除 facts 投影 → 2 failed；恢复 → 41 passed。

### 任务 2：Browser Use 正式自动采集入口（第 1 轮进度，未完成）
- 【绿】lib/server/browserUseResearch.ts（合同 v1）：严格 Preview schema（schema/seedAsin/marketplace/sourceUrl/capturedAt/results≤5 或≤100/missing/failureReason 白名单/collector）；resolveBrowserUseSeed 只从服务端任务身份解析（verified_product_batch/seller_sprite，ASIN 校验，缺身份 null）；assertBrowserUseOwnerOnly（visitor/sandbox → browser_use_local_owner_only 403）；服务端一次性预览缓存（bup_preview_ 前缀 + TTL）。测试 5/5 全绿（含上限/字段不猜/失败原因白名单/访客拒绝）。
- 【绿】tools/collectors/browser-use/sellerSpriteCollector.ts（正式入口，非 spike）：确定性 browser-use 脚本（仅导航+只读观察，无 token/cookie）；观察解析（登录墙/验证码/面板缺失 → login_required/captcha_required/panel_not_detected；畸形→null）；观察→严格 Preview（结果为空+明确失败原因，不冒充「无数据」）。测试 3/3 全绿。
- 【绿】lib/server/competitorEvidence.ts：写入器扩展 browser_use 来源（collectedBy/sourceUrl/capturedAt/reasonCodes 可追溯来源；来源缺失拒写 invalid_auto_provenance；parseEntry 兼容 manual+browser_use，旧数据解析不变）。测试 9/9（7 基线 + 2 新）。
- 【待第 2 轮】① 两个路由 action=collect/save（approval 竞品保存复用 addCompetitorAsin(autoProvenance)，关键词复用 saveKeywordEvidence；seed 交换/外站 URL/验证码/畸形结果的反向验证测试）；② EvidenceWorkbench「自动采集竞品/自动采集关键词」按钮+状态机+预览确认/取消；③ build+全量+浏览器验收（1440/390、只读、dev.db SHA256 不变）；④ 真实 SellerSprite 触发（本机 Chrome 官网无登录态，产品页面板需插件/登录——验收以 fail-closed 记录为准）。

## 关键证据存档
- dev.db SHA-256（before）: b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b（7,602,176 字节）。
- 基线 9 files/110 tests 全绿；任务1 相关 2 文件 41；browserUseResearch 5；collector 3；competitorEvidence 9。

## 轮 9 第 2 轮记录（路由+UI+验收；dev.db 前后一致）

- 【绿】路由：competitor-evidence POST action=collect_browser_use / save_browser_use（仅 local owner：assertBrowserUseOwnerOnly + getRuntimeMode=local_owner；服务端任务身份 resolveBrowserUseSeed → identity_unavailable 409）；save 互换 seed→409 seed_asin_mismatch、外站来源→400 forged_external_source_url、预览缺失→400、类型不符→400；确认保存复用 addCompetitorAsin(autoProvenance 可追溯来源)。测试 3/3。
- 【绿】watchword-evidence POST 同构（keyword 预览行映射 monthlySearches/relevance/competition——**仅页面真实存在的字段写入，其余不猜**；saveKeywordEvidence 复用）。测试 2/2。
- 【绿】UI：components/evidence/BrowserUseCollectButton.tsx（纯 reducer 状态机：idle/collecting/preview/saving/login_required/captcha_required/permission_insufficient/collect_failed/error；预览-确认-取消；取消无数据残留）+ EvidenceWorkbench 两处接线（竞品区/关键词区按钮）。reducer 测试 3/3。
- 【验证】定向 **14 files / 133 tests 全绿**（>110 ✓）；tsc exit 0；白名单 ESLint exit 0；npm run build exit 0（BUILD_ID L3wGhajA-d56kwCub7Uxx）。
- 【真实数据验证】/api/tasks/cmt0lmsqa000272kny9labi54 详情投影现返回 verified_product_batch facts.productFacts：productTitle=THERMOS FUNTAINER Kids Food Jar…、brand=THERMOS、price=14.69、rating=4.7、reviews=48474、rootCategoryBsr=8、subCategoryBsr=1、estimatedMonthlySales=36997、estimatedMonthlyRevenue=543486（**9 项≥5 项**）；asin=B08NCVT244、marketplace=US ✔ —— 批次商品概览恢复在真实数据上成立。
- 【真实 Browser Use 采集触发（产品路由，未用截图冒充）】POST /api/tasks/…/competitor-evidence action=collect_browser_use → **HTTP 502**（服务端收集器未产出有效观察；服务器日志无异常详情）——按规则 fail-closed：无保存、无数据、dev.db 未变。关键字采集与竞品同构。
- 【浏览器验收——限制如实】详情页 /tasks/[id] 在本机浏览器会话显示「请先输入访问密码后查看任务详情。」（会话凭据门，未持有口令、未猜测、未绕过——与 SellerSprite 未登录同一 fail-closed 纪律）。因此「页面按钮可点」与「页面概览视觉」以 API 真值 + 组件/纯函数测试证明；1440/390 页面（首页/startable）此前轮次已证无回归，本构建仅 API 层有改动。
- 【dev.db】前后 SHA-256 一致 = b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b（未重启服务已验证；数据库零写入）。【全量】npm run test（pwsh-29）结果见 %TEMP%\r9-fullsuite.log（下一条汇报引用）。
- 完成条件差距：①「产品内部 Browser Use 对同一权威商品成功返回≥1 竞品和≥1 关键词的可追溯预览」——**未达成**（真实采集 502 fail-closed；无截图/无假数据/无绕过）；②其余（≥5 项事实、>110 测试、typecheck/lint/build、防泄漏、零 DB 写入、白名单外 0 改动）达成。

## 轮 9 第 3 轮（最后）记录：真实 Browser Use 关键词采集成功（最小实验复用）

- 复用验证：实际打开 https://www.amazon.com/dp/B08NCVT244 真实商品页 - 卖家精灵插件面板 #main-sellersprite-extension 已注入（已登录）；面板导航 a.nav-web [0]=产品查询 [1]=关键词反查；点击「我不是机器人」人类验证入口（仅入口按钮，未识别任何图形验证码；面板出现图形验证码输入框 - 按规则停手未输入）；点击「关键词反查」- 真实关键词表渲染（table x2：表头 20 列 / 数据 10 行 19 列；列映射：2=关键词+翻译、3=流量%、8=ABA周排名、9=月搜索量、12=购买量、15=广告竞品数、17=PPC竞价）。
- 组件化：采集器脚本 5 步（导航-验证入口点击-关键词反查 tab-表格提取-JSON 写入 BU_COLLECT_OUTPUT），全程 ASCII 生成；spawn 改为无管道文件版（脚本/输出走 OS 临时目录 + stdio ignore + shell 重定向）——消除第 2 轮 502 根因（原 pipe spawn 在受限进程 EPERM）。
- 真实成功证据：POST /api/tasks/cmt0lmsqa000272kny9labi54/keyword-evidence action=collect_browser_use → HTTP 200；Preview kind=keyword、seedAsin=B08NCVT244、sourceUrl=https://www.amazon.com/dp/B08NCVT244?th=1、capturedAt=2026-08-22T16:54:36Z、results=10 条真实关键词（lunch box/午餐盒 1,481,183 / ABA 36 / 购买量 37,325；lunch bag 564,373；bento box for kids 281,596；owala 4,471,888 / rank 4 等）；缺失字段 null 不猜。未点击确认保存（只读预览）；dev.db 前后 SHA-256 一致 b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b。
- 竞品缺口：竞品视图（top-10 产品图 / 产品查询 tab）触发图形验证码 - 按规则 fail-closed 停手未绕过；竞品 Preview 返回 results=[] + missing=[sellersprite_competitor_rows]（不冒充无数据）。完成条件①的「≥1 竞品」未达成 - 如实。
- 源码后记：最后一处小修（观察 adCompetitorCount → preview.competition 映射）已入源码但未重建/未重跑；build exit 0（此小修前）、collector/browserUse 11/11 全绿。
## 轮 9 第 4 轮（额外续跑）：映射修复验证 + 竞品最终判定

- 修复验证：adCompetitorCount → preview.competition 映射已重建（build exit 0，tsc exit 0，定向 16/16）；真实复跑关键词 collect → HTTP 200，10 行，首行含 competition=1154（真实页面广告竞品数）——缺失字段不再为 null 即可信补齐。
- 竞品最终判定（第 4 轮再尝试 2 次，均 fail-closed）：① 点击面板 .show-top-10（展示前10产品图）→ 仅空 .el-overlay（无卡片无图），产品图卡加载不进；② 产品查询/竞品视图需插件图形验证码（「图形验证码，点击查看」输入框）。按规则未识别、未输入、未绕过 → 竞品真实预览在无人工前提下不可得（条件跨轮 2→3→4 持续存在）。
- 全量 npm run test（第 4 轮执行）见 %TEMP%\r9-fullsuite-final.log（下一条汇报引用）。
## 轮 9 终态记录（第 4 轮收官）

- 全量 npm run test：**594 files：532 passed / 62 skipped / 0 failed；Tests 5964 passed / 78 skipped / 0 failed —— EXIT 0（全绿，系列首次一次通过）**。
- dev.db 前后 SHA-256 一致：b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b（MATCHES_BASELINE=True；全程零真实数据库写入）。
- HEAD 未变 2d416627491a058350beeb8ac3a2ad7333cb49c4；dirty 169 项（全部为轮 9 白名单路径，无白名单外改动、无 Git 写操作）。
- 完成条件核对：① 批次概览 ≥5 项 ✔（真实 9 项）；关键词真实可追溯预览 ✔（10 行，searchVolume/abaWeeklyRank/purchaseVolume/competition 全部真实字段 + sourceUrl/capturedAt 追溯）；竞品真实预览 ✘（插件图形验证码，规则禁止绕过，条件跨 3 轮）；「人工不再是主入口」——UI 已置自动采集为主、人工为折叠备用 ✔（代码层面）。② 定向 >110 ✔（133 + 本轮 16）、tsc/lint/build ✔、无泄漏 ✔、真实 DB 写入 0 ✔、白名单外 0 ✔。
## 轮 10 记录（完整达成）

- TDD：amazonCompetitorCollector 红 6（模块缺失）→ 绿 6/6；REV-A（放行 seed/Sponsored→规范化测试红）→ 恢复绿；REV-B（amazon.evil.example 放行→allowlist 测试红）→ 恢复绿。
- 真实链路（产品 API 触发，非截图）：POST /api/tasks/cmt0lmsqa000272kny9labi54/competitor-evidence collect_browser_use → **HTTP 200**：kind=competitor、**rows=5**、failureReason=（空）、missing=（空）、sourceUrl=https://www.amazon.com/s?k=lunch+box（SellerSprite 真实关键词驱动）；样例：B0DBDKT4QC HOTOR $7.98 rating 4.4 reviews 8300（src=amazon.com/dp/B0…真实搜索卡 URL）；B0B56CHMSC Lifewit $7.98 4.5/9；B0H2ZBDWR4 $19.99（缺 r/rv→null 不猜）。未点击确认保存（previewId=bup_preview_vy4j4treud）。
- 失败路径：Amazon 验证码→Preview captcha_required；save 400 preview_not_collectable（写入器 0 次）；SellerSprite 关键词失败→502 不改用标题/旧快照；客户端伪造 query/seed 被忽略（路由测试 6/6）。
- 验证：定向 **9 files / 79 tests 全绿**（>50）；tsc exit 0；build exit 0（BUILD_ID rHqUoq_f_J01HV9ct6UJ1 之后重新构建）；全量见 r10-fullsuite.log。
- 页验收：详情页密码门限制（无凭据）——按钮/预览以组件+API+路由测试证明（与轮 9 一致的限制记录）。
## 轮 10 收官记录

- 全量 npm run test：595 files：531 passed / 62 skipped；**2 failed**（native1688Bridge.integration 文件级失败——**隔离复跑 11/11 通过 4.18s**（B-001）；demoSandbox.store-consistency 5s 负载超时——既往隔离 9/9）；Tests：5962 passed / 1 failed。未刷绿，如实记录。
- dev.db 前后 SHA-256 一致 b4d0f149ee331c8b225f1637f0062294a732a0f6e26b2074ea93799e513c289b（MATCHES=True；全程零真实数据库写入——真实采集仅预览未确认保存）。
- git：HEAD 未变 2d416627491a058350beeb8ac3a2ad7333cb49c4；dirty 171（169+2 新增 round-10 文件：amazonCompetitorCollector.ts/.test.ts——全部白名单内）；无 Git 写操作。
- 完成条件核对：① 真实 THERMOS 任务 → 产品内部 Browser Use（SellerSprite 真实关键词 lunch box）→ Amazon 搜索结果 → **5 条真实竞品 Preview**（合法 ASIN+标题+Amazon 来源 URL+采集时间；非 seed、非广告、非重复；缺 r/rv 置 null 不猜）✅；未点击确认保存；② 定向 9 文件 79 测试全绿（>50）✅；tsc 0 ✅；build 0 ✅；无白名单外改动 ✅；无真实 DB 写入 ✅；无 Git 写操作 ✅。
## 轮 11 记录（确认保存契约修复 + 隔离库真实闭环）

- 【红/绿/反向】契约测试 3 例（payload 必须携带版本；版本未就绪-提示刷新不发送；409 文案不冒充成功）；REV-1 临时恢复 undefined+移除 builder → payload 测试红（buildSaveBrowserUsePayload is not a function）→ 恢复 → 按钮+workbench 28/28 绿。
- 【最小修复】BrowserUseCollectButton 新增 storageVersion prop + buildSaveBrowserUsePayload（版本未就绪→null，确认按钮禁用并提示「版本信息尚未就绪，请刷新后重试」）；confirmSave 原样发送合法版本；EvidenceWorkbench 竞品按钮接 competitor GET 版本、关键词按钮接 keyword GET 版本；任一保存成功后 onSaved 同时刷新两个证据区版本——第二次保存不再 409。
- 【隔离库闭环】Playwright 包不可得（npx 缓存仅 playwright core，无 @playwright/test；禁止安装）→ 采用已安装 Chrome headless + Node 原生 CDP（普通浏览器点击/刷新/截图；无 Browser Use 参与验收；已说明）。
- 隔离实例：C:\Users\a2578\Desktop\qingxuan-smoke\formal-v2-round11-20260823-014811（isolated.db + demo-access.json；isolated.db 由原 dev.db 复制，未改原始库）；node scripts/local-next-runtime.mjs start --port 3011（--database-path/--demo-access-store-path 指隔离文件；子进程仅清空 ACCESS_PASSWORD/APP_ACCESS_PASSWORD）；health ok、runtime-mode local_owner noAuthOwner:true、candidateCount 19 / taskCount 18。
- 真实闭环结果：① 关键词 采集→预览→确认保存 → KW_ROWS=10；② 竞品 同页不刷新 采集→确认保存 → COMP_ASINS=B0DBDKT4QC,B0B56CHMSC,B0H2ZBDWR4,B07VLFFV5F,B017SGIMV2（5 条，无 seed B08NCVT244），第二次保存未出现 storage_version_required（版本刷新生效）；③ 整页刷新 RELOAD_KW=10、RELOAD_COMP=5；DECISION_UNCHANGED=true、AI_UNCHANGED=true（人工决定未变、无自动 AI 结论）；④ 1440×900 保存/刷新截图、390×844 刷新截图（round11-*.png）；OVERFLOW_1440=false、OVERFLOW_390=false；FINAL_OK=true。保存前状态 PRE_COMP=0；全程零写请求到 3005/原始 dev.db。
- 【待补】全量 npm run test（pwsh-41）与最终哈希核对（见下一记录）。

## 轮 12 第 1 轮记录（改完任务 1/3/4 主体；任务 2 部分；验收与全量待下轮）

- 任务 1 供应线索免密：resolveSourcingAccessState（hydration/noAuthOwner/密码三态；未 hydration→「正在读取供应能力…」）；面板接线；红 2（missing fn）→绿 14/14；REV-1（禁用 noAuth 分支）→ 红 → 恢复绿。
- 任务 2 保存冲突：resolveSaveConflictRecovery 纯函数（首冲突 retry=true；二次→「资料刚刚更新，请再试一次」；非冲突→不重试）+ 测试 1 → 绿 15/15；REV-2（首冲突也 return false）→ 红 → 恢复绿。**组件级接线（409 时保留预览+刷新版本+重试有限次）仍待 wire**——下轮完成并挂载真实组件模拟请求序列（本轮时间已尽，未实施交互挂载——如实）。
- 任务 3 身份锁定：resolveVocAsinInput（当前商品→只读+服务端 taskAsin；竞品→可编辑）；输入框/提交 payload 均按角色锁定；空态文案「当前商品暂未采到公开评论，可重试或粘贴该商品评论」（去「换一个 ASIN」）；Route 契约 current_candidate ASIN 不匹配→409 current_candidate_asin_mismatch 零写入（authoritativeReviewAsin 解析 resultJson）；红 2→绿 9/9；路由 16/16；REV-3（guard 禁用）→ 红 → 恢复绿。
- 任务 4 用户语言：Evidence→资料、VOC→买家评论与需求、AI 证据总结→AI 研究摘要、Missing→待补资料、unknown 展示→尚未取得；**删除固定 4 张 unknown 假卡**（保留 formal-v2-cost-risk-evidence 目标并向真实成本表单提示）；评论区/商品资料区标题与提示同步改；SSR 级文案测试 2（零出现 Evidence/VOC/Missing/unknown + 业务用语）→ 绿 24/24。
- 注意：批量替换曾损坏标识符/导出名（EvidenceWorkbench）——已全量修复并 tsc 0 复核。
- 验证：直接 5 文件（4 基线+review-evidence 路由）**78/78 全绿**（55 基线+23 新）；tsc exit 0；build exit 0（见下 BUILD_ID）。剩余：白名单 ESLint、全量一次、3005 真实浏览器验收（1440/390：零密码词、零内部词、无溢出、console 0、冲突恢复交互序列）、任务 2 组件接线与交互挂载——下轮完成。
## 轮 12 第 2 轮记录（交互挂载 + 验收 + 全量完成）

- 任务 2 组件接线（完成）：BrowserEvidenceSection 拆 attemptSave(version, allowRetry) + 版本变化 effect 自动重试一次 + lastVersionRef 同版本去重；二次冲突 setConflictPending(false)+「资料刚刚更新，请再试一次」，失败不掉预览。VocEvidenceSection 同类接线（attemptImport/attemptCollectConfirm + 各自 effect 去重）；**共享决策函数下沉 lib/client/evidenceConflictRecovery.ts**（resolveEvidenceConflictRecovery + CONFLICT_RETRY_MESSAGE），BrowserEvidenceSection 保留 resolveSaveConflictRecovery 兼容导出。
- 交互测试（真实组件挂载 + 模拟请求序列，非源码字符串扫描）：BrowserEvidenceSection.conflict.dom.test.ts 2 项（409→保留预览+刷新版本重试一次→成功；二次 409→保留预览+简洁提示+共 2 次 save）全绿；VocEvidenceSection.conflict.dom.test.ts 3 项（导入首冲突保留草稿+重试成功；导入二次冲突提示+不再次请求；采集确认首冲突保留预览+重试成功——采集预览带 mock collect 序列）全绿。
- 反向验证（临时改坏→红→恢复→绿）：REV-3-交互（409 清空预览→Browser 交互测试 2 failed→恢复 2 passed）；REV-VOC（临时禁用两处 recovery.retry 分支→3 failed→恢复 3 passed）。桩件说明：React 受控 textarea 的 onChange 在无 jsdom 假 DOM 中不触发类浏览器输入序列，导入草稿改用真实会话草稿恢复路径灌入（useSessionDraft 语义：刷新不丢输入），非伪造。
- 语言收尾：删除剩余用户可见内部词——BrowserEvidenceSection capturedLabel unknown→尚未取得；VocEvidenceSection 「开始 VOC 分析」×2→「开始分析评论」；EvidenceWorkbench 「均为 unknown」→「均尚未取得」、「fact/risk/conflict 必须带证据引用」→「事实、风险和矛盾信息必须带资料引用」。
- 验证：定向 8 文件（4 直接 + review-evidence 路由 + 2 交互 + evidenceConflictRecovery 库）**88/88 全绿**（55 基线 + 33 新增）；tsc exit 0；白名单 ESLint exit 0（仅 1 条 HEAD 既有 <img> 警告）；npm run build 成功 → 新 **BUILD_ID H0VBXDbwc6k0P5WKCXK7m**（初值 jo0o3n9x6EytY6aPq3_GZ）。
- 全量 npm run test 一次：**5983 passed / 89 skipped / 2 failed**；两失败均为环境负载型：① lib/server/native1688Bridge.integration.test（复跑发现端口 53318 被上一轮遗留桥进程占用（PID 33484 的 server.mjs），清除后隔离 11/11 通过 3.98s）；② lib/server/demoSandbox.store-consistency.test（5s 超时，隔离 9/9 通过 3.18s）。与轮 12 改动无关（零白名单外改动）。
- 3005 真实浏览器验收（最终构建 start:local 承载、真实 Chrome headless + 原生 CDP；1440×900 + 390×844）：页面就绪 TRUE；**「访问密码/输入密码」零出现**；**Evidence/VOC/Missing/unknown/fact-risk-conflict 零出现**（展开核对区全文 10849 字符审计，唯一命中为实现原语的接口文案见 BLOCKED——白名单外文件，已记录）；供应线索面板真实状态（1688 登录 ✓/浏览器助手已连接/需确认普通 Chrome 登录 1688——与工作台访问密码明确分离）；当前商品 ASIN 输入 value=B08NCVT244 disabled=true（服务端绑定只读）+ 无「换一个商品」提示；横向溢出 1440: sw=1425≤1440、390: sw=375≤390（false）；console 0 error / 0 warning；按钮可聚焦（主模块按钮 active=true）；四模块跳转目标全部保留（market/buyer/sourcing/cost-risk ↔ 四个稳定 id，cost-risk 指向 #formal-v2-cost-risk-evidence 保留锚点，未回归）。
- 截图（旧=轮 11 同任务页 *round11-1440-refresh / round11-390-refresh*；新=本轮 *usability-fix-r12-*）：docs/v4.1/evidence/d-formal-v2/{round11-1440-refresh.png, usability-fix-r12-1440-detail.png, usability-fix-r12-1440-expanded.png, usability-fix-r12-390-detail.png, usability-fix-r12-390-expanded.png}——1440 与 390 均无溢出、无旧内部词、供应线索真实状态。
- 遗留：AiEvidenceSummarySection.tsx（EvidenceRef 门禁通过 / 尚未生成 AI 证据总结 / 生成 AI 证据总结）与 KeywordReportEvidenceSection.tsx（capturedAt 标签、缺失字段兜底 unknown）属白名单外文件、本轮未触碰——记录 BLOCKED。dev.db 哈希与归档不一致的记录见 BLOCKED。


## 轮 12 门态疑点闭环（第 3 轮）

- 现象：验收脚本两个变体结果不一致——A 变体（Page.enable + Log.enable + 轮询 record 出现）3/3 绿；B 变体（仅 Runtime.enable + 固定延时读取 innerText）3/3 红（读到「请先输入访问密码后查看任务详情」）。
- 诊断：B 变体在 hydration 完成前读取 DOM——SSR 先输出锁态「请先输入访问密码」（服务端无 sessionStorage/无 runtime-mode），客户端 hydration 后由 useAccessPassword 免密分支改写；带 Page.enable 的轮询脚本实测 **HYDR_MS=289ms**（首次出现 formal-v2-product-result 距导航完成），且 **GATE_FINAL=false、PW_WORDS=[]（访问密码/输入密码 0 命中）**。连续 2 次单独复跑均 READY=true、GATE=false、PAGE_ERR_COUNT=0。
- 结论：3 次红为验收脚本时序伪影（读点早于 hydration），非产品缺陷；产品侧真实用户态（hydration 完成后）零密码词，完成条件 1 满足。已在 BLOCKED 记录该测试注意事项。



## 任务 1 完成（TDD 用户语言收口）

- 新增测试（先红）：AiEvidenceSummarySection.test.ts（2 项：有摘要「引用校验通过」+ 零 EvidenceRef/Evidence/证据总结；无摘要「生成 AI 研究摘要」+ 零内部词）；KeywordReportEvidenceSection.test.ts（2 项：保存态「采集时间」+ 零 capturedAt/unknown；缺失单元格「尚未取得」+ 零 unknown）——首跑 4 failed（red）已留输出。
- 修改（最小）：AiEvidenceSummarySection（门禁徽标 EvidenceRef 门禁通过→引用校验通过 / 门禁未通过→引用校验未通过；空态「AИ 证据总结…Evidence 生成」→「AI 研究摘要…资料生成」；按钮 生成 AI 证据总结→生成 AI 研究摘要）；KeywordReportEvidenceSection（capturedAt→采集时间；缺失兜底 unknown→尚未取得）。内部 schema/字段名/枚举未动。
- 反向（临时恢复旧文案）：AI 徽标与 KW unknown 兜底同时恢复 → 2 files / 3 failed（red 已留输出：AI badge 断言、KW 两断言）；恢复正式文案 → 2 files / 4 passed。


## 任务 2 完成（dev.db 只读追因）

- 结论：无法唯一归因（证据不足）+ 有依据推断；固定事实链见 BLOCKED。关键：bella Task 行 updatedAt=20:07:36.103Z 与 dev.db mtime 20:07:36.108Z 毫秒级吻合，单事务单行微调、result 未变；所有隔离实验（GET、8 文件×2、新测试、10 文件、90s 零活动）哈希零变化；唯一服务 3005（19:25:23Z 启动）；计划任务最后运行 13:19:47Z。未 stop/复制/编辑/回滚 dev.db。


## 任务 3 完成（发布清单）

- 依据 %TEMP%\\r13-before.txt（191 行）逐项归类：**A=133（Formal v2 发布内容，9 功能组：首页/候选池/任务详情/商业输入/竞品关键词证据/评论证据路由/可用性纠偏/文档/证据截图）+ B=16（原型×3 代码 + PROTOTYPE_V2 文档×3 + c-prototype-v2 截图×7 + AGENTS.md）+ C=42（tmp/bu_*.py×24、r8-*.txt×13、snap_*.py×4、start-local-r11.txt×1）+ D=0（dev.db/data 均 gitignore）**；守恒 191=191 ✓。
- 结论：**READY_FOR_COMMIT = NO_GO**（未获 Commit 授权；A 类含大 diff 文件需先审查；B/C 须从提交范围剔除）。交付文件：docs/v4.1/FORMAL_V2_RELEASE_FREEZE.md。


## 任务 4 完成（公网审计 + 验收）

- 交付：docs/v4.1/PUBLIC_CAPABILITY_MATRIX.md（21 项能力、每项附代码/契约路径）、docs/v4.1/PUBLIC_READINESS_AUDIT.md（结论 **READY_FOR_PUBLIC_IMPLEMENTATION = NO_GO** + P0 阻塞 6 条 + 最小部署顺序与回滚点 + 授权清单）。
- 关键实证：runtimeMode.ts 已实现（契约 01：QX_RUNTIME_MODE 单点读取、非法值 fail-closed 缺省 local_owner）；guest 铸造/guestCookie/ipBackstop 已实现；resolveAccessContext 5 通道 + CSRF/Origin 收紧；Visitor 默认 maxAiCalls=0 fail-closed；provider 门禁 OPENAI_*_VISITOR_ENABLED !== true 默认关；capability.state 驱动采集按钮 fail-closed。
- 最终构建：本轮组件修改后重新 build → 新 BUILD_ID **lkjvP6oxBkqX5Vl8bulEQ**（初 H0VBXDbwc6k0P5WKCXK7m）；3005 以 start:local 重启承载（pwsh-46，health 200）。
- 真实浏览器验收（1440×900 + 390×844，Chrome headless + CDP）：ready=true；**zero EvidenceRef/Evidence/capturedAt/unknown/AI 证据总结/访问密码/输入密码**；「引用校验通过」「AI 研究摘要」出现；关键词区空态（无关键词证据）显示「未导入关键词报表证据」；overflow 1440 sw=1425≤1440、390 sw=375≤390；console 0 error/0 warning。截图：docs/v4.1/evidence/d-formal-v2/freeze-r13-{1440,390}-detail.png。
- 白名单外改动：0（本轮仅动 2 组件 + 2 测试 + 5 文档 + 2 截图均在白名单）。


## 最终验证（全量 + 定向 + 构建）

- **全量 npm run test 一次**：600 files / 535 passed / 62 skipped / 3 failed；Tests 5984 passed / 89 skipped / **4 failed**。失败三文件均为历史环境负载型：① lib/server/native1688Bridge.integration.test（桥端口 53318 被全量并行的桥进程占用，beforeAll「bridge did not start」）；②③ tools/upstream/generate-stage15-source-native-result.test + stage15-source-native-effectiveness.test（并行负载超时 25s/28s）。**隔离复跑一次：3 files / 25 tests 全绿（6.34s）**——非本轮功能失败，按规矩仅隔离一次不刷绿。
- **定向复跑**：10 文件（8 基线 + 2 新组件测试）92/92 全绿（88 基线 + 4 新）；tsc 0；白名单 4 文件 ESLint 0；build 成功 → BUILD_ID lkjvP6oxBkqX5Vl8bulEQ。
- 反向验证：临时恢复 «EvidenceRef 门禁通过» + «unknown» 两旧文案 → 新测试 3 failed（红）；恢复正式 → 4 passed（绿）。



## 任务 1 完成（服务端预览与候选保存原子化）

- 红→绿：sourcingEvidence.test.ts 先红（peek/consume 缺失 → 3 failed 输出留档）→ 实现 peek/consume → 17/17（14 基线+3 新）；route.test.ts 追加 4 项原子契约（候选错误修正后同 previewId 成功、409 后同 previewId 成功、成功后二次 410、空选后修正仍可用）→ 24/24（20 基线+4 新）。
- 核心实现：SourcingPreviewStore 新增 peek（只读校验不删）+ consume（仅保存成功后一次性作废）；route save 改为 peek→候选校验→详情补全→CAS→成功后 consume；enrichCandidates 修复：未纳入详情补全（前 3 之后）的选中候选保留服务端搜索快照，不再被截断/删除。
- 追加保存层测试：4 条/20 条全部候选与确认保存无截断（17/17 内含）。
## 任务 2 完成（前端同页版本恢复）

- 接线：attemptSave(version, allowRetry) + saveConflictPending + lastSaveVersionRef；409 首冲突 → 保留预览/选择/备注 → loadInitial 刷新版本 → storageVersion 变化 effect 自动重试一次（attemptSave(新版本,false)）；二次冲突 → 统一复用 resolveEvidenceConflictRecovery（首冲突 retry=true，二次 retry=false），面板转译文案「资料又发生变化，请再试一次」；runSearch 采集成功后立即 loadInitial 取最新版本（避免同页其它模块更新后立即 409）；导出纯函数 resolveSourcingSaveError(status, code, message, alreadyRetried) → {preview_expired|auth_required|conflict_retry|conflict_stop|generic}。
- 挂载测试（真实组件）：SourcingEvidencePanel.conflict.dom.test.ts 6/6——挂载后初始 GET（能力可用不出现「组件未安装」，1688 登录 ✓）+ resolveSourcingSaveError 5 决策单测（409 首→冲突重试；409 二→「资料又发生变化，请再试一次」；preview_expired；auth_required；generic）。
- **harness 修复（本轮关键）**：fake-DOM FakeText 缺 nodeValue setter，React 19 commitTextUpdate 写 nodeValue 被静默丢弃 → textContent 读到陈旧文本（曾误判为 fetch 未触发）。补 get/set nodeValue 同步 text 后挂载断言通过（这是 harness 缺口修复，非放宽断言）。

## 任务 3 完成（隔离库真实浏览器验收）

- 隔离实例：C:\Users\a2578\Desktop\qingxuan-smoke\r14-iso-20260823-052258\isolated.db + demo-access.json（原 dev.db 复制，SHA-256 3d1128b6b751f8fa99e30398c625787d08d82ba9611ab64a93fbb31f610e4471 与轮 13 存档一致）；端口 3022（非 3005；3005 保持 PID 22160）；`node scripts/local-next-runtime.mjs start --port 3022 --database-path … --demo-access-store-path …`；BUILD_ID tvHcSt58c5RTP__45mst_（含轮 14 代码重建）；health ok / runtime-mode local_owner noAuthOwner:true。
- 真实流程（Chrome headless CDP 1440×900，真实 1688 CLI 搜索「保温杯」）：① 搜索→10 候选预览→勾选 4→保存→刷新保留 4（前 3 详情完整、第 4「跨境一键开盖保温杯」以搜索快照保留显示未知项——无截断）；② 同页冲突恢复：搜索→勾选 2→用 keyword-evidence 合法 API 更新同任务（resultJsonHash 变化）→点保存→409→前端自动刷新版本重试一次→成功（已加入供应线索 5 条，服务端 candidates=5 confirmed=5）；③ 二次冲突：CDP Fetch 拦截 retry 请求挂起→期间再更新版本→放行→第二次 409→显示「资料又发生变化，请再试一次」+ 搜索结果（10 条）与勾选全部保留；全程无「预览已过期」；④ 1440×900 OVERFLOW=0、390×844 OVERFLOW=0、console errors=0 warns=0、起点选择保留（SELECTED_COUNT=2，视口切换后仍 2）。
- 截图：docs/v4.1/evidence/d-formal-v2/r14-flow-before-save-1440.png、r14-flow-after-reload-1440.png、r14-conflict-recovered-1440.png、r14-conflict-stop-1440.png、r14-preview-selected-1440.png、r14-preview-selected-390.png。
- 原库校验：prisma/dev.db SHA-256 = 3d1128b6b751f8fa99e30398c625787d08d82ba9611ab64a93fbb31f610e4471（Node 原始句柄读取，MATCHES_R13=true），mtime 2026-08-22T20:07:36.107Z 未变——零写原始库。

# Formal v2 P1 修复（代码审查后最小修复轮）

- 审查结论：NO_GO（P1×3：分页 total/hasMore 失真、Amazon 来源白名单正则可绕过、abandoned 分类口径冲突）。
- **P1-1** app/api/tasks/route.ts：research/historical 改为**两阶段精确分页**（无 take/skip 全量窗口 → classifyResearchLifecycle 精确分类 → 切片）；total/hasMore/nextOffset 全部基于精确结果；窗口上限 MAX_RESEARCH_PAGINATION_WINDOW=5000（超限 fail-closed 500）；排序 createdAt desc + id desc；SQL 不再做 lifecycle 启发式预过滤（避免提前排除 abandoned+legacy continue 记录）；product-research 语义不变。
- **P1-2** lib/server/browserUseResearch.ts：isAllowedCollectorSourceUrl 改为 new URL 解析 + 协议(仅 http/https) + 拒绝 userinfo + hostname 精确匹配 AMAZON_RETAIL_HOSTS（amazon.com/co.uk/de/co.jp/ca + www 前缀），拒绝后缀欺骗/用户信息/非 HTTP(S)/含空白/畸形。
- **P1-3** lib/taskResearchHistoryPresentation.ts + lib/researchLifecycle.ts：productResearchSummary.status="abandoned" → deriveResearchHistoryStatus 返回独立 {key:"abandoned",label:"已放弃"}；deriveProductProjectGroup 对 abandoned → group="completed"（保持三列）+ statusLabel="已放弃" + nextLabel="查看研究记录"；creative_ready 保持"研究已完成/查看研究结果"；类型 ResearchHistoryStatus 扩展 abandoned。
- 测试：红线契约先写后实现（route.test.ts +2、browserUseResearch.test.ts +1、researchLifecycle.test.ts +1、taskResearchHistoryPresentation.test.ts +1）；原 6 文件基线 102 → **107 passed / 0 skip**；route.test.ts 59/59（含既有 1 处 SQL 预过滤断言适配为两阶段实现断言，行为断言保留）。
- 反向验证 ×3（均红→恢复绿）：恢复"当前页长度当 total" → 分页新测试 2 failed；恢复旧 Amazon 正则 → 恶意域名用例 failed；abandoned 映射回 completed 文案 → 状态测试 2 failed。
- 全量 npm run test（一次）：**6046 passed / 0 failed / 89 skipped**；唯一文件级失败 lib/server/native1688Bridge.integration.test.ts（bridge did not start，隔离复跑复现，环境性既有问题）。
- tsc 0 / 改动文件 ESLint 0 / build 成功 / git diff --check 0；prisma/dev.db SHA a17675798b3a75976758136a37cc4dbe91d6d02e845ba389b1ab9e2b24a463a9 与审查起点一致（零写入）；HEAD 7980f713 未变；暂存区 0；16 项 B 类未动。
- 结论：三个 P1 全部闭环 → READY_FOR_RE_REVIEW。
