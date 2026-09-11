# FINAL_CLOSE_REPORT.md — 轻选工作台 V5 最终收口报告

- 报告日期：2026-09-12（本地时区）
- 仓库：`D:\Workspace\projects\project-001-listing-v5`
- 分支：`feat/listing-v5-rebuild`
- 本轮收口提交：`91f1124`（`feat(listing-v5): close final product audit gaps`）
- 报告提交：本文件所在提交（见 §6）
- 上一提交：`799d12f`

## 1. 最终判断

**CONDITIONAL PASS**

四个指定问题全部修复并验证，全部要求的用户链路已在真实浏览器中完成（含生成、状态三场景、刷新一致性、控制台、移动端）。存在**非阻塞**遗留项（§3）：一条改动前就存在的测试侧陈旧夹具、以及若干本轮明确不扩大范围而未动的既有风险。无阻断问题。

判定口径：

| 判定 | 含义 | 本轮 |
|---|---|---|
| PASS | 所有用户链路真实完成 | 链路全部完成（§5） |
| **CONDITIONAL PASS** | **存在非阻塞问题** | **采用：§3 的非阻塞遗留项** |
| FAIL | 存在阻断问题 | 无 |

## 2. 修复内容

### 2.1 修复 AI 全局开关绕过（最高优先级）

**问题**：`/api/products/listing-copy`、`/api/products/ai-analysis`、`/api/products/keywords` 三个路由直接调用 `callAiJson`，**完全没有**服务端 AI 开关检查；而 `/api/listing-studio`、`/api/image-studio` 都走了 gate。因此 `OPENAI_LISTING_ENABLED=false` 时这三个路由仍会真实调用 Provider。

**入口可达性（这是关键判断依据）**：Phase 6 风险表把「旧 listing-copy 链无 gate」判为「页面已停新入口 → 风险关闭」（`docs/v3/changes/phase-6/proposal.md:40`）。但实测该前提今天不成立：`app/products/new/page.tsx:3,68` 渲染 `ProductProfitForm`，且 `components/WorkspacePlaceholderPage.tsx:44`、`components/cross-border/RiskCheckForm.tsx:522` 都有指向 `/products/new` 的站内链接 → 绕过是可点击到达的，不是纯 API 层风险。

**改法（复用既有 gate，不新写逻辑）**：

| 文件 | 改动 |
|---|---|
| `app/api/products/listing-copy/route.ts` | 新增 `import { isRealAiListingEnabled }`；在 parse 之后、demo 配额之前判断，关闭时返回 `403 { code: "real_ai_disabled" }` |
| `app/api/products/ai-analysis/route.ts` | 同上 |
| `app/api/products/keywords/route.ts` | 同上 |

设计要点：

- 复用 `lib/server/realAiListingGate.ts` 的既有 helper，未新增 gate 模块、未复制逻辑。
- 返回码 `real_ai_disabled` 与消息「真实 AI 服务暂未开启，本次没有消耗额度。」沿用客户端已有映射（`lib/client/studioErrorMessage.ts:6`、`lib/client/studioIdempotency.ts:12`），前后端契约一致。
- 位置放在**鉴权与请求校验之后**（无密码/非法请求体仍返回原状态码 401/400，契约不变）、**demo 配额之前**（关闭时不会预留/消耗额度）。
- 权限校验与配额逻辑未改动；**未**为这三个路由追加 Visitor 专用开关（那会改变 Visitor 现有能力，属扩大范围，见 §3.5）。

**测试**：

| 文件 | 用例 |
|---|---|
| `app/api/products/listing-copy/route.test.ts` | 关闭时 403 + `real_ai_disabled` + **`callAiJson` 未被调用**；关闭时非法请求体仍 400；开启时原行为不变 |
| `app/api/products/keywords/route.test.ts`（新增） | 同上三例（该路由此前无专属测试） |
| `app/api/products/ai-analysis/route.test.ts` | 关闭时 403 且 Provider 未被调用；原有 3 例显式开启开关后保持通过 |

### 2.2 修复 Listing Studio 状态显示错误

**问题**：`components/listing-v5/ListingStudioV5Client.tsx` 的绿色「安全检查通过」只判断 `listing` 是否存在；「已校验」徽标与两条绿色断言（"仅使用已确认事实"、"Claim / Runtime / Copy 校验"）**无条件渲染**；客户端**从不读取** API 已返回的 `snapshot.stale`；服务端 `gate.reason` 被丢弃（只显示 message）。因此在 BLOCK / REPAIRABLE / stale / 门禁拒绝时，页面都会给出「通过」的错觉。

