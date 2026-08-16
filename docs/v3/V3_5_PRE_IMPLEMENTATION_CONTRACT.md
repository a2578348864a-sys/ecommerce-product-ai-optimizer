# V3.5 Pre-Implementation Contract（正式权威合同）

> **状态：APPROVED（2026-08-15）**。本文件是 V3.5 正式实现（Narrow Implementation）的**唯一入口与权威合同**。
> 证据基础：`docs/v3/changes/v3-5-sourcing-assessment/**`（初始价值评估）与 `docs/v3/changes/v3-5-acquisition-spike/**`（Acquisition Spike，含 A.1/A.2/A.3 实测证据）。
> **本文件不包含实现**；正式实现需用户另行授权（`V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED=TRUE`）。

---

## 1. Product Goal

为轻选（跨境新手/小团队的受控运营 Agent）提供 **1688 供应线索（Sourcing Evidence）的受控获取与研究**：把"找候选、读详情、整理证据、生成下一步问题"做成可追溯、可人工确认的流程，替代手工复制粘贴。

## 2. Problem Statement

用户需要 1688 供应线索时，手工流程=搜索→逐卡复制标题/价格/MOQ/供应商→粘贴→整理，费时且易错（复制错列/单位混淆/规格错配）。三条自动化候选路线（官方 API / 扫码 CLI / 已登录浏览器 Bridge）此前均未实证，需要先证明"哪条能真实工作、以什么边界工作"。

## 3. Why V3.5 Exists

- 原 Assessment（V3.5-Sourcing-Assessment，5849b20）给出 **V3_5_VALUE = NARROW_APPROVAL**：1688 定位为供应线索研究，不是供应商智能体/采购系统。
- Acquisition Spike（V3.5-A 至 A.3）**真实运行验证**了三路线并完成了图片找货全自动化实证——从"未证明"推进到"有边界地可用"。

## 4. V3.5 Value Decision

```
V3_5_VALUE = NARROW_APPROVAL
```
V3.5 = Sourcing Evidence / 供应线索研究。不是 Supplier Agent、不是 Supplier Selection System、不是 Procurement Agent。

## 5. Product Boundary

- 只做：找候选（关键词/图片/已知 URL）→ Search Results → Preview → **Human Confirm** → Sourcing Evidence → Evidence Matrix → 下一步询盘问题。
- 自动化只负责：**找到、读取、整理**。用户负责：**哪些候选值得加入 Evidence**。

## 6. Frozen Non-Goals（禁止项）

禁止：Supplier Score / Reliability Score / Match Probability / 自动选最佳供应商 / 自动采购 / 自动下单 / 自动加购物车 / 自动询盘 / 自动发消息 / 自动议价 / AI 真实利润预测 / AI 合规判断 / "值得采购" / "推荐采购" / 供应商成功概率。

```
PROFIT_MODULE = ASSUMPTION_ONLY
```

## 7. Acquisition Strategy（最终冻结）

```
ACQUISITION_STRATEGY = HYBRID
KEYWORD_SEARCH = LOCAL_SESSION_CLI        # 1688-cli + 用户扫码 + 工具自有隔离 Profile
IMAGE_DISCOVERY = BROWSER_BRIDGE_NATIVE_UI_AUTOMATED
IMAGE_DISCOVERY_AUTOMATION = FULLY_AUTOMATED_IN_ACTIVE_FOREGROUND_BROWSER_SESSION
DETAIL = LOCAL_SESSION_CLI
SECONDARY_DETAIL = BROWSER_BRIDGE
MANUAL_IMPORT = KEEP_AS_FALLBACK
```

## 8. Keyword Acquisition

- 实现证据：1688-cli（superjack2050/1688-cli v0.1.47）search 命令——3 关键词实测（6.2–10.5s），10/10 唯一 offerId，search→detail 实体绑定一致（route-b-1688-cli.md §8.4）。
- 边界：**禁用 1688-cli image-search**（fail-open 缺陷）；显式校验 `ok:true`；输出脱敏；写命令零暴露。

