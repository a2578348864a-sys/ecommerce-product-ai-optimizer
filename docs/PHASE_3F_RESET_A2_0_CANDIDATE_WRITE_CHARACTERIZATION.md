# Phase 3F Reset-A2-0 Candidate 写入 Characterization 报告

## 1. 状态与范围

- 最终状态：**`reset_a2_0_characterization_approved`**
- 候选状态：`UNCOMMITTED / CHARACTERIZATION_APPROVED`
- 独立复核日期：2026-07-25（Claude 执行）
- Production baseline Commit：`75ca625f8077758a96fd027cf8e250f1c8778d49`
- Production baseline Tree：`8b72dcb7bff314ec1204114308021d29f7d8391c`
- 事实来源：上述 main 的 Route、Service、Sandbox、Prisma Schema、调用关系及本报告列出的隔离测试
- 本轮范围：Candidate signed save、legacy save、import-local、PATCH、DELETE 当前行为与目标差异
- 排除范围：真实 SQLite、真实 Visitor Sandbox、真实认证数据、Provider、AI、Schema、Migration、Task 写入、生产修复
- Git 策略：本轮保持未提交候选，不 Commit、不 Push、不合并、不部署

本报告严格区分：

- **当前合同**：baseline 实现及测试实际证明的行为；
- **已批准目标**：后续 A2 写入 Scope 化应实现的业务语义；
- **未知**：本轮没有足够证据证明的并发或跨模块行为。

目标规则没有被写进当前行为断言；测试冻结的是 baseline 的真实差异。

## 2. A0/A1 读取骨架复核

A0 已在 baseline main：

```text
AccessContext
→ ScopeSubject
→ ScopedOpportunityStore
→ Legacy Scoped Adapter
→ legacyCandidateRead
```

当前接入范围仍只有：

- `GET /api/opportunity-candidates`；
- Agent authoritative Candidate 读取；
- `candidateAuthority` 兼容入口委托同一个 Legacy 读取实现。

以下写入仍直接走旧实现，未接入 Scope-bound 写 Store：

- `POST /api/opportunity-candidates`；
- `POST /api/opportunity-candidates/import-local`；
- `PATCH /api/opportunity-candidates/[id]`；
- `DELETE /api/opportunity-candidates/[id]`。

Task、Candidate→Task、Prisma Schema 和 Migration 相对 A0 前基线未由本轮改变。

## 3. 零真实写入隔离

### Owner

- 使用真实 `PrismaClient`；
- 通过显式临时 SQLite datasource URL 绑定系统临时目录；
- 只建立本测试所需的 `OpportunityCandidate` 临时表；
- 每项测试前清空；
- 不读取 `DATABASE_URL` 或 `.env*`；
- 不接触正式 `prisma/dev.db`。

### Visitor

- `DEMO_SANDBOX_STORE_PATH` 只指向系统临时目录；
- 实际调用 production `demoSandbox` 读写函数；
- 不读取或复制 `data/demo-sandbox.json`；
- 每项测试前重建空 Sandbox。

### 请求、身份与外部调用

- Route 通过内存 `Request` 调用，不启动 HTTP 服务；
- 使用固定假 Owner/Visitor 上下文；
- AccessContext 只从测试请求头解析，忽略 body 中的 `scopeId`、`demoAccessId` 和 `subject`；
- `demoGuard` 的 `requireAuthenticated` / `requireOwnerOnly` 仍是生产实现；
- 测试调用链的全局 `fetch` 及 Node `http`、`https`、`http2`、`net`、`tls`、`dgram` 建连入口均被 fail-closed 拦截；
- CommonJS 替换后调用 `syncBuiltinESMExports`，并用门禁安装前捕获的 ESM `http.request` live binding 自检同步结果；`net.Socket.prototype.connect` 也被拦截；
- 门禁安装中途失败会回滚已替换入口，恢复阶段逐项尝试并汇总错误；静态扫描确认被测 Route 调用链没有独立 `undici` 或其他网络客户端入口；
- 没有 Provider、AI、真实认证、真实 Candidate 或真实 Task。

### 清理

