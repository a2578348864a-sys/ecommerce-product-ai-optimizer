# Listing V5 最终冻结报告

- 日期：2026-09-12
- 仓库：`D:\Workspace\projects\project-001-listing-v5`（Git worktree）
- 分支：`feat/listing-v5-rebuild`
- 冻结提交：`eb2ce0d`（`fix(listing-v5): let a finished research task reach the creative confirmation`）
- 冻结 tag：`project-001-v5-final`
- 上游：`origin/feat/listing-v5-rebuild`

## 1. 冻结版本状态

| 项 | 结果 |
|---|---|
| 工作区 | clean（`git status --porcelain` 为空） |
| 同步 | `ahead=0 behind=0`，本地 = `origin` = tag 指向同一提交 |
| 未提交生产代码 | 无（`--ignored` 扫描 `app/ lib/ components/ scripts/ prisma/ tools/` 仅命中被忽略的 `prisma/dev.db`、`prisma/i-do-not-exist.db`） |
| 类型检查 | `npx tsc --noEmit` → 0 错误 |
| 静态检查 | `npm run lint` → 0 错误 / 7 条既有警告（全部 `@next/next/no-img-element`） |
| 构建 | `npm run build` → `✓ Compiled successfully`，62/62 静态页 |
| Listing V5 关键链路测试 | 73 文件 / **780 用例通过**（1 skipped） |
| 全量测试 | 7565 通过；2 个环境类失败（见 §4），隔离串行复跑均通过 |
| 运行时 | 3005 正常（`/`、`/listing-studio`、`/tasks` 均 200）；启动方式与开关见 §5 |

## 2. 核心链路与已完成能力

链路：**研究完成 → factCandidates 人工确认 → creativeHandoff → Listing V5 gate → Listing 生成 → validation/snapshot 持久化**

| 环节 | 代码入口 | 失败关闭语义 |
|---|---|---|
| 研究完成 | `lib/productResearchRecord.ts`（`researchRecord` / `researchVerification` / `researchCompletion`） | hash 校验失败 → `research_hash_invalid` |
| 事实确认（研究侧） | `lib/factCandidates.ts`、`app/api/tasks/[id]/fact-candidates/route.ts` | 只有 `confirmed` 才晋升为事实；`human_confirmed` + `user_confirmation` |
| 创作侧人工确认 | `components/studio/TaskStudioPreparation.tsx` + `lib/server/productCreativeHandoffPersistence.ts` | 零候选兜底仅接受"研究已确认事实 / 手工事实 / 视觉批准"，否则 `no_facts_selected` |
| V5 gate | `lib/server/productCreativeHandoffPreview.ts`（`checkCreativeHandoffGate`） | 逐级 fail-closed：任务不可访问→404；研究未完成 / 旧版 / 交接合同异常 → 各自原因 |
| 生成 | `app/api/tasks/[id]/listing-v5/route.ts` → `lib/listingV5/*` | Writer 无事实依据即回退安全模板；Validator 不给 PASS 不显示通过 |
| 持久化 | `lib/server/taskResultJsonMutation.ts`（CAS + 命名空间隔离） | 版本冲突 → 409；快照写入后按 fingerprint 判定 `stale` |

已具备的用户可完成路径（本轮实测）：

```
研究完成任务 → Listing Studio 显示「还差一步：完成创作资料人工确认」
→ 勾选人工确认并提交 → creativeHandoff 写入（active, revision 1, 12 条已确认事实）
→ 门禁解除（GET 200）→ 点击生成 → 安全检查通过 + 确定性 fallback 输出
→ 刷新状态保持 → 控制台无错误
```

## 3. 本轮两个修复提交的审计结论

