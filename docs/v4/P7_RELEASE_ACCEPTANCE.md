# P7 TASK_REPORT — 发布与最终验收（V4-FINAL-R2）

- 判定：**CONDITIONAL（本地面向发布验收通过；DONE 声明附条件）** —— 阻断项均为「用户裁定/授权」性质，无 V4 代码缺陷
- RC SHA：`1494e77a1b6e44f4f97cf5054338eadc284269a6`（本地 main；**未 push/tag/deploy**——按授权边界）
- 报告时间：2026-08-21 16:27:30 +08:00；集成 HEAD：`2d60366`
- 验证：A=自动化回归矩阵；B=安全/Eval/依赖审计；C=文档/演示/干净安装审计；Lead=全链浏览器 E2E + 裁定

## 验证矩阵（实测）
| 项 | 结果 |
|---|---|
| lint | exit 0（0 error / 8 warning，与 P0 基线一致） |
| typecheck（tsc --noEmit） | exit 0 |
| 全量测试（npm test） | 5769 passed / 1 failed（B1 基线）/ 78 skipped；V4 专项 44 files/419 全过；V3.1 抽样 517/517（flag off）无回归 |
| build | 各 Phase 多次成功（P6 最后一次 flagged build 成功；P7-A 因 3005 占用记录跳过） |
| 依赖审计 | 0 critical / 1 high（brace-expansion dev-only，audit fix 可修）；无敏感文件被跟踪 |
| 硬指标（14） | 5/5 有强制实现：wrong_entity=0、引用覆盖率=100%、SupplierClaim 自动晋级=0、跨 sandbox=0、Replay secret/PII/路径=0 |
| 浏览器旅程 | 全链 completed（run 84a4cefd，rev30）+ 恢复/取消/失败路径/Replay 防篡改（409）/flag rollback |

## 发布阻断核对
| 阻断项 | 状态 |
|---|---|
| B1 handoff quota 基线测试失败（v3.1.0 既有） | **待用户裁定**（A=route 防御 / B=修 mock）；P0 起公示 |
| B3 /api/opportunities legacy 410 | 待用户裁定 |
| B4 isDemoAccessExpired 语义 | 待用户裁定 |
| P6 公网部署 / push / tag / README G6 声明 | 待用户显式授权 |
| 17 其余项 | 各 Phase 门禁已过（P1 8/8、P2 6/6、P3 3/3、P4 6/6、P5 7/7、P6 本地 6/6） |

## 最小修复任务（用户裁定后）
1. B1：`image-handoff/route.ts:369` 加 null 防御（fail-closed）或更新测试 mock。
2. B3：为 /api/opportunities 增加 LEGACY 410 门禁（与 agents/* 一致）。
3. 授权后：push + tag + 部署 + README/CHANGELOG V4 声明 + 公网无痕 E2E + 网络记录核对。
4. 可选：npm audit fix（dev-only high）；research-report schema 接线（第 18 节追踪增强）；.env.example 补 public 说明。

## 最终交付（本报告）
- 完整测试矩阵：上表 + 各 Phase 报告。
- E2E 证据包：docs/v4/P*_E2E_EVIDENCE.md + tmp/v4-p1-evidence/（截图）+ .playwright-cli（快照）。
- 安全/隐私/依赖审计摘要：P7-B（5 硬指标、0 critical、无敏感文件）。
- 金标案例：THERMOS FUNTAINER（SellerSprite 导入，XLSX 采集日期 2026-08-14/15）；失败/冲突案例：candidateProfiles（数据不足/冲突明显）+ wrong-entity/injection fixtures。
- 演示脚本：DEMO_SCRIPTS.md（3/10 分钟）。
- 已知限制/Deferred：KNOWN_LIMITATIONS.md + RELEASE_NOTES_V4.md（Deferred V5 见 00 决策）。

## DONE 声明格式（17）
- 完成范围：V4 P0-P6 全部门禁 + P7 本地发布验收（RC SHA 1494e77，未发布）。
- 测试命令与结果：见验证矩阵。
- 真实浏览器旅程：全链 completed + 恢复/取消/失败/Replay 防篡改 + flag rollback（各 Phase E2E 证据）。
- 迁移/回滚：3 个 additive migration（V4ResearchRun/V4FactRecord/commercialJson/contentJson/reportJson 列）；回滚=删表/删列 + 删 .tmp/v4-graph；flag 关=V3.1 原样。
- 已知限制：见 KNOWN_LIMITATIONS.md。
- 未完成项：B1/B3/B4 用户裁定；push/tag/deploy/公网授权；README G6 声明。
