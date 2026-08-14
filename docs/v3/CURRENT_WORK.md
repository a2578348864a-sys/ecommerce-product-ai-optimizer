# CURRENT_WORK — 轻选工作台 V3 执行状态

> 主 Agent 维护的唯一权威状态文档（执行包 23_CURRENT_WORK_TEMPLATE.md）。权威顺序：当前仓库真实代码/AGENTS.md/Git 状态 > v2.2 FINAL 合同 > 30 增强 > Change Package。

## 当前版本

- V3 Core: Phase 0 = PASS（Closeout 完成）；Phase 1 = PASS（见下）；Phase 2 = 进行中
- V3.x: 未授权（v3x_auto_start=false，硬约束）
- Current Wave: Wave 1（Phase 2）
- Current Phase: Phase 2（Evidence Read Model + Workbench UI）
- Status: AUTO_ADVANCE（auto_with_integration_gates）

## 权威基线

- repo_root: `D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`
- main HEAD: 6a53a07（Phase 1 文档收口后）
- origin/main: 76e2c96（main 领先 12 个提交，未 push——push 等待用户明确授权）
- main clean: 是

## 活跃 Agent

| Agent | Role | Worktree | Branch | Task | Status | Commit |
|---|---|---|---|---|---|---|
| 主 Agent | 集成/调度 | main | main | Phase 2 调度 | 进行中 | 6a53a07 |
| Phase 1 开发 | Developer | 电商工具-pipeline-phase1 | codex/pipeline-phase1 | Phase 1（已完成） | 已集成 | 9153c87→0fd8efa |

## 当前目标

Phase 2：Evidence Read Model + Workbench UI（证据读取模型 + 研究页/任务详情展示；Novice Comprehension 约束必读 seed；正式风险 #1/#6/#7/#11/#12/#14/#15 涉及本阶段评估）。

## 已完成

- Phase 0 = PASS + Closeout（风险清单 15 项统一、Decision 语义钉死、Phase 1 边界修正、score 展示风险 #15）
- **Phase 1 = PASS**（6a53a07）：
  - 三层报告类型判定（表头签名 + 行级 BSR 值域信号 + fail-closed reasonCode）
  - Golden Dataset + Parser Replay（deterministic 双跑，旧样本不退化）
  - 真实样本验证：Products(10) → unknown(ambiguous_ps_without_search_rank)（修复前静默误判 CC）；12/12 BSR → category_current
  - 历史误分类只读审计：无真实误分类需修正
  - main 验证：tsc/lint/4482 测试全绿；build 见门禁记录
  - 产出：docs/v3/changes/phase-1/{proposal,tasks,validation,learnings}.md

## 待集成

- Phase 2 开发产物（worktree 待创建）

## 阻塞

- 无

## 样本状态

- Product Search: 有（真实样本材料根只读验证；仓库内脱敏 golden fixture）
- Category Current: 有（同上）
- Reverse ASIN: 无（Phase 3）
- Keyword Mining: 无（Phase 4）
- Browser Evidence: 未授权（V3.1）
- VOC / 1688: 未授权（V3.4/V3.5）

## 正式风险登记（来源 decisions.md §7，Phase PASS 不得遗失）

| # | 风险 | Phase | owner/阶段 | 状态 |
|---|---|---|---|---|
| 1 | 任务级 AI Listing 不受 OPENAI_LISTING_ENABLED 开关控制 | Phase 2/6 | MA/Phase 2 gate | 待评估 |
| 2 | 旧 AI 入口（/api/generate、/api/agents/*5）真实调用消耗配额 | Phase 6 | MA/Phase 6 | 未动 |
| 3 | Reverse ASIN / Keyword Mining 无实现 | Phase 3/4 | MA/Phase 3-4 | 未动 |
| 4 | category_current 候选源快照硬编码 Search Results（lib/server 禁改） | Phase 1 评估→Phase 2/6 | MA/Phase 1 close | **Phase 1 评估完成：留待 Phase 2/6** |
| 5 | 旧 listing-copy 链真实 AI 无证据门禁 | Phase 6 | MA/Phase 6 | 未动 |
| 6 | listing-keyword-brief 可追溯字段不完整（05 合同） | Phase 2/3 | MA/Phase 2-3 | 待评估 |
| 7 | studio resultStore 无查询入口 | Phase 2 | MA/Phase 2 | 待评估 |
| 8 | listing-copy-history owner-only | 产品决策 | PU/任何 Phase | 未动 |
| 9 | 外部抓取出口 2 处无页面调用方 | Phase 6 | MA/Phase 6 | 未动 |
| 10 | 真实 XLSX 不入 Git 约束持续有效 | 持续 | MA/每 Phase | Phase 1 已遵守（0 命中） |
| 11 | research-record 不含事实字段，Phase 2 需明确边界 | Phase 2 | MA/Phase 2 | 待评估 |
| 12 | metricNature 身份字段 unknown 使用方式 | Phase 2 | MA/Phase 2 | 待评估 |
| 13 | research-decision PATCH 只接受三值 | 已裁定文档化 | MA/已关闭 | 已关闭 |
| 14 | studioListingService 缺测试；Studio 无保存草稿 | Phase 2 | MA/Phase 2 | 待评估 |
| 15 | score 排序/展示可能被新手误解为推荐分 | Phase 2 | MA/Phase 2 gate | 待评估 |

Observation（不占正式风险）：AgentStatusKey 派生态、主链两分支、注释漂移×2、双解析器（Phase 1 已澄清：xlsx.ts 为安全解析器、previewXlsx.ts 为预览专用解析器，角色保留不统一）、本机路径测试（realXlsxClosure.test.ts，Phase 1 未触碰，登记）、配额语义待产品确认、candidateEvidenceReview 边界——详见 decisions.md §7.1。

## Gate（Phase 1 门禁记录）

- spec compliance: PASS（validation.md §4 双审）
- code quality: PASS（validation.md §4）
- spec reconciliation: PASS（validation.md §5）
- lint: PASS（0 错误）
- tsc: PASS（0 错误）
- test: PASS（4482 passed / 0 failed，串行全量）
- build: 待 build 结果（job pwsh-31）
- local smoke: 3005 计划任务 registered/Ready 未触碰；Phase 1 无 UI 变更，不启动
- push: 等待用户明确授权（main 领先 origin/main 12 个提交）

## 下一步

1. build 门禁确认 → PHASE_1 = PASS 正式声明
2. 读 Phase 2 任务书（11_PHASE2_TASK.md）+ Novice Comprehension seed + 30 增强 Phase 2
3. 建 Phase 2 Change Package（docs/v3/changes/phase-2/）
4. 评估正式风险 #1/#6/#7/#11/#12/#14/#15 在本阶段的处理方式
5. 建 worktree（codex/pipeline-phase2 或 backend-phase2 按修改范围）开始开发
6. 门禁验证 + 集成 + 规格对账 → PHASE_2 = PASS → Phase 3
