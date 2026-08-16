# V3 Final Runtime Closeout — R9-R12（Package F/G）最终报告

> 2026-08-17 · 分支 `codex/v3-final-runtime-closeout` → main
> 用户最新手工验收新增 4 个反例：R9 图片找货 SSRF 误判 / R10 关键词+链接不可用 / R11 页面操作跳顶部 / R12 顶部状态与 Evidence 不一致。

## 1. R9 — 图片找货 SSRF 误判（代理 fake-ip 环境）

### 1.1 真实 root cause（完整 trace）

```
用户输入 m.media-amazon.com 图片 URL
  → 旧链路 downloadCandidateImage → isValidTargetUrl
  → resolveToPublicIp → dns.resolve4/resolve6（直连系统 DNS 服务器）
  → 本机代理（TUN/fake-ip DNS）拦截直连 DNS 查询 → ECONNREFUSED
  → fail-closed 拒绝一切域名 → "候选图片链接未通过安全校验（禁止内网/本地地址）。"
```

- 实测：`dns.resolve4` → `ECONNREFUSED`；`dns.lookup`（与实际 HTTP client 同路径）→ 返回代理 fake-ip `28.0.0.126-128`；`nslookup` Server 指向代理虚拟 DNS `28.0.0.2`。
- **PROXY_FAKE_IP = 确认**（代理把公网域名解析到 28.0.0.0/8 保留段；198.18.0.0/15 为同类常见 fake-ip 网段）。
- 同时浏览器（走代理）能正常显示 Amazon 图片——校验与实际连接不一致导致误杀。

### 1.2 安全修复（SSRF 禁令全部保留）

`lib/server/ssrfGuard.ts` 新增 `validateProxyAwareHttpsUrl`（proxy-aware）：

- 解析走 `dns.lookup`（与 Node HTTP client / 代理一致）；
- **fake-ip 识别**：域名解析结果落在 28.0.0.0/8、198.18.0.0/15 → 标记 PROXY_FAKE_IP 并放行（请求实际经代理按域名路由，不会发往内网）；
- **保留全部禁令**：localhost/127.0.0.0/8/::1、RFC1918、link-local（含 metadata 169.254.169.254）、CGNAT、private/reserved IPv6、file/ftp/data/javascript、userinfo、非 443 端口、解析失败 → 全部 fail-closed；
- **IP 字面量保留段输入仍然拒绝**（用户直接输入 28.0.0.1 / 198.18.0.1 等 → literal_private，不因 fake-ip 放行字面量）；
- **无域名白名单**（不 bypass amazon.com）。

`lib/server/sourcingImageAcquisition.ts`：

- 下载改 `fetchImageWithRedirectGuard`：**redirect 逐跳验证**（manual follow，≤5 跳；每跳经 `validateProxyAwareHttpsUrl`；https-only，协议降级拒绝；无 location 拒绝）；不再盲目 `redirect:"follow"`。

### 1.3 真实验收（headed + 真实 3005 + 美国节点）

```
真实 Amazon 主图 https://m.media-amazon.com/images/I/51VqeOTN67L._AC_SX522_.jpg
  → URL Safety PASS（proxy-aware 修复生效）
  → 图片下载成功（真实字节）
  → Native Extension acquisition（浏览器助手）
  → 1688 原生图搜
  → Preview 返回 60 条真实 1688 候选（首条：冰霸杯定制陶瓷内胆保温杯，offerId 1074215128034）
```

- `R9_IMAGE_SOURCING = PASS`（§150 全部达成：URL Safety PASS → Native Extension acquisition → 打开 1688 图搜 → 候选 Preview）。

### 1.4 图片 URL 自动预填（§151）

- `lib/client/sourceImageUrl.ts` `resolvePublicSourceImageUrl`：从 `sourceMeta.productBatchSnapshot/candidateSnapshot.imageUrl`、`productIdentity.image` 解析公网 https 主图；dataUrl 快照/内网/http/相对路径 → null（不预填）。
- SourcingEvidencePanel：`amazonContext.image` 存在时自动预填图片找货输入框 + 显示「当前商品主图 + [使用此图片找货]」；用户手动编辑后不覆盖。
- 当前数据模型 Task 主图为 dataUrl 快照（无公网 URL）→ 不预填（诚实条件式）；组件测试覆盖渲染与解析。