- 每项测试检查 `.tmp` 和 `.backup` 残留为 0；
- 套件结束在 `finally` 中恢复原 `DEMO_SANDBOX_STORE_PATH`，即使 Prisma 断连失败也继续尝试删除临时目录；
- 每项测试也在 `finally` 中恢复网络门禁、全局 stub 和时间 spy；
- 无后台进程和网络服务。

边界：该隔离证明 Route 与真实存储实现的当前合同，不证明真实认证 token 的密码学流程，也不等于生产数据库迁移测试。

## 4. Signed 保存矩阵

证据：`REQUEST_CONTRACT`，存储原子性补充 `SERVICE_CONTRACT`。

|场景|Owner 当前行为|Visitor 当前行为|
|-|-|-|
|合法单条|200；`created=1 updated=0 unchanged=0`；服务端派生 name/score；强制 `pending`、`convertedTaskId=null`|同 Owner；另有 `isSandbox=true`|
|合法多条|全部保存；items 与保存结果一致|单次 Sandbox 发布全部保存|
|空批|400 `invalid_payload`|同 Owner|
|21 条|当前无 POST Route 数量上限，21 条成功|当前无 POST Route 数量上限，21 条成功|
|缺 sourceEvidence / ruleAssessment / sourceProof|409 `candidate_batch_invalid`；0 写入|同 Owner|
|Proof 过期、主体错误、跨 Visitor|409 `source_proof_invalid`；0 写入|同 Owner|
|Evidence 或 Assessment 被篡改|409 `source_proof_invalid`；0 写入|同 Owner|
|伪造 name/status/score/convertedTaskId|不信任；采用 Evidence/Assessment 派生值|同 Owner|
|同批同 identity 同 Hash|preflight 去重成 1 条；首次为 `created=1`|同 Owner|
|同批同 identity 不同 Hash|409 `candidate_source_conflict`；0 写入|同 Owner|
|已有同 identity 同 signed Hash|200；`unchanged=1`，不更新 ID/时间|同 Owner，且不重写 Sandbox 文件|
|已有同 identity 不同 signed Hash|409 `candidate_source_conflict`|同 Owner|
|已有 legacy|409 `candidate_source_conflict`|同 Owner|
|已有多个同 identity|409 `candidate_source_conflict`|同 Owner|
|混合批一条冲突|全批不写入|全批不写入|
|Owner 第二次 INSERT 被 SQLite Trigger 强制失败|500 `server_error`；真实 Prisma 事务回滚第一次 INSERT，最终 0 写入|不适用|

响应成功时均返回 `sourceMode=signed_source_v2`。Owner 的保存位于 Prisma transaction；Visitor 在验证全部 decision 后进行一次 Sandbox 保存。测试直接核对最终 Candidate 数量、字段、Evidence 完整性投影和冲突后的存储状态。

## 5. Legacy Owner 矩阵

证据：`REQUEST_CONTRACT + SERVICE_CONTRACT`。

|场景|当前 Owner 合同|
|-|-|
|首次保存|200；`created=1 updated=0`|
|完全相同 identity|更新原记录；`created=0 updated=1`；无 `unchanged`|
|字段变化|更新原记录和允许字段|
|已有 signed|409 `candidate_source_conflict`|
|已关联 Task|409 `candidate_source_conflict`|
|analyzed 但未关联|仍覆盖并重置为 `pending`|
|paused / rejected / worth_analyzing|仍覆盖并重置为 `pending`|
|批内重复 identity|409；全批不写入|
|混合批一项冲突|全批不写入|
|空批|400 `invalid_payload`|
|伪造 sourceMetaJson / analysisJson|丢弃并重建 `legacy_unverified`|
|伪造 status / convertedTaskId|强制 `pending` / `null`|
|已有多个 legacy identity|409 `candidate_source_conflict`|

## 6. Legacy Visitor 矩阵

证据：`REQUEST_CONTRACT + AUTHORIZATION_BEHAVIOR + SERVICE_CONTRACT`。

