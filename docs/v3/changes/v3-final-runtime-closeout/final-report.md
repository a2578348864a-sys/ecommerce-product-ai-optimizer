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