## 9. Image Acquisition

- 实现证据：Browser Bridge + s.1688.com 原生图搜入口全自动链（A.1/A.2/A.3）：
  Candidate 主图 → Bridge → 原生图搜入口 → 自动触发原生 File Chooser（focus+Enter 键盘激活 + `DOM.setFileInputFiles`）→ 真实 upload state → 自动定位 closed-shadow"搜索图片"（DOM class 扫描 + Target Proof）→ CDP Input 真实点击 → 真实图搜结果 → 候选提取 → detail 补全。
- 实测计数：FIRST_UPLOAD_MANUAL_ACTION_COUNT=0 / SEARCH_BUTTON_MANUAL_CLICK_COUNT=0 / WRONG_UPLOAD_COUNT=0 / WRONG_CLICK_COUNT=0 / Wrong Entity=0（3 Case 3/3 + Restart Fresh Session PASS，见 trusted-file-chooser-automation.md）。
- **边界**：需要**活动的前台浏览器会话**（见 §31）；不是后台无人值守自动化。

## 10. URL / Detail Acquisition

- 主：1688-cli `offer`（结构化 15 字段：价格阶梯/SKU/属性/供应商/MOQ，实测）。
- 次：OpenCLI `item`（页面详情，与主路径交叉互证）。
- 已知 1688 URL 读取走同一 Detail 路径。

## 11. Manual Fallback

MANUAL_IMPORT = KEEP_AS_FALLBACK。Manual Import 链路（V3.4 已验证）永久保留为 fallback + 人工确认环节；"Manual Import 是唯一现实 Acquisition Path" 已 **SUPERSEDED**（见 §41）。

## 12. Human Confirm Boundary

- **Human Confirm 不可删除**。任何 Search Result 未经 Human Confirm 不得进入正式 Sourcing Evidence。
- 流程：Search Results → Preview → Human Confirm → Sourcing Evidence。自动化（即使全自动）只到"找到/读取/整理"。

## 13. Sourcing Evidence Model

正式 Sourcing Evidence 至少绑定稳定身份：

```
source = 1688
offerId
sourceUrl
capturedAt
acquisitionMethod
sourceProductRole（必要时）
```
不得只以 title+price 作为 identity（见 §21）。

## 14. Evidence Classification

正式分类（沿用 V3 冻结原则）：

| 分类 | 含义 |
|---|---|
| Source Snapshot | 抓取时刻的原始快照（URL/capturedAt/原始字段） |
| Platform Metadata | 平台展示元数据（销量/年限/badges 等）——展示，不评分 |
| Seller Claim | 卖家自报（材质/专利/检测等）——不是事实 |
| Derived / Deterministic Interpretation | 确定性派生（如价格档解析） |
| Human Confirmed Observation | 人工确认的观察 |
| Unknown / Conflict | 未知/冲突——如实保留 |

**CLI/API 返回结构化 JSON ≠ Confirmed Fact**。

## 15. Entity Binding Contract

- **Wrong Entity = 0（硬门禁）**。字段必须证明属于同一 offer（同卡片/同对象/交叉验证），否则标 unknown；禁止跨卡片拼接字段。
- 实测：search 10/10 唯一 offerId；search→detail 交叉一致；图搜卡片↔item↔detail 三路互证。

## 16. Price Semantics

```
displayedPrice / priceRange / priceTiers —— 各自保持语义，禁止合并成单一 cost
purchaseCost —— 禁止使用（除非未来存在独立、明确、经人工确认的采购成本数据）
```
实测证据：显示价 ¥21.30 vs 实价档 ¥16.5；卡片促销价 ¥6.38 vs 详情实价 ¥11.38（displayedPrice≠purchaseCost 实证）。

## 17. MOQ Semantics

