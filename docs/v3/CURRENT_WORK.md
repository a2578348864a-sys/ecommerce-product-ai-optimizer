# CURRENT_WORK — 轻选工作台 V3 执行状态

> 主 Agent 维护的唯一权威状态文档（执行包 23_CURRENT_WORK_TEMPLATE.md）。

## 当前版本

- **V3 Core: Phase 0–6 全部 PASS → `V3_CORE = DONE`**
- V3.x: 未授权（v3x_auto_start=false 硬约束；`V3X_AUTHORIZATION_REQUIRED = TRUE` 强制暂停中）
- Current Wave: Core 完成，暂停点
- Current Phase: —（暂停）
- Status: **HARD_PAUSE**（等待用户明确授权「继续 V3.x」或「部署公网」）

## 权威基线

- repo_root: `D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`
- main HEAD: f3c6668（验收排障修复，见下）
- origin/main: 76e2c96（main 领先，**push 等待用户明确授权**）
- main clean: 是（`.env.local.bak-corrupt-*` 为排障备份，未跟踪）

## 最终报告

`docs/v3/V3_CORE_FINAL_REPORT.md`（24_FINAL_REPORT_TEMPLATE 填写）

## 人工验收排障记录（验收准备阶段，不改变 V3_CORE=DONE 语义）

| 提交 | 问题 | 根因 | 修复 |
|---|---|---|---|
| fb41af9 + 7a50f56 | 任务详情仍显示老界面 | Evidence Workbench 挂载在旧组件 WorkflowDecisionSummary（不生效） | 改挂到主组件 TaskRecordDetail（研究结论后、人工决定前），playwright 验证 7 区块渲染 |
| f3c6668 | 商品概览显示"暂无商品概览数据" | GET /api/tasks/[id] 的 sourceMeta 白名单投影缺 productBatchSnapshot / candidateSnapshot（数据本身完好） | sourceMetaSpec 补充两个嵌套投影；hash 字段按惯例输出 12 位指纹；imageSnapshot base64 不外泄 |

- 排障过程产物：`PROOF_SIGNING_SECRET` 已补入 `.env.local`（研究失败 `run_proof_unavailable` 根因，未提交）；候选/任务数据只读诊断，未写 DB。
- 验收前服务：由 `npm run start:local` 启动（计划任务指向旧 runtime-package，guard 校验固定 buildId 无法拉起新构建——历史遗留，最终报告说明）。

## 正式风险登记（decisions.md §7 终态）

| # | 风险 | 状态 |
|---|---|---|
| 1 | 任务级 AI Listing 开关 | **关闭**（handoff 后默认允许文档化裁定） |
| 2 | 旧 AI 入口配额盲区 | **关闭**（停新入口已生效，保留兼容） |
| 3 | Reverse ASIN / Keyword Mining 无实现 | **关闭**（Phase 3/4 实现） |
| 4 | category_current 快照硬编码 | **关闭**（CC 走批次链动态 reportType） |
| 5 | 旧 listing-copy 无 gate | **关闭**（停新入口） |
| 6 | Keyword Brief 追溯不完整 | **关闭**（Phase 3/4 追溯字段） |
| 7 | studio resultStore 无查询入口 | 保留登记（暂停点后授权处理） |
| 8 | listing-copy-history owner-only | 保留登记（产品决策） |
| 9 | 外部抓取出口无调用方 | **关闭**（保留兼容） |
| 10 | 真实 XLSX 不入 Git | 持续遵守（全程 0 命中） |
| 11 | research-record 不含事实字段 | **关闭**（读取模型边界澄清） |
| 12 | metricNature 身份字段 unknown | **关闭**（UI 角标落地） |
| 13 | research-decision PATCH 三值 | 已关闭（文档化） |
| 14 | studioListingService 缺测试/无保存草稿 | 保留登记（暂停点后授权处理） |
| 15 | score 展示误导 | **关闭**（标注参考信号） |

## 最终验证（V3_CORE = DONE 门禁）

- lint / tsc / build：PASS
- tests：4518 passed / 0 failed（main 串行全量，含 DTO 投影新增 2 测）
- 9 步 Core Smoke：自动化矩阵 PASS + 人工页面步骤文档化（validation.md §3，需访问密码执行）
- 3005：计划任务 registered/Ready 全程未触碰（验收服务由 start:local 提供）
- 公网部署：NO；force push：NO；DB 写：NO；样本入库：NO
- 人工验收就绪：任务详情 Evidence Workbench 7 区块渲染，商品概览 11 项真实证据（ASIN/价格/评分/评论/BSR/估算月销/月销额）经 playwright 实测出现

## 下一步（等待用户授权，三项之一）

1. **授权 push**：main（领先 origin 44+ 提交）→ origin/main
2. **授权「继续 V3.x」**：解除 V3X_AUTHORIZATION_REQUIRED，按 V3.1 Browser Evidence Spike → V3.2 → … → V3.6 推进
3. **授权「部署公网」**：仅当 V3_FINAL = DONE 后，按 28_PUBLIC_RELEASE.md 执行 Release R1