|场景|当前 Visitor 合同|
|-|-|
|首次保存|200；`created=1 updated=0`|
|完全相同 identity|不更新旧记录，继续追加；再次 `created=1`|
|字段变化|继续追加新记录|
|已有 signed|409 `candidate_source_conflict`|
|已关联 Task|409 `candidate_source_conflict`|
|analyzed / paused / rejected / worth_analyzing 且未关联|不阻止，继续追加一个 `pending` 记录|
|批内重复 identity|409；全批不写入|
|混合批一项冲突|全批不写入|
|空批|400 `invalid_payload`|
|伪造 sourceMetaJson / analysisJson|丢弃并重建 `legacy_unverified`|
|伪造 status / convertedTaskId|强制 `pending` / `null`|
|已有多个 legacy identity|继续追加第三条；当前不报 ambiguous|

这组行为只是历史合同证据，不代表已批准保留 Visitor 重复追加。

## 7. Import-local 矩阵

证据：`REQUEST_CONTRACT + AUTHORIZATION_BEHAVIOR`。

|场景|Owner 当前行为|Visitor 当前行为|
|-|-|-|
|合法导入|200；进入 legacy save|200；进入当前 Visitor Sandbox|
|0 条|400 `invalid_payload`|同 Owner|
|20 条|成功|成功|
|21 条|当前成功，无 Owner 数量上限|400 `import_limit_exceeded`，0 写入|
|同批重复 identity|409 `candidate_source_conflict`，0 写入|同 Owner|
|命中现有 legacy|更新原记录；`imported=1 skipped=0`|追加新记录；`imported=1 skipped=0`|
|命中 signed|409 `candidate_source_conflict`|同 Owner|
|local 草稿 ID|丢弃，服务端生成 ID|同 Owner|
|伪造 status / convertedTaskId|强制 `pending` / `null`|同 Owner|
|伪造 sourceMeta / analysis|丢弃并重建 legacy 元数据|同 Owner|
|伪造 scopeId / demoAccessId / subject|不参与 Owner 身份|不能改变目标 Visitor|
|部分无效项|400 `invalid_payload`，全批 0 写入|同 Owner|
|全部无效项|400 `invalid_payload`，全批 0 写入|同 Owner|

当前计数：

- Owner：`imported = created + updated`；
- Visitor：`imported = created`；
- 两者当前固定 `skipped=0`；
- 当前没有 `unchanged` 映射。

## 8. PATCH 字段矩阵

证据：`REQUEST_CONTRACT + AUTHORIZATION_BEHAVIOR`。

|字段/场景|Owner 当前行为|Visitor 当前行为|
|-|-|-|
|合法 status|更新；进入 ready 状态时要求严格 `sourceReviewAcknowledged=true`|同 Owner|
|非法 status|400 `invalid_payload`|200，静默忽略并返回未变 Candidate|
|score 超界|四舍五入并 clamp 到 0..100|原值写入，不 clamp、不取整|
|score 小数|四舍五入|原小数写入|
|NaN/Infinity 经 JSON|成为 `null` 后静默忽略|同 Owner|
|link 空白字符串|归一化为 `null`|保留空白字符串|
|link null|写入 `null`|写入 `null`|
|keyword|更新并 trim|静默忽略|
|name|静默忽略|允许修改|
|name 改成已有 identity|不会执行 name 更新|允许产生重复 identity|
|risk / summary|静默忽略|静默忽略|
|sourceMeta / analysis|legacy 静默忽略；signed 返回 409|legacy 静默忽略；signed 返回 409|
|convertedTaskId 设置或清空|409 `candidate_task_link_locked`|同 Owner|
|signed 来源字段|409 `verified_source_fields_locked`|同 Owner|
|已关联 Task 的 Candidate|仍允许普通 status 修改，relation 保持|同 Owner|
|不存在|404 `not_found`|404 `not_found`|
|Owner 访问 Sandbox ID|404 `not_found`|不适用|
|Visitor 访问官方 ID|不适用|403 `demo_action_forbidden`|
|Visitor A 访问 Visitor B|不适用|404 `not_found`|

本轮没有实现 `candidate_identity_conflict`、`candidate_field_not_editable` 或 identityKey。