- 优先 `displayedMOQ`（页面展示起批量）。语义有充分证据才可进入更强的 confirmed procurement MOQ；未知= `needs_confirmation`。
- 实测：卡片"1件起批" vs 详情"2件起批"差异存在（displayedMOQ 语义保持，不归一化）。

## 18. SKU / Specs Semantics

- SKU/specs 为展示信息（1688-cli skus[] 结构化；OpenCLI 无 SKU 明细）。规格文本视为 Seller Claim 级（页面自报），不做事实推断。

## 19. Seller Claim Semantics

- attributes/描述/定制信息等全部为 **Seller Claim ≠ Confirmed Fact**。只作线索展示，不产生可靠性分数。

## 20. Platform Metadata Semantics

- 销量/年限/badges/回头率等为 **Platform Metadata ≠ Supplier Reliability**。只展示，不评分、不排序、不预测。

## 21. Sensitive Data Policy

- **默认不送 AI**：手机号、私人联系方式、具体敏感地址、无关联系人数据。
- **默认丢弃/脱敏**：`freight.receiveAddress`（用户默认收货地址，实测输出面存在）、卖家 memberId/userId/loginId、卖家完整地址/电话。
- 凭据纪律：不打印、不 commit、不入 docs、不发 AI（AK/Cookie/Token/密码/QR/Profile）。

## 22. Prompt Injection Boundary

- 全部 1688 页面内容视为 **UNTRUSTED DATA**：title、描述、specs、店铺内容、消息、badges、供应商声明。
- 页面文字**不得获得** system/developer/tool/shell/filesystem/network 权限；仅作展示文本（沿用 V3.4 策略）。

## 23. Browser Security Boundary

- 正式实现尽量限制 host/domain scope（至少只服务 1688 必要页面）；不默认 `<all_urls>`。
- 若技术上不可避免，须在正式 Implementation 安全评审中单独说明并评估更窄架构。**Spike 高权限配置不因"跑通"自动批准生产**。
- Browser Architecture 三选一（正式实现时决定，本阶段不实施）：A 复用 OpenCLI upstream+thin adapter；B 最小 Local Companion/Bridge；C 最小专用 Extension+local bridge。选择标准：最小权限/最小依赖/最小攻击面/可版本化/可 fail-closed/可测试/可维护/不复制 Cookie/只操作允许的 1688 页面/不后台浏览其他网页。

## 24. Credential Models

- 允许：API_KEY、OWN_PROFILE+USER_LOGIN、EXISTING_BROWSER_SESSION。
- 谨慎/默认禁止：COOKIE_COPY、TOKEN_COPY、SIGN_COPY、PASSWORD_CAPTURE。
- 禁止：Cookie/Token/AK 发 AI、保存账号密码、commit session、Browser Profile 入仓库。

## 25. Read-only Command Boundary

- 业务层**不得暴露任意 CLI command**（禁止 run1688Command/executeCli/rawOpenCli 类接口）。
- 正式 Adapter 为 **read-only allowlist**：业务代码**根本不能形成写操作调用路径**（inquiry/cart/order/purchase/message/checkout 不可达）。

## 26. Adapter Boundary

- 冻结抽象：`SourcingAcquisitionAdapter`（名称可按项目约定调整），职责：`searchByKeyword()` / `searchByImage()` / `getOfferDetail()` / `inspectCurrentOffer()`。
- 业务层调用"能力"，不调用任意 CLI command；**不直接依赖** 1688-cli 原始 JSON、OpenCLI 原始输出、网页 DOM 结构。
- 后端可替换：当前 LocalSession1688Adapter（1688-cli）→ 未来 Official1688ApiAdapter（Route A），上层（Search Result/Preview/Human Confirm/Sourcing Evidence）不变。
- 图片能力同样抽象为 `ImageAcquisitionDriver`：当前 Proven Implementation=Browser Bridge+Native 1688 UI；未来可替换为 Official API Image Search。

## 27. Fail-closed Rules

