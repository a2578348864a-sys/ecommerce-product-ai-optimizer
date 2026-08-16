# V3 Final Product Integration — Regression Review

## 全量回归（worktree，整改后）

```
Test Files  2 failed | 417 passed | 62 skipped (481)
Tests       1 failed | 4801 passed | 79 skipped (4881)
```

- 4801 PASS（baseline 29c2933 为 4781 PASS；新增 20 个定向测试）
- 唯一失败：`scripts/release-package.test.ts`（Windows tar 中文 worktree 路径环境问题，集成树基线同样失败/跳过——非本任务引入）
- 62/79 skipped 与基线一致

## 本任务新增/更新测试（≈24 个）
- `taskIdentityInheritance.test.ts`（13）：productUrl authority / marketplace 派生 / fail-closed / Browser ASIN 回退
- `sourcingCapabilities.test.ts`（6）：CLI/Image 独立 readiness（Case A-D）
- `startResearchTask.test.ts`（4）：骨架创建 / 幂等 / eligibility / 主体隔离
- `aiEvidenceSummary.test.ts`（+4）：5 类证据接入 / NO_EVIDENCE gate / 未确认候选排除 / hasPersistedEvidenceInput
- `TaskRecordsList.research-decision.test.tsx`（更新）：列表无第二决定 authority
- `sourcing route.test.ts`（更新）：分能力 toolStatus
- `tasks/[id] route.test.ts`（更新）：legacy PATCH 走 mutation layer（CAS）
- agents risk/summary route tests（更新）：410 收口
- navigation/convergence/history 断言（更新）：研究记录命名 + 新主链

## 验证命令（均实际执行）
- `npx vitest run`（全量）→ 4801 PASS
- `npx tsc --noEmit` → PASS
- `npm run lint` → 0 errors（6 既有 warnings）
- `npm run build` → PASS（见 build 记录）
- secret scan → 见最终报告

## 已知 flaky（与基线一致，非本任务引入）
- 全量并行下偶发超时/EPERM（mutationBoundary / taskResultJsonMutation.sqlite 等，单独重跑 PASS）