| 你的检查项 | 结论 | 证据 |
|---|---|---|
| 未修改 Validator 规则放宽 | ✅ | 冻结范围（`91f1124..HEAD`）**未触及**任何受保护文件：`lib/listingV5/validation.ts`、`generation.ts`、`strategy.ts`、`structuredRepair.ts`、`conversionRewrite.ts`、`conversionRecovery.ts`、`claimVocabulary.ts`、`types.ts`（版本常量）、`trace.ts`、`benefitExpression.ts`、`conversionBlueprint.ts` |
| 未绕过 human_confirmed | ✅ | diff 中 `human_confirmed` 仅 2 处命中，**全部是注释**（说明"复用既有确认链"），无 `evidenceTier`、`confirmed: true`、`allowed: true`、`reason: "eligible"` 等硬编码 |
| 未伪造 creativeHandoff | ✅ | 未新增任何写入 `creativeHandoff` 的代码；唯一新增的写入是用户点击既有组件的「确认资料并继续」，走既有 `POST /api/tasks/[id]/creative-handoff` 与既有 `human_confirmed` 构造 |
| 未引入新的业务分支 | ✅ | gate 唯一行为改动是 `!hasProductResearchRecordNamespace` 分支内的细分（8 行），旧版返回保持原样；V5 路由新增的是 404/422 映射；客户端新增的是条件渲染 |
| 未影响 legacy 模式 | ✅ | 冻结范围**未触及** `app/listing-studio-legacy/**`、`components/listing-studio/ListingStudioClient.tsx`、`lib/listingHandoff/**`；浏览器实测 `/listing-studio-legacy?taskId=…` 弃用标识、task-linked 模式、authoritative 模式均正常 |

| 提交 | 内容 |
|---|---|
| `905ed19` | 现代任务判定抽为共享谓词（`lib/productResearchRecord.ts`）；gate 区分"研究未完成"与"旧版任务"；`/listing-v5` 不可访问任务改 404 `task_not_found`；门禁状态文案与 `gateBlocked` |
| `eb2ce0d` | Listing Studio 在 `no_confirmed_facts` 时挂载既有创作资料确认步骤；`submitPreparation` 补 `onCommitted` 回调；门禁文案改为准确表述 |

## 4. 已知非阻塞问题

1. **陈旧测试夹具**：`lib/listingHandoff/listingOperatorCopy.test.ts:415` 写死任务 `cmtdgivs6000nutmvkeymtg83`，该 id 在任何存储中都不存在（CI 无库时早退，故 CI 显示通过）。测试侧问题，非产品缺陷。
2. **负载型测试失败**：`lib/server/native1688Bridge.security.test.ts`（外部进程占端口）在整机高负载时会失败，隔离串行复跑通过。同类的还有 `scripts/release-package.test.ts`、`tools/upstream/stage15-*` 等超时敏感套件。
3. **任务详情「Listing 文本草稿」徽标读的是旧链**：`components/TaskRecordDetail.tsx:2176-2181` 依据 `listingHandoffBinding` / `aiListingPackSnapshot` 判断"已生成/待生成"，不识别 `listingV5` 快照。本轮实测该任务已有 `listingV5`（PASS）但页面仍显示「待生成」。显示层不一致，不影响 V5 链路。
4. **`backendSearchTerms` 既有边界**：共享硬词表按非字母数字分词，`leak-proof` 会被拦，但 `water-proof`（两个词都不在表内）仍可能通过；词表较宽（含 `only`/`every`/`high` 等），一致化后该字段可能被清空。属既有规则定义，未改。
5. **其他 AI 入口仍在全局开关之外**：`lib/agents/orchestrator.ts`、`app/api/generate`、`lib/workflows/productAnalysis.ts`、任务级 handoff 链（`docs/v3/changes/phase-6/proposal.md:37` 已正式裁定「handoff 后默认允许」）。`/api/products/*` 三个路由的开关绕过已在 `91f1124` 修复。
6. **legacy 回滚入口仍在线可达**：`/listing-studio-legacy` 与任务详情旧 `listing-pack` 卡片已加弃用标识（`799d12f` 之后的行为），未删除。
7. **`contractMode` 与 gate 的语义曾不一致**：已在 `905ed19` 统一为同一谓词（`isModernResearchTaskShape`），此为已修复项，保留在此以便追溯。

## 5. 运行环境说明与安全重启方式

**当前 3005 的启动方式**：由计划任务 **`QingXuanAgent-Local-3005-V5`（状态 Ready/启用）** 负责看护，其动作显式设置：

```
QX_RUNTIME_MODE=local_owner, LISTING_PROVIDER_MODE=mock, IMAGE_PROVIDER_MODE=mock,
OPENAI_LISTING_ENABLED=true, OPENAI_LISTING_VISITOR_ENABLED=false,
LISTING_V5_TRACE=1, ENABLE_AI_DIAGNOSTICS=0
→ scripts/run-local-service.ps1（端口空闲时自动 start:local，实测 3 秒内拉起）
```