- 未登录/未连接/目标找不到/Proof 失败/上传失败/chooser 超时 → 一律不继续、不猜测、不伪造。
- 实测模式：1688-cli exit 3（未登录）、OpenCLI exit 69（Bridge 未连接）、PROOF_FAIL/NO_TARGET（点击门禁）、chooser 8s 超时（上传门禁）。

## 28. Wrong Entity Gate

- Wrong Entity = 0 是硬门禁；"100 个错 1 个"不可容忍。字段不能证明同 offer → unknown。

## 29. Wrong Upload / Wrong Click Gate

- WRONG_UPLOAD_COUNT=0、WRONG_CLICK_COUNT=0（硬门禁）。Candidate Identity 逐张证明（preview 与本地文件匹配）；点击前 Target Proof（elementFromPoint 命中目标文本）。

## 30. Image Match Semantics

- 图搜结果 = **Candidate Discovery**。匹配状态仅五态：exact_match / likely_similar / partial_match / different / unknown。
- 禁止百分比/分数（87%/Match Score/AI 相似概率）。Exact Match 极严（仅图片相似 ≠ exact）。

## 31. Foreground Browser Requirement

- 图片链自动化 = **FULLY_AUTOMATED_IN_ACTIVE_FOREGROUND_BROWSER_SESSION**。
- **未证明且不宣称**：Chrome 最小化、Windows 锁屏、服务器后台、无人值守。这些无证据。
- 产品 UX 必须引导用户保持浏览器窗口在前台。

## 32. Risk Control / CAPTCHA Boundary

- 不绕 CAPTCHA/滑块；不做 stealth；不 spoof fingerprint。
- 遇到风控 → USER_ACTION_REQUIRED + 合理限速（实测：高频操作触发 1688 滑块一次，用户人工完成）。

## 33. External Tool Dependency Risk

- **Route B（1688-cli）**：使用内部 MTOP 相关机制；页面/协议变化可能失效；非长期官方 API 保证；只通过 read-only Adapter 使用。
- **Route C（OpenCLI/Bridge）**：Extension 权限较高；DOM/Shadow DOM/layout 会变化；foreground session 要求；daemon/bridge 安全面需正式实现重新收窄；Spike TEMP 实现不得直接成为生产代码。
- 正式产品依赖**我们的 contract**，而非第三方 CLI 的永久稳定（Adapter 可替换，见 §26）。

## 34. Route A Future Upgrade Path

```
ROUTE_A_API = NOT_TESTED
ROUTE_A_ACCESS = BLOCKED_BY_ACCESS_REQUIREMENT
```
未来若用户正常获得合法 AK/OAuth access：允许重新评估（官方 API 可能替代 Keyword/Image/Detail 驱动）；本轮不申请。

## 35. Formal V3.5 Maximum Scope（Narrow Implementation 最大允许）

1. 关键词找 1688 供应候选
2. 图片找 1688 供应候选
3. 已知 1688 URL 读取详情
4. Search Results
5. Preview
6. Human Confirm
7. Sourcing Evidence
8. displayed price / price tiers
9. displayed MOQ
10. SKU / Specs
11. Seller Claims
12. Platform Metadata
13. Similarities
14. Differences
15. Unknowns
16. Evidence Matrix
17. Next Inquiry Questions
18. Provenance
19. Fail-closed
20. Run / Acquisition Trace

**不得扩大**。

## 36. Explicitly Deferred Features

冻结 Deferred：Supplier Score / supplier ranking / procurement recommendation / automated inquiry / automated negotiation / cart / order / payment / profit prediction / logistics automation / compliance automation / supplier reliability prediction / background unattended crawling / CAPTCHA automation / Route A official API integration / full browser agent / general-purpose browser control。

## 37. Implementation Architecture（推荐，不实施）

