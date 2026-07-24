# Phase 3F Reset-A0 Scope 基础设施骨架实验

## 文档状态

- 状态：`EXPERIMENTAL / LOCAL / NOT_PRODUCTION`
- 基线 Commit：`c410300f46d97c2939dc5d1471ec3a933c9f32c7`
- 基线 Tree：`5d86e6ebe707647ba0b57d5b06e62fc2c8819390`
- 事实来源：该基线代码与本次隔离实验测试
- 不包含：生产 Prisma Schema、正式 Migration、真实数据库、真实 Visitor Sandbox 数据
- 本轮不创建 Commit、不 Push、不部署

## 1. 实验目标

本实验只验证一件事：在不改变 Owner/Visitor 现有存储和 API 行为的前提下，能否把“访问身份解析”和“Candidate 读取后端选择”收敛到一个服务端绑定的 Scoped Store 边界。

本轮试点仅覆盖：

1. `GET /api/opportunity-candidates` 的 Candidate 列表读取；
2. Agent Route 的权威 Candidate 读取。

`save-task` 继续使用 `candidateAuthority` 兼容入口；该入口与 Scoped Store 委托同一个 Legacy Candidate读取实现。Task 读写、Candidate 写入、更新、删除、import-local、Candidate→Task 转换均未迁移。

## 2. AccessContext → ScopeSubject

`ScopeSubject` 是服务端内部身份，不是数据库 `scopeId`：

```ts
type ScopeSubject =
  | Readonly<{ kind: "owner"; subjectId: "default" }>
  | Readonly<{ kind: "visitor"; subjectId: string }>;
```

解析规则：

| AccessContext | ScopeSubject | 事实来源 |
|---|---|---|
| `mode: "owner"` | `{ kind: "owner", subjectId: "default" }` | 服务端已验证的 Owner 上下文 |
| `mode: "demo"` | `{ kind: "visitor", subjectId: demoAccessId }` | 服务端已验证的 Visitor 上下文 |

安全边界：

- 不使用 token、密码或客户端字段生成 ScopeSubject；
- Route 不读取或接收 `scopeId`；
- 当前不存在 DataScope 查询或数据库 Scope 映射；
- Visitor 的 `demoAccessId` 仍由现有认证上下文提供。

## 3. ScopedOpportunityStore 接口

当前接口只暴露已试点的 Candidate 读取能力：

```ts
interface ScopedOpportunityStore {
  readonly candidates: {
    list(query): Promise<CandidateListResult>;
    getAuthoritative(candidateId): Promise<AuthoritativeCandidate | null>;
  };
}
```

接口不暴露：

- `scopeId`；
- `demoAccessId`；
- Prisma Client；
- JSON 文件路径；
- Candidate/Task 写入；
- 删除或转换事务。

调用方只传入已验证的 `AccessContext` 创建 Store。ScopeSubject 在 Store 创建时绑定，后续业务调用不再传 scope 参数。

## 4. Legacy Adapter 行为

本实验没有切换存储：

| Subject | Candidate list | Authoritative Candidate |
|---|---|---|
| Owner/default | 现有 `listCandidates` Prisma 路径 | 现有 Prisma `findUnique` 投影 |
| Visitor/demoAccessId | 现有 `listSandboxCandidates` JSON 路径 | 现有 `getSandboxCandidate(demoAccessId, id)` |

Legacy Adapter 精确保留 Visitor 列表的状态过滤、名称查询、分数排序、分页和公开响应转换。它也继续拒绝：

- 本地草稿 `opp-*` 作为权威 Candidate；
- Owner 读取 Sandbox Candidate；
- Visitor 读取非 Sandbox Candidate；
- Visitor 跨 `demoAccessId` 读取其他 Visitor Candidate。

上述列表规则和权威 Candidate规则只在 `legacyCandidateRead.ts` 中实现。Legacy Adapter不直接依赖Prisma、JSON Sandbox或过滤排序规则，只绑定ScopeSubject并转发参数。

## 5. 数据流

```text
Route
  → getAccessContext()
  → createScopedOpportunityStore(context)
  → resolveScopeSubject(context)
  → Legacy Scoped Adapter（闭包绑定 Subject）
  → legacyCandidateRead（唯一Legacy读取规则）
     → Owner: Prisma legacy read
        Visitor: JSON Sandbox legacy read
  → 原有公开响应转换
```

