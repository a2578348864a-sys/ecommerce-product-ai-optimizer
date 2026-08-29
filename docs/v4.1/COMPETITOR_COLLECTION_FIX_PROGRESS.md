# 竞品采集收口 — 任务进度（PROGRESS）

> 任务书唯一来源：用户最新任务书（4 缺口补丁）。本文件只记录已发生事实，先读本文件再续做。
> 目标：竞品采集收口到「按钮真能启动、空结果不冒充成功、部分失败原因说实话」。
> 优先级：数据诚实 > 保存安全 > 按钮可用 > 改得更少。

## 任务 0：基线核对（完成 ✅）

- branch = feature/v4.1-ui-productization；HEAD = origin/HEAD = `db8934d4cdc43cae65af334a5275b0ac6f36673b`；staged = 0；worktree 干净 —— 全部匹配
- 基线测试：route.test.ts 8/8；CompetitorStrategyCard.dom + BrowserUseCollectButton.test 13/13（合计 21 基线）
- 3005 仍在运行，BUILD_ID = `W_OEoOGPb8egKy8AosngE`（旧，本轮不 build 不重启）
- EvidenceWorkbench.test.ts 预存在失败（引用已删除的 KeywordBriefCreateCard.tsx）→ 见 BLOCKED

## 目标与顺序（执行计划）

1. **红测先行**：4 组新测试（cp-collect 恰 1 次、命令句柄恰 1 次、空 results 写入器 0 次、skipped 分类、saved/skipped 互斥），贴真实红输出
2. **最小修复**：服务端空 results 硬拒 + 前端双保险；skipped 按 code 分类诚实文案；saved/skipped 互斥且保留 db8934d 有限冲突重试
3. **反向验证**：逐项临时破坏→红→逐字节恢复→复绿，探针残留 0
4. **质量门**：目标测试 ≥25 全绿；tsc / ESLint / diff-check 全绿；基线 21 条只增不减

## 修改文件（只允许清单）

- components/evidence/BrowserUseCollectButton.tsx
- components/evidence/BrowserUseCollectButton.test.ts
- components/evidence/CompetitorStrategyCard.dom.test.ts
- app/api/tasks/[id]/competitor-evidence/route.ts
- app/api/tasks/[id]/competitor-evidence/route.test.ts
- 新建专用竞品按钮行为测试（如需要）
- 本文件 + COMPETITOR_COLLECTION_FIX_BLOCKED.md

## 执行记录（按完成顺序追加）

- [2026-08-29] 任务 0 完成：基线全绿，HEAD/staged/worktree/3005 均符合预期。
- [2026-08-29] 任务 1（红测先行）完成，5 组红全部真实复现：
  - 服务端 9c 红：空 results（failureReason=null）save 返回 200（应 ≥400），写入器 0 次未验证 → 需硬拒（route.test.ts 轮 9c）
  - 服务端 9d 红：成功写入后刷新版本抛错 → 同一 ASIN 同时出现在 saved 与 skipped（route.test.ts 轮 9d）
  - 前端空预览门禁红：browserUseSaveAllowed 不存在（BrowserUseCollectButton.dom.test.ts）
  - 前端 skipped 分类红：buildSaveSummary 不存在（同文件）
  - 命令句柄恰 1 次：绿（db8934d 已实现，保留）
- [2026-08-30] 任务 2（最小修复）完成 → 28/28 全绿：
  - 服务端：空 results（failureReason=null）→ 422 competitor_preview_empty（路由 9c 转绿）
  - 服务端：写入成功与版本刷新分离——刷新失败不把该条改记 skipped（9d 互斥转绿）
  - 前端：browserUseSaveAllowed 空预览门禁（确认保存禁用 + confirmSave 拒绝发送）
  - 前端：buildSaveSummary 按 code 分类（duplicate→已在列表中 / conflict→版本冲突 / limit→达到竞品上限 / 其他→保存失败）
  - 既有 SAVED 测试同步升级为 skipped:[] 契约


## 最大风险（≤10 行）

1. 前端状态机/服务端双处改动可能使既有 21 条回归（补救：只加不改既有断言语义，改前先快照）
2. skipped 分类文案可能被既有 SAVED 测试断言卡住（对应测试已在本轮清单内同步升级）
3. mock 深度不足导致空结果门禁测试测不到真实路径（补救：服务端测试用真实写入器+mock 快照，前端用 reducer 状态机真断言）
- [2026-08-30] 任务 3（反向验证）完成：
  - 破坏1（移除空结果 422）→ 9c 红（1 failed|9 passed）→ 恢复复绿（10/10）
  - 破坏2（分类全标 duplicate）→ 分类测试红（1 failed|2 passed）→ 恢复复绿（9/9）
  - 破坏3（cp-collect onClick 移除）→ 点击测试红（9 failed 含目标用例）→ 恢复复绿（9/9）
  - 破坏4（回退先 push saved）→ 未红：目标实现已把 skip 记账严格锁在 !saved 分支，
    旧"先 push saved 后在同一 catch 记 skipped"缺陷时序已结构性消灭，无残留路径可破坏；
    9d 互斥不变式仍由测试覆盖（绿）。
  - 探针残留：0（三个源文件均恢复，备份已删）
