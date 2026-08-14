# CURRENT_WORK — 轻选工作台 V3 执行状态

> 主 Agent 维护的唯一权威状态文档（执行包 23_CURRENT_WORK_TEMPLATE.md）。权威顺序：当前仓库真实代码/AGENTS.md/Git 状态 > v2.2 FINAL 合同 > 30 增强 > Change Package。

## 当前版本

- V3 Core: Phase 0 = PASS（Closeout）；Phase 1 = PASS；Phase 2 = PASS；**Phase 3 = 进行中**
- V3.x: 未授权（v3x_auto_start=false，硬约束）
- Current Wave: Wave 2（Phase 3 — Reverse ASIN / Keyword Mining，无真实样本准备路径）
- Current Phase: Phase 3
- Status: AUTO_ADVANCE（auto_with_integration_gates）

## 权威基线

- repo_root: `D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`
- main HEAD: 490f24a（Phase 2 集成后）
- origin/main: 76e2c96（main 领先 18 个提交，未 push——push 等待用户明确授权）
- main clean: 是（除未提交的 phase-2 收口文档，见下）

## 活跃 Agent

| Agent | Role | Worktree | Branch | Task | Status | Commit |
|---|---|---|---|---|---|---|
| 主 Agent | 集成/调度 | main | main | Phase 3/4 准备 | 进行中 | 490f24a |

## 当前目标

Phase 3/4（Reverse ASIN / Keyword Mining 关键词 Evidence）：**无真实 XLSX 样本**（材料根确认仅 Products + BSR），按 12_PHASE3_4_TASK.md 走「无真实样本」允许路径：官方字段研究 / Adapter 设计 / 风险清单 / 测试计划；**禁止**猜表头、猜单位、宣称合同完成。Gate 中「真实 XLSX 正确 / 5 行值级核对」待样本到位后补齐。

## 已完成

- Phase 0 = PASS + Closeout
- **Phase 1 = PASS**（三层报告判定 + Golden Replay + 真实样本验证）
- **Phase 2 = PASS**（Evidence Workbench：六大区域 + Novice Comprehension 分层 + 竞品 Evidence 合同实现 + provenance 展示；main 4497 测试/tsc/lint/build 全绿；风险 #12/#15 关闭、#11 澄清）
  - 产出：docs/v3/changes/phase-2/{evidence-read-model,competitor-evidence-contract,proposal,tasks,validation,learnings}.md

## 待集成

- Phase 2 收口文档（validation/learnings 未提交，本轮提交）

## 阻塞

- **Phase 3/4 真实样本缺失**：材料根无 Reverse ASIN / Keyword Mining XLSX；任务书明确无样本时禁止猜合同。准备路径可推进，Gate 完整 PASS 需用户提供样本（或明确接受降级结论）。

## 样本状态

- Product Search: 有（真实 + golden fixture）
- Category Current: 有（真实 + golden fixture）
- Reverse ASIN: **无（阻塞 Phase 3 完整 Gate）**
- Keyword Mining: **无（阻塞 Phase 4 完整 Gate）**
- Browser Evidence: 未授权（V3.1）
- VOC / 1688: 未授权（V3.4/V3.5）

## 正式风险登记（来源 decisions.md §7，Phase PASS 不得遗失）

| # | 风险 | Phase | owner/阶段 | 状态 |
|---|---|---|---|---|
| 1 | 任务级 AI Listing 不受 OPENAI_LISTING_ENABLED 开关控制 | Phase 6 | MA/Phase 6 gate | 未动 |
| 2 | 旧 AI 入口（/api/generate、/api/agents/*5）真实调用消耗配额 | Phase 6 | MA/Phase 6 | 未动 |
| 3 | Reverse ASIN / Keyword Mining 无实现 | Phase 3/4 | MA/Phase 3-4 | 进行中（无样本准备路径） |
| 4 | category_current 候选源快照硬编码 Search Results（lib/server 禁改） | Phase 2/6 | MA/Phase 2 close | Phase 2 评估：未触及（lib/server 边界），顺延 Phase 6 |
| 5 | 旧 listing-copy 链真实 AI 无证据门禁 | Phase 6 | MA/Phase 6 | 未动 |
| 6 | listing-keyword-brief 可追溯字段不完整（05 合同） | Phase 3/4 | MA/Phase 3-4 | 待 Phase 3/4 增强（含 Keyword Brief 可追溯：evidenceRef/reportHash/month） |
| 7 | studio resultStore 无查询入口 | Phase 6 | MA/Phase 6 | Phase 2 评估：顺延 Phase 6 |
| 8 | listing-copy-history owner-only | 产品决策 | PU/任何 Phase | 未动 |
| 9 | 外部抓取出口 2 处无页面调用方 | Phase 6 | MA/Phase 6 | 未动 |
| 10 | 真实 XLSX 不入 Git 约束持续有效 | 持续 | MA/每 Phase | Phase 1/2 已遵守 |
| 11 | research-record 不含事实字段 | Phase 2 | MA/Phase 2 | **已澄清**（读取模型边界明确，见 evidence-read-model §0）；风险关闭 |
| 12 | metricNature 身份字段 unknown 使用方式 | Phase 2 | MA/Phase 2 | **已落地**（UI 角标映射）；风险关闭 |
| 13 | research-decision PATCH 只接受三值 | 已裁定文档化 | MA/已关闭 | 已关闭 |
| 14 | studioListingService 缺测试；Studio 无保存草稿 | Phase 6 | MA/Phase 6 | Phase 2 评估：顺延 Phase 6 |
| 15 | score 排序/展示可能被新手误解为推荐分 | Phase 2 | MA/Phase 2 gate | **已落地**（Workbench 标注参考信号）；风险关闭 |

Observation：AgentStatusKey 派生态、主链两分支、注释漂移×2、双解析器（角色已澄清保留）、本机路径测试、配额语义待产品确认、candidateEvidenceReview 边界——详见 decisions.md §7.1。

## Gate（Phase 2 门禁记录）

- spec compliance: PASS / code quality: PASS / spec reconciliation: PASS
- lint: PASS / tsc: PASS / test: **4497 passed / 0 failed**（串行全量）/ build: PASS
- local smoke: 3005 计划任务 registered/Ready 未触碰；Phase 2 无新服务入口（新 API 属既有 tasks 路由族）
- push: 等待用户明确授权（main 领先 origin/main 18 个提交）

## 下一步

1. 提交 Phase 2 收口文档（validation/learnings）→ PHASE_2 = PASS 正式声明
2. Phase 3/4 Change Package：无样本准备路径（官方字段研究、Adapter 设计、风险清单、测试计划、Keyword Brief 可追溯设计）
3. 向用户报告样本缺口，征集 Reverse ASIN / Keyword Mining 真实 XLSX
4. 样本到位后：实现 + 5 行值级核对 + Gate 全绿 → PHASE_3/4 = PASS
