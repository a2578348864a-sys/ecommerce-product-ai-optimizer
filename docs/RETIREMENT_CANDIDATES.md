# 生产退役候选

> Production baseline Commit：`2d4562aea234543ef3862b0d10a07e0ac40039b0`（短哈希 `2d4562a`）
> Production baseline Tree：`f1b4d9bebc51ddca01bd70ab615e02fe90833aa0`
> 审计日期：2026-07-23
> 事实来源：已 fetch 的 `origin/main`，以及基于该基线创建的 `codex/retire-unreachable-code` 候选分支；引用数来自 tracked 非测试源码的静态 import/字面量调用。
> 排除范围：其他分支 dirty、未跟踪 Provider 工具均为 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`，不进入生产退役候选。
> 复核要求：生产 Commit 或 Tree 变化后，所有引用数、Route 消费者和风险必须重新计算。

本文件不是删除授权。静态引用为 0 仍不能排除动态生成、仓外客户端、访问日志、人工运维或未合并分支。

## 1. 静态不可达代码

### 已验证退役

|文件|删除 Commit|引用与历史证据|验证结果|
|-|-|-|-|
|`components/cross-border/WorkflowClient.tsx`|`a22548930748649fa44458c82d0daacfee75f885`|运行、动态、测试和配置引用为 0；`edf3957` 已将 `/workflow` 改为保留 query 的 `/agent/run` redirect。|定向 workflow 测试 117/117；TypeScript、ESLint 与 Build 通过。|
|`components/CopyButton.tsx`|`a22548930748649fa44458c82d0daacfee75f885`|唯一源码 import 来自已退役 `WorkflowClient`；其他同名按钮均为组件内部实现。|与唯一调用者成组删除；残留路径引用为 0。|
|`components/ResultSection.tsx`|`be07046920a09308410fb590be3170ceba0b205f`|运行、动态、测试和配置引用为 0；`f3582ca` 已从旧首页移除整组 `ResultSection` import。|首页摘要定向测试 5/5；TypeScript、ESLint 与 Build 通过。|
|`components/WorkspacePlaceholderPage.tsx`|`be07046920a09308410fb590be3170ceba0b205f`|运行、动态、测试和配置引用为 0；原页面消费者已分别替换为真实表单、Task 列表或实验页面。|残留路径引用为 0；TypeScript、ESLint 与 Build 通过。|

完整验证：默认单线程测试 124/124 个文件、1731/1731 项通过；TypeScript 通过；ESLint 为 0 error、7 个与 main 基线相同的既有 warning；Production Build 成功并生成 45/45 个静态页面项。

### 本轮保留或待调查

|候选|非测试静态 import|证据|删除风险|结论|
|-|-:|-|-|-|
|`lib/tasks/filterTaskRecords.ts`|0|无生产运行时调用，但 `lib/tasks/filterTaskRecords.test.ts` 存在直接引用，26/26 项测试通过|删除实现会破坏现有搜索、兼容与分页测试合同；必须先独立审查测试目的，不能删除测试制造通过|`RETAIN`；本轮只审计，不删除|
|`hooks/useLocalStorage.ts`|0|生产 import 图不可达|可能由未来页面或动态入口使用|`UNKNOWN`，先查消费者|

## 2. Route/API 调查候选

|候选|生产静态证据|风险|当前结论|
|-|-|-|-|
|`/agent`|主导航没有该入口；页面自身明确归档并提供新入口链接|外部书签、演示说明仍可能需要|保留轻量归档页，不建议近期删除|
|`/workflow`|仍有可达源码字面量引用：`app/products/new/page.tsx` 1 处、`lib/homeDashboardSummary.ts` 2 处|旧书签、旧 Task、推荐卡和 query 迁移依赖|`COMPATIBILITY`，不是近期删除候选|
|旧多页 routes + `/api/agents/*`|旧页面之间仍互相链接并调用后端|可能有旧用户和数据流|作为 compatibility bundle 统一观察|
|`/products/new` + `/api/products/*`|旧页面/API 仍互相调用|Listing 历史可能包含用户数据|先做数据与访问审计|
|`/workflow/batch`|侧边栏、Task 列表和详情仍有入口|可产生 AI 调用和 Task|`EXPERIMENTAL`，不能仅因非主链删除|
|`/viral` + `/api/agents/viral`|由兼容产品页和 Task 概念引用|Task 模型历史名称相近，易误删数据能力|先区分页面能力与存储模型|
|`/api/opportunities/crawl`|production 可执行；站内精确静态调用为 0|仓外消费者未知；底层 crawler 被正式 source-import 使用|`UNKNOWN` Route 候选；不得连带删底层模块|
|`/api/generate`|production 可执行；站内精确静态调用为 0|仓外客户端和真实 AI 使用未知|`UNKNOWN`；先查访问日志|
|`/api/radar/*`|站内精确静态调用为 0；production 返回 404|本地开发/历史研究流程可能依赖|只可评估 Route；不连带删复用模块|

## 3. 脚本调查候选

|候选|tracked 精确引用|风险|当前结论|
|-|-:|-|-|
|`scripts/create-guest-codes.mjs`|0|可能是唯一人工 Guest code 运维入口|`UNKNOWN`；先补运维证据|
|`scripts/release-gate-screenshots.mjs`|0|可能由仓外发布流程手工调用|`UNKNOWN`；先查 Runbook 和操作记录|

## 4. 本次从候选中移除

|对象|移除原因|
|-|-|
|`/opportunities/import`、`FamilyTop5Review`、Family adapter/fixtures|production main 中存在可直接访问的 `ADVANCED_HIDDEN` 页面和完整 Artifact 校验闭包；生产代码未发现站内导航入口，但真实直接 URL 访问量未知，在取得访问日志前不得判断无人使用或直接退役。|
|`scripts/real-ai-listing-smoke.ts`|由 `vitest.real-ai-smoke.config.ts` 明确引用，是受控独立 smoke，不是零引用文件。|
|`radarCrawler.ts`、`radarNormalize.ts`、`radarScore.ts`|正式 opportunities/source-import 链仍直接复用。|
|`ViralAnalysisRecord` Prisma 模型|当前通用 Task 存储仍使用；改名/删除涉及 schema 与数据迁移。|
|其他分支的未跟踪 Provider 工具|不在 production main；只能标记 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`，不能进入生产退役表。|

## 5. 退役门槛

1. 在新的 production Commit 上重算静态 import、Route href、fetch 和 package/config 引用。
2. 检查 Nginx/应用访问日志、仓外客户端、书签、自动化和人工 Runbook。
3. 确认数据留存、兼容期、替代入口和回滚方式。
4. 先下线入口并观察，再归档；归档后才可单独申请删除。
5. 删除不得与功能开发、目录移动、依赖升级或数据库迁移混在同一 Commit。

## 6. 本地在途状态

当前开发分支的 16 项 dirty/未跟踪内容不属于本清单。它们的唯一治理标签是 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`，由其原工作树和任务所有者继续处理。
