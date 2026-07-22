# components / lib / hooks 静态代码健康报告

> Source baseline：`origin/main` commit `e536c8bf9771af1b7d615511fdda8449034d3867`，tree `a6d8eaf991b6c733bbb862996fe0cf7d4c11b693`
>
> 扫描日期：2026-07-23
>
> 口径：131 个 tracked、非测试 `.ts/.tsx/.js/.mjs` 文件，范围为 `components/`、`lib/`、`hooks/`。静态 import 支持字面量 import/export/require/dynamic import。静态结果不能排除仓外或运行时消费者。

## 1. 整体判断

主要健康风险不是大量孤儿文件，而是少数巨型客户端容器、跨 client/server 重复概念，以及隐藏在多个 state 与 adapter 间的 authority 语义。静态扫描只发现两个生产入度为 0 的文件，均不满足当前删除门禁。

## 2. 巨型文件

|文件|行数|生命周期/风险|
|-|-:|-|
|`components/cross-border/OpportunitiesForm.tsx`|2,388|PRODUCTION；29 state、9 fetch，多领域编排|
|`components/TaskRecordDetail.tsx`|1,489|PRODUCTION；Task 详情与多资产展示|
|`components/TaskRecordsList.tsx`|1,328|PRODUCTION；列表、筛选与状态|
|`components/cross-border/ProductProfitForm.tsx`|1,262|COMPATIBILITY；旧页面 bundle|
|`components/agent/AgentRunClient.tsx`|1,156|PRODUCTION；Agent 主链与恢复|
|`components/cross-border/WorkflowBatchClient.tsx`|917|EXPERIMENTAL|
|`components/ViralMockAgent.tsx`|852|EXPERIMENTAL|
|`lib/server/demoSandbox.ts`|832|PROTECTED；Visitor 数据与原子边界|

行数只用于定位认知成本，不构成重构或删除授权。

## 3. 重复与相似概念

|发现|判断|建议|
|-|-|-|
|`DecisionCard` 同时是 `lib` 类型和 UI module 名|同一领域的类型/渲染配对，不是重复实现|保留；调用处已别名 `DecisionCardUI`|
|Profit Snapshot 类型同时存在于 UI 和 `lib/profitSnapshot.ts`|可能是真实合同重复|后续单独比较字段、legacy normalize 与消费者|
|Candidate status 类型存在 client pool 与 server service 两处|相同字面量不代表相同 ownership|不在本轮合并；先审查持久化/权限合同|
|`CandidateItem` 在 Candidate service 与 radar normalize 中同名|领域含义不同|改名收益低，当前保留|

未发现可以仅凭同名安全合并的重复组件或工具函数。

## 4. 孤儿与删除门禁

|文件|生产引用|测试引用|配置/动态证据|结论|
|-|-:|-:|-|-|
|`hooks/useLocalStorage.ts`|0|0|未发现字面量配置/动态 import；仓外消费者未知|UNKNOWN，不删除|
|`lib/tasks/filterTaskRecords.ts`|0|1|26 项直接测试保护搜索、兼容和分页语义|RETAIN，不删除|

本轮删除文件：0。

没有对象同时具备“生产引用 0、测试引用 0、配置引用 0、动态引用 0”并且生命周期已确认可退役。`useLocalStorage.ts` 虽满足仓内四类静态 0，但仍被治理文档明确标为 UNKNOWN；生命周期未知优先于机械删除条件。

## 5. 循环依赖

静态图发现一个强连通组：

```text
lib/aiListingDraft.ts
  runtime import → lib/listingClaimFilter.ts
lib/listingClaimFilter.ts
  type-only import → lib/aiListingDraft.ts
```

这是 type-level cycle，不是已证明的 runtime 初始化循环。潜在风险是类型归属和未来 import 变化可能把它升级为 runtime cycle。当前不改；后续可把共享 draft interface 放到更深的领域 module，但必须先验证所有消费者。

## 6. 隐式状态与维护风险

- Candidate authority 由 `serverAvailable`、`identitySource`、ID 前缀、状态、Task link、R2.2 和 mode 组合表达；单个布尔值不足以代表。
- localStorage pool 包含服务端映射项，但不能证明当前服务端仍可用；Agent gate 必须继续要求当前 server availability。
- 来源 preview Candidate 与持久化 Candidate 使用相似形状，必须通过签名 adapter 和 confirm command 区分。
- 29 个 state 中 7 个为错误/反馈，错误清理顺序容易在提取时改变。
- `serverAvailable` 是 `null/true/false` 三态，兼具探测和降级含义。
- portal 位置依赖 DOM 查询与全局 listener，Node 测试不能证明布局。

## 7. 本轮低风险整理

治理候选把 `getCandidateDeletePresentation` 提取为 `lib/opportunityCandidateActions.ts`：

- module interface 只有三个布尔输入和一个 presentation 结果；
- 实现隐藏 local draft、linked Task、official readonly 的优先级；
- 原测试通过同一 interface；
- 容器 state、Effect、fetch、props 和 JSX 层级不变。

这是一个真实 seam：容器是生产 adapter，测试是第二个调用 adapter。除此之外未执行重复消除、孤儿删除或巨型文件拆分。

## 8. 风险分级

- P0：0
- P1：0
- P2：巨型容器、Profit Snapshot 潜在重复、type-level cycle、两个 UNKNOWN/RETAIN 零生产引用文件
- P3：历史 Phase 注释较多、部分同名类型增加检索成本

