# OpportunitiesForm 行为保护合同

> Source baseline：`origin/main` commit `08c37d1c5e68cc9a68a99a8670e4ddf94d5f6088`，tree `616d949e578087f2e435a6df0bd342244a1e90c4`
>
> 审计日期：2026-07-23。本文记录后续结构调整不得无意改变的现有行为，不是新功能授权。

## 1. 证据等级

- **RENDERED**：通过公开 component interface 做 React SSR 断言；
- **MOUNTED**：通过公开 component interface 挂载并触发用户可观察交互；
- **DOMAIN**：通过生产纯 module interface 验证可观察结果；
- **ROUTE**：通过 Route 测试验证请求、权限和写入 adapter；
- **STATIC**：只证明当前 import/结构，不冒充用户行为；
- **UNKNOWN**：当前环境未自动证明。
- **SSR_RENDERED**：本轮 `RENDERED` 的测试名称标签；
- **MOUNTED_BEHAVIOR**：本轮 `MOUNTED` 的测试名称标签；
- **PURE_CONTRACT**：本轮 `DOMAIN` 纯函数合同的测试名称标签；
- **STRUCTURAL**：本轮 `STATIC` 的结构证据标签。

## 2. surface 合同

|surface|行为|证据|
|-|-|-|
|默认|标题“机会雷达”，不显示“高级工具”|RENDERED|
|`advanced_import`|显示“高级工具 / 手工导入外部来源”|RENDERED + 页面测试|
|`visualFixture`|绕过本地 access/draft wrapper；不显示 intake；render phase 不 fetch|RENDERED|

`/opportunities/import` 不是兼容页或退役候选；访问量 UNKNOWN。

## 3. Candidate authority 合同

1. `normalizeCandidate` 产生的 local draft 不能进入 Agent，也不能生成权威 Agent href。**DOMAIN**
2. 只有当前服务端确认的 Owner/Visitor Candidate 才可能进入 Agent。**DOMAIN + ROUTE**
3. server unavailable 时，浏览器恢复项不能绕过 gate。**DOMAIN**
4. Task Snapshot 或 `convertedTaskId` 任一存在即阻止再次 handoff。**DOMAIN + ROUTE**
5. `official_readonly` 不能修改、删除或进入 Agent。**DOMAIN + ROUTE**
6. R2.2 reject/insufficient 阻止；watch 需要显式人工复核。**DOMAIN**
7. URL Evidence/R2.2 是 handoff Snapshot，服务端 Candidate 仍是 authority。**ROUTE**

## 4. Owner / Visitor 合同

- Owner Candidate/Task 只走 Prisma-backed service；
- Visitor 只走匹配 `demoAccessId` 的 Sandbox；
- Visitor 不得读取 Owner Task 或其他 Visitor 数据；
- import-local 在 Owner 与 Visitor 下都经过 legacy preflight；
- Candidate→Task 分别由 Prisma transaction 和 Sandbox 原子写入保证；
- 前端按钮显示不是权限控制。

这些保护区不因 component 提取而改变。

## 5. 分析与保存合同

|场景|必须保持|
|-|-|
|空输入、超过 30 条、access 未就绪|本地阻断，不发分析请求|
|分析成功|先展示临时结果，再尝试权威 Candidate 保存|
|Candidate 保存失败|保留本地结果并显示非权威 notice|
|Candidate 保存成功|refresh 服务端池|
|状态 PATCH 失败|回滚 previous status|
|已关联 Task 删除|UI presentation 和服务端同时保护|

真实点击与重叠请求仍为 UNKNOWN；后续不能把 disabled 状态误写成完整竞态保证。

## 6. 来源导入合同

1. preview 只调用 source-import，不写 Candidate；
2. SourceProof 签名不可用时必须 fail-closed，不能返回未签名 Candidate；
3. confirm 重新检查 `canSave`，使用既有 save adapter；
4. import-local 强制 `legacy_unverified`；
5. Owner/Visitor 使用各自 storage adapter；
6. 保存成功但 refresh 失败要保留“已保存”的事实。

治理候选补充了 `PROOF_SIGNING_SECRET` 的测试隔离，避免本机配置让 fail-closed 用例产生假失败。

来源可用性说明的展示合同：

