# OpportunitiesForm 分阶段拆分方案

> Source baseline：`origin/main` commit `e536c8bf9771af1b7d615511fdda8449034d3867`，tree `a6d8eaf991b6c733bbb862996fe0cf7d4c11b693`
>
> 制定日期：2026-07-23。本文只定义 module/interface/seam/adapter，不授权当前任务继续拆分主逻辑。

## 1. 原则

- 深 module：小 interface 隐藏复杂实现；
- interface 同时包含类型、authority、顺序、错误和恢复约束；
- seam 只放在有真实变化或测试 adapter 的位置；
- 纯规则由 domain module 提供，视图不复制；
- 旧实现被替换后不长期双轨。

## 2. 已完成准备，不是主逻辑拆分

- 系统、state、Effect、网络、Storage 和权限地图；
- 公开 surface SSR 行为测试；
- local→server→Agent→Task 跨 module 合同测试；
- SourceProof fail-closed 测试隔离；
- 一个纯删除 presentation seam。

29 个 state、5 个 effect、9 个 fetch 和页面层级均未调整。

## 3. seam 清单

|推荐顺序|建议 module|输入/输出|state owner|副作用/依赖|风险|
|-:|-|-|-|-|-|
|1|Surface header|surface presentation model → JSX|容器|无|copy/ARIA|
|2|Decision badges/summary|Candidate presentation → JSX|容器|无|Evidence/R2.2 标签漂移|
|3|Decision View Model|pool + Task links + mode → rows|纯 module|无|authority 条件遗漏|
|4|Source import view|view model + commands → JSX|容器|无直接 fetch|preview/confirm 混淆|
|5|Candidate list/detail|rows + selection + commands → JSX|容器|portal 另行处理|DOM/菜单行为|
|6|Storage recovery module|cache adapter → hydration result|专用 Hook/module|localStorage|覆盖顺序/Strict Mode|
|7|Request module|commands → result/error|专用 module|HTTP adapter|headers/abort/stale response|

## 4. 候选 interface

### Decision View Model

```ts
type CandidateDecisionRow = {
  id: string;
  queue: CandidateQueuePresentation;
  market: MarketPresentation;
  evidence: EvidencePresentation;
  taskLinks: readonly LinkedTaskInfo[];
  actions: CandidateActionPresentation;
};
```

module 内部统一解释 `official_readonly`、local/server、Task、`convertedTaskId`、R2.2 和 Evidence。调用者不应重新拼这些条件。

### Source import commands

```ts
type SourceImportCommands = {
  preview(): void;
  toggle(key: string): void;
  confirm(): void;
};
```

preview 与 confirm 必须保持两个 command，签名 payload 只能由现有 adapter 生成。

### Storage result

```ts
type CandidateHydrationResult = {
  items: OpportunityCandidatePoolItem[];
  source: "server" | "local_fallback" | "fixture";
  serverAvailable: boolean;
  notice: string;
};
```

只有真实 DOM/Effect 测试建立后才考虑此 interface；当前不是实现建议。

## 5. 执行阶段

### Phase 0：行为基线

进入条件：最新 main、clean worktree。退出门禁：行为合同、完整验证和独立复核。当前治理候选完成准备，尚未进入 main。

### Phase 1：纯展示叶子

一次提取一个区域，不移动 state/effect/fetch。收益是降低 JSX 认知负担。失败直接 revert 单 Commit。

### Phase 2：派生 View Model

把散落的 presentation 条件集中为纯 module。必须先用 table-driven tests 覆盖 authority 矩阵。

### Phase 3：来源导入视图

先 view 后 controller。禁止同时改签名、crawler、API 或选择规则。

### Phase 4：Candidate 列表与详情

提取列表/详情/动作视图。portal 必须有 DOM 测试后单独移动。

### Phase 5：Storage 恢复

只有 server-first、fallback、TTL、fixture、Strict Mode 可验证时才提取 Hook。

### Phase 6：请求 module

需要 production HTTP adapter 与 test adapter 两个真实 adapter。逐 endpoint 替换，不做统一 client 大改。

### Phase 7：容器收口

最终容器只组合 modules 和 access adapter。state 数量下降是结果，不是目标。

## 6. 每阶段共同门禁

- 不改 props、路由、API payload、Storage key、认证、Prisma、Sandbox、Artifact；
- 不同时修 UNKNOWN 并发行为；
- 相关测试 + 完整单线程测试 + TypeScript + ESLint + Build；
- production diff 与目标范围逐项核对；
- 独立 detached review；
- 每次 1–3 个紧密文件，可独立 revert。

详细交付顺序和回滚矩阵见 `NEXT_REFACTOR_ROADMAP.md`。

