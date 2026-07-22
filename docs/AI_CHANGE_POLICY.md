# AI 修改生产代码边界

> Production baseline Commit：`2d4562aea234543ef3862b0d10a07e0ac40039b0`（短哈希 `2d4562a`）
> Production baseline Tree：`f1b4d9bebc51ddca01bd70ab615e02fe90833aa0`
> 审计日期：2026-07-23
> 事实来源：已 fetch 的 `origin/main`；生产判断不得来自其他本地工作树。
> 排除范围：其他分支的 dirty、未跟踪文件和 Provider 工具均为 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`。
> 复核要求：生产 Commit 或 Tree 变化后，必须重新核对本策略引用的 Route、合同和保护文件。

本文件约束 Codex、Claude 和其他 AI 执行者。它不替代用户授权、`AGENTS.md` 或安全规则；冲突时采用更严格边界。

## 1. 修改前必须回答

1. 当前 fetch 后的 `origin/main` Commit/Tree 是什么？
2. 目标文件在 `CODE_LIFECYCLE.md` 中属于哪一类？
3. 目标 Route 在 `ROUTE_LIFECYCLE.md` 中属于哪一类和入口角色？
4. 当前工作目录是不是正确 Git 根和授权的工作树？
5. 当前 dirty 是否属于本任务，哪些必须保留？
6. 修改是否改变 Candidate 权威性、Evidence、Run Proof、Task、Owner/Visitor 隔离或恢复状态？
7. 精确修改文件、不碰范围和验证命令分别是什么？

如果无法区分 production main 与本地在途事实，停止修改并报告 `governance_facts_ambiguous`。

## 2. 生命周期默认行为

|状态|AI 默认行为|
|-|-|
|`PRODUCTION`|仅在明确授权范围内做最小修改；验证直接消费者、失败路径和恢复。|
|`COMPATIBILITY`|只读；除非任务明确要求兼容修复，并证明旧消费者。|
|`EXPERIMENTAL`|默认只读；不得接入主导航或宣称生产化。|
|`ARCHIVED`|禁止修改、复活或重接。|
|`UNKNOWN`|停止写入，先查调用者、访问日志和负责人。|
|`IN-FLIGHT`|不得当作生产事实；只能在其所有者和专用工作树中处理。|

`PRODUCTION / ADVANCED_HIDDEN` 表示生产存在但非主导航入口，不等于可以随意曝光或扩大使用。

## 3. 禁止直接修改的保护区

以下内容必须由用户对具体目标、风险和验证单独授权。普通“整理”“优化”或相邻功能授权不包含这些保护区。

### 认证、权限与配额

- `app/api/auth/**`
- `lib/server/accessPassword.ts`
- `lib/server/accessSession.ts`
- `lib/server/signedToken.ts`
- `lib/server/demoAccess.ts`
- `lib/server/demoGuard.ts`
- `lib/client/accessPassword.ts`
- `lib/client/accessToken.ts`
- `lib/client/loginRedirect.ts`
- Owner/Visitor 分流、401/403、配额预留/结算/恢复

### Prisma、正式数据与 Sandbox

- `prisma/**`
- `lib/server/db.ts`
- `lib/server/demoSandbox.ts`
- migration、db push、db migrate、真实 SQLite 和运行时 Sandbox 数据
- `OpportunityCandidate`、`ViralAnalysisRecord`、`ListingCopyHistory` 的字段和语义

### Artifact Hash、Manifest 与 Provenance

- `lib/upstream/**`
- 固定 Manifest Hash、所有 Sidecar、bytes、schema、sourceArtifactId、source binding
- readiness 和 fail-closed 路径

不得通过放宽校验、改旁车、删除 Provenance 或把失败映射成 `ready` 来让页面显示。

### Candidate → Task 原子边界

- `app/api/workflows/product-analysis/route.ts`
- `app/api/workflows/product-analysis/save-task/route.ts`
- `lib/server/workflowRunProof.ts`
- `lib/server/candidateAuthority.ts`
- `lib/server/opportunityCandidateService.ts`
- `lib/server/demoSandbox.ts` 中 Candidate/Task 原子创建与回链

不得把本地草稿、URL 参数或客户端 Evidence 当成权威 Candidate；不得拆开 Owner transaction 或 Visitor 原子写入后声称合同不变。

### 部署与生产保护

- `deploy/**`
- `scripts/db/protect-sqlite-db.mjs`
- `package.json` 中 build/start/db/deploy scripts
- `DEPLOY.md`、`docs/PRODUCTION_RUNBOOK.md` 中生产命令
- Nginx、PM2、systemd、端口、备份和健康检查

真实部署配置在 `deploy/ecosystem.config.cjs`，仓库根没有同名文件。

## 4. 修改前必须审查的主链

### 导航与页面

- `/`：`app/page.tsx`、`HomeDashboardClient.tsx`、`WorkspaceSidebar.tsx`
- `/opportunities`：`app/opportunities/page.tsx`、`OpportunitiesForm.tsx`
- `/opportunities/import`：页面、`FamilyTop5Review`、Family adapter
- `/agent/run`：页面、`AgentRunClient.tsx`
- `/tasks`：页面、`TaskRecordsList.tsx`
- `/tasks/[id]`：页面、`TaskRecordDetail.tsx`
- `/workflow`：兼容 redirect 和 query 映射

### Candidate 权威性

必须同时检查：

- local draft 与 server identity 的区别；
- `/api/opportunity-candidates` 保存/刷新失败的降级；
- `import-local`；
- Candidate 状态、已关联 Task 和 R2.2 门禁；
- Agent API 的服务端重新读取；
- manual Agent 路径不能被误改成伪 Candidate 路径。

### 数据合同和恢复

- Candidate、Evidence、source proof、`sourceMetaJson`；
- Run Proof、Agent output snapshot、人工决定、decision evidence；
- Task result JSON、Listing Pack、图片草稿；
- Agent session cache、刷新/返回恢复、过期和身份隔离；
- 历史 Task normalize/fallback；
- Owner Prisma 与 Visitor Sandbox 的等价语义及隔离差异。

## 5. 禁止的推断

- 页面存在，不等于主导航入口。
- Route 存在，不等于 production 可用；必须检查 404 和 environment gate。
- 本地 pool item 不等于权威 Candidate。
- Artifact Hash 自洽不等于 Provider 实时可用或效果有效。
- 静态调用为 0 不等于可以删除；仓外消费者仍是未知项。
- 文件名包含 `release`、`guest`、`radar` 或 `legacy` 不等于已知生命周期。
- 测试通过不等于生产部署或真实 AI 已验证。
- 本地 dirty 或未跟踪 Provider 文件不等于 production main。

## 6. 验证矩阵

|影响面|最低验证|
|-|-|
|纯文档|Markdown、相对路径、事实基线、Route/File 白名单、`git diff --check`|
|页面/导航|Route 与 href 证据、目标测试、loading/error/刷新恢复|
|API/合同|Route 测试、权限、错误码、服务端重验、消费者|
|Candidate → Agent|local/server、状态、R2.2、服务端重新读取、manual 输入|
|Candidate → Task|Owner transaction、Visitor 原子回链、重复/陈旧 proof、身份错误|
|Artifact|Manifest、Sidecar、Hash、bytes、schema、Provenance、fail-closed|
|部署/数据库|只有明确授权后才执行；构建、部署、备份、迁移和生产冒烟分别报告|

验证失败不得降低断言、改 Fixture 或绕过 Guard 制造通过。

## 7. Git 与秘密边界

- 修改前后记录当前 Git 根、HEAD、Tree 和 `git status --short`。
- 精确暂存授权文件；禁止 `git add .` 和 `git add -A`。
- 不覆盖、stash、reset、清理或提交他人的 dirty。
- 未经授权不 Push、不合并、不部署。
- 不读取、打印或搜索 `.env*`、密钥、token、cookie、生产数据库或真实运行时 Sandbox。
- `.env.example` 类模板只用于变量名称和合同，不复制任何真实值。

## 8. 本地在途状态

其他开发分支的 16 项 dirty/未跟踪内容和 Provider compatibility 工具整体标记为 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`。AI 不得把它们写进生产架构主图、生产 Route 统计或退役结论。
