# 阻塞记录（Listing 创作补充 · 第9轮 边界修复）

状态：无阻塞（BLOCKED=无）。

- 独立复审两项 P1（P1-B1 候选含 4 条无 diff 文件；P1-B2 integration 漏列）均已关闭：4 条 NO_DIFF 文件移出候选（以实际路径 docs/v3/changes/v3-4-voc/smoke-evidence/… 为准）；integration.test.ts 正式列入候选。
- 附加边界说明（非阻塞，已记录于 PROGRESS·差集）：data/demo-access.json 有 HEAD diff 但为受保护运行数据文件，不作为提交候选（保留为候选外 dirty）；lib/listingHandoff/listingGenerationService.ts 为第八轮清单的另一处遗漏（有 HEAD diff 生产文件），已纳入 16 候选并进入隔离测试基线（42/42 集成合同覆盖）。
- 任务书路径书写偏差：docs/v3/review-evidence/*.html 实际路径为 docs/v3/changes/v3-4-voc/smoke-evidence/*.html（以真实路径 NO_DIFF 核验为准，记录于 PROGRESS）。
