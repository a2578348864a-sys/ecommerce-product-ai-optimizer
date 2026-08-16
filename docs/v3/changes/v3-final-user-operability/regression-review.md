# V3 Final User Operability Correction — 回归审查

> 基线：main 737b6bf（审计）→ 功能分支 8 commits → main a366555（已 ff 集成并 push）。

## 验证矩阵（全部实际运行）

| 项 | 命令 | 结果 |
|---|---|---|
| 全量回归 | `npm test`（功能树） | 419 文件 / 4810 测试 PASS；3 失败均为环境类（见下） |
| tsc | `npx tsc --noEmit` | PASS（0 错误） |
| lint（改动文件） | `npx eslint …` | 0 errors（既有 warnings 除外） |
| 生产 build | `npm run build`（功能树 + 集成树两次） | PASS |
| 表达式 invariant | production-bundle.invariant（3 用例） | PASS（detail-page 15 helpers / review-snippet 工件 / search-page；全 chunk 扫描） |
| 真实浏览器 Amazon | RUN_V33_BROWSER_SMOKE | PASS（3 ASIN 实体绑定+字段提取 correct；JPY fail-closed；mismatch 硬拒绝） |
| 真实浏览器 Amazon（生产 build UI） | playwright 走查 3005 | PASS（采集→Preview→确认→保存全链） |
| VOC 真实采集+分析 | playwright 走查 3005 | PASS（13 条采集→确认；批量 3 条；真实 AI 分析 16 条样本） |
| AI 证据总结真实 | playwright 走查 3005 | PASS（真实 AI + EvidenceRef 门禁通过） |

## 环境类失败归因（非回归）
1. `lib/server/native1688Bridge.integration.test.ts`：53318 端口被集成树正式 bridge 占用（集成树独占运行）→ 功能树无法并行；集成树环境可跑。
2. `lib/server/taskResultJsonMutation.sqlite.test.ts`：并行 EPERM（Windows 临时目录竞争）→ 单独重跑 PASS（4/4）。
3. `scripts/release-package.test.ts`：Windows tar 环境问题（上一任务已确认基线一致，非本任务引入）。

## 走查发现并修复的生产 bug（回归闭环）
- P1-E（BrowserEvidenceSection preview 崩溃）→ 修复 + 测试 +2 → 3005 复验保存成功。
- P1-F（AI 总结 409 不自动恢复）→ 修复 → 集成重部署。

## 兼容性
- detail-page-extract / extract-search-page 对外 API 不变（re-export），browserEvidenceCollect 调用方零改动。
- review-evidence route：GET 新增 taskAsin 字段（向后兼容）；POST 新增 collect/collect-confirm action（旧 action 不变）。
- ReviewImportInput 新增可选字段（sourceType/bindingKind/collectorVersion），旧导入路径默认值不变（manual_import/manual_confirmed）。
- /tasks scope 参数为可选（缺省 active），旧调用（demo 页/测试）不受影响。

## 结论
REGRESSION=PASS（环境类 3 项已归因，非代码回归）。