**影响**：`GET /api/tasks/<id>/listing-v5` 返回 `realAiEnabled=true`。V5 任务路由的 provider 判定只看 `isRealAiListingEnabled()`，因此**在 3005 上点击「生成 Listing」会产生真实 DeepSeek 调用（付费）**；`LISTING_PROVIDER_MODE=mock` 只约束旧独立 Studio（所以「生成 Mock 草稿」是 mock）。另 `LISTING_V5_TRACE=1` 在生产构建下不生效（`isListingV5TraceEnabled()` 还要求非 production），实测 trace 未暴露。

这不是随机污染，而是既有的本地看护配置；按你的要求**未修改任何代码与任务配置**。安全重启方式（需你授权后执行）：

1. `Stop-ScheduledTask -TaskName 'QingXuanAgent-Local-3005-V5'`（或先 `Disable-ScheduledTask`）——停掉看护，避免被立刻拉回；
2. `node scripts/local-next-runtime.mjs stop`（自带属主校验，只停本项目 3005）；
3. 在**不带** `OPENAI_LISTING_ENABLED` 的干净 shell 里 `npm run start:local`；
4. 复核 `GET /api/tasks/<id>/listing-v5` 的 `realAiEnabled` 为 `false`，页面出现「安全演示模式（未启用真实 AI）」；
5. 如需恢复看护：`Start-ScheduledTask -TaskName 'QingXuanAgent-Local-3005-V5'`（会同时恢复 AI 开关）；若希望长期"默认安全"，应把该任务动作里的 `OPENAI_LISTING_ENABLED` 改为 `false`。

本报告的浏览器验收即遵循该原则：3005 上只做只读与 UI 验证，真实生成在**隔离实例 3016**（同库、开关关闭）完成，用后已停止（当前 3016 无监听）。

## 6. 作品集展示建议

**推荐展示的主线旅程（一条完整、可复现）**

1. 研究记录页：展示"研究已完成 + 已确认商品事实（12 条）"
2. Listing Studio：展示「还差一步：完成创作资料人工确认」→ 勾选 → 「确认资料并继续」
3. 生成结果：`安全检查通过` + 「确定性 fallback 输出 · 安全模板」+ 五点/描述/关键词分区
4. 失败关闭对照（很有说服力）：stale 任务显示「研究依据已更新，需重新生成」；未完成任务显示「商品研究尚未完成」；不存在的 id 显示「任务不存在」——三种状态**都不显示"通过"**

**可用的证据素材**

- 冻结提交：`eb2ce0d`，tag `project-001-v5-final`；完整收口链：`91f1124`（审计收口）→ `905ed19` → `eb2ce0d`
- 测试规模：Listing V5 关键链路 780 用例通过，全量 7565 通过
- 既有基准文档：`docs/listing-v5/BENCHMARK.md`
- 历史归档截图：`docs/archive/phase-reports/screenshots/**`（已入库，可直接引用）

**展示注意事项**

- 生成演示请使用"安全演示模式（未启用真实 AI）"的实例，既零成本也能体现"确定性回退"这一产品特性
- 录屏/截图前确认页面没有真实 AI Key、任务真实商品名等敏感内容；`prisma/dev.db`、`.env.local`、`data/demo-*.json` 均为受保护数据，**不要**截图或导出
- 讲述重点建议放在"证据纪律"而非"AI 生成"：事实候选人工确认 → 创作侧人工确认 → Validator 判定 → stale 失效 → 失败关闭

## 7. 后续不建议继续修改的范围

在冻结版本上继续改动以下范围，收益低而回归风险高，建议仅在出现确定性缺陷时按最小修复处理：

- `lib/listingV5/validation.ts` 的判定与阈值（`MAX_REPAIRABLE_*`、硬词表）
- `lib/listingV5/` 的 Writer / Strategy / Repair / Rewrite / Recovery prompt 文本与版本常量
- `lib/server/productCreativeHandoffPreview.ts` 的 gate 阶梯顺序与语义（当前每个分支都有对应文档与测试）
- `lib/productResearchRecord.ts` 的合同 schema / hash 规范（改动会使全部历史快照失效）
- `app/api/tasks/[id]/listing-v5/route.ts` 的响应契约（`provider` 标志、snapshot 投影字段）
- 旧回滚链（`/listing-studio-legacy`、`listing-pack`、`lib/listingHandoff/**`）：只做弃用引导，不做删除或重构
- 数据库 schema 与迁移：冻结版本不引入任何迁移
- 任何"为了让测试全绿"而放宽断言的改动