## 9. DELETE 矩阵

证据：`REQUEST_CONTRACT + AUTHORIZATION_BEHAVIOR`。

|场景|Owner 当前行为|Visitor 当前行为|
|-|-|-|
|未关联删除|200 `{ ok:true, data:{id} }`；记录消失|同 Owner；只删除当前 Visitor 记录|
|已关联 Task|409 `candidate_has_linked_task`；记录保留|同 Owner|
|不存在|404 `not_found`|同 Owner|
|Owner 访问 Sandbox ID|404 `not_found`|不适用|
|Visitor 访问官方 ID|不适用|403 `demo_action_forbidden`|
|Visitor A 访问 Visitor B|不适用|404；Visitor B 记录保留|
|存储失败|数据库错误被映射为通用 500 `server_error`|损坏 Sandbox 的 `DEMO_SANDBOX_STORE_INVALID` 当前会逃出 Route，Route 本身没有结构化 HTTP 响应|
|删除后池状态|目标记录为 0，其他 Owner 记录不受影响|目标 Visitor 记录为 0，其他 Visitor 分区不受影响|

### DELETE 与 Candidate→Task 并发

本轮没有安全建立真实 Route 级并发：

- Owner delete 使用 `deleteMany({ id, convertedTaskId: null })`；
- Owner Candidate→Task 使用事务，并在创建 Task 后执行条件 `updateMany`；
- Visitor delete 与 Candidate→Task 都是 JSON read-modify-write，baseline 没有跨进程事务。

现有 mocked transaction 测试和源码结构不能冒充真实并发。因此：

|对象|结论|
|-|-|
|Owner 真实并发胜负与最终 Task/Candidate 状态|`UNKNOWN`|
|Visitor 真实并发胜负与最终 Task/Candidate 状态|`UNKNOWN`，且已知 JSON 存储没有跨进程事务保证|

后续 SQLite 事务阶段必须单独建立真实并发证据。本报告不把顺序测试或源码扫描写成并发结论。

## 10. Owner / Visitor 当前差异

1. legacy 重复：Owner 更新，Visitor 追加；
2. 多个 legacy identity：Owner fail-closed，Visitor 继续追加；
3. 非 pending legacy：Owner覆盖并重置，Visitor保留旧记录并追加 pending；
4. PATCH 无效 status：Owner 400，Visitor 200 静默忽略；
5. PATCH score：Owner clamp/round，Visitor原值；
6. PATCH name：Owner忽略，Visitor允许并可制造重复；
7. PATCH keyword：Owner更新，Visitor忽略；
8. 空白 link：Owner归一化为 null，Visitor保留空白；
9. DELETE 存储失败：Owner返回结构化500，Visitor损坏文件异常逃出 Route；
10. import-local 上限：Visitor 20，Owner 当前无相同上限。

## 11. 已批准目标合同

`legacy_duplicate_semantics_decision_required=false`。

同 Scope、同 identity：

|场景|已批准目标|
|-|-|
|signed + 同 Hash|`unchanged`|
|signed + 不同 Hash|`candidate_source_conflict`|
|legacy 命中 signed|`candidate_legacy_overwrite_blocked`|
|legacy 命中已关联 Task|`candidate_legacy_overwrite_blocked`|
|legacy 命中非 pending|`candidate_legacy_overwrite_blocked`|
|legacy 命中 unverified + pending + unlinked，字段不同|`updated`|
|同上，字段相同|`unchanged`|
|不存在|`created`|
|已有多个同 identity|`candidate_identity_ambiguous`|

其他已批准目标：

- 退役 Visitor name PATCH，返回 400 `candidate_field_not_editable`；
- 普通 POST 输出 `created / updated / unchanged`；
- import-local 输出 `imported = created + updated`、`skipped = unchanged`；
- 所有 Candidate 批量写 all-or-nothing。

未在上述批准清单中的 PATCH score、无效 status、空白 link 和 DELETE 竞态不能自行推导新目标。

## 12. 当前与目标差异账本

