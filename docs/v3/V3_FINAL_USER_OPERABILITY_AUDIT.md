# V3 Final User Task & Operability Adversarial Audit — 最终报告

> 状态：FINAL_USER_OPERABILITY_AUDIT = COMPLETE（严格只读；本文件未进入 main，等用户确认）
> 基线：main == origin/main == 737b6bf；docs-only worktree codex/v3-final-operability-audit
> 方法：6 路并行专项审计 + 主线程 OA6 深挖（build 产物实证）+ 用户真实浏览器反馈交叉验证
> LOCAL_RELEASE_CANDIDATE = REOPENED_FOR_OPERABILITY_AUDIT；PUBLIC_DEPLOY = FORBIDDEN

## 第一句话

**这不是"还剩几个 bug"的问题，而是轻选工作台仍然没有做到普通人可以独立使用**：一个没看过开发文档的用户，目前会被三处卡死——①点"开始研究"后落入叫"商品研究记录"的页面再被要求"开始 AI 研究"（三个"开始"撞车、AI 被文案说成研究前置条件）；②1688 供应线索只有"去 CLI 扫码登录/去加载扩展"两行文字，没有任何可点按钮、安装步骤或登录入口；③Amazon 浏览器证据在生产环境 **100% 失败**（SWC minify 把提取表达式内联函数名压缩成单字母，浏览器执行时 `ReferenceError: s is not defined`），错误还被原样贴给用户。架构主链是顺的，**产品化操作层是断的**。

## 定级

| 级 | 数量 | 项 |
|---|---|---|
| P0 | **0** | 无数据破坏/跨用户/错误自动操作 |
| P1 | **3** | OA6+OA7（Amazon Browser 生产 100% runtime 失败 + 技术栈直出）、OA4（1688 onboarding 不可操作）、OA1（主导航无法找到活跃研究） |
| P2 | **4** | OA2（Active Task 误称"商品研究记录"）、OA3（三个"开始"CTA 撞车 + AI 被文案描述成 Research Gate）、OA5（VOC 自动采集缺失 + 批量粘贴能力不透明）、预填/进行中分组（自动化机会） |

## OA 验证结论（用户 44 节：逐一实证，非直接采信）

### OA6 — Amazon Browser `s is not defined`（P1，实证成立）

