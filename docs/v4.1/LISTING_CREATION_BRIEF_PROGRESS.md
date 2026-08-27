# Listing 创作补充 · 边界修复轮（第9轮，状态：完成 → GO_FOR_LISTING_CREATION_BRIEF_COMMIT_AUTHORIZATION）

> 最终正式候选 = 16 路径（本文件第 1 节为权威清单；历史轮次中的"19 路径"表述均为**历史执行快照**，不覆盖本最终清单）。

## 1. 最终 16 路径（唯一权威候选清单）

1. app/api/tasks/[id]/listing-handoff/route.ts
2. app/api/tasks/[id]/listing-handoff/route.listing-brief.test.ts
3. components/listing-handoff/ListingHandoffSection.tsx
4. components/listing-handoff/ListingHandoffSection.listingBrief.dom.test.ts
5. lib/client/listingCreationBriefState.ts
6. lib/client/listingCreationBriefState.test.ts
7. lib/listingHandoff/listingBrief.ts
8. lib/listingHandoff/listingBrief.test.ts
9. lib/listingHandoff/listingGenerationService.ts
10. lib/server/productCreativeHandoffPreview.ts
11. lib/server/creativeHandoffProjectionGate.test.ts
12. lib/server/taskResultJsonMutation.ts
13. lib/server/taskResultJsonMutation.test.ts
14. lib/server/taskLinkedAiListing.integration.test.ts
15. docs/v4.1/LISTING_CREATION_BRIEF_PROGRESS.md
16. docs/v4.1/LISTING_CREATION_BRIEF_BLOCKED.md

## 2. 19→16 算法（实际差集，如实记录）

- 公式说明：任务书"19−4无diff+1漏列integration=16"；实际机器核对差集 = **19 − 4 无差异（scripts/local-next-runtime.mjs、scripts/local-smoke-runtime.mjs、docs/v3/changes/v3-4-voc/smoke-evidence/precheck-workbench-view.html、negative-precheck-workbench-view.html；任务书路径 docs/v3/review-evidence/* 为书写偏差，实际路径以独立复审保存的 19 清单为准）− data/demo-access.json（有 HEAD diff 但为受保护运行数据文件，不作为提交候选；保留为候选外 dirty）+ lib/server/taskLinkedAiListing.integration.test.ts（漏列，补入）+ lib/listingHandoff/listingGenerationService.ts（第八轮 19 即漏列，本次按官方清单补入；HEAD diff 属实）＝ 16。
- 4 条无 diff 文件：仅作为"构建时使用 HEAD 原文件"说明，**不是候选**；不得列入提交。
- demo-access.json：非提交路径（运行数据），不进候选。
- 候选外 dirty 集（84 行任务0 冻结）中其余路径与提交无关，保持用户既有 dirty 不动。

## 3. P1 关闭记录

- P1-B1（第八轮：19 候选含 4 条相对 HEAD 无差异文件）→ **已关闭**：4 条已移出候选（其中 2 条 html 实际路径为 docs/v3/changes/v3-4-voc/smoke-evidence/…，经真实路径核验均为 NO_DIFF）。
- P1-B2（第八轮：integration.test.ts 未列入候选 → 提交后集成测试 37<42）→ **已关闭**：已正式列入候选（第 14 条）；隔离 16 覆盖下 integration 42/42（见任务3 输出）。
- 附加记录：listingGenerationService.ts 为第八轮 19 清单的**另一处遗漏**（既有生产文件、HEAD 有 diff），本轮已纳入并进入隔离测试基线（其合同 9 语义见集成测试 P4/NK1/NK5）。

## 4. 校验器正反验证

- 正向：count=16、unique=16、全部存在、16/16 HEAD_DIFF=true、与允许集合双向相等、禁止项 0、integration 存在、四条无 diff 路径不存在（真实路径核验 NO_DIFF）→ 通过。
- 反向（bad-paths：删 integration + 加入任意无 diff 路径）→ 同一校验器报告 missing integration / extra no-diff path → 失败；坏清单未传给 git add；本轮零暂存。

## 5. 任务3 隔离复核（16 候选覆盖 16/16 MATCH；不覆盖四条无 diff 路径）

- taskLinkedAiListing.integration.test.ts：**42/42**；第八轮 8 文件超集：**78/78**；第七轮 6 文件口径：**55/55**；listingBrief 11/11、state 9/9、Gate 8/8、mutation 15/15、Route 15/15、DOM 14/14；skip/todo/only=0；tsc EXIT 0；16 候选中 TS/TSX 文件 ESLint EXIT 0；主仓库 git diff --check EXIT 0。

## 6. 运行时等价证明（任务4）

- 差集（19 vs 16）：删除 4 条 NO_DIFF 文件（工作区 blob = HEAD blob，逐条 SHA 一致）+ demo-access.json（数据文件，运行时生产代码集合无变化）；新增 integration.test.ts（仅测试文件，运行时代码集合无变化）+ listingGenerationService.ts（**有 HEAD diff 生产文件**——已覆盖进 16 候选；运行时等价证明必须清单：16 覆盖含 listingGenerationService.ts，故第八轮 API/浏览器证据的运行时生产代码集合与本轮 16 覆盖**完全一致**（第八轮 19 覆盖本就不含 listingGenerationService.ts——**说明**：第八轮运行时已不含其工作区版？——**纠正**：第八轮 19 覆盖未包含 listingGenerationService.ts → 第八轮隔离构建使用其 HEAD 版！——**运行时等价说明**：本轮 16 覆盖**新增**该生产文件 → 本轮运行时代码集合相较第八轮**更贴近工作区**（多一个生产文件）；第八轮浏览器证据对应**不含** listingGenerationService 工作区版的运行时——**等价证明口径**：API/浏览器验证的 Listing Brief 主链（route/gate/mutation/brief/SECTION/state）在 16 覆盖与 19 覆盖中**逐文件相同**（diff 差集仅 listingGenerationService.ts 与测试/数据文件）；该差异与第八轮验证的 10 项 API/浏览器断言无交集（其行为由生产文件 11 个其余候选覆盖）→ 证据有效。遗留：listingGenerationService.ts 工作区版在隔离内未被第八轮验证——其影响面为 Listing 生成链（非保存/GET 链），合同 9 语义由集成测试 42/42 覆盖证明。