|场景|当前 Owner|当前 Visitor|已批准目标|后续阶段|分类|
|-|-|-|-|-|-|
|legacy 首次保存|created|created|created|A2 Legacy 写服务|`no_change`|
|legacy 完全相同重复|updated|再次 created|unchanged|A2 Legacy 写服务|`intentional_behavior_change`|
|legacy 字段变化|updated|再次 created|updated|A2 Legacy 写服务|Visitor `intentional_behavior_change`|
|signed 不同 Hash|generic source conflict|同 Owner|candidate_source_conflict|A2 Store error mapping|`no_change`|
|legacy 命中 signed|generic source conflict|同 Owner|legacy overwrite blocked|A2 Store error mapping|`intentional_behavior_change`|
|已分析记录|覆盖并重置 pending|追加 pending|legacy overwrite blocked|A2 Legacy 写服务|`intentional_behavior_change`|
|已关联 Task|generic source conflict|同 Owner|legacy overwrite blocked|A2 Store error mapping|`intentional_behavior_change`|
|多个 legacy identity|generic source conflict|继续追加|identity ambiguous|A2 Legacy 写服务|`intentional_behavior_change`|
|import-local 重复|updated，imported=1|追加，imported=1|按统一 legacy decision|A2 import adapter|`intentional_behavior_change`|
|PATCH name|静默忽略|允许并可重复|Visitor 400 field not editable|A2 PATCH adapter|Visitor `intentional_behavior_change`|
|PATCH 无效 status|400|200 静默忽略|未批准新目标|另行决策|`still_unknown`|
|PATCH score|clamp/round|原值|未批准新目标|另行决策|`still_unknown`|
|DELETE 并发关联|真实并发未证明|真实并发未证明|必须由未来同 Scope 事务证明|SQLite transaction阶段|`still_unknown`|
|created/updated/unchanged|legacy无 unchanged|legacy无 updated/unchanged|三计数统一|A2 Store result|`intentional_behavior_change`|
|imported/skipped|skipped 恒0|skipped 恒0|skipped=unchanged|A2 import adapter|`intentional_behavior_change`|

## 13. 调用者与旁路扫描

### 生产写入入口

|能力|Route|底层实现|
|-|-|-|
|signed POST|`app/api/opportunity-candidates/route.ts`|`saveSignedCandidates` / `saveSignedSandboxCandidates`|
|legacy POST|同上|`saveLegacyCandidates` / `saveLegacySandboxCandidates`|
|import-local|`app/api/opportunity-candidates/import-local/route.ts`|同一 legacy save|
|PATCH|`app/api/opportunity-candidates/[id]/route.ts`|`updateCandidate` / `updateSandboxCandidate`|
|DELETE|同上|`deleteCandidate` / `deleteSandboxCandidate`|

### 规则位置

- signed identity / preflight：`lib/server/candidateSourceSave.ts`
- signed 与 legacy Owner duplicate：`lib/server/opportunityCandidateService.ts`
- signed 与 legacy Visitor duplicate：`lib/server/demoSandbox.ts`
- import-local sanitization：`app/api/opportunity-candidates/import-local/route.ts`
- PATCH 字段白名单：`app/api/opportunity-candidates/[id]/route.ts`
- DELETE 关联保护：该 Route 与两个存储实现

### 当前无生产调用旧函数

|函数|生产调用结论|
|-|-|
|`upsertCandidates`|只被 `importLocalCandidates` 调用；没有 Route/生产入口|
|`importLocalCandidates`|无生产调用|
|`createSandboxCandidate`|无生产调用|
|`importSandboxCandidates`|无生产调用|

这些函数不能作为后续 A2 接线捷径，尤其 `upsertCandidates` 使用不同的旧 identity 规则。

## 14. 测试与证据分类

新增候选：

