# RESEARCH_LISTING_CLOSURE_R5 PROGRESS（执行者自记）

## 任务 0：只读基线（完成）
- 分支 feature/v4.1-ui-productization；HEAD 1623a1e4bffa07bf3bb55c9cffed1a175564d38a；无暂存。
- prisma/dev.db SHA-256：d29d45db4f23f278f1dd24d21951465e61166d92fb166ff2bc1c42d72f80a8a2（全程不变）。
- 基线：9 文件 / 154 tests 全绿。

## P1-1：AI 摘要安全 DTO 与前端消费者漂移（完成）
- route GET/POST 增加 hasSummary（summary !== null）安全状态字段；保持不返回原始 summary/unverified/gateResult。
- EvidenceWorkbench 不再读 json.data.summary（改为 hasSummary → aiSummary boolean 状态；hasAiSummary 冒泡用同一状态）。
- AiEvidenceSummarySection prop summary 改为 boolean（hasSummary）；新手层替换为安全说明（「已基于采集证据生成研究摘要」）；门禁块替换为安全文本（不再恢复原始 gateResult）；四模块独立渲染（businessModules 非空即展示）。
- 契约测试：无摘要任务 hasSummary=false + 空骨架 4 模块不冒充；有摘要任务 hasSummary=true。
- 真实链路行为：route-shaped response → workbench → Section（API 验证 + 浏览器）。

## P1-2：Listing providerAttempted 三态保留（完成）
- draftSafeSummary：providerAttempted/providerSucceeded 仅 typeof boolean 时透传，否则 undefined（不再缺失强转 false）。
- 真实历史持久化草稿测试：删除新字段后的历史快照经 draftSafeSummary → providerAttempted undefined（历史语义保留）。

## P2：测试可信度（完成）
- 删除 mainChain R3 源码契约测试（readFileSync+正则证明行为）——由真实路径行为测试承担。
- 删除 mainChain R4 真实非 AI 测试的 void doc 占位代码。
- 全白名单测试 void 占位清零（DOM 测试 + mainChain）。
- route.test：beforeEach 隔离设置 DEMO_SANDBOX_STORE_PATH + DEMO_ACCESS_STORE_PATH；afterEach 恢复（原值 undefined 才删除，存在则精确恢复）；afterAll 真实校验恢复准确（sentinel）。
- EvidenceWorkbench.test.ts（clean 既有测试）同步一处源码字符串断言（hasAiSummary 语义变化）——如实记录。

## 反向验证（红→绿，三项）
1. 移除 hasSummary 接线 → route 契约测试 2/2 红；恢复绿。
2. providerAttempted 强转 false → 历史草稿测试红；恢复绿。
3. 删除 DEMO_ACCESS_STORE_PATH 恢复 → afterAll 恢复校验红；恢复绿。

## 验证结果
- 定向测试：9 文件 / 157 tests 全绿；stderr 0 act warning。
- tsc --noEmit --pretty false：0 错误。
- eslint（改动文件）：0 errors（2 warnings 为 HEAD 既有 unused disable）。
- git diff --check：clean。
- next build：✓ Compiled successfully（18.9s）。
- dev.db SHA 与任务 0 一致（全程零写入）。
- API 验证：有摘要任务 hasSummary=true；无摘要任务 hasSummary=false + 空骨架 4 模块（未冒充已生成）；无内部字段泄漏。
- 浏览器验收：有摘要任务（cmt0lmsqa）四模块+历史折叠+无泄漏+无 h-scroll+console 0/0；无摘要任务（cmszqjpfo）四模块空骨架（AI 结论尚未生成）+重新生成按钮+无泄漏+无 h-scroll+console 0/0；双端一致。

## 全量 npm run test（616 文件）：8 failed / 6135 passed / 78 skipped
- 6 个为 R1-R4 既有（TaskRecordDetail 断言系列 + 原生 CLI 桥接）——零新增。
- 2 个新增经核实：
  1. components/evidence/EvidenceWorkbench.test.ts（轮 13 源码断言 hasAiSummary 语义）——因 P1-1 合法修改语义而失效，已同步断言（30/30 绿）。
  2. lib/server/demoSandbox.store-consistency.test.ts（100-race 5800ms 并发超时）——单跑 9/9 通过，属全量并发环境超时，与本次改动零关联（未改 store 一致性）。

## 遗留说明
1. EvidenceWorkbench.test.ts 不在任务书显式白名单但为对应组件测试（clean 文件），仅同步一处源码字符串断言（hasAiSummary 语义）；其余未动。
2. 无摘要任务页面显示"四模块空骨架 + AI 结论尚未生成 + 重新生成"（hasSummary=false 语义），非全空态——正确行为（businessModules 存在即渲染，空结论诚实展示）。