Agent Route 的权威 Candidate读取通过绑定后的Scoped Store进入 `legacyCandidateRead`。`save-task` 继续调用 `candidateAuthority.getAuthoritativeCandidate`，该兼容入口也只委托 `legacyCandidateRead`，因此两条调用链不再维护重复规则，Candidate→Task事务本身仍未进入本次试点。Agent与save-task的API合同、权限和Candidate权威性判断未改变。

Candidate列表接口类型从现有Owner列表返回类型与Sandbox列表投影类型推导，不再手工复制第二套Candidate DTO，也不把Owner的 `CandidateStatus` 主动放宽为 `string`。Visitor仍保留其现有Legacy Sandbox类型，未通过类型收紧改变运行时行为。

## 6. 新增与修改文件

新增：

- `lib/server/opportunityScope.ts`
- `lib/server/scopedOpportunityStore.ts`
- `lib/server/legacyCandidateRead.ts`
- `lib/server/legacyScopedOpportunityStore.ts`
- `lib/server/opportunityStore.ts`
- `lib/server/opportunityScope.test.ts`
- `lib/server/legacyScopedOpportunityStore.test.ts`
- `docs/PHASE_3F_RESET_A0_SCOPE_INFRASTRUCTURE.md`

最小接线：

- `app/api/opportunity-candidates/route.ts`
- `app/api/workflows/product-analysis/route.ts`
- `lib/server/candidateAuthority.ts`

## 7. 行为验证

新增测试证明：

- Owner token 不参与 ScopeSubject 身份，统一解析为 Owner/default；
- Visitor 只从服务端 `demoAccessId` 解析 Visitor Subject；
- Store 与 Candidate 子接口均不暴露 `scopeId`；
- Owner Candidate 列表继续走原 Prisma service；
- Visitor Candidate 列表继续走其 JSON Sandbox 分区；
- Visitor A 的权威读取不能获得 Visitor B Candidate；
- Visitor 不能读取Owner Candidate；
- Owner 继续拒绝 Sandbox Candidate；
- Owner/Visitor 都继续拒绝本地草稿作为权威 Candidate；
- Agent Scoped Store与save-task兼容入口返回相同字段投影；
- Visitor状态过滤、分数排序、分页、总数、默认顺序和空列表合同不变；
- 结构哨兵确认Adapter不包含Prisma、Sandbox、过滤、排序或权威ID规则。

现有 Route 与 Agent 测试继续证明：

- Candidate GET 的 Owner/Visitor 响应与公开字段过滤不变；
- Agent 权威 Candidate 读取和跨 Visitor 隔离不变；
- API 响应合同未增加 Scope 字段。

## 8. 未迁移范围

本实验没有实施：

- DataScope 表或 `scopeId` 字段；
- SQLite Visitor 存储；
- Task Store；
- Candidate 写入、更新、删除；
- import-local；
- Candidate→Task 事务；
- JSON 数据迁移、双读或双写；
- JSON Adapter 退役；
- 正式 Migration、回填、切换或回滚。

## 9. 风险与下一阶段门禁

当前 Legacy Adapter 仍依赖原 JSON Sandbox，因此本实验没有解决文件并发与 lost update；它只证明应用层绑定 Scope 的接口形状可行。

主要遗留风险：

1. Candidate读取规则已收敛到单一Legacy实现，但存在Scoped Store与candidateAuthority两个兼容调用入口；写入和Task仍在旧路径，不能宣称Scope化完成；
2. ScopeSubject 当前不是数据库实体，不能用于数据库约束；
3. Route 遗漏风险需要在后续迁移时逐项清单验证；
4. 未来 Prisma Adapter 必须在构造时绑定服务端解析的 Scope，不能让客户端或 Route 传裸 `scopeId`；
5. Candidate 与 Task 的真实存储切换必须保持同 Scope 关系和 Candidate→Task 原子事务。

下一阶段建议：先独立审查本实验 Diff 与行为证据。若批准，再单独设计并测试 Prisma Scoped Candidate 只读 Adapter；仍不迁移写入、Task 或生产 Schema。