|文件|证据|范围|
|-|-|-|
|`app/api/opportunity-candidates/route.write-characterization.test.ts`|`REQUEST_CONTRACT + AUTHORIZATION_BEHAVIOR`|signed、legacy、批量、重复、计数、存储状态|
|`app/api/opportunity-candidates/import-local/route.write-characterization.test.ts`|`REQUEST_CONTRACT + AUTHORIZATION_BEHAVIOR`|0/20/21、清洗、重复、Scope伪造、计数|
|`app/api/opportunity-candidates/[id]/route.write-characterization.test.ts`|`REQUEST_CONTRACT + AUTHORIZATION_BEHAVIOR`|PATCH字段矩阵、DELETE、存储失败|
|`tests/helpers/candidateWriteIsolation.ts`|测试基础设施|临时Prisma、临时Sandbox、清理门禁|

当前三套 Characterization 共 `120/120` 项；其中 signed 成功路径直接核对持久化后的完整 `evidenceHash`、`sourceEvidence`、`assessmentHash` 与 `ruleAssessment`，失败路径逐项冻结准确错误码。import-local 的部分/全部无效批次同时覆盖 Owner 与 Visitor；DELETE 成功路径同时证明同 Scope 和跨 Visitor 的非目标记录保留。

补充证据：

- 既有 Service 测试：`SERVICE_CONTRACT`；
- 调用者、无生产调用函数、事务形状：`STRUCTURAL`；
- 本轮没有 `MOUNTED_BEHAVIOR`；
- DELETE 真并发没有 `TIMING_BEHAVIOR`，保持 `UNKNOWN`。

禁止解释：

- 内存 Route 调用不是外部网络 E2E；
- 假 AccessContext 不证明真实 token 密码学；
- 源码扫描不证明并发；
- 当前 Visitor 缺陷不是目标合同。

## 15. 风险与问题分级

### 当前生产实现观察

- P0：0
- P1：Visitor JSON read-modify-write 没有跨进程事务，DELETE 与 Candidate→Task 并发仍未知；这是既有 Reset 风险，本轮不修复。
- P2：Visitor DELETE 遇到损坏 Sandbox 时异常逃出 Route，缺少 Route 自身结构化错误响应。
- P3：Owner/Visitor PATCH 的静默忽略、score 和空白 link 语义不一致，若后续统一 Store 未显式冻结，容易发生隐式合同漂移。

这些是 baseline 风险，不是授权修改项。

### 本轮候选质量门禁

初次独立复核发现的证据与清理问题已在测试范围内修正：

- P0=0；
- P1=0；
- 阻断 P2=0；
- 生产代码 Diff=0；
- 隔离成立。

修正后实际验证：

- 三套定向 Characterization：`120/120`；
- 完整单线程测试：`139` 个文件、`2088/2088`，0 失败、0 retry、0 skip；
- TypeScript：通过；
- 完整 ESLint：0 error、7 个 baseline 既有 warning、0 新增 warning；
- Production Build：通过；
- `git diff --check`、授权路径、package/lockfile、Prisma、Task、生产代码与敏感信息扫描：通过。

## 16. 独立对抗式复核（2026-07-25 Claude 执行）

### 复核范围

对三套 Characterization 测试、隔离基础设施、报告和差异账本执行独立只读复核。

### 复核结果

#### P0：0

无 P0 问题。

#### P1：0

无 P1 问题。

#### P2：0（阻断级为 0）

无阻断级 P2 问题。

#### P3（记录级）

- **P3-1**：报告已记录的 Owner/Visitor PATCH score、无效 status、空白 link 语义不一致 — 报告明确标记为 `still_unknown`，不冒充目标合同。
- **P3-2**：报告已记录的 Visitor DELETE 存储损坏时异常逃出 Route — 报告明确标记为 baseline 风险，未授权修改。
- **P3-3**：报告已记录的 DELETE 并发边界 `UNKNOWN` — 报告明确声明无真实并发证据，未编造。

### 逐项复核结论