**改法**：新增唯一映射 `lib/client/listingV5SafetyDisplay.ts`，优先级 **门禁拒绝 > stale > 无草稿 > 校验状态**：

| 状态 | 徽标 | 允许出现"通过" |
|---|---|---|
| 服务端门禁拒绝（含错误码与原因） | 未通过服务端门禁，无法校验 | 否 |
| `stale=true` | 研究依据已更新，需重新生成 | 否 |
| 无草稿 | 尚未生成草稿 | 否 |
| `validation.status=PASS` 且未过期 | 安全检查通过（并注明仍需人工复核） | **是** |
| `REPAIRABLE` | 已自动修复，仍需人工复核 / 存在待修复项，仍需人工复核（按 `repairAttempted` 区分） | 否 |
| 无结论 / 其他（BLOCK、NOT_RUN…） | 缺少校验结论 / 安全检查未通过 | 否 |

客户端改动：徽标改为 `data-testid="listing-v5-safety-badge"` + `data-safety-tone` 驱动；新增显眼的过期/未通过提示条 `data-testid="listing-v5-safety-notice"`；区块徽标 `data-testid="listing-v5-section-status"`；保留并新增 `errorCode` 状态以显示门禁真实原因；无草稿时不再渲染三条通过性断言，改为「还没有草稿，因此没有任何校验结论」。通过文案**只**来自映射函数（组件内已无该字面量，并有测试钉住）。

**测试**：`lib/client/listingV5SafetyDisplay.test.ts`（9 例：PASS / stale / BLOCK / REPAIRABLE×2 / 无草稿 / 无结论 / NOT_RUN / 门禁优先级）+ `components/listing-v5/ListingStudioV5Client.safetyDisplay.test.ts`（接线钉：不得再硬编码通过文案、必须读 `stale`、必须暴露门禁错误码）。

### 2.3 处理 V4 legacy 外露入口（不删除，保留回滚）

| 文件 | 改动 |
|---|---|
| `app/listing-studio-legacy/page.tsx` | 新增弃用提示条（`data-testid="listing-studio-legacy-deprecated"`）：说明是 V4 旧版、不经过 V5 Validator/证据绑定/人工复核门禁，并提供「前往新版 Listing Studio」链接（**带 taskId 跳转**，避免用户掉进独立模式）。V4 编辑器本体、CSS 模块、页面注释中的回滚用途全部保留 |
| `components/ListingPackCard.tsx` | 卡片顶部新增旧链说明 + 同样的新版链接（`data-testid="listing-pack-deprecated-notice"`）。生成/保存/复制能力全部保留 |

**测试**：`components/listing-studio/legacyEntryDeprecation.test.ts`（3 例，同时钉住「标识存在」与「V4 编辑器/旧按钮未被删除」）。

### 2.4 backendSearchTerms 风险检查与最小修复

**确认存在绕过**：`lib/listingV5/validation.ts` 对 `backendSearchTerms` **0 命中**（Validator 从不检查该字段），而它会直接下发到客户端。`lib/listingV5/conversionRewrite.ts` 已经为此写了过滤器（其注释原文即指出「the one field no Validator rule inspects」），但**只用在 rewrite 路径**：

- `lib/listingV5/generation.ts:78` 确定性 fallback：`strategy.keywordIntent.backendOnly.slice(0, 8)` 原样下发；
- `lib/listingV5/generation.ts:100` Writer 归一化：只用 `clean()`（9 个词）过滤，硬词表未生效。

**改法（最小、且不新增 Validator 规则、不改词表）**：把既有规则提为共享模块 `lib/listingV5/backendTermSafety.ts`（`filterListingV5BackendSearchTerms`），`conversionRewrite.ts` 改为引用（行为不变），`generation.ts` 两条路径全部接入；顺带丢弃空字符串条目（同一模块内的 1 行收紧，只减少垃圾项）。

**测试**：`lib/listingV5/backendTermSafety.test.ts`（5 例：硬词过滤、顺序/上限、其他字段不受影响、**fallback 路径**、**Writer 归一化路径**）。

## 3. 未修问题（非阻塞，均如实记录）