```
SourcingAcquisitionService
├─ KeywordAcquisitionDriver   → LocalSession1688CliDriver（1688-cli，read-only allowlist）
├─ ImageAcquisitionDriver     → Native1688BrowserDriver（Bridge + 原生图搜，foreground）
└─ OfferDetailDriver          → LocalSession1688CliDriver（主）+ Browser driver（secondary fallback）
统一输出：AcquisitionCandidate（上层不知 CLI 命令/OpenCLI 命令/CDP selector/Shadow DOM class）
```
数据流：External Source → Acquisition Driver → Raw Acquisition Snapshot → Normalize → Entity Binding Validation → Acquisition Candidate → Preview → Human Confirm → Sourcing Evidence。

## 38. Testing Requirements

- Adapter 单测（mock 外部）；实体绑定校验；fail-closed 场景（未登录/未连接/目标缺失/上传失败/Proof 失败）；敏感数据脱敏断言；Prompt Injection 隔离测试；Owner/Visitor 隔离；真实 1688 数据 smoke（有限次、限速）。

## 39. Acceptance Gates

正式实现必须满足：Wrong Entity=0 / Wrong Upload=0 / Wrong Click=0 / Prompt Injection isolation / Owner-Visitor isolation / Preview+Human Confirm / No write operations / No supplier messaging / No purchasing / No sensitive credential leakage / Fail-closed / Provenance / Manual fallback / Browser failure recovery / deterministic entity binding / real smoke with actual 1688 data。

## 40. Deployment Boundary

`PUBLIC_DEPLOY = FORBIDDEN`（当前）。正式上线需单独授权（含生产 runbook 与部署评审）。

## 41. Authority / Supersession Rules

Authority 链（降序）：
1. current real code / AGENTS.md / Git state
2. **本 Pre-Implementation Contract**
3. V3.x frozen contracts
4. V3.5 Assessment / Acquisition evidence
5. individual spike notes

旧 Assessment 与最终 Contract 冲突时：**Contract 胜出**，旧结论标注 SUPERSEDED 保留历史（不删除）。

**Supersession 表（关键）**：

| 旧结论 | 状态 | 说明 |
|---|---|---|
| "Manual Import 是唯一现实 Acquisition Path" | **SUPERSEDED** | 被 HYBRID Acquisition Strategy 替代；Manual Import 保持 KEEP_AS_FALLBACK |
| IMAGE_SEARCH = NOT_PROVEN（早期） | **SUPERSEDED** | Native 1688 图搜三 Case 实测成功 → IMAGE_SEARCH = APPROVED |
| ACQUISITION_STRATEGY = LOCAL_SESSION_CLI（A 阶段中间值） | **SUPERSEDED** | 图搜实证后 → HYBRID |
| NATIVE_IMAGE_SEARCH_AUTO_CLICK = AUXILIARY_ONLY（A.2 中间值） | **SUPERSEDED** | A.3 上传全自动后 → APPROVED（4/4、0 误点、0 人工点击） |
| ROUTE_C_BROWSER_BRIDGE = PROVEN_ALTERNATIVE（非正式枚举） | **SUPERSEDED** | 正式枚举：ROUTE_C_BROWSER_BRIDGE = APPROVED + ROUTE_C_ROLE = IMAGE_DISCOVERY_SECONDARY |
| V3.5 早期"三条路线都未证明" | **SUPERSEDED** | Route B/C + 图片链已真实运行验证 |
| **IMAGE_DISCOVERY_DRIVER = V3.3-CDP-BROWSER（`--remote-debugging` 调试浏览器）** | **SUPERSEDED（2026-08-16 R1 反证）** | 真实生产 smoke 反证：同账号同 IP 下 CDP 调试浏览器 → 1688 **无限滑块**（BLOCKED_BY_RISK_CONTROL，人工多次+刷新均无法通过）；普通 Chrome → 登录/刷新正常。R1 Spike（codex/v3-5-r1-spike，FULL PASS）证明 No-Debugger 窄权限扩展形态全自动图搜可行 → 正式替换为 **NATIVE_1688_EXTENSION_DRIVER**（见 §42 R1 Amendment） |
| Route A（官方 API） | **DEFERRED**（保持 NOT_TESTED/BLOCKED_BY_ACCESS_REQUIREMENT） | 未来合法 AK 时重新评估 |
| 其余冻结原则（NARROW_APPROVAL/Seller Claim≠Fact/页面价≠成本/MOQ 语义/Evidence Matrix/Unknown/Question Generation/Supplier Score 禁止/PROFIT=ASSUMPTION_ONLY/旧 Agent 不复活） | **CONFIRMED** | 全部保持 |

