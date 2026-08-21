# P0 Baseline Audit Report（V4-FINAL-R2）

- 执行批次：V4-FINAL-R2-P0-20260821-1827
- Authority：V4-FINAL-R2 项目书（解压包 CHECKSUMS.sha256 自身 SHA-256 = `848bc4f0845ac87db713e85022360835a0bccb5d148b813082bb53f3534378e1`，56 文件全部校验一致）
- 报告时间：2026-08-21 10:37:10 +08:00
- 报告角色：仅 Lead 撰写；三个只读子 Agent（P0-A/B/C）取证，Lead 交叉核验并裁定冲突

## Verdict

- 基线可信度：**可信**。HEAD 与项目书基线一致，工作树干净，关键断言绝大部分 verified。
- 最大实现差异：真实数据架构是「versioned resultJson 命名空间」JSON 存储，而非书内描述的 Prisma 表集合；Prisma 只有 6 个模型。LangGraph 确实未安装（G2 确认）。
- 基线质量：lint 0 error / 8 warning；typecheck（tsc --noEmit）通过；全量测试 5335 passed / 4 failed / 90 skipped —— **1 个确定性失败**（handoff.product-journey-quota.test.ts，v3.1.0 冻结 tag 上可稳定复现：测试 mock 与 route 契约漂移），另 2 个文件隔离重跑通过（并行负载超时 flake）。
- P1 是否可开始：**是**（本批次用户已授权 P0→P7 连续执行；P0 门禁全过，自动进入 P1）。

## Repository Baseline

| 项 | 值/证据 |
|---|---|
| repo/root | `D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`（Git 根） |
| branch/HEAD | `main` @ `53880c83fb25d7e266d6aa5abe0ce700347137c4`（= `v3.1.0` tag） |
| remote | `origin` = `git@github.com:a2578348864a-sys/ecommerce-product-ai-optimizer.git`；`git ls-remote origin main` = `53880c8…`（远端 main 与本地一致）；远端 `refs/tags/v3.1.0` = `79aa3d239c0643b787c5597d1f80867b0c6a1c21`（release artifact commit，非代码 HEAD；不移动任何 tag） |
| dirty files | P0 全程 `git status --porcelain` 空（子 Agent 零写入）；唯一新增：本报告 `docs/v4/P0_BASELINE_AUDIT_REPORT.md`（P0 任务卡唯一允许的创建物） |
| package/app version | `2.2.16`（package.json）；**漂移**：package-lock.json 根 `2.1.7`、tag `v3.1.0`、release-manifest `40470a1`（打包时点 2026-08-20）与 HEAD 不同——历史记录，非功能缺陷 |
| runtime/db | Next 16.3.0 / React 19 / TS / Prisma 5.22 + SQLite（`prisma/dev.db`）；本机 3005 `npm run start:local` 运行中（/api/health 200，runtime local_owner） |
| 环境 | Windows 11（10.0.26200），Node 24，npm 11；计划任务 `QingXuanAgent-Local-3005` 托管 3005；`V4_Spike_Shutdown_0858` 已于 08:58 触发完成（LastResult 0），无待执行关机 |

## 并行审计账本

| Work Order | 只读范围 | Base SHA | 主要证据 | 冲突/Lead 裁定 |
|---|---|---|---|---|
| P0-A 路由/API/依赖 | 页面/路由/API/依赖/410/迁移断言 | 53880c8 | 路由与 API 清单、410 代码+测试、LangGraph 缺失、版本漂移、无流式、idempotencyKey 仅 2 处 | 与 Lead 复核一致；image-draft GET 有专用访问模块 `lib/server/aiImageTaskAccess.ts`+测试（403/404），降级为「建议安全专项复核」 |
| P0-B 数据/权限/安全 | Prisma/命名空间/沙箱/配额/Ledger/Gate/安全 | 53880c8 | 6 模型、resultJson 命名空间、reservation/lease/refund/recovery、usageScopes、evidenceRefs+F11、SSRF 432 行/134 测试 | 与 Lead 复核一致（`agent_runs` 全仓 0 引用；`isDemoAccessExpired` 无条件 false 属刻意设计，待用户确认） |
| P0-C UI/测试/发布/Legacy | UI 页面/测试资产/CI/文档/发布/Legacy 陷阱 | 53880c8 | 22 page.tsx、593 测试文件、4 vitest 配置、唯一 CI、A–E 评分残留、README 陈旧 HEAD | 与 Lead 独立复核一致：`/api/opportunities` 在线但 UI 孤儿化；README `ae67912` 陈旧；release-manifest 与 HEAD 不同为打包时点差 |

