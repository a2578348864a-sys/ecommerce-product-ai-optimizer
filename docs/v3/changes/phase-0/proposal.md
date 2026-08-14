# Phase 0 提议 — 现状资产与迁移裁定

> 来源：轻选工作台 V3 多 Agent 最终执行包 v2.2 FINAL（`09_PHASE0_TASK.md`、`04_ASSET_MIGRATION_SPEC.md`、`00_MASTER_EXECUTION.md`）
> 状态：已完成（`PHASE_0 = PASS`，见 acceptance.md）
> 基线：main `76e2c962`（Phase 0 开始前 clean）

## 1. 目标

建立 V3 唯一权威现状地图：对当前仓库全部与 V3 主链相关的资产（页面 / Route / API / 状态 / score / 旧 workflow / Research / Keyword / Handoff / Studio / SellerSprite / AI gate / Skill）逐项确认「当前职责、调用方、状态语义、V3 角色、去留裁定」，为 Phase 1/2 提供明确边界，避免 V3 开发踩入旧链或重复建设。

## 2. 范围

- 只读盘点：不修改任何业务代码、不迁移数据、不启动本地服务、不触碰 3005 / prisma/dev.db / demo 数据文件。
- 文档产物：仅写入 `docs/v3/changes/phase-0/`（5 个文档，见 §4）。
- 明确不做：不进入 Phase 1，不写 Prisma，不改 package.json / AGENTS.md / 共享文件，不部署公网；Phase 0 文档 commit 属执行包预授权范围，push 等待用户明确授权。

## 3. 盘点方法（并行只读）

| 任务 | 内容 | 执行方式 |
|---|---|---|
| 0A | 页面 / Route / API 清单与调用关系 | 只读子 Agent + 主 Agent 交叉核对 |
| 0B | 状态 / score / 旧 workflow | 只读子 Agent + 主 Agent 交叉核对 |
| 0C | Research / Keyword / Handoff / Studio / SellerSprite / AI gate | 只读子 Agent + 主 Agent 交叉核对 |

所有结论必须带仓库内文件证据；不确定项标「未知」，不猜值（执行包第一性原则）。

## 4. 产出

`docs/v3/changes/phase-0/`：

- `proposal.md`（本文件）
- `audit.md`（现状资产地图，含资产表）
- `decisions.md`（资产去留裁定 / 状态映射 / score 裁定 / API-MCP 定位 / Phase 1-2 冲突范围）
- `acceptance.md`（Gate 六项自检 + 双重审查 + 规格对账 + 三视角终审 + PHASE_0 结论）
- `learnings.md`（5–10 条有证据的阶段学习）

## 5. 门禁（来自 09_PHASE0_TASK.md）

- 资产表完整
- 状态语义统一
- score 裁定
- 旧链去留
- API/MCP 定位
- Phase 1/2 冲突范围明确

全部通过后：`PHASE_0 = PASS`，立即停止，不进入 Phase 1。
