# Phase 3F Reset-A2-1 Legacy Candidate 目标写入服务实现报告

## 1. 最终状态

`reset_a2_1_implementation_approved_for_commit`

## 2. 基线

| 项目 | 值 |
|------|-----|
| main HEAD | `6927a61aa73e691a9b811bd5794daf8a55174ebe` |
| main Tree | `0f3af91ff839f1332f456fccb6daf512e22daab9` |
| 分支 | `codex/phase3f-reset-a2-1-legacy-write-service` |
| worktree | `C:\wt\phase3f-reset-a2-1` |

## 3. 修改及新增文件

| 文件 | 状态 | 行 |
|------|------|-----|
| `lib/server/legacyCandidateWriteTypes.ts` | 新增 | 100 |
| `lib/server/legacyCandidateWrite.ts` | 新增 | 190 |
| `lib/server/legacyCandidateWrite.test.ts` | 新增 | 780 |
| `docs/PHASE_3F_RESET_A2_1_LEGACY_WRITE_SERVICE.md` | 新增 | 本文件 |

**生产代码修改：0**
**Schema / Migration / Task / package / lockfile：0 变化**

## 4. Identity 复用方式

直接导入并使用 `normalizeCandidateIdentity` from `@/lib/server/candidateSourceSave`（已导出）。

算法：`value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ")`

不复制、不重写、不修改函数体。77 个新测试通过该函数进行端到端验证，不自行实现 identity 算法。

## 5. Mutable Fingerprint V1

### 纳入字段（8 个）

```text
score, rawInput, link, source, keyword,
riskLevel, riskLabel, summaryLabel
```

### 排除字段

- `name`（展示名变化不触发 update，身份由 identity 决定）
- `sourceMetaJson`（含 capturedAt 等时间戳）
- `analysisJson`（含 generatedAt 等时间戳）
- `status`（权威字段，不由输入内容决定）
- `convertedTaskId`（权威字段）

### 实现

SHA-256 over `JSON.stringify([normalizedField1, normalizedField2, ...])`。

- 字符串 trim 后空串归一化为 `null`
- 确定性：同一输入永远产生同一指纹

## 6. 领域接口

### `LegacyCandidateWriteInput` = `CandidateSaveItem`（复用现有类型）

### `ExistingLegacyCandidate`

```ts
{ id, name, status, convertedTaskId, sourceIntegrity, mutableFingerprint }
```

### `LegacyCandidateWriteDecision`

```ts
| { kind: "create"; identityKey; input }
| { kind: "update"; candidateId; input }
| { kind: "unchanged"; candidateId }
```

### `LegacyCandidateWriteError`

错误码：`candidate_source_conflict` | `candidate_identity_ambiguous` | `candidate_legacy_overwrite_blocked` | `candidate_batch_invalid` | `candidate_write_backend_mismatch` | `candidate_write_backend_failure`

### `BoundLegacyCandidateWriteBackend`

```ts
{ loadByIdentityKeys, commitPlan }
```

不包含 `scopeId`、`demoAccessId`、Prisma、HTTP。

## 7. create 规则

同 Scope 不存在相同 identity → `create`。

## 8. update 规则

同 Scope 存在单条 legacy_unverified + pending + unlinked 记录，且 mutable fingerprint 不同 → `update`。

## 9. unchanged 规则

同 Scope 存在单条 legacy_unverified + pending + unlinked 记录，且 mutable fingerprint 相同 → `unchanged`。

展示名仅大小写/空白差异不触发 update（name 不在 fingerprint 中）。

仅非确定性字段（sourceMetaJson 的 capturedAt、analysisJson 的 generatedAt）变化不触发 update。

## 10. overwrite blocked 规则

阻止覆盖：signed、linked、非 pending（worth_analyzing / analyzed / paused / rejected）、unknown integrity。

错误码：`candidate_legacy_overwrite_blocked`

整批 fail-closed。

## 11. ambiguous 规则