**Root Cause（build 产物实测，file:line）**：
1. `tools/collectors/amazon/detail-page-extract.ts:340-363` 用 `fn.toString()` 把 14 个模块函数内联进 Runtime.evaluate 表达式，IIFE 内以**源码原名**声明 const
2. 生产构建 SWC minify 把模块函数压缩为单字母——集成树 `.next/server/app/api/tasks/[id]/browser-evidence/route.js` 实测：`const detectDetailPageStatus = ${z(s)}`（z=functionSource、s=压缩后的函数）
3. 内联函数体（minified 源码）内部调用的是压缩名 `s(...)`，页面作用域只有 `detectDetailPageStatus` → **ReferenceError: s is not defined**（`anonymous:16:61` = extractAmazonDetailPage 体内 `s(root)` 调用行）
4. **影响范围**：Browser Evidence collect 唯一入口（`browserEvidenceCollect.ts:175`）→ 生产模式 **100% 失败**
5. **为什么测试没抓住**：vitest 不 minify，`fn.toString()` 返回原始名，与 IIFE 声明一致 → 全部 fixture PASS；缺生产构建产物冒烟
6. **同一脆弱模式共 4 处**（系统性风险）：detail-page-extract.ts:340-363、extract-search-page.ts:252-271、page-diagnostics.ts:694-718、tools/collectors/1688/*（旧路径）
7. 修复方向（不实施）：该模块关闭 minify（next.config 排除）或表达式改自包含生成（不依赖 fn.toString()）+ 生产构建冒烟断言

### OA7 — 技术错误泄漏（P1，实证成立）
- `browser-control.ts:552` 抛 `CDP_RUNTIME_EVALUATION_FAILED: …` → `browserEvidenceCollect.ts:200-211` **把原始技术串拼进用户文案** → route 直通 → `BrowserEvidenceSection.tsx:306` 直显——用户截图证据链完整
- 全库 **15 处 Top 泄漏**（完整清单见下 Output 8），含：`V35_1688_CLI_PATH` 环境变量直出（sourcingAcquisition.ts:313）、`pageKind/pageUrl` dump（sourcingImageAcquisition.ts:254）、`expectedStorageVersion` 字段名、`R2.2` 阶段号、`Creative Handoff` 英文模块名、Provider/账本细节
- **SourcingEvidencePanel 文案分流只覆盖 5 个 code，其余全部原样渲染服务端 message**（need_login/error 横幅均直出，已确认到达 UI）
- 已有最佳实践可复用：`lib/client/studioErrorMessage.ts`（code→文案 + 未命中 fallback 不直出）

### OA1 — 缺少"研究中"（P1，实证成立）
- 候选池"开始研究"→ 创建骨架 Task → 跳 /tasks/[id]，该页 h1"商品研究记录"+"研究记录待补充/人工决定待确认"→ 认知断裂真实
- "继续昨天研究"**路径存在但进行中不可见**：/tasks 有 pending/need_info 加权置顶（TaskRecordsList.tsx:297-308）+ decisionStatus 过滤，但无"进行中"单一分组
- **裁决：Option B**——/tasks 内部 [进行中][待补信息][已完成][已放弃] Tab（复用现有 filter，零新路由）；Option A（新增导航层）会造成 4 个近义入口，不推荐

### OA2 — Active Task 误称"商品研究记录"（P2，实证成立）
- `TaskRecordDetail.tsx:1410-1412` h1 硬编码"商品研究记录"；建议改「商品研究」（URL /tasks/[id] 不变）

### OA3 — "加入研究→开始 AI 研究"重复（P2，实证成立但代码层 Evidence-first 成立）
- 三个"开始"CTA：开始研究（候选池）/ 开始 AI 研究（引导卡）/ 开始商品研究
- **Evidence-first 代码层成立**：六个证据区均无 researchRecord 前置 gate（竞品/关键词/VOC/货源/浏览器/AI 总结独立可用）
- **文案层矛盾**：F1 引导卡"先执行 AI 商品研究…保存后再收集 Evidence"把 AI 描述成前置条件——应改为"AI 整理当前已有资料（可选，随时可跑）"；引导卡第二个动作改名为"AI 整理当前资料"或"生成研究摘要"

### OA4 — 1688 onboarding 不可理解（P1，实证成立）
- 后端分能力 gate 正确（F3），但前端把"未就绪"翻译成三段静态文字：**无登录按钮、无二维码、无安装步骤、无重新检测、无自动恢复**
- 1688-cli login 在 FORBIDDEN_COMMANDS——当前产品没有任何登录入口，用户只能自己开终端
- RECOMMENDED：业务动作优先 + 每入口就近就绪态（浏览器助手 ✅/❌、1688 登录 ✅/❌）+ [完成 1688 登录] CTA + 扩展 3 步引导 + [已加载，重新检测] + 自动检测恢复

### OA5 — VOC 只有单条手工（P2，部分成立）
- **"只能手动一条"是误解**：已支持多行批量粘贴（textarea 每行一条，≤300，VocEvidenceSection.tsx:447）+ 去重/上限/实体绑定
- **无自动采集**（生产零 review collector）；历史 smoke 证明详情页 Top Reviews 片段提取可行（29 条全链路验证过）
- **Feasibility = PARTIAL_FEASIBLE**：半自动（详情页公开 Top Reviews 片段→Preview→人工确认→导入）可行，全自动（评论全文页）登录墙不绕过——不可行
- 文件导入（CSV/XLSX）：无，但 SellerSprite XLSX 安全解析范式可复用

## Output 1 — Current User Journey（用户语言）

1. **找商品**：上传 SellerSprite XLSX → 选品 → 加入候选池（✅ 可独立完成）
2. **加入研究**：点"开始研究"→ 跳"商品研究记录"页 ← 认知断裂（OA1/OA2）
3. **开始研究（重复）**：新页面"研究尚未开始 → 开始 AI 研究" ← 第二个"开始"（OA3）
4. **收资料**：六区独立可用，但文案暗示"先跑 AI" ← 文案与能力矛盾（OA3）
5. **AI 整理** → **人工决定** → **Listing/Image**（✅ 主链正常）
6. **1688**：只有"去 CLI 扫码/去加载扩展"文字 ← 无法操作（OA4）
7. **VOC**：批量粘贴可用但未明示；无自动采集（OA5）
8. **Amazon**：点击采集 → 生产 100% 失败 + 技术栈直出（OA6/OA7）

## User Task Map（14 任务 × 9 问）

| 任务 | 入口在哪 | 知道入口吗 | 知道下一步吗 | 外部依赖 | 能自动吗 | 不能自动有 fallback | 失败恢复 | 暴露内部实现 | 不看 README 能完成 |
|---|---|---|---|---|---|---|---|---|---|
| 找商品 | /opportunities 上传 XLSX | ✅ | ✅ | SellerSprite 导出（用户） | 解析自动 | 手工添加候选 | 错误提示+重试 | 轻微（报表类型名） | ✅ |
| 加入研究 | 候选池"开始研究" | ✅ | ⚠️ 落入"研究记录"页困惑 | 无 | ✅（F1） | — | — | ⚠️ 状态词"待补充" | ⚠️ 能点但认知错位 |
| 查看正在研究 | /tasks（无"进行中"分组） | ⚠️ 无直接入口 | ⚠️ 需自己翻译状态 | 无 | 可自动分组（未做） | 搜索/筛选 | — | ⚠️ 三套状态词 | ⚠️ 能找到但费解 |
| 补市场资料（SellerSprite 快照） | Workbench 商品概览 | ✅ | ✅（只读展示） | 导入时已带 | ✅ 已自动 | — | — | 无 | ✅ |
| 查看竞品 | Workbench 竞品区 | ✅ | ✅ 手动加 ASIN | 无 | 可选增强（报表带入） | 手动输入 | 错误提示 | 无 | ✅ |
| 补关键词 | 上传 XLSX | ✅ | ⚠️ 只能 XLSX | SellerSprite 导出 | 解析自动 | 无粘贴替代 | 错误提示 | 无 | ✅ |
| 采集 Amazon 信息 | 「采集页面证据」 | ✅ | ✅ | 本机 Chrome | ✅ 全自动（但生产 broken） | 手动核对商品页 | ⚠️ 技术栈直出 | ❌ CDP/ReferenceError | ❌ 生产不可用 |
| 采集买家评论 | 「导入评论」粘贴 | ✅ | ⚠️ 不知道能批量 | 无 | 半自动可行（未做） | 批量粘贴 ✅ | 冲突已修复 | 无 | ✅（手动） |
| 找 1688 供应线索 | 三入口 | ✅ | ❌ 未就绪时无操作 | CLI 登录+扩展 | 登录/安装后自动 | ❌ 只有文字无按钮 | ❌ 无重新检测 | ❌ 1688-cli/扩展术语 | ❌ 卡死 |
| 让 AI 整理资料 | 「生成 AI 证据总结」 | ✅ | ✅ | AI provider | ✅ | — | 配额/失败提示 | ⚠️ runId/model 展示 | ✅ |
| 看缺失 | Missing 区 | ✅ | ✅ | 无 | ✅ 静态派生 | — | — | 无 | ✅ |
| 做决定 | 决定面板 | ✅ | ✅ | 无 | 不该自动 | — | 冲突自动重载 | 无 | ✅ |
| 进入创作 | Studio 链接 | ✅ | ✅ | AI provider | 不该自动 | — | 门禁提示 | ⚠️ Handoff 术语一处 | ✅ |
| 查看历史研究 | /tasks 已完成 | ⚠️ 与进行中混在一起 | ⚠️ 无历史分组 | 无 | 可分组（未做） | 搜索 | — | 无 | ⚠️ 混排费解 |

## Output 2 — Friction Map

| 步骤 | User Goal | 现状摩擦 | Severity |
|---|---|---|---|
| 加入研究 | 进入研究工作区 | 落入"研究记录"命名页 + "待补充"状态 | P1 |
| 1688 关键词 | 登录后搜索 | 无登录按钮/二维码/向导 | P1 |
| 1688 图片 | 装扩展后图搜 | 无安装步骤/检测/恢复 | P1 |
| Amazon 采集 | 一键采集 | 生产 100% 失败 + CDP/ReferenceError 直出 | P1 |
| 开始研究 | 一次开始 | 三 CTA 撞车 + AI 文案成 gate | P2 |
| VOC 采集 | 批量拿到评论 | 批量粘贴不透明；无半自动采集 | P2 |
| 补资料 | 少输入 | VOC ASIN/图搜 URL/关键词需手输（数据已有） | P2 |
| 继续昨天研究 | 找到进行中 | 无"进行中"分组（Option B 修复） | P2 |

## Output 3 — Navigation / IA Decision
**Option B**：研究记录内部 [进行中][待补信息][已完成][已放弃] Tab；Active Task Detail 标题改「商品研究」；URL 不变；零新路由，复用 decisionStatus 过滤 + 加权置顶。

## Output 4 — External Tool UX

| 能力 | 当前 | 目标 | 术语暴露 |
|---|---|---|---|
| SellerSprite | 上传 XLSX（可完成） | 保持 + 导出引导 | 轻微 |
| Amazon 采集 | 一键采集（后端全自动）但生产 broken | 修复表达式 + 用户层文案 | 严重 |
| 1688 登录 | 静态文字"完成 1688-cli 扫码登录" | [登录 1688] CTA + 二维码 + 自动检测 | 严重 |
| 1688 扩展 | 静态文字"chrome://extensions 加载" | 3 步引导 + [已加载，重新检测] | 严重 |

## Output 5 — Automation Opportunities

| 项 | 分类 |
|---|---|
| Review collection（半自动） | SHOULD（PARTIAL_FEASIBLE；当前商品+竞品可选、≤20/次、单 ASIN 100/总 300、reviewId 或 asin+hash 去重、ASIN 三一致、Preview→人工确认、登录墙 fail-closed） |
| Amazon identity / 商品 URL | DONE（F4 已修） |
| 1688 登录引导 | SHOULD（CTA+二维码，登录动作本身 MUST_BE_HUMAN） |
| Extension readiness 检测+恢复 | SHOULD |
| Evidence refresh（新证据后） | OPTIONAL |
| AI summary refresh（证据变化提示） | OPTIONAL |
| VOC ASIN 预填 / 图搜 URL 预填 / 关键词默认词 | SHOULD（数据已有，成本极低） |
| 无限爬取 / CAPTCHA bypass / 自动下单 | DO_NOT_AUTOMATE |

## Output 6 — VOC Product Plan
- 保留：单条/批量粘贴（明示"每行一条、一次最多 300 条"）+ 分析 + 清空
- P1 优先：批量粘贴能力文案明示（表单标题/说明）
- P2：半自动「采集评论」按钮（PARTIAL_FEASIBLE 五步方案）；文件导入可选（复用 XLSX 范式）
- 样本量语义：显示"已导入 N 条 / 覆盖 M 个 ASIN"，1 条时不呈现为完整 VOC 数据集

## Output 7 — Runtime Bug List
1. **Amazon Browser `s is not defined`**（P1）：root cause/reproduction 见 OA6；生产 100% 失败；测试缺口=无生产构建冒烟
2. **AiEvidenceSummarySection 错误渲染分支 bug**（P2）：已有总结时"重新生成"失败 → 错误静默（error 只在 summary===null 分支渲染，AiEvidenceSummarySection.tsx:86/172）
3. **EvidenceWorkbench 四区静默失败**（P2）：voc/browser/aiSummary/keyword 初始加载 catch 为空——失败=空态，无法区分"没数据"与"加载失败"
4. **全库 fetch 无超时**（P2）：服务挂起时可能永久 spinner（无 AbortSignal.timeout）

## Output 8 — Technical Leakage List（Top 10）

| 位置 | 现状 | 建议 |
|---|---|---|
| BrowserEvidenceSection:306 | `页面提取脚本执行失败：CDP_RUNTIME_EVALUATION_FAILED: ReferenceError: s…` | "页面提取失败：商品页结构可能变化，请稍后重试或手动核对商品页。"（诊断进日志/detail） |
| browserEvidenceCollect:210 | `浏览器采集失败：<原始 message 240 字>` | 统一用户文案，raw 进日志 |
| SourcingEvidencePanel:291 | `未配置 1688 获取工具（V35_1688_CLI_PATH）…`（env 变量直出） | "1688 获取工具尚未配置，请先完成 1688 登录与工具配置。" |
| SourcingEvidencePanel:307 | `1688 图搜页面未就绪（pageKind=…；pageUrl=…）` | "1688 图搜页面未就绪，请确认图搜页已打开且扩展已刷新。" |
| SourcingEvidencePanel（CLI 失败） | `1688-cli search 失败（<code>：<message>）` | "获取 1688 数据失败，请稍后重试；若持续失败请重新登录。" |
| 各 evidence route | `缺少或非法的 expectedStorageVersion（并发保护）` | "内容刚在其他位置更新，请刷新后重试。" |
| save-task | `R2.2 商业验证运行快照缺失…` | "该商品的商业验证信息与当前研究不一致，请重新分析后保存。" |
| demoGuard | `AI quota reservation is missing.` | "AI 服务暂时不可用，请稍后重试（本次未扣减额度）。" |
| aiImageDraftService | `请求账本无法记录 Provider 调用边界…` | "图片生成服务暂时异常，请稍后重试。" |
| creative-handoff | `禁止字段: resultJson` | "提交内容包含不支持的项目，请刷新后重试。" |

机制：`lib/client/apiErrorMessage.ts`（code→文案 + 未命中 fallback + requestId）+ 服务端 errorResponse 增 detail 字段（诊断仅日志/非生产）；复用 `studioErrorMessage.ts` 模式。

## Output 9 — Final Correction Packages

- **Package A — Core Operability Bugs（P1，最先）**：OA6（提取表达式 minify 修复 + 生产构建冒烟）+ OA7（两层错误文案机制 + Top10 泄漏点修复 + EvidenceWorkbench 四区 loading/error 态 + fetch 超时 + AiSummary 错误分支 bug）。依赖：无
- **Package B — Navigation / Active Research（P1）**：OA1（/tasks 进行中/待补/已完成/已放弃 Tab）+ OA2（标题改"商品研究"）+ OA3（引导卡文案 AI 去 gate 化、CTA 收敛）。依赖：无
- **Package C — VOC / Automation UX（P2）**：OA5（批量粘贴明示 + 半自动采集按钮 PARTIAL_FEASIBLE + 样本量语义）+ 预填三项（VOC ASIN/图搜 URL/关键词默认词）。依赖：A（表达式修复可复用）
- **Package D — External Capability Onboarding（P1）**：OA4（1688 登录 CTA/二维码、扩展 3 步引导、重新检测按钮、就绪态）。依赖：无
- **Package E — Final User Journey（收口）**：全链真实浏览器 Journey 重验 + 30 秒 gate + HR demo gate。依赖：A-D

## Output 10 — Release Verdict

- **P0 = 0；P1 = 3；P2 = 4**
- **LOCAL_RELEASE_CANDIDATE = REVOKED**（P1>0：Amazon Browser Evidence 生产不可用 + 1688 不可操作 + 活跃研究不可寻——普通人无法独立完成核心流程）
- **PUBLIC_DEPLOY = FORBIDDEN**（保持）
- 无需 DB migration；无需架构重写；预计影响：Package A 约 3-4 文件（表达式生成+文案层），B 约 3-5 文件（列表 Tab+文案），C 约 4-6 文件，D 约 2-3 文件（面板 onboarding UI）
- 最大回归风险：Package A 的表达式生成方式变更（需真实浏览器冒烟）；其余为文案/UI 层，风险低

## Resolution References（V3 Final User Operability Correction 已执行）

> 整改分支 `codex/v3-final-operability-correction`（8 commits）→ main a366555（ff 集成 + push）。证据：`docs/v3/changes/v3-final-user-operability/`（packages-abdc / user-journey / security-review / regression-review / plan）。

| 项 | 修复提交 | 验收 |
|---|---|---|
| OA6 Amazon 生产 100% 失败 | 178fa2f（self-contained 字符串工件 + invariant 测试） | AMAZON_BROWSER_PRODUCTION_SMOKE=PASS（真实浏览器 vitest smoke + 3005 生产 build 采集→保存全链） |
| OA7 技术错误泄漏 | 711dc18（apiErrorMessage 双层 + Top10 泄漏点 + 四区错误态 + 超时） | TECHNICAL_ERROR_LEAKAGE_CORE=PASS（92/92 受影响测试；真实页面无技术串） |
| OA1 活跃研究入口 | a41df29（/tasks 五 Tab：进行中/待补/已完成/已放弃/全部） | ACTIVE_RESEARCH_UX=PASS（真实页面五 Tab + 空态 + 卡片 CTA） |
| OA2 标题 | a41df29 | 真实页面 h1/breadcrumb「商品研究」✅ |
| OA3 CTA + AI gate | a41df29（引导卡 AI 去 gate 化 + 清单） | 真实页面引导卡「研究尚未运行 AI 分析…AI 整理当前资料」✅ |
| OA4 1688 onboarding | f2b320d（登录 2 步引导+固定命令+重新检测；扩展 3 步引导；术语隐藏） | 1688_ONBOARDING=PASS（真实页面业务语言 + 就绪徽章 + 按钮闭环） |
| OA5 VOC 批量 + 半自动 | 5b09c8c（批量明示 + 行数识别 + 采集评论按钮 + Preview→确认；ASIN 预填） | VOC_BATCH_UX=PASS / VOC_COLLECTION=PARTIAL_WITH_FALLBACK（真实采集 13 条→确认；SSRF/登录墙 fail-closed；批量粘贴 3 条） |
| 预填（VOC ASIN） | 5b09c8c | 真实页面采集面板 ASIN 自动预填 B085DTZQNZ ✅ |
| 走查新增生产 bug | f57afa0（P1-E preview 崩溃）/ a366555（P1-F 409 不恢复） | 3005 复验：采集保存成功；AI 总结 409 自动刷新 |

**最终裁决（见 FINAL_RELEASE_REPORT）：LOCAL_RELEASE_CANDIDATE = APPROVED**（P1=0、全 Gate PASS、真实普通用户 Journey 全链可独立完成；1688 扫码/扩展加载为部署环境依赖项，由用户按 UI 引导完成）。PUBLIC_DEPLOY 仍 FORBIDDEN（等用户亲自在 3005 查看最终版后另行授权）。

## 44 项回答速查
1-3：P0=0 / P1=3 / P2=4；4：需要"进行中"（Option B Tab，不新增路由）；5：Active Task 应叫"商品研究"；6：研究记录放全部（含进行中，Tab 分层）；7：Start Research 重复=文案撞车（OA3）；8：AI 不是代码层 gate 但文案把它说成 gate；9：1688 当前=只有文字无操作；10：因为 onboarding 缺失+术语直出；11-12：Keyword 登录流程/Image 扩展流程见 Output 4；13：需要 setup wizard（轻量：就绪态+CTA+步骤）；14：应隐藏"1688-cli"字样（用户层"1688 登录"）；15-17：VOC 能力见 OA5（批量粘贴已有、无隐藏批量、无文件导入）；18-19：PARTIAL_FEASIBLE + 最小方案见 Output 5/6；20-21：批量粘贴明示需要；文件导入可选；22：理想 UI="自动采集+批量粘贴+文件上传"三入口；23-26：OA6 实证（minify toString）；27-28：Runtime/泄漏清单见 Output 7/8；29-31：自动化分类见 Output 5；32-33：30 秒 gate=未过（新任务页三个"开始"+术语）；HR demo gate=未过（需解释 CLI/Extension 才能懂）；34：推荐导航=Option B；35：Workbench 首页=商品研究（身份+资料清单+就绪态）；36：推荐最小 research progress=Evidence completion 状态（已收集/待补/可选，无百分比）；37：推荐 onboarding=Output 4 目标列；38-41：Packages A-E/无 migration/无重写/影响范围见 Output 9；42：最大回归风险=表达式生成变更；43：**不可公网部署**（P1>0）；44：修复后验收=Package E 全链 Journey + 30 秒/HR gate + 全量回归。

---

*审计执行：6 路并行（VOC 能力/1688 操作性/IA·CTA/错误语言·空状态/自动化机会 + 主线程 OA6 深挖），全部 file:line 实证 + 用户真实反馈交叉验证；严格只读，未修改任何文件、未执行 git 操作、未动 main。*
