# 生产文档一致性差距

> Production baseline Commit：`2d4562aea234543ef3862b0d10a07e0ac40039b0`（短哈希 `2d4562a`）
> Production baseline Tree：`f1b4d9bebc51ddca01bd70ab615e02fe90833aa0`
> 审计日期：2026-07-23
> 事实来源：已 fetch 的 `origin/main`；只比较该 Git 根中 tracked 文档和生产代码。
> 排除范围：外层项目文档、其他分支 dirty 和未跟踪 Provider 工具均为 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`，不作为生产事实。
> 复核要求：生产 Commit 或 Tree 变化后，必须重新执行代码与文档对照。

本报告只记录差距，不修改 README、Runbook、旧 Phase 文档或部署文档。

## 1. 原治理 Commit 中纠正的事实

|原表述|origin/main 复核结果|本次修正|
|-|-|-|
|把主链画成强制的首页 → opportunities → Candidate → Agent → Task|首页直接链接 opportunities、agent/run、tasks；Agent 还支持 manual 输入|改为多入口拓扑，并分别记录 Candidate 路径和 manual 路径。|
|暗示 `/opportunities` 分析后总会得到服务端 Candidate|分析结果先进入本地池；只有认证、Candidate API 可用且保存成功后才成为权威 Candidate|增加 local draft、server save、import-local 和 Agent 阻断条件。|
|首页读取 Candidate API|`HomeDashboardClient` 的静态 fetch 只有 `/api/tasks`|删除首页 Candidate API 表述。|
|把 `/opportunities/import` 分类为 EXPERIMENTAL|Route 位于 main、无 development gate、无 redirect；但站内 href 为 0|改为 `PRODUCTION / ADVANCED_HIDDEN`。|
|把 `/api/opportunities/crawl` 分类为 COMPATIBILITY|生产代码没有静态调用者，也没有 redirect/alias 证明兼容职责|改为 `UNKNOWN`。|
|部署配置写作根 `ecosystem.config.cjs`|真实 tracked 路径是 `deploy/ecosystem.config.cjs`；仓库根不存在该文件|统一修正路径。|
|把真实 AI smoke 当作零引用退役候选|`vitest.real-ai-smoke.config.ts` 明确引用该脚本|从退役候选移除，分类为受控 `EXPERIMENTAL` 验证工具。|
|把本地未跟踪 Provider 工具列入生产代码/退役表|它们不在 origin/main|只在独立本地在途章节标记 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`。|
|把 redirect 的具体 HTTP 状态写成已确认事实|静态代码只证明调用 Next `redirect()`；本轮未启动运行时|不宣称实测状态码。|

## 2. origin/main 现有文档与代码差距

|文档|文档表述|生产代码事实|风险|
|-|-|-|-|
|`README.md`|主路径仍写“单品分析（`/workflow`）”|`/workflow` 是兼容 redirect；正式 Agent 页面是 `/agent/run`|AI 或新人可能修改不可达 `WorkflowClient`。|
|`README.md`|没有记录 `/opportunities/import` 和 Family Top 5|main 中存在高级隐藏页面和完整 Artifact 校验闭包|高级生产能力与保护边界不可见。|
|`docs/alpha-mvp-status.md`|主链写 `/opportunities → /workflow → /tasks`，把 `/agent/run` 写成实验看板|主导航直接使用 `/agent/run`，且它支持 Candidate/manual 两种路径|当前状态文档停留在旧代际。|
|`docs/alpha-mvp-status.md`|首页数据写“localStorage + 任务 API”，权限写“单用户，无权限分层”|存在 Owner/Visitor、Prisma/Sandbox 分流；首页静态 fetch 只有 Task API|身份与数据边界描述失真。|
|`docs/PRODUCTION_RUNBOOK.md`|要求 `/workflow` 返回 200|代码是 redirect；本轮未实测具体状态|可能把正确 redirect 误判成失败，或反向破坏兼容逻辑。|
|`docs/PRODUCTION_RUNBOOK.md`|核心页面偏重 workflow/batch，缺少 agent/run、tasks/[id]、opportunities/import|这些分别是生产主入口、详情入口和高级隐藏入口|生产冒烟覆盖不对应当前架构。|
|`docs/TASKS_FEATURE.md`|默认描述爆款素材/Viral 记录，API 主要是 GET/DELETE|Task 已承担多类型工作台，并有 PATCH、lifecycle、listing-pack、image-draft|历史模型名被误当成当前产品边界。|
|`DEPLOY.md`|注释称 deploy 文件实际位于外层 `09_交付与归档/deploy/`|文件实际 tracked 于本仓 `deploy/`|部署人员可能复制错误位置。|
|旧 `phase-2*`、`phase-3*` 文档|多处把 `/workflow` 当当前页面或主链|当前 `/workflow` 只做兼容 redirect|历史设计缺少统一的“非当前生产事实”标识。|

## 3. 缺失的生产治理信息

- 没有以 Commit/Tree 双锚定的生产架构入口。
- 没有区分 `PRODUCTION / ADVANCED_HIDDEN` 和 `EXPERIMENTAL`。
- 没有集中说明 `/opportunities` 的本地草稿与权威 Candidate 条件。
- 没有记录 `/agent/run` 的 manual 生产路径。
- 没有把 production 404 的诊断/Radar API 与普通可用 API 分开。
- 没有可复算的代码生命周期统计和静态不可达证据。
- 没有明确把其他工作树内容排除为 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`。

## 4. 本地在途边界

外层项目记录、当前开发分支的 16 项 dirty/未跟踪内容和 Provider compatibility 工具不属于 `origin/main`。本报告不评价它们是否应合入，只记录其状态为：

```text
IN-FLIGHT / LOCAL / NOT_PRODUCTION
```

## 5. 后续文档治理建议（本轮不执行）

1. 先对本轮六份治理文档做独立只读复核。
2. 复核通过后，再用单独 docs-only 任务更新 README、Runbook 和 Alpha 状态。
3. 旧 Phase 文档只加历史标识，不重写原始决策记录。
4. 生产 Commit 变化时，先重跑事实扫描，再更新治理文档。
