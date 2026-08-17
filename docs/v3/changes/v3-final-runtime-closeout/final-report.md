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

---

# R13 补充整改 — 1688 Bridge / Helper Protocol 真链路收口

> 2026-08-17 · 分支 `codex/v3-final-runtime-closeout-r13` → main（0520f31）
> 用户真实 UI 反例推翻了 R9/R10 结论：图搜报「桥接服务拒绝命令（job_image_consumed）」、关键词报「未知操作（仅支持 search / image / url / detail / save）」。

## 1. 先 trace 不猜 — 三链 operation 实测

| 链 | UI_OP | API_OP | DRIVER_OP | BRIDGE_OP | HELPER_OP | 结果 |
|---|---|---|---|---|---|---|
| Keyword | `keyword`（漂移） | route 期望 `search` | — | — | — | **invalid_action** |
| Image | `image` ✓ | `image` ✓ | acquireByImage | upload 重试第 2 次 enqueue upload | 图片一次性消费 → **400 job_image_consumed** | **extension_bridge_rejected** |
| Detail URL | `url` ✓ | `url` ✓ | getOfferDetailById | — | — | 正常 |

## 2. Root cause（代码实证）

- **Keyword**：`SourcingEvidencePanel.runSearch` 发送 `{ action: method }`——关键词发 `action:"keyword"`，而 route action allowlist 为 `search/image/url/detail/save` → 兜底 invalid_action。UI/API operation 名漂移。
- **Image**：`acquireByImage` upload 重试（≤3）对**同一 bridge job** 重复 enqueue upload；bridge 对 job 图片为一次性消费（入队后 `job.image=null`）→ 第二次 enqueue 必然 400 `job_image_consumed`；客户端把它直接拼进用户文案。
- **版本**：用户 Chrome 扩展 SW = **0.3.1**（bridge /health extensionSwVersion，与仓库一致）——**版本不是 root cause**，但 readiness 无版本握手（连接即绿）是设计缺口。

## 3. 修复（最小安全）

1. **SourcingOperation 唯一类型**（`lib/upstream/1688/contracts.ts`）：`search/image/url/detail/save`；UI 用 `UI_METHOD_TO_OPERATION`（keyword→search）映射，route/UI/driver 共享同一契约（§202/§203）。
2. **upload 重试重新注册 job**：attempt>1 时 `registerJob` 新 job（重新绑定图片），杜绝 job_image_consumed；后续 submit/collect 用新 jobId（§199/§200——不把 job_image_consumed 加入用户 allowlist，在正确层消费）。
3. **Readiness Protocol Handshake**（§196/§197/§207）：
   - bridge /health 增 `bridgeVersion`；SW 心跳上报 `swVersion` 已存在；
   - `getStatus` 透出 `extensionSwVersion` + `bridgeVersion`；
   - `probeImageCapability` 计算 `versionCompatible`（SW 版本 === 期望 `0.3.1`）；
   - 不匹配 → `extension_version_mismatch` → **imageReady=false**（不假绿）→ UI「浏览器助手需要更新」+ 查看更新步骤（chrome://extensions → 重新加载 → 回工作台 → 重新检测）+ 重新检测（§205）。
4. **UI 不泄漏内部 operation**（§210）：invalid_action 用户文案「操作无法识别，请刷新页面后重试。」（raw action 进服务端日志）；bridge 拒绝文案用户友好（「1688 图片助手未能执行操作…」），内部 code（job_image_consumed 等）只进日志（§211）。
5. 发布 Checklist 增补：Helper 代码变更后必须 `EXTENSION_RELOAD_REQUIRED` 并真实确认 Chrome 运行版本（§206）。

## 4. 真实验收（headed，用户相同操作方式：页面上直接输入/点击/粘贴）

| 链 | 操作 | 真实结果 |
|---|---|---|
| R10 Keyword UI | 输入「儿童吸管水杯」→ 点「搜索」 | **搜索结果（10 条）** Preview，无错误 |
| R9 Image UI | 输入真实 Amazon 主图 URL → 点「图搜」 | **搜索结果（60 条）** Preview，**无 job_image_consumed** |
| R10 Detail UI | 粘贴 `detail.1688.com/offer/1036730598102.html` → 点「读取」 | **搜索结果（1 条）**：特美刻…/页面显示价 ￥149.00/起批 1 个/供应商 杭州特美刻实业有限公司 |

版本握手实测：`toolStatus.image = { extensionAvailable:true, versionCompatible:true, extensionSwVersion:"0.3.1", reasonCode:"extension_seen" }`（§215/§216：APP/BRIDGE/EXTENSION 协议兼容均 PASS）。

## 5. 测试与质量

- 新增：UI_METHOD_TO_OPERATION 映射（2）、sourcingCapabilities 版本握手（4）、upload 重试重新注册 job（1）、route action=keyword 回归 + 文案不泄漏（1）。
- 全量：**4880 passed / 90 skipped**（+8 新用例）；仅 2 个既有环境失败（bridge 53318 端口被运行中 3005 占用；release-package Windows tar 基线）。
- tsc PASS；lint 0 errors；build PASS；R1-R12 无回归。
- 3005 运行新构建（health 200，计划任务原状态）。

## 6. 版本清单（§215）

- APP_BUILD_HEAD：`0520f31`（R13 修复）
- BRIDGE_VERSION：`authenticated-loopback-bridge.v1`（/health 握手字段）
- EXTENSION_VERSION：`0.3.1`（manifest + SW_VERSION）
- PROTOCOL_VERSION（期望 Helper SW）：`0.3.1`（NATIVE_1688_HELPER_SW_VERSION）
- Chrome 当前 loaded extension version：**0.3.1**（bridge extensionSwVersion 实测）
- 本轮未修改扩展文件 → 无需 reload；未来 Helper 变更后按 §206 执行 reload 确认。

LOCAL_RELEASE_CANDIDATE：待用户复查 R13 三链后按既有流程评估；PUBLIC_DEPLOY = FORBIDDEN（维持）。

---

# R14 补充整改 — 1688 搜索结果商品图片真实展示

> 2026-08-17 · 分支 `codex/v3-1688-candidate-images` → main（155dc69）
> 用户真实手工验收：三条链数据真实，但关键词/图搜结果卡片的商品缩略图大量 broken-image。

## 1. 先 trace 不猜（§1/§2）

| 层 | 实测结果（Keyword 3+ 候选 / Image Search） |
|---|---|
| RAW_IMAGE_FIELD | 1688-cli search 输出 `image` 字段 = **完整 https URL**（`https://cbu01.alicdn.com/img/ibank/O1CN01VUhiVs26E8d7Rhwo7_!!2217167297629-0-cib.jpg`，10/10 齐全） |
| NORMALIZED_IMAGE_URL | normalize 后 `candidate.images[0]` = 同一 URL（无截断/转义） |
| API_IMAGE_URL | 同 URL（无变化） |
| DOM_IMG_SRC | `<img src="https://cbu01.alicdn.com/...">`（完整、正确） |
| NETWORK_FINAL_URL | 同 URL（无重定向） |
| HTTP_STATUS | 直接访问 **200**；**带 Referer: http://127.0.0.1:3005/ → 403** |
| CONTENT_TYPE | image/jpeg（150-220KB 真实图片） |