## 项目书断言核验

| 断言 | 状态 | 文件/命令证据 | 影响 |
|---|---|---|---|
| SellerSprite 导入和候选池已存在 | verified | `app/api/opportunities/sellersprite-import|plugin-import|preview/route.ts` + `app/opportunities/(page|import|sellersprite-preview)` + `tools/upstream/sellersprite-preview.ts`；项目根 `XLSX案例/*.xlsx`（2026-08-14/15 真实报表） | 冻结复用 |
| Evidence workbench 与 Amazon/关键词/VOC/竞品/1688 类型已存在 | verified | `lib/creativeContextBuilder.ts`（分层 confirmedFacts/candidates/VOC/keyword/competitor/sourcing/AI/missing）；`lib/server/browserEvidence.ts|keywordEvidence.ts|competitorEvidence.ts`；`lib/upstream/1688/contracts.ts`（SOURCING_EVIDENCE_SCHEMA v1、EvidenceClass 六类、seller_claim≠fact） | V4 直接复用 |
| 1688 已有 Search → Preview → Human Confirm → Evidence | verified | `app/api/tasks/[id]/sourcing/route.ts`（search/url/image→preview，save 注释「Human Confirm 后保存 Formal Evidence」）；`SourcingEvidencePanel.tsx`（preview/confirmSelection/humanConfirmed）；`lib/upstream/1688/entityBinding.ts` | 复用 |
| Listing claim 仅能使用 confirmed facts，Image 可共享 facts | verified | `realAiListingGate/realAiImageGate` + `lib/factCandidates.ts`（禁止 AI/VOC/competitor/seller claims 升权）+ `confirmedFact.usageScopes` 分流（测试充分） | 复用 |
| Visitor sandbox/配额 和 AI summary evidenceRefs 已存在 | verified | `demoAccess/demoSandbox/demoGuard`（demoAccessId 双匹配 fail-closed；reservation/lease 5/30min）；`aiEvidenceSummary.ts`（inputEvidenceHash + F11 无证据→422 + 无引用降级） | 复用 |
| /agent 已迁移，/agent/run 重定向，旧 summary API 返回 410 | verified | `app/agent/page.tsx` 归档页；`app/agent/run/page.tsx` redirect() + page.test.ts/page.security.test.ts；`agents/summary|viral|sourcing|material|risk/route.ts` LEGACY_AGENT_DISABLED→410 + route.test.ts 断言；`/api/generate` 亦 410 | 复用 |
| legacy orchestrator 的 A–E/AI 估算不得重新启用 | partial（需处理） | `lib/agents/orchestrator.ts` 仍含 `RecommendationLevel = "A"|"B"|"C"|"D"|"E"` + `getLevel(score)` + `runOpportunitiesPipeline`，被活跃路由 `app/api/opportunities/route.ts` 调用且**无 410 门禁**；UI 已孤儿化（`OpportunitiesForm.tsx` 无页面 import；`opportunity-candidates/page.test.ts:11`、`opportunities/import/page.test.ts:16,22` 断言页面不含该组件） | **Legacy trap**：API 层可达；列入用户决策（B3） |
| package 当前确实没有 LangGraph | verified | package.json 无 langchain；package-lock rg @langchain|langgraph exit 1；`node_modules/@langchain` 不存在 | G2 成立：P1 新增冻结元组依赖（spike 已 8/8 验证） |
| Lease/Fencing/Ledger 的真实完成度和测试覆盖 | verified（非 stub） | `providerUsageLedger.ts`(5215B)、`creativeHandoffRequestLedger.ts`、`atomicFileStore.ts`(3384B)、`ipBackstop.ts`(5086B)、`taskResultJsonMutation.ts`(14243B+mutationBoundary 测试) 全部真实实现并被业务引用；配额 lease 语义在 `demoAccess.ts`+`client/accessToken.ts`+`aiImageDraftService.ts`（reserved/committed/released+leaseExpiresAt+providerStartedAt，含恢复测试） | 冻结保留；V4 不扩建（书 00 决策） |
| 本地没有未 push 的 V4 runtime/spike | verified | git branch -a 无 V4 分支；worktree 仅 main；`agent_runs` 全仓 0 引用；`scripts/spike/` 仅 V2 模板 | P1 从零建图 |

