# Listing 历史 Draft 读取守卫（LISTING_HISTORICAL_DRAFT_READ_GUARD）

已完成 2026-08-26T15:25:20.760Z

## 问题

draftSafeSummary 信任历史快照字段,只做旧结构检查（词数/句法),未执行当前 Fact Safety + Copy Quality 门禁。历史坏稿（structured_listing_draft + 坏句 + 无 factSafe/copyQuality）以 listingUnqualified=false 对外暴露。

## 修复（最小,单文件为主）

lib/listingHandoff/listingGenerationService.ts:
- 新增 revalidateHistoricalDraftRead 纯函数（导出,可测试）: 安全解析正式字段 → 当前 validateCopyQualityContract 重校验正文 → factSafe 仅持久化 true 且无读取侧禁止词面矛盾; copyQuality = 当前重校验结果（不信任持久化）; listingUnqualified = !factSafe || !copyQuality || 结构检查不合格
- draftSafeSummary 消费该重校验; unqualified 时正式 title/bullets/description/keywords/backendSearchTerms/sellingPoints 清空; rejectedListingSentences 有界（原坏句+中文原因）
- 不写库; 不改变新生成路径; providerSucceeded 语义不变

## 测试

新建 lib/listingHandoff/listingHistoricalDraftReadGuard.test.ts（5 类红测: 缺 gate 字段→unqualified/伪造 gate→拒/新合格快照→保留/坏句只进 rejected 有界/纯函数不改入参）
改 components/listing-handoff/ListingGenerationBasis.dom.test.ts（unqualified 历史快照→安全摘要→诚实空态）

## 验证

- 9 文件 114 + 新 6 = 120/120 全绿, 0 failed, 0 skip
- tsc 0 errors; ESLint 0; diff-check clean
- 反向 3 项红→绿（缺 gate 默认通过→红; 不清空→红; 全部 unqualified→红）, 无注入残留
- 隔离构建成功（BUILD_ID xg_DLJeB7gdFLiPoNMBWF）+ 3029 验收: 历史坏稿 API 返回 unqualified=true/factSafe=false/copyQuality=false/正式字段空; 1440+390 显示暂无合格草稿, 无复制按钮, 正式区无坏句, 历史事实区保留 Leak Proof, 无横滚, console 0/0, 写请求 0
