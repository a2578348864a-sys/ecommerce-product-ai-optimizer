# OpportunitiesForm 行为保护合同

> Source baseline：`origin/main` commit `e536c8bf9771af1b7d615511fdda8449034d3867`，tree `a6d8eaf991b6c733bbb862996fe0cf7d4c11b693`
>
> 审计日期：2026-07-23。本文记录后续结构调整不得无意改变的现有行为，不是新功能授权。

## 1. 证据等级

- **RENDERED**：通过公开 component interface 做 React SSR 断言；
- **DOMAIN**：通过生产纯 module interface 验证可观察结果；
- **ROUTE**：通过 Route 测试验证请求、权限和写入 adapter；
- **STATIC**：只证明当前 import/结构，不冒充用户行为；
- **UNKNOWN**：当前环境未自动证明。

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

## 7. Storage 合同

- 输入草稿 key 与 10 分钟 TTL 不变；
- Candidate pool key、7 天 TTL 与 version 不变；
- 损坏、过期和版本不符 payload 安全清理；
- localStorage 不持久化可信 Evidence review、R2.2 或 canonical Task relation；
- fixture 不读写 Storage；
- access secret 继续由 session adapter 管理，不作为叶子 UI props 扩散。

## 8. 自动化矩阵

|保护面|测试|
|-|-|
|公开 surface、fixture|`components/cross-border/OpportunitiesForm.behavior.test.ts`|
|local→server→Agent→Task authority 链|同上|
|删除 presentation|`components/cross-border/OpportunitiesForm.delete-policy.test.ts`|
|Candidate pool、Storage、R2.2|`lib/opportunityCandidatePool.test.ts`|
|Agent href|`lib/candidateAgentRunLink.test.ts`|
|Task relation|`lib/candidateTaskLinks.test.ts`|
|Owner/Visitor import-local|`app/api/opportunity-candidates/import-local/route.test.ts`|
|signed source fail-closed|`app/api/opportunities/source-import/route.test.ts`|

## 9. 未自动化风险

- DOM 输入、click、confirm、portal 与 keyboard；
- Strict Mode Effect 时序；
- analyze/preview/confirm/PATCH/DELETE 的重叠响应；
- 真实 Owner/Visitor 服务端集成；
- `/opportunities/import` 实际访问量。

这些项目进入 `OPPORTUNITIES_FORM_DEFERRED.md`，不能用字符串扫描替代行为证据。

## 10. 后续变更门禁

任何 Phase 必须保持 props、路由、payload、Storage key、authority、错误合同和 Candidate→Task 原子边界。测试失败不得通过删测试、放宽断言、改 Fixture 或绕过 Guard 制造通过。