**Route 最终状态（合法枚举）**：

```
ROUTE_A_API = NOT_TESTED（ROUTE_A_ACCESS = BLOCKED_BY_ACCESS_REQUIREMENT）
ROUTE_B_1688_CLI = APPROVED（带风险：MTOP/read-only Adapter/不暴露任意命令）
ROUTE_C_BROWSER_BRIDGE = APPROVED（ROUTE_C_ROLE = IMAGE_DISCOVERY_SECONDARY；不是默认全部 Acquisition）
```

---

## 42. R1 Amendment — No-Debugger Image Driver 正式替换（2026-08-16 授权）

### 42.1 背景（真实反证，非理论偏好）

| 形态 | 真实结果 |
|---|---|
| V3.3-CDP 调试浏览器（`--remote-debugging-port`） | **BLOCKED_BY_RISK_CONTROL**：同账号同 IP 下 1688 无限滑块（人工多次+刷新均无法通过） |
| 普通 Chrome + 轻选窄权限扩展（R1 Spike） | **FULL PASS**：登录正常、图搜全自动、零滑块 |

判定：旧 CDP Image Driver 存在**生产环境反证**，按 §41 Authority 规则合法触发修订。

### 42.2 R1 Spike 证据（branch codex/v3-5-r1-spike @ 2b57ebb）

```
NORMAL_CHROME = PASS（装扩展 idle 与 active 均无风控；A/B 对照）
NO_DEBUGGER = TRUE / REMOTE_DEBUGGING_PORT = FALSE
Candidate 图片自动注入 = PASS（DataTransfer + files 原型 setter + 重试 ≤3）
Upload Identity Proof = PASS（预览 srcLen vs 本地 base64 长度 ≤1% 容差）
Search Submit = PASS（composed:true MouseEvent 穿透 closed shadow → 真实 imageId 结果页）
结果提取 = 60 offerId（data-renderkey；§38 守卫拒绝推荐流）
1688-cli Detail Cross-check = PASS（title 逐字一致）
Chrome Full Restart = PASS（完整流程一次跑通）
Wrong Upload = 0 / Wrong Click = 0 / Wrong Entity = 0 / CAPTCHA_BYPASS = 0 / COOKIE_EXPORT = 0
```

注意：以上冻结为**当前已验证的 1688 UI behavior**（composed 事件/closed shadow/data-renderkey），不泛化为通用网页自动化能力。

### 42.3 正式架构

```
ImageAcquisitionDriver
  ↓ Native1688ExtensionDriver（新正式实现）
  ↓ Authenticated Loopback Bridge（127.0.0.1；高熵 jobId 凭证；轻选↔bridge 进程 token）
  ↓ Qingxuan 1688 Narrow Extension（固定能力 allowlist；无 debugger/cookies/all_urls）
  ↓ Normal Chrome（用户正常登录的当前会话；不读取/复制 Cookie）
  ↓ 1688 Native Image Search
```

禁止（正式调用路径 ZERO CDP）：`remote-debugging-port` / `chrome.debugger` / `Debugger.attach` / `Runtime.evaluate` / CDP attach / Playwright/Puppeteer 控制已登录浏览器 / fingerprint spoof / CAPTCHA bypass。

### 42.4 CDP Driver 处理

旧 CDP Image Driver：**保留代码，LEGACY_DISABLED / DIAGNOSTIC_ONLY**（不再作为默认路径）。硬约束：

```
NO_AUTOMATIC_FALLBACK_TO_CDP = TRUE
```