- 只在已解锁且 intake 展开时出现，锁定 surface 不出现；**RENDERED + MOUNTED**
- default 与 `advanced_import` 使用相同四级顺序、文案和标识；**MOUNTED**
- 初始收起，点击 `<summary>` 展开，再次点击收起；展开状态由浏览器原生 disclosure 拥有；**MOUNTED**
- intake 展开及 disclosure 切换不新增业务 fetch、localStorage 或 sessionStorage 写入；**MOUNTED**

## 7. Storage 合同

- 输入草稿 key 与 10 分钟 TTL 不变；
- Candidate pool key、7 天 TTL 与 version 不变；
- 损坏、过期和版本不符 payload 安全清理；
- localStorage 不持久化可信 Evidence review、R2.2 或 canonical Task relation；
- fixture 不读写 Storage；
- access secret 继续由 session adapter 管理，不作为叶子 UI props 扩散。

## 8. Candidate pool 空状态合同

- `poolItems.length === 0` 优先显示池为空文案；**MOUNTED_BEHAVIOR**
- pool 非空但 `visiblePoolItems.length === 0` 时显示筛选为空文案；**MOUNTED_BEHAVIOR**
- 恢复“全部”后按既有顺序重新显示全部 Candidate，两个空状态均消失；**MOUNTED_BEHAVIOR**
- default 与 `advanced_import` 使用相同三态优先级；锁定 surface 不渲染 Candidate pool；**MOUNTED_BEHAVIOR + SSR_RENDERED**
- 两类空状态的 class、文案、条件优先级和正常列表留在父组件的事实由 source diff 与规范化合同哈希保护；**STRUCTURAL**
- 叶子不接收 Candidate 数组、权限对象或 callback；筛选与 Candidate authority 仍由父组件拥有。

## 9. 自动化矩阵

### Candidate pool 计数合同

- 输出字段固定为 `all`、`pending`、`worth_analyzing`、`analyzed`、`paused`、`rejected`；**PURE_CONTRACT + SSR_RENDERED**
- `all` 按数组元素总数计数，重复元素逐项计入；各合法状态进入对应桶；**PURE_CONTRACT**
- `analyzed` 排除已有 `convertedTaskId` 的 Candidate，但该 Candidate 仍进入 `all`；**PURE_CONTRACT + SSR_RENDERED**
- 绕过正常化的未知状态只进入 `all`；经服务端正常化的未知状态回落到 `pending`；**PURE_CONTRACT**
- 计数与顺序、surface 无关，不修改输入数组或 Candidate 对象；**PURE_CONTRACT + SSR_RENDERED**
- 原 `useMemo`、`[poolItems]` 依赖、筛选消费者和 Candidate authority 仍由父组件拥有；**STRUCTURAL**

|保护面|测试|
|-|-|
|公开 surface、fixture|`components/cross-border/OpportunitiesForm.behavior.test.ts`|
|Candidate pool UI 计数|`components/cross-border/OpportunitiesForm.pool-counts.test.ts`|
|来源可用性 disclosure|`components/cross-border/OpportunitiesForm.source-availability.test.ts`|
|Candidate pool 空池、筛选为空、恢复列表|`components/cross-border/OpportunitiesForm.candidate-pool-empty-state.test.ts`|
|local→server→Agent→Task authority 链|同上|
|删除 presentation|`components/cross-border/OpportunitiesForm.delete-policy.test.ts`|
|Candidate pool selector、Storage、R2.2|`lib/opportunityCandidatePool.test.ts`|
|Agent href|`lib/candidateAgentRunLink.test.ts`|
|Task relation|`lib/candidateTaskLinks.test.ts`|
|Owner/Visitor import-local|`app/api/opportunity-candidates/import-local/route.test.ts`|
|signed source fail-closed|`app/api/opportunities/source-import/route.test.ts`|

## 10. 未自动化风险

- 除来源 disclosure 外的 DOM 输入、confirm、portal 与 keyboard；
- Strict Mode Effect 时序；
- analyze/preview/confirm/PATCH/DELETE 的重叠响应；
- 真实 Owner/Visitor 服务端集成；
- `/opportunities/import` 实际访问量。

这些项目进入 `OPPORTUNITIES_FORM_DEFERRED.md`，不能用字符串扫描替代行为证据。

## 11. 后续变更门禁

任何 Phase 必须保持 props、路由、payload、Storage key、authority、错误合同和 Candidate→Task 原子边界。测试失败不得通过删测试、放宽断言、改 Fixture 或绕过 Guard 制造通过。