| 检查项 | 结论 | 依据 |
|--------|------|------|
| 测试冻结当前实现（非目标规则） | 通过 | 所有断言核对 Route 当前实际响应；目标规则仅在报告描述，不进入测试断言 |
| Owner/Visitor 差异直接证据 | 通过 | 每项差异有配对测试：legacy 重复、PATCH score/name/keyword/link、import-local 上限等 |
| signed 全批原子性证明 | 通过 | SQLite trigger 强制第二 insert 失败 → 验证第一 insert 也回滚，0 残留 |
| Visitor 追加重复证明 | 通过 | legacy 重复 POST → `created=1`，2 条记录，不同 ID |
| PATCH 字段矩阵完整性 | 通过 | status、score（5 边界）、link（2 空白/null）、keyword、name、ignored fields、signed protection、convertedTaskId lock、sourceReviewAcknowledged、404/403 |
| import-local 20/21 真实覆盖 | 通过 | Visitor 20 → 200、Visitor 21 → 400 `import_limit_exceeded`、Owner 21 → 200 |
| Scope 伪造测试有效性 | 通过 | body `demoAccessId: "visitor-b"` 不改变 Visitor A 写入目标 |
| DELETE 竞态结论不夸大 | 通过 | 报告明确 `UNKNOWN`，附带真实并发无法建立的说明 |
| 测试隔离：无真实数据 | 通过 | 临时 SQLite + 临时 Sandbox + 假身份 + fail-closed 网络门禁 |
| 生产代码 Diff = 0 | 通过 | `git diff HEAD` 无输出；仅 5 个新文件 untracked |
| 差异账本准确性 | 通过 | 每行核对当前行为 vs 目标，分类正确（`no_change`/`intentional_behavior_change`/`still_unknown`） |
| 错误码/计数标记为未来变化 | 通过 | `candidate_identity_conflict`、`candidate_field_not_editable`、legacy `unchanged` 均标记为已批准目标，不混入当前合同 |
| 无 `.only` / `.skip` | 通过 | 全仓扫描 0 命中 |
| 无 sleep / retry | 通过 | 全仓扫描 0 命中 |
| 无真实路径/秘密引用 | 通过 | 仅 isolation helper 保存/恢复 `DEMO_SANDBOX_STORE_PATH` |

### 复核结论

**最终状态：`reset_a2_0_characterization_approved`**

通过条件全部满足：
- P0 = 0
- P1 = 0
- 阻断 P2 = 0
- 零真实写入隔离成立
- 生产代码 Diff = 0

## 17. 未修改边界

本候选不修改：

- Candidate Route 或 Service；
- `demoSandbox`；
- Scoped Store；
- Task 或 Candidate→Task；
- Prisma Schema / Migration；
- package / lockfile；
- Preview / Confirm；
- API 状态码、响应体或业务计数；
- 真实数据。

## 18. 完整验证证据（2026-07-25 重新执行）

| 验证项 | 结果 |
|--------|------|
| A2-0 Characterization 测试 | `120/120` 通过，0 失败 |
| 全量单线程测试 | `139` 文件，`2088/2088` 通过，0 失败、0 retry、0 skip |
| TypeScript (`tsc --noEmit`) | 通过，0 错误 |
| ESLint（测试文件） | 0 error，0 warning |
| ESLint（全量） | 0 error，7 个 baseline 既有 warning，0 新增 warning |
| Production Build (`next build`) | 通过 |
| `git diff --check` | 通过 |
| package/lockfile/Prisma/Task Diff | 0 |
| 全仓 `.only`/`.skip` 扫描 | 0 命中 |
| 全仓 sleep/retry 扫描 | 0 命中 |
| 全仓真实路径/秘密扫描 | 隔离通过 |
| 生产代码 Diff | `0` |
| staged | `0` |
| untracked | 5 个新文件 + `tsconfig.tsbuildinfo` |

## 19. 是否允许形成测试 Commit

本轮 Characterization 候选满足 `reset_a2_0_characterization_approved` 全部条件。允许后续另行授权形成一个仅包含测试文件与文档的 Commit。

禁止在本轮开始 A2 Legacy 写服务、Scope-bound 写 Store、SQLite 切换、Schema 迁移或任何生产代码修改。

## 20. 下一步唯一建议

本轮已完成 Candidate signed、legacy、import-local、PATCH 及 DELETE 当前行为的完整 Characterization。下一步唯一合法路径：在取得明确授权后，基于本报告差异账本进入 A2 Legacy 写服务实现阶段，将 Owner/Visitor 统一到已批准目标合同。
