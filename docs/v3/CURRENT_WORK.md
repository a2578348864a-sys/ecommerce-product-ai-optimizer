# CURRENT_WORK — 轻选工作台 V3 执行状态

> 主 Agent 维护的唯一权威状态文档（执行包 23_CURRENT_WORK_TEMPLATE.md）。权威顺序：当前仓库真实代码/AGENTS.md/Git 状态 > v2.2 FINAL 合同 > 30 增强 > Change Package。

## 当前版本

- V3 Core: Phase 0 = PASS（Closeout 完成，用户审查通过）；Phase 1 = 进行中
- V3.x: 未授权（v3x_auto_start=false，硬约束）
- Current Wave: Wave 1（Phase 1）
- Current Phase: Phase 1（Product Search 识别稳定化）
- Status: AUTO_ADVANCE（auto_with_integration_gates）

## 权威基线

- repo_root: `D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`
- main HEAD: 0e56807（Closeout 提交前基线）
- origin/main: 76e2c96（main 领先 7 个提交，未 push——push 等待用户明确授权）
- main clean: 是

## 活跃 Agent

| Agent | Role | Worktree | Branch | Task | Status | Commit |
|---|---|---|---|---|---|---|
| 主 Agent | 集成/调度 | main | main | Phase 1 调度+Closeout | 进行中 | — |
| （Phase 1 开发 Agent 待创建） | Developer | pipeline-phase1 worktree（待创建） | codex/pipeline-phase1 | Golden Dataset + Parser Replay | 待启动 | — |

## 当前目标

完成 Phase 1：修复真实 Product Search 缺 searchRank 时被静默误判的风险；建立 Golden Dataset + Parser Replay（30 增强）；三层判断 + fail-closed；历史误分类只读审计。Gate 全绿后 `PHASE_1 = PASS`。

## 已完成

- Phase 0 = PASS（6 项 Gate、双审、规格对账、三视角终审）
- Phase 0 Closeout：统一风险清单（§7 15 项 + 8 observation）、Decision 语义钉死（§2.1a）、Phase 1 边界修正（lib/server 默认禁改）、Phase 2 score 风险登记（#15）、CURRENT_WORK 落地
- 用户授权：恢复 auto_with_integration_gates，开始 Phase 1，自动推进 Phase 1–6；V3_CORE = DONE 强制暂停

## 待集成

- （Phase 1 开发产物）

## 阻塞

- 无

## 样本状态

- Product Search: 有（真实样本在 Git 根外 XLSX 案例目录，只读验证；仓库内仅脱敏 fixture）
- Category Current: 有（同上）
- Reverse ASIN: 无（Phase 3）
- Keyword Mining: 无（Phase 4）
- Browser Evidence: 未授权（V3.1）
- VOC / 1688: 未授权（V3.4/V3.5）

## 正式风险登记（来源 decisions.md §7，Phase PASS 不得遗失）

| # | 风险 | Phase | owner/阶段 |
|---|---|---|---|
| 1 | 任务级 AI Listing 不受 OPENAI_LISTING_ENABLED 开关控制 | Phase 2/6 | MA/Phase 2 gate |
| 2 | 旧 AI 入口（/api/generate、/api/agents/*5）真实调用消耗配额 | Phase 6 | MA/Phase 6 |
| 3 | Reverse ASIN / Keyword Mining 无实现 | Phase 3/4 | MA/Phase 3-4 |
| 4 | category_current 候选源快照硬编码 Search Results（lib/server 禁改） | Phase 1 评估→Phase 2/6 | MA/Phase 1 close |
| 5 | 旧 listing-copy 链真实 AI 无证据门禁 | Phase 6 | MA/Phase 6 |
| 6 | listing-keyword-brief 可追溯字段不完整（05 合同） | Phase 2/3 | MA/Phase 2-3 |
| 7 | studio resultStore 无查询入口 | Phase 2 | MA/Phase 2 |
| 8 | listing-copy-history owner-only | 产品决策 | PU/任何 Phase |
| 9 | 外部抓取出口 2 处无页面调用方 | Phase 6 | MA/Phase 6 |
| 10 | 真实 XLSX 不入 Git 约束持续有效 | 持续 | MA/每 Phase |
| 11 | research-record 不含事实字段，Phase 2 需明确边界 | Phase 2 | MA/Phase 2 |
| 12 | metricNature 身份字段 unknown 使用方式 | Phase 2 | MA/Phase 2 |
| 13 | research-decision PATCH 只接受三值 | 已裁定文档化 | MA/已关闭 |
| 14 | studioListingService 缺测试；Studio 无保存草稿 | Phase 2 | MA/Phase 2 |
| 15 | score 排序/展示可能被新手误解为推荐分 | Phase 2 | MA/Phase 2 gate |

Observation（不占正式风险）：AgentStatusKey 派生态、主链两分支、注释漂移×2、双解析器（Phase 1 澄清项）、本机路径测试、配额语义待产品确认、candidateEvidenceReview 边界——详见 decisions.md §7.1。

## Gate

- spec compliance: 待 Phase 1
- code quality: 待 Phase 1
- spec reconciliation: 待 Phase 1
- lint: 待 Phase 1
- tsc: 待 Phase 1
- test: 待 Phase 1
- build: 待 Phase 1
- local smoke: 待 Phase 1（3005 计划任务 registered/Ready，未触碰）
- push: 等待用户明确授权（main 领先 origin/main 7 个提交）

## 下一步

1. 提交 Closeout 文档（decisions/audit/acceptance/CURRENT_WORK）
2. 创建 Phase 1 Change Package（docs/v3/changes/phase-1/）
3. 读取 Phase 0 learnings 的 SellerSprite 条目（#5 报告类型、#10 边界）
4. 创建 Pipeline worktree（codex/pipeline-phase1，兄弟目录）
5. 实现 Golden Dataset + Parser Replay + searchRank 缺失 fail-closed 修复
6. 定向测试 + 全量验证 + 集成 main + 规格对账 + `PHASE_1 = PASS`