多条已有记录同 identity → `candidate_identity_ambiguous`。

整批 fail-closed。不自动挑选、不合并、不更新首条、不继续追加。

## 12. 错误优先级

1. 输入无效 / 空批 / 批内重复 → `candidate_source_conflict` / `candidate_batch_invalid`
2. 身份歧义（多条记录）→ `candidate_identity_ambiguous`
3. 禁止覆盖 → `candidate_legacy_overwrite_blocked`

## 13. 批次内重复规则

Fail-closed（`candidate_source_conflict`）。不静默去重。

## 14. all-or-nothing 证明

### 规划错误前不调用 commit

77 个测试中所有冲突场景（signed、linked、非 pending、ambiguous、批内重复）均断言 `commitCalls.length === 0`。

### Backend 原子性是接口合同

Service 在规划完成后只调用 `commitPlan` 一次。Backend 负责原子提交。Service 通过结果数量/计数校验检测 Backend 违反合同。

### 部分失败检测

"backend returning wrong item count" 测试：Backend 返回 0 items → Service 抛出 `candidate_write_backend_mismatch`。

"backend returning mismatched counts" 测试：Backend 返回错误计数 → Service 抛出。

## 15. Backend 责任边界

- Service：纯业务逻辑 + 编排（规划 → 单次提交）
- Backend：存储原子性、ID 生成、时间戳、实际写入
- Service 不保证 Backend 原子性——在接口合同中声明要求

## 16. 新测试数量

**77 项**，覆盖：

- identity（8）
- fingerprint（12）
- create（4）
- update/unchanged（10）
- overwrite blocked（8）
- ambiguous（4）
- batch-internal duplicate（5）
- all-or-nothing（7）
- counting（4）
- safe interface（9）
- backend contract（2）

## 17. 现有 Characterization 不变

A2-0 5 文件 SHA-256：

```text
ba1f53cb...  route.write-characterization.test.ts
0d73a98b...  import-local/route.write-characterization.test.ts
1bd67134...  [id]/route.write-characterization.test.ts
fccf95fb...  candidateWriteIsolation.ts
5f36de4d...  PHASE_3F_RESET_A2_0_CANDIDATE_WRITE_CHARACTERIZATION.md
```

实现前后完全一致。120/120 Characterization 测试继续通过。

## 18. 全量工程验证

| 验证项 | 结果 |
|--------|------|
| 新 Legacy 写服务测试 | 77/77 |
| Characterization | 120/120 |
| 全量测试 | 140 文件，2165/2165，0 失败、0 retry、0 skip |
| TypeScript | 0 错误 |
| ESLint（新增文件） | 0 error，0 warning |
| Production Build | 通过 |
| 生产运行时 Diff | **0** |
| Schema/Migration/Task Diff | **0** |
| 新服务消费者 | 仅自身测试 |

## 19. 当前未接线

新服务 `legacyCandidateWrite.ts` 未被任何生产 Route、Service 或 Store 导入。

> 新服务尚未接线，生产运行时行为未变化；它是 A2-2 接线前的受控目标语义实现。

## 20. A2-2 接线所需

- 实现 `BoundLegacyCandidateWriteBackend` for Owner（Prisma）和 Visitor（Sandbox JSON）
- 修改 `POST /api/opportunity-candidates` Route 接入新服务
- 修改 `POST /api/opportunity-candidates/import-local` Route 接入新服务
- 退役 Visitor name PATCH（`candidate_field_not_editable`）
- 统一 score/link 语义

## 21. 未实现（明确排除）

- 未解决 Visitor JSON lost-update
- 未实现数据库唯一约束
- 未开始 Scope 写入
- 未修改 Schema / Migration
- 未修改 Task 或 Candidate→Task
- 未部署

## 22. 是否允许形成本地 Commit

**是。** 3 个新增文件（类型、实现、测试）通过了独立工程验证和 Characterization 兼容性检查。允许后续单独授权形成一个仅包含 A2-1 文件的本地 Commit。