Extension 路线失败 → 返回明确错误（EXTENSION_NOT_INSTALLED / EXTENSION_DISCONNECTED / ...）或 Manual Fallback；**绝不静默回退 CDP 再触发无限滑块**。

### 42.5 正式状态目标（FULL PASS 时）

```
V3_5_IMAGE_DRIVER = NATIVE_1688_EXTENSION
V3_5_IMAGE_ACQUISITION = APPROVED
NO_DEBUGGER_IMAGE_DRIVER = APPROVED
CDP_IMAGE_DRIVER = LEGACY_DISABLED
```

### 42.6 结果分级（§43-45）

```
FULL PASS  → 正式收口 V3.5（§53 全部 APPROVED）
PARTIAL    → IMAGE_DISCOVERY_AUTOMATION = SEMI_AUTOMATED_ONE_USER_CLICK，停止研究
FAIL       → NO_DEBUGGER_IMAGE_DRIVER = NOT_ADOPTED；Image = Manual / Future Official API；停止浏览器研究
```

### 42.7 治理

- 正式分支：`codex/v3-5-r1-formal-replacement`（本 Amendment 与其同批合入）。
- 不公网部署；V3_6_AUTHORIZATION_REQUIRED = TRUE（不变）。
- R1 Spike 分支保留为证据（不并入 main）。

---

## 最终状态（本 Contract 冻结）

```
V3_5_VALUE = NARROW_APPROVAL
ACQUISITION_STRATEGY = HYBRID
KEYWORD_SEARCH = LOCAL_SESSION_CLI
IMAGE_DISCOVERY = BROWSER_BRIDGE_NATIVE_UI_AUTOMATED
IMAGE_DISCOVERY_AUTOMATION = FULLY_AUTOMATED_IN_ACTIVE_FOREGROUND_BROWSER_SESSION
IMAGE_DISCOVERY_DRIVER = NO_DEBUGGER_EXTENSION（R1 Amendment §42：NATIVE_1688_EXTENSION_DRIVER；CDP = LEGACY_DISABLED）
DETAIL = LOCAL_SESSION_CLI
SECONDARY_DETAIL = BROWSER_BRIDGE
MANUAL_IMPORT = KEEP_AS_FALLBACK
ROUTE_A_API = NOT_TESTED
ROUTE_A_ACCESS = BLOCKED_BY_ACCESS_REQUIREMENT
ROUTE_B_1688_CLI = APPROVED
ROUTE_C_BROWSER_BRIDGE = APPROVED
IMAGE_SEARCH = APPROVED
NATIVE_IMAGE_SEARCH_AUTO_CLICK = APPROVED
TRUSTED_FILE_CHOOSER_AUTOMATION = APPROVED
PROFIT_MODULE = ASSUMPTION_ONLY

V3_5_PRE_IMPLEMENTATION_CONTRACT = APPROVED
V3_5_PRE_IMPLEMENTATION_CONSOLIDATION = DONE
V3_5_REMOTE_CLOSEOUT = PASS

V3_5_IMPLEMENTATION = COMPLETE（2026-08-16 结项：FULL PASS — 正式 smoke ×2（60 候选）与 Restart smoke 全链通过，§42.5 全部达成；证据见 docs/v3/changes/v3-5-r1-replacement/real-smoke-runbook.md 执行记录）
V3_5_IMPLEMENTATION_AUTHORIZATION_REQUIRED = TRUE
V3_6_AUTHORIZATION_REQUIRED = TRUE
PUBLIC_DEPLOY = FORBIDDEN
```

**证据入口**：`docs/v3/changes/v3-5-sourcing-assessment/**`（proposal/value-assessment/risk-analysis/final-report 等）与 `docs/v3/changes/v3-5-acquisition-spike/**`（route-a/route-b/route-c/native-image-search/closed-shadow-autoclick/trusted-file-chooser-automation/security-review/candidate-matrix/final-report 等）。实验细节以 Change Package 为准，本 Contract 只冻结权威结论与边界。