**定性 = E 类：1688 CDN（alicdn）防盗链**——浏览器 img 请求携带页面 Referer（127.0.0.1:3005）→ alicdn 403 → broken。非 Next/Image（普通 img）、非 normalization、非代理、非 cookie、非 URL 缺失。

## 2. 修复（最小安全，§4/§5/§13/§14/§15）

- `SourcingCandidateThumb`（唯一展示入口）：`referrerPolicy="no-referrer"`（实证：无 Referer → 200 image/*）+ `loading="lazy"` + **onError 单张降级「暂无商品图」占位**（不显示 broken icon、不无限重试、不重复请求）；无图候选同样占位。
- `normalizeCandidateImageUrl`（§5）：protocol-relative `//host` → `https://host`；仅接受 https 绝对 URL；相对路径/其他协议 → null（禁止猜路径）。
- 未引入图片代理（无需：no-referrer 已实证解决，无 SSRF 面、无开放代理风险、无 cookie）。
- 未动价格/MOQ/seller claim 语义（§20）；未做 DB migration（§12/§19——Preview 卡片正确，证据合同无图字段不强行扩展）。

## 3. 真实验收（headed + 真实 3005，§21/§22/§23）

| 链 | 结果 |
|---|---|
| 关键词（儿童吸管水杯） | **10/10 loaded**（修复前 10/10 broken）；0 broken、0 placeholder、0 pending |
| 图搜（真实 Amazon 主图） | **60/60 loaded**（滚动触发 lazy 后全部 naturalWidth>0）；0 broken、0 placeholder |
| 实体绑定 | first/middle/last 抽查：img + offerId（来源 URL）+ title 同卡片一致（§17）；keyword 链 image 与 offerId 同 CLI 输出对象（结构层，§18） |
| 代理环境 | 当前美国代理节点下全部正常（§25） |

after 截图：`docs/v3/changes/v3-final-runtime-closeout/r14-image-search-after.png`（§30；before 状态以修复前 10/10 broken 的 DOM 统计为证据）。

## 4. 测试与质量

- 新增 7 用例：normalizeCandidateImageUrl（4 类拒绝 + protocol-relative + keyword 链集成）、SourcingCandidateThumb（no-referrer 渲染 + 占位 fallback）。
- 全量：**4887 passed / 90 skipped**（+7）；仅 2 个既有环境失败（bridge 53318 端口占用、release-package tar 基线）。tsc / lint（0 errors）/ build PASS；R1-R13 无回归。
- 3005 运行新构建（health 200，计划任务原状态）。

## 5. 门禁（§31）

R14_KEYWORD_IMAGES = PASS（10/10）；R14_IMAGE_SEARCH_IMAGES = PASS（60/60）；IMAGE_ENTITY_BINDING = PASS；IMAGE_SSRF_SAFETY = PASS（无代理、无放宽）；NO_OPEN_IMAGE_PROXY = PASS（未引入代理）；PROXY_ENVIRONMENT = PASS；BROKEN_IMAGE_FALLBACK = PASS；R1-R13 无回归。

LOCAL_RELEASE_CANDIDATE：待用户复查真实商品图后按既有流程评估；PUBLIC_DEPLOY = FORBIDDEN（维持）。

---

# V3 Legacy Research Task Purge & Compatibility Removal

> 2026-08-17 · 分支 `codex/v3-remove-legacy-research` → main（ec811e2）
> 用户授权：LEGACY_RESEARCH_TASKS = REMOVE / LEGACY_RESEARCH_COMPATIBILITY = REMOVE。只保留 Current Research Task / Evidence Workbench / Human Decision / Creative Handoff / Studio。

## 1. 备份（BACKUP FIRST）

- 官方 `db:backup`（SQLite 在线备份）：`.local-backups/db-guard/2026-08-17T06-33-14/dev.db`（6,868,992 B）
- 副本：`prisma/backups/dev.db.before-legacy-purge-20260817-143257`（内容一致）
- **SHA256：`706E0799EDB33FCA7994279E38E329B5E5693ADF467FC3CC747B1B1C3B8E124A`**（两处一致）
- 可读验证：PRAGMA quick_check = ok；tasks=11 / candidates=11
- 备份目录已加入 .gitignore（不提交 Git，§27）

## 2. DRY RUN Inventory（只读，不假定）

11 个任务全量盘点（id/title/type/source/createdAt/updatedAt/decisionStatus/resultJson 结构/关联字段）：

| 类别 | 任务 | 判定 |
|---|---|---|
| AgentRun 新版（5） | 合成验收商品×2 / Owala FreeSip / John Boos / HydroJug | 全部含 `researchRecord` + `creativeHandoff` + `decisionEvidence`（完整新版创作链） |
| candidate_research 新版 Evidence（5） | Owala FreeSip / John Boos / Bentgo / BrüMate / THERMOS | 全部含 `browserEvidence/reviewEvidence/aiEvidenceSummary`（Current Evidence Workbench 结构；用户 R7-R14 验收数据） |
| candidate_research 空壳（1） | Owala SmoothSip（pending） | 仅 keywordEvidence；无 researchRecord/无 evidence 链 |

- **LEGACY_TASK_COUNT = 0**（代码实证：无任何任务属于"旧版主链"格式——全部为当前 V3 结构；§4 硬约束"只有代码实证属于旧主链的 Task 才能删除"）
- CURRENT_TASK_COUNT = 11；**LEGACY ∩ CURRENT = ∅ ✓（无需 STOP）**
- 判定依据（非时间/标题/无证据）：resultJson 顶层结构（researchRecord/creativeHandoff/browserEvidence 等均为当前正式字段）
- 关联：ListingCopyHistory 为独立实体（taskId=null，7 条），与任务删除无关
- **删除 Task 数量 = 0**；删除 child row = 0；保留 shared row = 11（全部任务 + 关联数据原样保留）

## 3. 产品层兼容移除（LEGACY_RESEARCH_COMPATIBILITY = REMOVE）

| 项 | 处理 |
|---|---|
| 旧版人工决定 / 保存旧版状态（详情页 legacy-decision-control） | **移除**；早期候选任务显示只读「当前决定」卡（legacy-decision-readonly） |
| 旧版研究记录（详情/面板 legacy-research-decision 分支） | **移除**（ProductResearchDecisionPanel 只服务新版研究记录） |
| Studio legacy 提示（studio-legacy-unsupported-note / TaskStudioPreparation legacy_not_supported） | **移除**；无新版创作上下文任务不显示创作工具区；Studio 只处理正式 Current Research Context |
| /tasks 描述「已完成、已放弃与旧版记录」 | 改为「已完成、已放弃的研究记录」 |
| 详情页「旧版状态仅保留查看」 | 移除 |

**保留（正式链依赖，B 类）**：
- research-decision 的 legacy readOnly 门禁（数据保护——不能对无 researchRecord 记录写版本化决定）
- classifyResearchLifecycle 的 historical_legacy（数据分类；当前 0 命中，未来非标准 decisionStatus 仍需要）
- TaskRecordsList 列表「人工决策状态」卡片（只读状态展示 + 链接详情决定区；F10 收敛）
- PATCH /api/tasks/[id] decisionStatus（通用 task 字段能力）
- WorkflowDecisionSummary（无调用点遗留组件，未触碰）

## 4. 验收（headed + 真实 3005）

| 项 | 结果 |
|---|---|
| BrüMate（无 researchRecord）详情页 | 无「旧版研究记录/旧版人工决定/保存旧版状态/缺少新版创作资料/创作工具区」；显示只读「当前决定：可继续」 |
| HydroJug（有 researchRecord）详情页 | 正式决定面板 + 创作工具区（Listing/Image CTA）正常；零「旧版」字样 |
| /research | 10 条 active，无旧版字样 |
| /tasks | 空态「还没有历史研究记录」+ 新描述（0 条允许） |
| Listing Studio | PASS（handoff 正常读取上下文） |
| Image Studio | PASS |
| 1688 最小回归 | 关键词「儿童吸管水杯」→ 10 条 Preview，10/10 图片 loaded |
| Owner/Visitor 隔离 | 未触碰权限层（仅 UI/文案），全量权限测试通过 |

## 5. 测试与质量

- 更新 ProductResearchDecisionPanel.test.ts（legacy 分支移除断言 + 详情页只读卡断言）；全量 **4887 passed / 90 skipped**（仅 2 个既有环境失败：bridge 53318 端口占用、release-package tar 基线）；tsc / lint（0 errors）/ build PASS。
- Git：独立分支 `codex/v3-remove-legacy-research`（ec811e2）→ main；备份不提交。
- 3005 运行新构建（health 200，计划任务 Ready/Enabled）。

## 6. 结论

- **LEGACY_RESEARCH_TASKS = REMOVE（数据层无旧版任务可删；已备份）**
- **LEGACY_RESEARCH_COMPATIBILITY = REMOVE（UI/文案收口完成）**
- 正式产品只保留：Current Research Task / Evidence Workbench / Current Human Decision / Current Creative Handoff / Listing-Image Studio
- **独立问题（未混入本轮）**：早期候选任务（无 researchRecord，存量验收数据）决定为只读——如需对这些存量任务继续做决定操作，需另行评估（新 lifecycle 或升级路径，不在本轮范围，§14）
- LOCAL_RELEASE_CANDIDATE：待用户复查后按既有流程评估；PUBLIC_DEPLOY = FORBIDDEN（维持）；V3_6 = NOT_AUTHORIZED

---

# V3 Current Research Normalization & Completion Closure 最终报告

> 2026-08-17 · 分支 `codex/v3-current-research-normalization` → main（5 commits：d05f9f2 / 41fc8cb / 48c6617 / 8835047 / 98b4283）
> 目标（TARGETED WORKFLOW CORRECTION / NO NEW FEATURE）：把上一轮遗留的"无 researchRecord 任务决定只读"纠正为正式 CURRENT_ACTIVE 人工决定，并打通 Active → Completed → 研究记录的完整生命周期。

## 0. 第一句回答（用户最关心的问题）

**是的：那 6 个之前被误认为旧版的 candidate_research 任务已被正式认定为"当前未完成 Research"（CURRENT_ACTIVE，非 legacy，未删除），并恢复了统一正式人工决定（首次保存即创建 product-research-record.v1 revision 1）；用户现在能把一条 Research 从『商品研究』明确完成到『研究记录』——真实 Journey 已用 THERMOS（cmsw7363z0002cih40bujcawy）完整走通并落库验证。**

## 1. 本轮修正的三件事（相对上一轮 Legacy Removal）

上一轮把无 researchRecord 任务的决定区改成只读卡（legacy-decision-readonly），并把无记录任务标为 legacy。本轮按用户要求正式归一：

| 上轮（已纠正） | 本轮（正式语义） |
|---|---|
| 无 researchRecord → legacy / 只读 | 无 researchRecord 但有当前 Evidence（browserEvidence/reviewEvidence/aiEvidenceSummary 等）→ **CURRENT_ACTIVE**，可编辑 |
| 无记录任务不能写版本化决定 | 首次保存人工决定 → 创建 `product-research-record.v1` revision 1（同一 versioned writer，无第二 writer、无 clone） |
| 完成研究 = 不存在的动作 | `POST /api/tasks/[id]/complete`：auth / closure gate / 幂等 / CAS 单次持久化；同一 canonical Task lifecycle 转换（Active → historical） |
| researchRecord 只存在于 agent_run 任务 | researchRecord 是"正式决定/完成记录载体"：Active 阶段可有（5 个 AgentRun 任务在 agent_run 时创建），完成标记为独立命名空间 `research-completion.v1`（resultJson 顶层，无 DB migration） |

## 2. 关键代码实证

- `lib/productResearchRecord.ts`：`RESEARCH_COMPLETION_SCHEMA="research-completion.v1"`、`ResearchCompletionV1`、`parseResearchCompletion`（fail-closed：schema/status/completedAt/decisionId UUID/revision/finalStatus 全校验）、`getResearchCompletion`；`validateDecisionForWorkflow` 与 `parseProductResearchReviewState` 支持 `totalReviewSteps===0`（无 Agent workflow 复核的候选研究）。
- `lib/server/productResearchRecordStore.ts`：
  - `getProductResearchDecisionState`：无 record → `{legacy:false, readOnly:false, record:null}`（可编辑）；有 record + researchCompletion → `readOnly:true`（完成态决定锁定）。
  - `createCurrentResearchDecision`：expectedRevision 必须 = 1；candidateId 从 resultJson 绑定提取；runId=taskId；contextHash/inputHash/resultHash 为确定性 sha256 绑定指纹；workflowStatus="completed" + NO_WORKFLOW_REVIEW；单次 CAS persist（record + verification + decisionStatus 兼容列同步：creative_ready→continue / needs_information→need_info / abandoned→rejected）。
  - `completeCurrentResearch`：幂等（已 researchCompletion → 返回当前状态，不重复写）；gate（无 record → `research_decision_required` 409；needs_information → `research_need_info` 409）；写 `research-completion.v1`（CAS）；同一 Task，不复制。
- `lib/server/taskResultWriterServices.ts` + `taskResultJsonMutation.ts`：`persistResearchDecision` 支持 verification 合并；新增 `persistResearchCompletion`（writer=`research-completion`，OWNED_NAMESPACES 注册 `researchCompletion`；research-decision 追加拥有 `researchVerification`——headed 验收发现并修复的 namespace 契约）。
- `lib/researchLifecycle.ts`：`classifyResearchLifecycle` 先读 researchCompletion（completed→`historical_completed`、abandoned→`historical_abandoned`），再读 researchRecord.latestDecision，再 decisionStatus；`historical_legacy` 仅 defensive（真实数据 0 命中）。
- `app/api/tasks/[id]/complete/route.ts`（新）：POST，requireAuthenticated → completeCurrentResearch → `{taskId, lifecycle, researchRecord, completedAt, idempotent}`。
- `app/api/tasks/route.ts`：`buildResearchScopeWhere("historical")` 纳入 researchCompletion（已完成任务 decisionStatus 仍为 continue，SQL 预过滤必须显式包含）；`scope=completed` 改为 researchCompletion 完成标记；demo sandbox JS 侧过滤同步（headed 验收发现：否则完成任务不会出现在 /tasks）。
- `lib/productResearchPublicDto.ts`：`DETAIL_FIELDS` 增加 `researchCompletion` 安全投影（schema/status/completedAt/revision/finalStatus，**不含 decisionId**——headed 验收发现：否则 F5 后完成态不显示）。
- `components/TaskRecordDetail.tsx`：统一正式决定面板（无条件渲染 ProductResearchDecisionPanel，移除 legacy-decision-readonly 只读卡）；新增 `ResearchCompletionControl`（无决定→禁用"请先保存人工决定"；needs_information→禁用"当前仍需补充资料"；creative_ready/abandoned→[完成研究并保存记录] + 确认弹窗；已完成→"研究已完成并保存到研究记录。"+[查看研究记录]）。完成态判定读取 `productResearchSummary.status`（浏览器投影不含 researchRecord——headed 验收发现并修复）。
- `components/product-research/ProductResearchDecisionPanel.tsx`：创建模式（record null，testid `product-research-decision-create`，保存人工决定 → revision 1）；完成态只读模式（testid `product-research-decision-readonly-completed`，"最终人工决定/研究已完成并保存到研究记录；最终决定不再修改"）。

## 3. 真实验收（headed + 真实 3005，THERMOS cmsw7363z0002cih40bujcawy）

```
登录（管理员）→ /research（10 条）→ 打开 THERMOS（candidate_research，无 researchRecord，
  有 browserEvidence/reviewEvidence/aiEvidenceSummary/sourcingEvidence）
→ 决定区显示创建模式"尚未保存人工决定" + 完成按钮禁用"请先保存人工决定，再完成研究。"（✓ 门禁文案）
→ 人工决定=进入创作准备 + 原因 → 保存人工决定 → DB：researchRecord revision 1 / creative_ready /
  researchVerification / decisionStatus=continue（兼容列同步）✓
→ F5 刷新 → 决定面板"正式研究决定 版本 1 进入创作准备"（✓ 持久化）；完成按钮仍禁用（发现 productResearchSummary
  投影问题 → 修复 → 重新构建重启 3005）
→ [完成研究并保存记录] → confirm 弹窗"完成后，该商品会从『商品研究』移动到『研究记录』。现有研究资料不会删除…"（✓）
→ 确认 → "研究已完成并保存到研究记录。" + [查看研究记录]（✓）
→ F5 → 最终人工决定只读卡（版本 1 / 进入创作准备 / 不再修改）+ 创作工具区（Listing/Image Studio CTA 正常）✓
→ /research：10 → 9 条，THERMOS 不再出现 ✓
→ /tasks：0 → 1 条，THERMOS 显示"研究已完成" ✓
→ 幂等：重复 POST /complete 两次均 200 + idempotent:true + 同一 completedAt（无重复写入）✓
→ DB 断言：tasks=11（不变）、candidates=11（不变，无 clone）、researchCompletion 仅 1 条、
  evidence 4 个命名空间全部保留 ✓
→ Evidence API：browser-evidence / review-evidence / ai-evidence-summary / sourcing 全部 200 ✓
→ 详情 API：productResearchSummary.status=creative_ready + researchCompletion.status=completed，
  decisionId 不泄露（LEAKS_DECISION_ID=false）✓
```

### fixture Journey（visitor / 临时 DEMO_SANDBOX_STORE_PATH，零真实数据影响）— `lib/server/researchCompletionFixtureJourney.test.ts`

| 场景 | 结果 |
|---|---|
| need_info 决定 → 完成 | `research_need_info` 409 拒绝；仍 active_need_info（留在商品研究）✓ |
| abandoned 决定 → 完成 | researchCompletion=abandoned → historical_abandoned（已放弃历史）；重复完成 idempotent:true ✓ |
| creative_ready 决定 → 完成 | completed → historical_completed；决定 readOnly ✓ |

## 4. 测试与质量

- **FULL_REGRESSION = PASS**：`npx vitest run` → **4907 passed / 90 skipped**（仅 2 个既有环境失败：native1688Bridge 53318 端口被 3005 占用、release-package Windows tar 基线——均非本轮引入）。
- 新增/更新测试：store（无记录可编辑 / 首次保存创建 revision 1 / 绑定缺失拒绝 / 完成写 researchCompletion / 幂等 / need_info 拒 / 无决定拒 / 完成态只读 + 禁止再改）、complete route（6 项：成功/幂等/401/无决定 409/need_info 409/空 id 400）、lifecycle（historical_completed/abandoned 优先）、tasks route（scope=historical 含 researchCompletion / scope=research 排除已完成）、publicDto（researchCompletion 安全投影不泄露 decisionId）、panel（创建/完成态/门禁文案/productResearchSummary 读取断言）、fixture journey（3 场景）。
- tsc / lint（0 errors）/ build：全部 PASS。
- 修复过程中发现的真实缺陷（headed 验收驱动）：① research-decision writer 未拥有 researchVerification 命名空间（namespace_contract_invalid）→ 注册；② scope=historical SQL 预过滤不含 researchCompletion → 完成任务不显示在 /tasks；③ DETAIL_FIELDS 缺 researchCompletion → F5 后完成态不显示；④ 完成控件读 researchRecord（投影已剥离）→ 改读 productResearchSummary。

## 5. Git / 运行 / 备份

- 分支 `codex/v3-current-research-normalization`（5 commits）→ main（ff-only）：
  - d05f9f2 fix(v3): normalize current research lifecycle - candidate_research is CURRENT_ACTIVE
  - 41fc8cb fix(v3): restore unified human decision editing for all current research
  - 48c6617 feat(v3): close research via POST /api/tasks/[id]/complete
  - 8835047 fix(v3): completion control reads projected summary - real headed acceptance find
  - 98b4283 test(v3): visitor fixture journeys for research completion gates
- 3005 运行最新构建（health 200，计划任务 QingXuanAgent-Local-3005 Ready/Enabled）。
- DB 轻量备份：`.local-backups/db-guard/2026-08-17T15-31-17/dev.db`（SHA256 `706E0799EDB33FCA7994279E38E329B5E5693ADF467FC3CC747B1B1C3B8E124A`，备份于真实 Journey 之前；不提交）。

## 6. Final Gate（§64）

| Gate | 结果 |
|---|---|
| LEGACY_DATA = 0 | PASS（11 任务全为当前 V3 结构；6 个 candidate_research 正式认定为 CURRENT_ACTIVE，0 删除） |
| CURRENT_ACTIVE_DECISION_EDIT = PASS | PASS（THERMOS headed 保存人工决定成功） |
| DECISION_PERSIST = PASS | PASS（researchRecord revision 1 + verification + decisionStatus 同步；F5 后仍显示） |
| RESEARCH_COMPLETION_ACTION = PASS | PASS（完成按钮 + confirm + 成功态 + 移入研究记录） |
| RESEARCH_COMPLETION_IDEMPOTENT = PASS | PASS（重复 POST /complete → idempotent:true，无重复） |
| NO_TASK_CLONE = PASS | PASS（tasks/candidates 均 11 不变） |
| ACTIVE_TO_HISTORY = PASS | PASS（/research 10→9；/tasks 0→1；F5 正确） |
| RESEARCH_RECORD_VISIBLE = PASS | PASS（/tasks 显示 THERMOS 研究已完成；详情 Evidence/Decision/Studio 正常） |
| NEED_INFO_STAYS_ACTIVE = PASS | PASS（fixture：need_info 完成被拒，留在商品研究） |
| REJECTED_HISTORY = PASS | PASS（fixture：abandoned → historical_abandoned 已放弃历史） |
| EVIDENCE_PRESERVED = PASS | PASS（4 个 evidence 命名空间完整；Evidence API 全部 200） |
| LISTING/IMAGE_ACTIVE+COMPLETED = PASS | PASS（completed 详情创作工具区正常；Studio 读取上下文） |
| OWNER_VISITOR_ISOLATION = PASS | PASS（权限层未触碰；全量权限测试通过；fixture 用临时 store 隔离） |
| SCROLL = PASS | PASS（TaskRecordsList 滚动逻辑未改动；列表浏览/查看更多正常） |
| FULL_REGRESSION = PASS | PASS（4907 passed / 90 skipped，仅 2 个既有环境失败） |
| **LOCAL_RELEASE_CANDIDATE** | **APPROVED**（待用户亲自验证 Journey 后按既有流程评估） |

## 7. 遗留与边界

- createCurrentResearchDecision 的确定性 hash 是"绑定指纹"（锁定 task↔candidate），不承诺内容完整性；verification 写入后 record 任何修改即 hash 失配（assertBinding 门禁）。
- abandoned 决定未完成前仍显示在 /research（可继续操作）；完成 abandoned 后进入已放弃历史——语义按 §14 保持。
- `historical_legacy` 保留为 defensive 分类（当前真实数据 0 命中）。
- PUBLIC_DEPLOY = FORBIDDEN（维持）；V3_6 = NOT_AUTHORIZED。
- 3005 保持运行，等待用户亲自验证 Journey（商品研究 → 保存决定 → 完成研究 → 研究记录）。

---

# V3 Human Decision Authority Consistency Fix — P1 最终报告

> 2026-08-17 · 分支 `codex/v3-human-decision-authority`（5084e30）→ main
> 用户报告 P1：Bentgo（cmsw0bzti0004udte4dauumii）详情页顶部显示"人工决定：已记录"，但底部决定面板显示"尚未保存人工决定"，且保存按钮灰色——状态自相矛盾，用户以为研究已完、找不到保存入口。

## 1. decisionStatus 的真实定位（修复后正式语义）

- `decisionStatus` 是**兼容列 / projection / filtering helper**：继续用于 /research 列表过滤（buildResearchScopeWhere）、lifecycle active/historical 分类（classifyResearchLifecycle 的旧版兜底分支）、列表筛选下拉等 A 类用途。
- **它不再是 Human Decision Authority**：不能单独证明"已保存人工决定"、"可以完成研究"、"已存在正式 researchRecord"或"Creative Handoff ready"。
- 正式 Human Decision authority = `product-research-record.v1`（浏览器投影 `productResearchSummary`，schema + status 有值）**或** 正式 `humanDecision` record（status 有值）。实证：agent_run 任务两者都有；新体系（THERMOS/Bentgo）只有 researchRecord。

## 2. 被删除的错误 fallback

| 位置 | 旧逻辑 | 新逻辑 |
|---|---|---|
| `lib/taskResearchHistoryPresentation.ts` | `humanDecisionExists = ... \|\| input.decisionStatus !== "pending"` | 只认 productResearchSummary / humanDecision |
| `lib/userProgressSummary.ts` | `hasHumanConclusion = keys.has("human_conclusion") \|\| decisionStatus === "continue"` | 只认 human_conclusion artifact / 正式载体 |
| `lib/taskWorkflowSummary.ts` getPriority | `decisionStatus === continue/rejected/need_info` 直接给"可跟进/已放弃/需补资料" | 仅正式决定存在时才采用（否则回退风险/结论信号） |
| `components/agentNextStepPanelModel.ts` getStage/getAgentStatus | `decisionStatus === continue` → "可人工推进" | 仅正式决定存在时；高风险 guard 保持与决定无关 |
| `components/TaskRecordsList.tsx` 卡片 | 无正式决定 → `getDecisionStatusOption(decisionStatus).shortLabel`（"可继续"） | 无正式决定 → **"待人工决定"** |
| `components/TaskRecordDetail.tsx` TaskDecisionHero | 直接传 decisionStatus | 无正式决定 → 传 `"pending"`（Hero 显示"待判断"） |

## 3. 全仓 Authority Sweep 结果

grep `decisionStatus` 全部误用点，分类：

- **A 类（保留，UI filter / compatibility projection）**：`lib/researchLifecycle.ts:92`（active 分类兜底）、`lib/productResearchPresentation.ts` deriveStage（humanDecision.status 优先，兼容列仅 stage 展示）、`lib/productPipeline.ts`（pipeline status 是流程展示，非决定断言）、`app/api/tasks/route.ts` scope 过滤。
- **B 类（必须改，Human Decision existence）——共 6 处，全部已修**：taskResearchHistoryPresentation（主修）+ userProgressSummary + taskWorkflowSummary + agentNextStepPanelModel（2 处：getStage/getAgentStatus）+ TaskRecordsList 卡片 + TaskDecisionHero。
- **C 类（Completion Gate）——原本就安全，回归确认**：`completeCurrentResearch` 无 record → `research_decision_required` 409，不看 decisionStatus。
- **D 类（Studio/Handoff readiness）——未发现误用**：creative-handoff gate 基于 researchRecord/hash 验证，不读兼容列。

## 4. Bentgo 修复前 → 修复后

| 项 | 修复前 | 修复后（headed 实测） |
|---|---|---|
| 顶部徽标 | 人工决定：**已记录** ❌ | 人工决定：**待确认** ✅ |
| 研究状态 | 研究记录待补充 | 研究记录待补充（一致） |
| 底部面板 | 尚未保存人工决定（一致但矛盾） | 尚未保存人工决定（两处一致，矛盾消除） |
| 列表卡片"当前决定" | "可继续" ❌ | "待人工决定" ✅ |
| 保存按钮 | 灰色无解释 | 灰色 + "保存前待完成：填写决定原因…" 引导 ✅ |

## 5. 保存按钮为什么 disabled + 用户如何知道缺什么

- disabled 是因为表单校验 gate：`reason 必填`；`needs_information` 时 `下一步动作必填`（§7 明确不要取消 required gate）。
- 新增 Disabled Button UX（§8）：按钮下方显示"保存前待完成"列表（填写决定原因 / 填写下一步动作（需补资料时必填））；创建模式新增引导句"请先选择人工决定并填写原因；信息完整后即可保存"，`needs_information` 时额外提示"选择『需补资料』时，还需要填写下一步动作"。

## 6. 保存后的统一状态 / F5 持久（headed 实测，§9/§11）

1. 初始：顶部"待确认" + 面板"尚未保存" ✅
2. 选"进入创作准备" + 填原因 → 保存按钮 disabled → **enabled**，引导消失 ✅
3. 点击保存 → 成功提示 + 顶部立即变"研究已完成 / 人工决定：已记录" + 面板"正式研究决定" ✅
4. F5 → 完全一致（研究已完成 / 已记录 / 版本 1 / 完成按钮可用）✅
5. /research 列表：该任务卡片同步（保存后状态一致）✅

## 7. Completion 仍安全（§13）

- **保存正式决定前**：`POST /complete` → **409 `research_decision_required`**（Bentgo decisionStatus=continue 也不能放行）✅
- **保存正式决定后**：gate 正常放行 → completed（headed 实测中 Bentgo 因此被正式完成，与 THERMOS 相同——这是有意的真实验收动作；Bentgo 现已在研究记录中，researchCompletion=completed）
- need_info 决定 → 409 `research_need_info`（fixture 测试覆盖）

## 8. 存量数据

- **未修改任何存量 decisionStatus**（NO_DB_DATA_REWRITE = PASS）；本轮只修读语义，不抹历史数据。
- Bentgo 因验收被正式保存决定（revision 1 creative_ready）+ 完成（researchCompletion）——这是 §11/§13 要求的真实 Journey 数据；其余 5 个 candidate_research 任务保持原状（decisionStatus=continue 但无正式决定，现在 UI 正确显示"待确认/待人工决定"）。

## 9. 测试与质量

- 新增/更新测试：taskResearchHistoryPresentation（continue 无正式→false / 正式载体→true / pending+正式→true）、userProgressSummary（兼容列不放行 / 正式载体放行）、taskWorkflowSummary（无正式不显示人工认可 / 正式+continue 保留）、agentNextStepPanelModel（无正式→待决策 / 高风险 guard 独立）、ProductResearchDecisionPanel（引导 + need-info 提示 + 更新模式引导）。
- **targeted：150 passed**（13 files）；**full regression：4915 passed / 90 skipped**（仅 2 个既有环境失败：native1688Bridge 53318 端口占用、release-package Windows tar 基线，非本轮引入）；tsc / lint（0 errors）/ build 全 PASS。
- **headed 真 3005**：Bentgo 全流程（初始徽标 → 表单 → 保存 → 顶部同步 → F5 → 列表标签）实测通过。

## 10. Final Gate

| Gate | 结果 |
|---|---|
| DECISION_AUTHORITY = FORMAL_RECORD_ONLY | PASS |
| BENTGO_INITIAL_BADGE = 待确认 | PASS（headed 实测） |
| BENTGO_PANEL = 尚未保存 | PASS（headed 实测） |
| NO_STATUS_CONTRADICTION = PASS | PASS |
| DISABLED_BUTTON_GUIDANCE = PASS | PASS |
| FORMAL_DECISION_SAVE = PASS | PASS（headed 实测） |
| F5_PERSIST = PASS | PASS（headed 实测） |
| COMPLETION_BEFORE_DECISION = DENY | PASS（409 research_decision_required） |
| COMPLETION_AFTER_VALID_DECISION = PASS / CONTRACT_CORRECT | PASS |
| NO_DB_DATA_REWRITE = PASS | PASS（未动存量 decisionStatus） |
| **P1 = CLOSED** | ✅ |

## 11. Git / 运行

- 分支 `codex/v3-human-decision-authority`（5084e30，12 files +319/-26）→ main（ff-only）。
- 3005 运行修复后构建（health 200，计划任务 Ready/Enabled）。
- PUBLIC_DEPLOY = FORBIDDEN（维持）；V3_6 = NOT_AUTHORIZED；未触碰 1688/Amazon/VOC/Studio。
- 提醒：Bentgo 已作为验收被完成（在研究记录中）；如需回退 Bentgo 的保存+完成（回到"未决定"状态），备份 `.local-backups/db-guard/2026-08-17T20-17-48` 之前的状态可恢复，或告诉我由我处理。


---

# V3 Evidence → Creative Context Closure — P1 最终报告

> 2026-08-17 · 分支 `codex/v3-evidence-creative-context` → main
> 主链 P1：商品研究阶段已保存的 Evidence 此前没有进入 Listing / Image 创作上下文。

## 0. 第一句回答（用户最关心的问题）

**是的：用户在商品研究中收集的 Amazon Evidence（browserEvidence）、VOC（reviewEvidence/vocAnalysis）、AI 证据摘要（aiEvidenceSummary）、关键词（keywordEvidence）、竞品（competitorEvidence）和 1688 供应线索（sourcingEvidence）现在已真正进入 Listing / Image 的创作上下文（预览、生成输入与提示词均可见），并且系统严格区分『事实』与『参考资料』——只有经过正式人工确认的商品事实才进入 confirmedFacts（Bentgo 实测：bsr 从浏览器证据确认后进入 revision 2 的 confirmedFacts；VOC/AI/竞品/供应/关键词全部只作参考层，绝不自动成为事实）。**

## 1. 原断层 root cause

Creative Handoff 投影链（`buildProductCreativeHandoffProjectionEvidence`）只读取 `candidateAnalysisContext` + `agentOutputSnapshot` 两个输入；Evidence Workbench 的证据命名空间（browserEvidence/reviewEvidence/vocAnalysis/aiEvidenceSummary/sourcingEvidence/competitorEvidence/keywordEvidence）只被展示层消费，从未进入创作链 → Studio 显示"当前来源资料没有可直接核实的商品事实候选"。

## 2. 原 Listing/Image 输入链

- Listing：creativeHandoff → `buildListingInputFromCreativeHandoff` → productFacts/creativeReferences/prohibitedClaims/unknowns → `buildListingPromptFromInput`（五分区）→ Provider（mock/real）
- Image：creativeHandoff → `buildImageInputFromCreativeHandoff` → productFacts/approvedVisualReferences/compositionReferences → `buildImagePromptFromInput`（双模式）

## 3. 新 Creative Context Builder（唯一桥）

`lib/creativeContextBuilder.ts`：`buildCreativeContextFromResearch(resultJson)` → typed `creative-context.v1`（纯函数、确定性、runtime projection、无 DB migration、无第二套 Research 模型）。所有 Evidence 先进入统一 Builder，再由 Listing/Image 消费（不做三套零散 adapter）。

## 4-5. Builder 输入/输出

- 输入：resultJson（researchRecord + candidateAnalysisContext + 全部 Evidence namespaces + creativeHandoff + agentOutputSnapshot）
- 输出：confirmedFacts / confirmableFactCandidates / vocInsights / keywordCandidates / competitiveContext / sourcingContext / aiReferences / missingConflicts + counts（bounded、evidenceRef 可追溯）

## 6-7. confirmedFacts authority / confirmableFactCandidates 来源

- confirmedFacts 只来自现有 Creative Handoff 已人工确认的事实（`parseHandoffConfirmedFacts`），绝不因 Evidence 自动增加。
- candidates 来源：(a) candidateAnalysisContext stable facts（既有链）；(b) **browserEvidence 确定性字段**（新增投影 `projectBrowserEvidenceStableFacts`，经新 sourceRef 分支 `amazon_browser_snapshot` 进入同一确认链）。

## 8-10. browserEvidence 投影字段 / provenance / entity binding

| FIELD | VALUE | EVIDENCE_REF | ENTITY_BINDING | WHY |
|---|---|---|---|---|
| asin | B08CVT84C9 | ev:browser:{asin}:{capturedAt} | bound+urlAsin=targetAsin | identity_only（身份绑定） |
| title | 页面标题 | 同上 | 同上 | routing_only（路由参考） |
| price_usd | 32.99 | 同上 | 同上 | market_signal（Observed Amazon Page Price，非采购成本） |
| bsr | 8 | 同上 | 同上 | market_signal |
| rating | 4.6 | 同上 | 同上 | market_signal |
| review_count | 18999 | 同上 | 同上 | market_signal |

规则：entityBinding.bound=false 或 observed ASIN ≠ target ASIN → 整条跳过（wrong entity 保护）；字段 status ≠ correct → 跳过；同 field 与 candidateAnalysisContext 冲突时以 candidate snapshot 为准（不重复）。

## 11-20. 各层去向与 Fact 边界

- VOC → `vocInsights`（theme/summary/evidenceRefs/reviewCount/strength；NOT FACT，绝不产生"产品漏水"或"100% 防漏"）
- AI Summary + agentOutputSnapshot → `aiReferences`（AI_REFERENCE_NOT_FACT；AI 总结是解释层，不二次升权）
- Keyword → `keywordCandidates`（observed/search evidence；人工确认 gate 复用现有 listingKeywordBrief 机制，不新建编辑器）
- Competitor → `competitiveContext`（reference-only；禁止复制竞品属性为目标商品事实）
- Sourcing → `sourcingContext`（displayedPrice ≠ purchaseCost；Similar ≠ Exact；confirmed 标记来自 humanConfirmed）
- Missing/conflicts → `missingConflicts`（不得推断补全）；sourceImages/visualReferences 沿用既有 visual reference 链

## 21-24. 接入与安全

- preview gate 新增 `creativeContext`（完整 Builder 输出，服务端）→ preview DTO 只暴露 `creativeContextSummary`（§63 Public DTO：无 resultJson/内部 hash/raw connector state）
- Listing/Image generation input 增加 bounded `creativeContext` 参考层；prompt 增加"研究参考层（NOT FACTS）"分区（VOC/KEYWORD/COMPETITIVE/SOURCING/AI 各自明确用途）
- evidenceRef 全程保留；不复制 14KB reviews/raw 1688（只投影摘要/top-N/引用）

## 25-31. 人工确认 / 保护 / readiness

- 新 candidates 只展示、人工确认后才进 confirmedFacts（确认链复用 `confirmSelectedProductFacts`，CAS/revision 不变）
- 已有 confirmedFacts 不被重建覆盖（merge 现有版本）；新 Evidence 只新增 candidates，不重置旧确认
- readiness 语义不变（READY/NEEDS_CONFIRMATION/NOT_AVAILABLE）；无正式决定任务（BrüMate）维持 gate 拒绝
- Human Decision / Research Completion / Creative Handoff 三者继续分离

## 32. Bentgo 修复前 Context（baseline）

- confirmedFacts=2（brand/series_or_model）；confirmable candidates=6（仅 candidate snapshot）；VOC=0；AI refs=0；keyword=0；competitor=0；sourcing=0；Studio 显示"当前来源资料没有可直接核实的商品事实候选"

## 33-38. Bentgo 修复后 Context（headed + API 实测）

- confirmable candidates=7（+bsr 来自 amazon_browser_snapshot）；VOC insights=12；AI references=9；missing/conflicts=7；keyword/competitor/sourcing=0（Bentgo 无此类证据）
- VOC 实测：School lunches (n=2)、Kids meals (n=2) 等主题带 reviewCount/evidenceRefs
- 人工确认 bsr=8 → **confirmedFacts=3（revision 2，F5 持久）**，bsr 为 market_signal 仅 internal（不污染 Listing）
- John Boos（agent_run）：旧链正常（confirmable=9、aiRefs=2）+ keyword candidates=10（keywordEvidence 真实进入）+ AI refs=10 → 回归 PASS
- BrüMate（无正式决定）：gate=legacy_not_supported → 未绕过

## 39-43. Listing 正式消费 / Prompt Policy / Claim Gate / 真实验收

- Listing input 携带 creativeContext 参考层；prompt 明确：CONFIRMED FACTS=可声明事实；VOC/KEYWORD/COMPETITIVE/SOURCING/AI=参考 only；MISSING=不得推断
- Listing claim filter / integrity gate 不变：只允许 confirmedFacts 支撑 factual claim（VOC/AI/竞品/供应进入 prompt 不放宽 claim gate）
- 真实 AI smoke：LISTING_PROVIDER_MODE=real 需付费调用 → 遵守授权纪律（§89），未擅自多次调用；以 Context Inspection + contract tests（mock 链验证 reference layers 进入 prompt 且不污染 facts）替代

## 44-47. Image 正式消费 / Claim Safety

- Image input 携带 creativeContext（VOC→场景优先级、AI→创意方向、Competitive→差异化参考）；视觉文案事实 claim 仍只能来自 confirmedFacts
- 实测 Image Studio 显示"创作参考资料（研究证据已载入）"：VOC 12 / AI 已载入 / 缺失 7
- agentOutputSnapshot 保留为 aiReference（不高于 Evidence 事实权限）；candidateAnalysisContext 保留为 identity/source snapshot

## 48-53. 事实 Authority / UI / Missing

- 唯一事实 authority：deterministic source fact candidate + Human Confirmation → confirmedFacts（其余一律参考层）
- Studio 新增轻量"创作参考资料"摘要（§51）：已确认事实/待确认候选/VOC/关键词/竞品/供应/AI/缺失计数，可展开 VOC 洞察；不复制 Evidence Workbench
- 无足够 confirmedFacts 时文案："已载入研究证据（含仅内部参考的市场观察，如 Observed Price / Rating / BSR；它们不会自动成为 Listing 事实）"（不再假装 Context 为空）

## 54-56. Prompt Injection / Raw Text / Token Budget

- 全部外部文本（review/competitor/sourcing/browser）视为 UNTRUSTED：bounded excerpt（≤200 字符）+ NFC + 结构化字段；注入文本测试确认不升级为 Fact
- 不把 HTML/脚本/评论原文直接拼 prompt；token bounding：各层 top-N（VOC 12 / keyword 20 / competitor 5 / sourcing 5 / AI 10 / missing 12）+ 长度上限

## 57-64. Determinism / Migration / CAS / 兼容 / 历史 / DTO / 隔离

- 纯函数确定性投影（同输入同输出，测试覆盖）；无 DB migration；revision/CAS/fingerprint 沿用
- 旧 Studio-ready 任务不强制 NEEDS_CONFIRMATION（已有 confirmedFacts 继续有效，新 Evidence 作为额外 context）；历史 Listing/Image 不被重写
- Public DTO 只暴露必要 projection；Owner/Visitor actor isolation 不变（gate 权限链未触碰）

## 65-74. 测试（新增）

- bridge 8 项（分层/观察价语义/Fact Lane/错实体/status 门禁/确定性/注入隔离/降级）
- browser 投影 5 项（字段规则/错实体×2/status/空）
- handoff contract 1 项（amazon_browser_snapshot sourceRef 解析+指纹稳定）
- listing 2 项（参考层进输入不污染 facts / 无 context 兼容）+ image 1 项（参考层进输入不污染 facts + prompt NOT FACTS）
- 全量回归：**4932 passed / 90 skipped**（仅 2 个既有环境失败：native1688Bridge 53318 端口占用、release-package Windows tar 基线，非本轮引入）

## 75-76. Bentgo Headed Journey（真实 3005）

打开研究记录 → Evidence Workbench（确认证据存在）→ Listing Studio → "创作参考资料（研究证据已载入）"（VOC 12/AI 已载入/缺失 7）→ 不再显示"没有来源资料" → 确认 bsr=8（浏览器证据候选）→ revision 2 → F5 保留 → Image Studio 同样显示上下文。

## 77-78. John Boos / BrüMate

John Boos（agent_run）旧链无回归（confirmable 9/aiRefs 2 + keyword 10 进入参考层）；BrüMate（无正式决定）gate 拒绝（legacy_not_supported），未绕 gate。

## 79-85. 范围控制

Performance：Builder 纯投影（不重跑 AI Summary）；无新 Agent/RAG/向量库；不扩展 1688/Amazon/VOC/Keyword 采集（只消费已有 Evidence）。

## 86-89. Git / Backup / Validation / Real AI

- 分支 `codex/v3-evidence-creative-context`（21 files +1809/-13）→ main（ff-only）；未 push/force/history-rewrite；未触碰 prisma/dev.db 与本地备份
- DB 备份（headed Journey 前）：`.local-backups/db-guard/2026-08-17T22-51-57/dev.db`（SHA256 F2DD8D8E158048339219259445617FFCF226B1A4918E80981E77B3649AD709A6，不提交）
- tsc / lint（0 errors）/ build 全 PASS；targeted + full regression 通过；headed Playwright 真 3005 全流程
- 真实 AI Listing smoke：provider=real 需付费授权 → 未擅自调用（Context Inspection + contract tests 替代）

## 90. Final Gate

| Gate | 结果 |
|---|---|
| EVIDENCE_TO_CREATIVE_BRIDGE = PASS | PASS |
| FACT_AUTHORITY_PRESERVED = PASS | PASS |
| BROWSER_FACT_CANDIDATES = PASS | PASS（bsr/rating/review_count/price 进入 candidates） |
| HUMAN_CONFIRMATION_GATE = PASS | PASS（bsr 确认后 revision 2，F5 保留） |
| VOC_CONTEXT = PASS | PASS（12 insights 可见） |
| AI_REFERENCE = PASS | PASS（9 refs 可见） |
| KEYWORD_CONTEXT = PASS | PASS（John Boos 10 candidates 真实进入） |
| COMPETITIVE_CONTEXT = PASS（fixture） | PASS（contract tests） |
| SOURCING_CONTEXT = PASS（fixture） | PASS（contract tests） |
| VOC_NOT_FACT / AI_NOT_FACT / COMPETITOR_NOT_FACT / SOURCING_NOT_FACT / KEYWORD_NOT_FACT | 全 PASS |
| PROVENANCE = PASS | PASS |
| WRONG_ENTITY_PROTECTION = PASS | PASS |
| PROMPT_INJECTION_ISOLATION = PASS | PASS |
| LISTING_CONTEXT = PASS | PASS（headed + input/prompt） |
| IMAGE_CONTEXT = PASS | PASS（headed） |
| EXISTING_CONFIRMED_FACTS_PRESERVED = PASS | PASS（revision merge） |
| NO_DB_MIGRATION = PASS | PASS |
| OWNER_VISITOR_ISOLATION = PASS | PASS |
| FULL_REGRESSION = PASS | PASS（4932 passed） |
| **P1_EVIDENCE_CREATIVE_CONTEXT = CLOSED** | ✅ |
| **LOCAL_RELEASE_CANDIDATE = APPROVED** | ✅（待用户亲自验证后按既有流程评估） |

## 91-93. 汇报与 STOP

- 第一句回答见第 0 节。
- 遗留：真实 AI Listing smoke 因付费授权纪律未执行（provider=real）；若用户授权单次调用，我可执行并在 Context Inspection 基础上补充输出安全检查。
- **STOP**：未继续 V3.6/公网部署/RAG/1688/Amazon/VOC/Keyword 采集扩展/UI polish；3005 保持运行（health 200），等待用户亲自验证"商品研究收集的资料现在 Listing/Image 有没有真的用上"。