# P6 TASK_REPORT — 公网 Replay（V4-FINAL-R2）

- 判定：**PASS（本地全链）**；真实公网部署=**待用户显式授权**（本 Phase 未部署）
- executionBatch：V4-FINAL-R2-P6-20260821-2340；authorityChecksum：`848bc4f0…`
- 报告时间：2026-08-21 16:14:07 +08:00；集成 HEAD：`e6583c2`（main，本地；未 push）
- 角色：Lead（契约/API/审批/门禁/E2E）；A（exporter/redaction/hash）；B（Replay UI）；C（泄漏/篡改/越权评审）

## 目标与达成
| 目标 | 达成 | 证据 |
|---|---|---|
| ReplayBundle v1（allowlist/redactionReport/逐文件+整体 hash/schema 主版本门禁） | ✅ | schema.ts（P6-C 修复：主版本解析、内容复算 hash、fail-closed 结构校验）+ schema.test.ts |
| 仅 completed run 导出 | ✅ | replay 路由 run.status !== completed → 409 |
| 脱敏扫描（secret/PII/联系人/成本/路径/EXIF/未授权）→ redactionReport；扫描失败不可发布 | ✅ | exporter.ts（15 测试；leakCases fixtures）；approve 前 scanOk 门禁（409 redaction_scan_failed） |
| Owner 审批 + bundle 落盘只读 | ✅ | POST approve → data/replay-bundles/*.json |
| Visitor 只读母案例 + hash 防篡改 | ✅ | GET /api/v4/replay/[bundleId]：verifyBundleHash 内容复算；篡改→**409 bundle_tampered**（E2E 实证） |
| UI 明确「真实脱敏历史案例回放」+ capturedAt/时效 | ✅ | app/replay/* + ReplayView/ReplayTimeline（20 测试） |
| 暂停/快进/Evidence 点击；不伪造进度 | ✅ | ReplayTimeline 本地播放；无进度百分比 |
| 越权矩阵 fail-closed | ✅ | V4 API 沿用 owner/demo scopeMatches；replay 为静态只读（无 Browser/Owner API）；P6-C Z1-Z8 案例 |

## 文件
A：lib/v4/replay/exporter.ts + exporter.test.ts（15）+ leakCases fixtures；B：app/replay/* + components/v4/ReplayView/ReplayTimeline + 测试（20）；Lead：schema.ts（P6-C 修复）+ schema.test.ts、replay export/approve/list/get API、content-hash 校验、P6_CONTRACT。

## 命令与结果
| 命令 | 结果 |
|---|---|
| npx tsc --noEmit | exit 0 |
| npx vitest run lib/v4 app/v4 components/v4 app/api/v4 | 44 files / 419 passed |
| npm test 全量 | 5767 passed / 1 failed（B1 基线）/ 78 skipped（store-consistency 隔离重跑通过=负载 flake） |
| 浏览器 E2E | 导出→审批→列表→读取→篡改 409→Replay UI（P6_E2E_EVIDENCE.md） |

## 边界与授权
- 公网无 Browser/Owner API/Cookie/文件权限（bundle 静态只读）。
- **未执行真实公网部署**（用户规则：未经授权不部署）；部署步骤列为待授权项，本地 3005 已验证全部流程。

## 风险/下一步
- B1 基线待用户裁定。
- 公网部署授权后：vercel 部署 + 公网无痕 E2E + 网络记录核对。
- P6 PASS（本地）→ 按授权进入 **P7（发布验收）**。