## 2. R10 — 关键词找货 / 已有 1688 链接

### 2.1 原状态（trace 结论）

| 项 | 状态 |
|---|---|
| 工具是否安装 | **已安装**（`%TEMP%\v35-spike-audit\1688-cli`，v0.1.47，08-15 构建验证） |
| 是否登录 | **已登录**（`~/.1688/state.json` loggedInAt 08-15；whoami loggedIn:true；08-16 仍有 offer/whoami 成功调用） |
| 为什么不可用 | **Case A 变体：V35_1688_CLI_PATH 从未配置**（`.env.local` 无此键；3005 进程无该 env）——工具存在、登录有效，仅缺配置/发现 |

### 2.2 修复

- **部署**：把已验证的 1688-cli 复制到固定位置 `~/.1688/cli`（工具自有 home，规避 TEMP 清理风险；不下载任何来源不明 binary）。
- **自动发现**（§155/§156）：`discoverCliPath` 限定目录查找（`~/.1688/cli/dist/cli.js`、项目 `tools/1688-cli/dist/cli.js`），env 显式配置优先；找不到 → `not_configured`。普通用户无需接触环境变量。
- **用户层状态细分**（§154）：
  - 组件未安装 → 「关键词找货组件尚未准备完成 / 尚未安装」（不再误导为"去登录"）；
  - 已安装未登录 → 「关键词找货需要先登录 1688」+ [打开 1688 登录窗口]；
  - 已登录 → 「1688 登录 ✓」（关键词卡片 / 已有 1688 链接卡片独立徽标）。

### 2.3 真实验收（真实 3005，无需扫码——会话复用）

- **R10_KEYWORD_SEARCH = PASS**：真实关键词「儿童吸管水杯」→ 10 条 1688 候选（首条：特美刻40oz汽车杯316不锈钢保温杯，offerId 1036730598102，¥146.5）。
- **R10_DETAIL_URL_READ = PASS**：`https://detail.1688.com/offer/1036730598102.html` → 完整详情（title / offerId / displayedPrice ￥149.00 / displayedMoq 1 个 / 供应商 杭州特美刻实业有限公司 / SKU 2 / 属性 37 项 / 价格阶梯）——displayedPrice ≠ 采购成本语义保持。
- UI：关键词/链接卡片显示「1688 登录 ✓」（Case C）。
- 登录态共用（Keyword/Detail 同一 LocalSession1688CliDriver session）；图片找货仍走 普通 Chrome + Helper（三者 readiness 独立显示，§159）。

## 3. R11 — 页面操作后跳顶部

### 3.1 root cause

`EvidenceWorkbench onDataChanged` / `ProductResearchDecisionPanel onUpdated` → `setRefreshKey` → `loadRecord` effect 重跑 → **`setRecord(null)` + `setLoading(true)`** → 内容区 collapse 成一行 loading 文本 → 页面高度骤减 → 浏览器把 scrollY 钳制回 0 → 新内容渲染后停留顶部。

### 3.2 修复（非 scroll hack）

- TaskRecordDetail：两个回调改为 `refreshRecord()`（既有轻量刷新：保留现有内容直到新数据到达，不 `setRecord(null)`、不 `setLoading(true)`）；`refreshKey` 状态与 effect 依赖删除。
- 无 form submit / router.push / remount / focus 问题（扫描确认）；Same-page mutation 原则达成（§160-166）。

### 3.3 headed 实测（§167）

| mutation | before scrollY | after scrollY | delta |
|---|---|---|---|
| 人工决定保存（保存旧版状态） | 4042 | 4042 | **0** |
| AI 证据总结重新生成 | 3030 | 3030 | **0** |

- URL 不变；无「正在读取研究记录」collapse；无强制 `window.scrollTo` hack（代码零 scroll 调用）。
- `R11_SCROLL_PRESERVATION = PASS`。

## 4. R12 — 顶部研究状态与 Evidence 不一致

### 4.1 原问题（trace）

- 「研究尚未开始整理」按 `!recordHasResearchRecord`（有无新版 researchRecord）判断——与 Evidence 无关；
- 「研究结论」区（AI 总结/市场研究结果/风险/证据缺口）来自 legacy 派生（`deriveProductResearchPresentation` / `getResearchEvidenceSections`）——不随新 Evidence 更新，制造"什么都没开始"的假象。