1. **`lib/listingHandoff/listingOperatorCopy.test.ts` 仍红**（改动前即存在，非本轮引入）：用例写死真实任务 `cmtdgivs6000nutmvkeymtg83`，该 id 在任何存储中都不存在（`prisma/dev.db` 无 Task 表；CI 无库时该用例 `existsSync` 早退，因此 CI 显示通过而本地失败）。属测试侧陈旧夹具（class E）。本轮未修：既不在指定四项内，也不得通过改弱断言处理。
2. **V5 来源标注可反转（路由侧，未修）**：`app/api/tasks/[id]/listing-v5/route.ts` 在 Writer 失败时置 `fallbackUsed=true`，随后 repair/recovery 可能用 AI 文本覆盖草稿而不复位该标志（rewrite 路径有 `writer_stage_failed` 守卫，repair/recovery 没有）。UI 现已如实显示后端标志，但标志本身在真实 AI 开启时可能失真。属 V5 写入路径改动，超出本轮范围。
3. **`backendSearchTerms` 残余边界**：共用词表按非字母数字分词，因此 `leak-proof`（含 `leak`）被拦，但 `water-proof` 这类「两个词都不在表内」的连字符写法仍可能通过；且词表很宽（含 `only`/`every`/`all`/`high` 等），一致化后该字段可能被清空。两者都是**既有边界**的定义，本轮只做一致性接入，未改词表（改词表等于改规则，属禁止项）。
4. **其他 AI 调用入口仍在开关之外（已文档化裁定，未动）**：`lib/agents/orchestrator.ts`（`/api/agents/*`）、`app/api/generate/route.ts`、`lib/workflows/productAnalysis.ts`、任务级 handoff 链（`listingGenerationService`/`taskLinkedAiListing`）等。其中任务级 handoff 链在 `docs/v3/changes/phase-6/proposal.md:37` 被正式裁定为「handoff 后默认允许」，旧入口（`/api/generate`、`/api/agents/*`）同在风险表内判为「API 保留兼容不扩展」。本轮只修用户指定的三个 products 路由，未扩大范围。
5. **未为三个 products 路由追加 Visitor 专用开关**：`/api/listing-studio` 等还有 `isRealAiVisitorListingEnabled()` 一层。给旧链加上会让 Visitor 默认失去该能力（能力变更，非本次目标），故只加全局开关。
6. **旧 `listing-pack` 卡片在当前数据下不可达**：它位于 `TaskRecordDetail` 的 `hasListingPrep` 分支内，而当前 10 个任务全部是 `type=workflow` 且无 `listingPrepSnapshot`，实测 4 个任务详情页都未渲染该卡片。因此 §2.3 的卡片标识为**代码级修复 + 源码钉测试**，浏览器不可达（不是回归，`app/listing-studio-legacy` 的弃用标识已在浏览器实测通过）。
7. **不存在的任务 id 被报为 `legacy_not_supported`**：截断/不存在的 id 与真实旧任务的错误码相同，排查时容易被误导（本轮我自己就先被误导一次）。属既有对外契约，未改。

## 4. 测试结果

在提交 `91f1124` 的工作区上实测：

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | **exit 0，0 错误** |
| 静态检查 | `npm run lint` | **exit 0，0 错误 / 7 警告**（全部为既有 `@next/next/no-img-element`） |
| 构建 | `npm run build` | **exit 0**，`✓ Compiled successfully in 19.0s`，**62/62** 静态页 |
| 全量测试 | `npm test` | **1 failed / 7553 passed / 79 skipped（7633）**；文件级 1 failed / 656 passed / 63 skipped（720） |
| 本轮新增 | — | **+26 个用例**（7607 → 7633），分布：products 三个路由 6、backendTermSafety 5、safetyDisplay 9、客户端接线 3、legacy 标识 3 |
| 唯一失败 | `lib/listingHandoff/listingOperatorCopy.test.ts` | §3.1 的陈旧夹具，**改动前后完全一致**，非本轮引入 |

未执行：真实 AI / Provider 调用（本轮禁止，且开关全程关闭）。未为了通过而删除测试、skip 测试或弱化断言。

## 5. 浏览器验收结果

真实浏览器（`playwright-cli`，真实 Chrome）访问 **http://127.0.0.1:3005**，服务端为**本轮新构建**（构建后才重启，浏览器取到的是新代码；服务端 AI 开关与 trace 均未开启）。