## Reuse / Adapt / Add / Freeze / Deferred

| 能力 | 分类 | 当前实现 | V4 动作 | Phase |
|---|---|---|---|---|
| SellerSprite 导入/候选池 | Reuse | opportunities 路由+页面+preview 工具 | 不动；作为 Opportunity Radar 输入 | P1+ |
| Evidence 命名空间（browser/keyword/review+voc/competitor/sourcing） | Reuse | lib/server/*Evidence.ts + taskResultJsonMutation | 作为 Research Agent 证据写入面 | P1/P2 |
| 事实晋级（factCandidates/mergeConfirmedProductFacts/usageScopes） | Reuse | lib/factCandidates.ts + creativeContextBuilder | 冻结语义，不重做 | P3 |
| Listing/Image Gate + Studio | Reuse | realAiListingGate/ImageGate + listing-studio/image-studio | 增量接入 Skill/Guard | P5 |
| Visitor sandbox/配额/lease/ledger | Freeze | demoAccess/demoSandbox/demoGuard + ledgers | 冻结保留，不扩建 | — |
| 1688 acquisition 契约 | Reuse | lib/upstream/1688/contracts.ts（search/image/url/detail/save） | 作为 Supplier Research 工具信封 | P3 |
| Amazon browser connector | Reuse | tools/collectors/amazon/browser-control.ts + human-assisted + environment-gate | 受控 Browser Tool 基础 | P2 |
| 旧 agents/* 接口 | Freeze(410) | LEGACY_AGENT_DISABLED | 保持 410；不得复活 | — |
| /api/opportunities（legacy pipeline） | **Adapt/决策** | 在线但 UI 孤儿 | 建议 410 门禁（B3 用户决策） | P1 |
| LangGraph 运行主链 | Add | 不存在 | 冻结元组依赖 + graph skeleton | P1 |
| Gate A / Gate B 双人工决策 | Add | 现仅 research-decision 单语义 | 拆两闸门 | P1/P3/P4 |
| 商业可行性快照 | Add | 零件散落（ProfitSnapshot/Risk 等） | 统一为区间+风险快照 | P4 |
| Replay 公网展示 | Deferred→P6 | 无 | P6 再建（脱敏运行快照） | P6 |
| 分布式 Lease/Fencing 扩建 | Deferred | 已完成部分冻结 | 不扩建（V5） | — |
| 跨平台/Linux artifact | Deferred | release/ 有 linux tar.gz | V4 不承诺 | — |

## Inventory

- **页面**：22 个 `app/**/page.tsx`（agent 归档+run 重定向、opportunities、opportunity-candidates、products、tasks、research、summary、sourcing、risk、viral、materials、workflow、listing-studio、image-studio 等）；app 全部 163 个 tsx/ts。
- **API**：app/api 65 个 route；鉴权全部 route 内（无全局 middleware），demoGuard requireAuthenticated/requireOwner + demoAccessId 沙箱匹配；idempotencyKey 仅 image-studio/listing-studio；无 ReadableStream 流式端点；agents/* 与 /api/generate 已 410。
- **数据**：Prisma 6 模型（ListingCopyHistory、ViralAnalysisRecord、OpportunityCandidate、ProductBatch、ProductBatchItem、ProductDiscoverySelection）+ 5 migrations；业务主链在 versioned `resultJson` 命名空间（research/browserEvidence/keywordEvidence/reviewEvidence/vocAnalysis/competitorEvidence/sourcingEvidence/listing/image/decision 等），写入收敛于 `lib/server/taskResultJsonMutation.ts`（CAS+storageVersion+mutationBoundary）。
- **AI/tools**：openai ^6.39（callAiJson 信封）、Provider 服务端开关、SSRF guard（432 行/134 测试）、XLSX 上传校验；浏览器：CDP bridge+系统 Chrome/Edge 隔离 profile+owned-process-tree（tools/collectors/amazon）、.playwright-cli 资产、tools/collectors/1688（browser-session/image-search）。
- **Skills**：skills/amazon-product-research（只读汇报型，不满足 V4 G1）、skills/sellersprite-market-preview（SKILL.md+测试）。
- **auth/sandbox**：accessPassword/accessSession/signedToken/demoAccess/demoGuard/demoSandbox（双匹配 fail-closed、5/30min lease、恢复幂等）。
- **测试/CI**：vitest 4.1.9（593 测试文件：lib 277/tools 179/app 73/components 47…；tests/ 仅 1 helper）；4 个 vitest 配置（含 project-materials/real-ai-smoke/task-linked-smoke）；唯一 CI `.github/workflows/ci.yml`（lint+tsc --noEmit+test+build on ubuntu）；scripts/*-browser.ts 真实浏览器 smoke 资产。
- **文档/发布**：docs/v3.1 15 份契约+README、docs/v3 全套、docs/archive/phase-reports、release/（22 linux tar.gz+manifest）、deploy/（runbook/nginx/systemd example）、vercel.json；无 public/ 目录。

## Gaps and Risks

| ID | 缺口/风险 | 证据 | 影响 | 最小动作 | Phase |
|---|---|---|---|---|---|
| G1 | amazon-product-research Skill 只读汇报，无规划—行动—观察—修订 | skills/amazon-product-research/SKILL.md | 核心差距：Research Agent 主链 | P1 图 + P2 Skill 改造 | P1/P2 |
| G2 | LangGraph 未安装、无图、无 Checkpoint/Revision 主链 | package.json/锁文件/node_modules | 主链缺失 | P1 依赖+骨架（spike 冻结元组） | P1 |
| G3 | 研究决定只有单一语义，缺 Gate A/Gate B | app/api/tasks/[id]/research-decision | 需拆双闸门 | P1 契约 + P3/P4 集成 | P1–P4 |
| G4 | 商业可行性未统一为区间+风险快照 | ProfitSnapshot/Risk 零件散落 | 决策质量 | P4 公式冻结 | P4 |
| G5 | 公网无法证明本地真跑过（Replay 缺失） | 无 replay 资产 | 公网价值 | P6 | P6 |
| G6 | GitHub 故事与 V4 状态未统一；README 陈旧（`ae67912`、MAINTENANCE ONLY） | README.md:5,155 | 发布故事 | P7 统一 | P7 |
| G7 | Listing/Image 缺版本化 Skill/Guard/policy pack | 现为代码门禁 | 行业化不足 | P5 | P5 |
| B1 | **基线 1 个确定性测试失败**（v3.1.0 tag） | handoff.product-journey-quota.test.ts：mock 缺 `approvedReferenceImageDataUrl`，image-handoff/route.ts:369 直读 | 全量回归门禁无法绿 | 用户决策：route 防御或修 mock | P1 前 |
| B2 | 版本字段漂移 2.2.16/2.1.7/v3.1.0 | package.json vs lockfile vs tag | 发布一致性 | P7 收口统一 | P7 |
| B3 | `/api/opportunities` legacy pipeline 在线无 410（A–E 评分残留） | route.ts 无 LEGACY_AGENT_DISABLED；orchestrator.ts RecommendationLevel A–E | 误引用即复活打分/MOQ 估算 | 用户决策（加 410 或删除） | P1 |
| B4 | `isDemoAccessExpired()` 无条件 false | demoAccess.ts:306 + 测试 214/232 | 过期访问依赖 isActive（注释明示刻意） | 用户确认语义 | — |
| B5 | `tasks/[id]/image-draft/[imageId]` GET 建议安全专项复核 | route.ts + aiImageTaskAccess.ts | 已有访问模块+测试，防御纵深 | P1 安全清单复核 | P1 |
| B6 | 并行负载下 2 个测试文件超时 flake | sqlite CAS / production-bundle.invariant | 隔离重跑全过 | 记录，不修 | — |

## Legacy Traps（禁止复活）

- `lib/agents/orchestrator.ts`（A–E 打分、score/level、MOQ 估算、"可做"结论）——UI 孤儿，任何页面不得重新引用。
- `app/api/opportunities/route.ts`（唯一消费者为孤儿组件 OpportunitiesForm）。
- `components/cross-border/OpportunitiesForm.tsx`（页面测试已断言不在候选池/导入页渲染）。
- `app/api/agents/summary|viral|sourcing|material|risk`、`app/api/generate` —— 保持 410，不拆开关。
- 旧 Agent summary 语义、1688 seller_claim 直接晋级、VOC/AI/competitor 自动成为 facts —— 由 factCandidates/creativeContextBuilder 门禁封死。

## P1 建议变更边界

- 预计复用：lib/server/taskResultJsonMutation.ts（graphVersion 存运行行语义）、resultJson 命名空间、demoGuard 鉴权、prisma/dev.db 本地链、AGENTS.md 集成树规则。
- 预计新增：LangGraph 冻结元组依赖（@langchain/langgraph 1.4.12 / checkpoint 1.1.5 / checkpoint-sqlite 1.0.4 / core 1.2.9，spike 已验证）、graph 骨架（graphVersion 门禁+SqliteSaver checkpoint）、Run Console 状态 UI、Gate A 决策契约、g1–g4 等价单测。
- 暂不触碰：prisma/schema.prisma（除非迁移决策）、真实 Provider/浏览器、公网部署、README 宣称。
- 建议验证命令：`npm run lint`、`npx tsc --noEmit`、定向 vitest、`npm run start:local` 页面冒烟、真实浏览器 E2E（P1 收口）。

## Commands and Results

| 命令 | 结果 |
|---|---|
| git rev-parse/branch/status/ls-remote | 53880c8… / main / clean / 远端 main 一致 |
| `npm run lint` | exit 0：0 error / 8 warning（既有） |
| `npx tsc --noEmit` | exit 0（类型检查通过） |
| `npm test` 全量 | 526 files：5335 passed / 4 failed / 90 skipped（B1/B6） |
| 隔离重跑 3 个失败文件 | 2 文件全过（flake）；1 例稳定失败（B1） |
| P0-A eslint 直跑 / P0-B 定向 9 文件 242 测试 / P0-C 4 纯函数 32 测试 | 全部 exit 0 |
| `git status --porcelain`（多次） | 始终 clean 至报告写入前 |
| 未执行 | build（写 .next、扰动 3005）、db:* 迁移/备份、真实浏览器自动化、依赖安装、任何 git 写操作 |

## User Decisions Needed

1. **B1**：handoff.product-journey-quota.test.ts 确定性失败——A=route 加防御（null 检查+fail-closed）、B=更新测试 mock。需在 P1 全量回归前裁定。
2. **B3**：`/api/opportunities` 是否加 410 门禁（与 agents/* 一致）。
3. **B4**：`isDemoAccessExpired` 无条件 false 为有意设计还是缺陷。

P0 门禁：关键断言均有文件/命令证据 ✅；已有/部分/仅文档声称已区分 ✅；无业务代码/依赖/Schema/数据改动 ✅；用户原有 dirty 改动未被覆盖（原本即 clean）✅。**P0 = PASS**，按用户授权自动进入 P1（graph skeleton）。
