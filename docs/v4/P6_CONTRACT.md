# P6 Public Replay — 冻结契约（Wave 0）

- executionBatch：V4-FINAL-R2-P6-20260821-2340；authorityChecksum：`848bc4f0…`
- baseCommit：`6fff742`（P5 PASS 后 main）
- **部署边界（Lead 裁定）**：本 Phase 全链本地实施（导出/脱敏/hash/审批/Replay UI/无痕浏览器 E2E 走 127.0.0.1）；真实公网部署步骤仅当用户显式授权后执行，本报告将部署标记为待授权项。

## 0. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | ReplayBundle v1：{bundleId, schemaVersion, sourceRunId, exportedAt, capturedAt, mode: "replay", allowlistVersion, manifest: {files: [{path, sha256}], bundleSha256}, redactionReport, data} —— 逐文件 hash + bundle hash；主版本不支持→安全拒绝 | P6 卡 |
| D2 | 仅 completed 或明确选择 revision 的 run 可导出；字段 allowlist（证据字段/报告/事件/决策；不含成本明细/密钥/PII/本地路径） | P6 卡 |
| D3 | 脱敏扫描：secret/PII/联系人/Owner 私密成本/本地路径/EXIF/未授权整页图片 → 清理或阻断；redactionReport 记录每项处理；扫描失败不可发布 | P6 卡 |
| D4 | Owner 审批：导出→预览（redactionReport+hash）→Owner 确认→bundle 落盘（data/replay-bundles/）→仅可读 | P6 卡 |
| D5 | Visitor Replay：读母 bundle 不可变；Visitor 的 Gate 选择/备注/新草稿存独立 sandbox（复用 demo sandbox 语义）；无 Browser/Owner API 权限 | P6 卡 |
| D6 | UI 明确「真实脱敏历史案例回放」+ capturedAt/时效；暂停/快进/点击 Evidence；不伪造网络/进度 | P6 卡 |
| D7 | 越权矩阵：Owner→Visitor、Visitor A→B、Visitor→母案例 均 fail-closed | P6 卡 |

## 1. 文件所有权
| Owner | 路径 |
|---|---|
| Lead | docs/v4/P6_*、lib/v4/replay/schema.ts（bundle 契约+allowlist+hash）、app/api/v4/replay/**（导出/审批/访问）、graph/run 导出接线、Owner 审批 API、E2E |
| A（worktree codex/v4-p6-replay） | lib/v4/replay/exporter.ts（bundle 生成+脱敏扫描+redactionReport+hash）+ exporter.test.ts + fixtures |
| B（worktree codex/v4-p6-ui） | app/replay/**（Guided Demo 页）+ components/v4/ReplayView.tsx（暂停/快进/Evidence 点击）+ 测试 |
| C（只读） | 泄漏/篡改/越权 cases 评审 |

## 2. 必测（Gate）
1. secret/PII/路径/EXIF/未授权内容 fixture 阻断或清理；2. Owner→Visitor、Visitor A→B、Visitor→母案例越权均失败；3. bundle 篡改→hash 校验失败；4. schema 主版本不支持→安全拒绝；5. 无痕浏览器 Guided Demo/Gate/Evidence/Content Guard/刷新；6. 公网页面网络记录无 Browser/Owner API。
