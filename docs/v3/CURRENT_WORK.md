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
- main HEAD: （最终验证提交后填写）
- origin/main: 76e2c96（main 领先，**push 等待用户明确授权**）
- main clean: 是

## 最终报告

`docs/v3/V3_CORE_FINAL_REPORT.md`（24_FINAL_REPORT_TEMPLATE 填写）

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
- tests：4516 passed / 0 failed（main 串行全量）
- 9 步 Core Smoke：自动化矩阵 PASS + 人工页面步骤文档化（validation.md §3，需访问密码执行）
- 3005：计划任务 registered/Ready 全程未触碰
- 公网部署：NO；force push：NO；DB 写：NO；样本入库：NO

## 下一步（等待用户授权，三项之一）

1. **授权 push**：main（领先 origin 44+ 提交）→ origin/main
2. **授权「继续 V3.x」**：解除 V3X_AUTHORIZATION_REQUIRED，按 V3.1 Browser Evidence Spike → V3.2 → … → V3.6 推进
3. **授权「部署公网」**：仅当 V3_FINAL = DONE 后，按 28_PUBLIC_RELEASE.md 执行 Release R1