- [2026-08-30] 质量门全绿：目标测试 28/28（基线 21 + 新增 7）；tsc 0 错误；ESLint 0 报错；git diff --check 通过（仅 CRLF warning 非错误）。
- [2026-08-30] 完成条件核验：HEAD=db8934d（未动）、staged=0、未 commit/push/build、3005 运行中 BUILD_ID=W_OEoOGPb8egKy8AosngE 未变、原 dev.db 未写、Provider 未调用。
- [2026-08-30] 结论：READY_FOR_3029_SAFE_RETRY
- [2026-08-30] 最终验收任务 1（互斥正确反向证据）完成：
  - 逐字节备份 route.ts（SHA=e96ed10f6d1be624...）
  - 正确破坏：写入成功后版本刷新失败 → 该 ASIN 再进 skipped（旧缺陷精确语义）
  - 真实红：9d 互斥测试失败，281 行交集断言 expected true to be false（同 ASIN 双入组）
  - 恢复：SHA 与冻结完全一致；10/10 全绿；探针残留 0
- [2026-08-30] 最终验收任务 2（本地质量门）完成：28/28、tsc 0 错误、ESLint 0、diff-check 0。
- [2026-08-30] 最终验收任务 3（3029 隔离环境）完成：
  - git archive HEAD 纯净导出到 C:/Users/a2578/qingxuan-competitor-acceptance；8 候选覆盖
  - 扫描：.env=0（仅 example）、dev.db 原始=0、.next 原始=0、个人 Skill=0；Provider key 全 ABSENT；59999 无监听
  - 隔离 prisma generate + tsc + next build 成功（BUILD_ID=-zM98Kf5nB9aS3apbKYGV，与主仓不同）；.next 密钥命中 0
- [2026-08-30] 最终验收任务 4（3029 真实浏览器验收）完成：
  - A.1 采集关键词+竞品：点击→POST 恰 1 次→诚实失败状态（409/502 未冒充成功）✓
  - A.2 自动采集竞品：cp-collect→collectRef 链真实执行；**发现并修复 busy guard 缺口**（busy 重击曾产生第 2 次请求）；修复后 busy 期间 disabled=true 且 POST 不增 ✓
  - B.1/B.2 非空预览保存：确认保存 POST 恰 1 次；5 竞品 saved→页面「直接竞品 5」；刷新后持久（隔离 demo-sandbox.json 指纹变化 b8e42f77）✓
  - B.3 空结果 422 由 route 单测 9c 锁定（真实环境无空结果入口，引擎返真实非空）；前端禁用由 dom 测试锁定
  - B.4 skipped 分类 + B.5 互斥 + B.6 冲突重试：由单测 9b/9d/dom 测试锁定；本轮保存 skipped=0
  - C.1 1440/390 无横滚；C.2 console 0/0；C.3 请求全 127.0.0.1:3029（0 外部域名）；C.4 Provider=0；C.5 3005=0；C.6 原 dev.db 指纹未变
- [2026-08-30] 最终验收任务 5（安全停止与核对）完成：
  - stop dry-run：ownershipVerified=false（child_next_entry_mismatch/runtime_launcher_missing）——3029 为手动隔离启动，非项目 runtime 子进程，工具正确拒绝
  - 安全停止：确认 37188 仅监听 3029、无子进程、父进程为会话 bash → 单 PID 停止；3029 端口释放不可达；未 taskkill 3005、未杀进程树
  - 最终核对：HEAD=db8934d 未变 ✓；staged=0 ✓；3005 PID=17080/health ok/BUILD_ID=W_OEoOGPb8egKy8AosngE 未变 ✓；原 dev.db 指纹 9967963ef0e49613 未变 ✓；Provider=0（59999 死端口 0 连接）✓；commit=0 ✓；push=0 ✓；deploy=0 ✓
  - 8 候选：唯一功能变更 = BrowserUseCollectButton.tsx（新增 busy guard，a94d65f8）+ dom.test.ts（busy guard 测试，1bcc5a6a）；其余 5 文件与冻结 SHA 一致；PROGRESS.md 记录追加
  - 结论：READY_FOR_COMPETITOR_COLLECTION_COMMIT_AUTHORIZATION