| # | 场景 | 真实数据 | 结果 |
|---|---|---|---|
| 1 | 独立模式打开 `/listing-studio` | 无 taskId | 页面正常、控制台 **0 错误 0 警告**、入口标识齐全 |
| 1b | **生成流程**（独立 Mock） | 填写商品名/描述 + 勾选人工确认 → 点击「生成 Mock 草稿」 | 生成成功（复制/导出按钮转为可用，出现标题分区）。服务端 mock 分支返回 `saved:false` → **不写库**。刷新后：表单输入保留、Mock 草稿不保留（Mock 为免费预览，服务端明确不保存），与本次改动无关 |
| 2 | **场景1 PASS → 显示通过** | `cmtwkhaci000honodyk1fmfi2`（原本无快照） | 生成前：`尚未生成草稿`；点击「生成 Listing」（AI 关闭 → 确定性回退稿）并刷新后：`data-safety-tone="pass"`、「安全检查通过」、草稿渲染；**刷新后状态一致** |
| 3 | **场景3 stale → 明确提示，不显示通过** | `cmtwkikd6000konod02isod49`（PASS+stale） | `data-safety-tone="stale"`、「研究依据已更新，需重新生成」+ 说明条；`安全检查通过` = **false**、`已校验` = **false** |
| 4 | **场景2 门禁拒绝 → 不显示通过** | `cmtwk2b5i00089px2cove9eq0`（422 `research_stale_requires_reconfirmation`） | `data-safety-tone="blocked"`、「未通过服务端门禁，无法校验」+「研究依据已更新，需要重新确认后才能生成。（错误码：…）」；通过性文案 = false |
| 5 | 控制台 | 上述全部页面 | 独立模式与 stale 页 **0 错误**；门禁拒绝页仅 1 条浏览器对 422 响应的**资源级**记录（应用无未捕获异常） |
| 6 | 移动端 390×844 | `/listing-studio`、task-linked PASS、task-linked STALE、`/listing-studio-legacy` | 四页 `documentElement.scrollWidth == 390` → **无页面级横向溢出**；徽标状态与桌面一致 |
| 7 | V4 legacy 弃用标识 | `/listing-studio-legacy` | 标识在位、新版引导链接在位，且 **V4 编辑器仍正常渲染**（回滚能力保留） |

证据：`.playwright-cli/` 下的会话快照与截图（该目录被 `.gitignore` 忽略）。本轮我无法读图（当前模型不支持图像输入），因此**未做截图视觉判定**，仅以 DOM 实测为准。

数据副作用说明：为验证场景 1，在**原本没有快照**的任务 `cmtwkhaci000honodyk1fmfi2` 上通过产品自身流程生成了一份确定性草稿快照（未覆盖任何历史快照、未手工改库）。除此之外无任何写操作；未改数据库结构、未跑迁移、未做真实 AI 调用。

## 6. Git

- 收口提交：`91f11248235b169692bfe577c0d4dc0fab315dcf`（`feat(listing-v5): close final product audit gaps`，17 文件，+800/−41）
- 提交方式：**逐文件 `git add`**，未使用 `git add .` / `git add -A`；提交前已核对暂存清单
- 工作区：提交后 `git status --porcelain` **为空**
- 历史未改写：未 `reset --hard`、未 force push、未 merge main、未删除任何历史工作树或旧链
- stash：仍为 3 条（husky/lint-staged 的临时 stash 已自动清理）
- **未推送**：本轮指令为「提交」，未包含 push；`feat/listing-v5-rebuild` 现领先 `origin` 若干提交，需要时请明确授权推送

## 7. 当前项目状态

- 代码：四项收口已提交，工作区干净；产品行为在开关关闭时**不再有可点击到达的真实 AI 绕过**
- 测试：7633 项中 7553 通过；唯一红为 §3.1 的测试侧陈旧夹具
- 运行：本机 3005 正常（`/` 与 `/listing-studio` 均 200）；真实 AI 开关与 trace 均未开启；由计划任务管理的实例提供服务
- 未动的边界（按指令）：未新增业务功能、未重构架构、未升级技术栈、未改 Validator 规则策略、未改 Writer Prompt、未删除旧版本回滚链、未引入新 AI Provider、未做 V6 设计

## 8. 建议的后续动作（非本轮范围）

1. 修掉 §3.1 的陈旧夹具（推荐做法：把写死的任务 id 换成真实存在的数据，或在无数据时**显式** skip 并说明原因，不得改弱断言）。
2. 评估 §3.2 的来源标注复位，并在真实 AI 窗口做一次回归。
3. 若确认不再使用 `/products/new` 旧链，按 Phase 6 的「退役候选」流程处理入口；在退役前，本轮的 gate 已使其默认安全。
4. 补 `backendSearchTerms` 的连字符/词表边界（属规则变更，需单独评审）。
