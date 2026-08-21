# P0 契约（基线审计，回顾性登记）

> 本文件为阶段收口时补登的回顾性契约。P0 为纯审计阶段，执行期间以项目书第 14 节
> 与 `P0_BASELINE_AUDIT_REPORT.md` 为实际契约；此处按 P1–P6「契约 + E2E 证据 + 任务报告」
> 三件套约定补全形式（P7-C 审计 Issue #1 收口项）。

## 目标

对 v3.1.0 集成树（基线 commit `53880c8…`，V3.1 FROZEN）做全量基线审计：回归基线、
flag 采样、安全/权限/数据边界抽检、E2E 证据与恢复场景盘点，产出 V4 起点的可信基线。

## 范围

- 只读审计 + 定向测试；不修改业务语义、不引入 V4 功能。
- 审计项：lint / tsc / 全量测试基线；V3.1 flag-off 采样（`QX_V4_GRAPH_ENABLED` 关闭路径）；
  授权边界（owner / demo、fail-closed、sandbox 隔离）；P0 必测恢复场景清单。

## 出口标准（PASS 条件）

1. 基线测试结果可复现；唯一定期失败项（B1，handoff 配额基线）被登记且判定与 V4 无关。
2. 安全/权限不变量抽检通过（fail-closed、跨 sandbox 隔离、无敏感文件入库）。
3. 证据落盘：`P0_BASELINE_AUDIT_REPORT.md` + `P0_E2E_EVIDENCE.md`。

## 验收证据

- `docs/v4/P0_BASELINE_AUDIT_REPORT.md`
- `docs/v4/P0_E2E_EVIDENCE.md`

## 边界与遗留

- 不修复 B1（留待发布裁定，见 `KNOWN_LIMITATIONS.md`）。
- 不触碰 V3.1 FROZEN 语义；V4 全部能力经 `QX_V4_GRAPH_ENABLED` 特性开关隔离。
- P0 阶段不产生代码交付物（纯审计），故无 P0_TASK_REPORT.md 独立文件——审计结论
  即记录于 `P0_BASELINE_AUDIT_REPORT.md`。