### 4.2 修复（§169-179）

- **删除**「研究尚未开始整理」块（不再用"研究尚未开始"表达"AI 未运行"）。
- **研究状态行**（EvidenceWorkbench 顶部，从实时 Evidence checklist + AI 证据总结派生，data-testid=research-status-line）：
  - 0 类已收集 → 「研究资料尚待补充」；
  - ≥1 类已收集、无 AI 总结 → 「研究进行中」+ 「已收集 X、Y 等资料；可继续补充其他 Evidence，或在下方生成 AI 证据总结。」；
  - 有 AI 证据总结 → 「AI 已整理当前资料」。
- **legacy「研究结论」区降级**为折叠「历史初始分析」（明确标注"进入本工作台前生成的初始分析，不代表当前证据结论"；无内容不显示）。
- **唯一 AI Summary authority**：AI 证据总结（既有区）；顶部不再有第二套 AI 总结概念。
- Missing 区保持 canonical（decisionEvidence.missingData 缺口；displayedMOQ ≠ confirmed procurement MOQ 语义不变，§178）。

### 4.3 真实验收

- BrüMate（Amazon 页面 已有 + 买家评论 已有 + 已生成 AI 证据总结）→ 顶部状态行 = 「AI 已整理当前资料」✓；「研究尚未开始整理」不再出现 ✓；legacy 空结论区不显示 ✓。
- Bentgo（有 browser evidence + AI 总结）→ 「AI 已整理当前资料」（与真实数据一致）✓。
- empty/partial 三态派生由单测覆盖（`deriveResearchStatus`：0 类→empty、≥1 类无 AI→partial 且列出已收集类别、有 AI→ai_ready）✓。
- `R12_RESEARCH_STATUS = PASS`。

## 5. 测试与质量

- 新增/更新测试：ssrfGuard（proxy-aware 17 项）、fetchImageWithRedirectGuard（7 项）、cli-discovery（6 项）、resolvePublicSourceImageUrl（5 项）、EvidenceWorkbench R12 派生（7 项）、SourcingEvidencePanel 文案/预填（2 项）、源码断言 3 处更新、route.test.ts 隔离 USERPROFILE（2 项修复）。
- 全量：**4872 passed / 90 skipped**；仅 2 个**既有环境失败**（native1688Bridge 53318 端口被运行中 3005 占用；release-package Windows tar 基线——main@cd7a476 已存在，非本轮引入）。
- tsc PASS；lint 0 errors（14 既有 warnings）；build PASS。
- 3005 运行最终构建（BUILD_ID `lLeVR5EfqjWAiMQ18mIk0`），health 200，计划任务原状态。

## 6. 最终矩阵（R1-R12）

| 反例 | 结果 |
|---|---|
| R1 1688 recheck | PASS（本轮回归：状态细分后徽标/文案正确；recheck 闭环保留） |
| R2 AI duplicate action | PASS（唯一「生成 AI 证据总结」） |
| R3 Decision save | PASS（本轮回归：保存→刷新持久→还原） |
| R4 Listing Studio | PASS（本轮回归：handoff 正常） |
| R5 Research vs Records | PASS（本轮回归：/research active、/tasks historical） |
| R6 Image Studio | PASS（本轮回归：handoff 正常） |
| R7 Research Materials sync | PASS（本轮回归：checklist 实时派生） |
| R8 Amazon currency | PASS（fail-closed + JPY 实测；USD 成功链受 Amazon 首页反爬环境阻断，见上轮报告） |
| **R9 Image Sourcing URL safety** | **PASS**（proxy fake-ip 识别；SSRF 禁令保留；真实图搜 60 候选） |
| **R10 Keyword + Detail acquisition** | **PASS**（真实关键词 10 候选；真实详情读取；状态细分） |
| **R11 Scroll preservation** | **PASS**（delta=0 ×2 mutation；无 hack） |
| **R12 Research Summary canonical state** | **PASS**（状态行真实派生；legacy 降级；唯一 AI authority） |

LOCAL_RELEASE_CANDIDATE 状态：**待用户复查后按既有流程评估**；PUBLIC_DEPLOY = FORBIDDEN（维持）。
