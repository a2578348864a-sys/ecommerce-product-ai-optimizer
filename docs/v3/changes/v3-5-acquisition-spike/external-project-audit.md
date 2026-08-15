# V3.5-A — External Project Audit（外部项目分层审计）

> 审计日期：2026-08-15；方式：gh API + 本地 TEMP 浅克隆源码审阅（未安装/未运行——用户选择先静态审计）。
> 纪律（任务书七节）：仅凭搜索摘要/旧博客/Star 不判定能力；分层输出。

## 1. next-1688 生态（Route A 代表）

**项目分层**：

| 层 | 状态 | 证据 |
|---|---|---|
| PROJECT_EXISTS | ✅ 是 | org `next-1688` 24 仓（2026-03-02 创建）；`1688-product-find`（167★）、`1688-source-suppliers`（554★）、`1688-item-select`（628★）、`1688-supplychain-api-procurement`（0★）、`1688-sourcing-inquiry`（99★）等 |
| PROJECT_MAINTAINED | ✅ 活跃 | product-find 更新 2026-08-12、source-suppliers 2026-08-08；SKILL v1.7.0 |
| INSTALL_WORKS | ⏳ NOT_TESTED（静态可判：纯 Python + requirements.txt，无 postinstall） | 未安装 |
| AUTH_WORKS | ⏳ NOT_TESTED（静态可判：OAuth 2.1/PKCE + AK 双模式，见 route-a） | 未运行授权 |
| SEARCH_WORKS | ⏳ NOT_TESTED | 需 AK 实测 |
| IMAGE_SEARCH_WORKS | ⏳ NOT_TESTED | 代码存在（capabilities/image_search） |
| DETAIL_WORKS | ⏳ NOT_TESTED | find_product API 映射存在 |
| STRUCTURED_OUTPUT_WORKS | ✅ 静态确认：标准 JSON（success/markdown/data）+ 统一商品结构（_http.py `_parse_product_item`） | 源码 |
| ENTITY_BINDING_WORKS | ✅ 静态确认：`product_id(itemId)` + `detail_url`（detail.1688.com/offer/{id}.html）同一 item 内绑定 title/image/price/sku/supplier | 源码（_http.py:180-207） |
| SAFE_FOR_OUR_USE | ⚠️ **License 缺失**（product-find/source-suppliers license 为空 = 默认保留所有权利）——代码不可直接复制/并入；可参考其 API 协议（官方网关公开接口） | gh api license=null |
| FIT_FOR_V3_5 | ⚠️ 条件性：技术形态合适（官方网关/OAuth/结构化），**但 license 不明 + AK 获取门槛待用户实测** | — |

**官方关系**：endpoint 全部 `*.1688.com`（`air.1688.com/app/tai/oauth_page` 授权页、`skills-gateway.1688.com/api/*` 网关）——**1688 官方 Skills 网关**；AK 获取入口 `clawhub.1688.com`。org 本身无官网/描述（无法确认 org 官方身份，但端点指向官方域名）。

## 2. superjack2050/1688-cli（Route B）

| 层 | 状态 | 证据 |
|---|---|---|
| PROJECT_EXISTS | ✅ 是 | 57★，TypeScript，2026-05-12 创建 |
| PROJECT_MAINTAINED | ✅ 活跃 | 更新 2026-08-14；v0.1.47；CHANGELOG 持续 |
| INSTALL_WORKS | ⏳ NOT_TESTED（静态可判：npm 包 + postinstall 自动装 Chromium，失败非致命） | 未安装 |
| AUTH_WORKS | ⏳ NOT_TESTED（静态确认登录模型：`1688 login` 扫码 + Playwright `launchPersistentContext` 自有 profile，见 route-b） | 未运行 |
| SEARCH_WORKS | ⏳ NOT_TESTED | — |
| IMAGE_SEARCH_WORKS | ⏳ NOT_TESTED | README 声称支持 |
| DETAIL_WORKS | ⏳ NOT_TESTED | — |
| STRUCTURED_OUTPUT_WORKS | ✅ 静态确认：docs/JSON_CONTRACTS.md 存在 + 命令 -f json | 文档/源码结构 |
| ENTITY_BINDING_WORKS | ⏳ NOT_TESTED（静态：以 offerId/URL 为键，dedupe 逻辑存在） | 待实测 |
| SAFE_FOR_OUR_USE | ⚠️ **MTOP 内部协议**（`mtop.1688.buycenter.*`、`parseMtopJsonp`、`hijack window.lib.mtop.request`）——依赖 1688 非公开接口，稳定/合规风险高；MIT license 可集成；登录为工具自有 profile（安全可接受）；含 cart/order/seller chat 等写命令（V3.5 禁止调用） | 源码 + docs/playbooks/add-mtop-capture.md |
| FIT_FOR_V3_5 | ⚠️ 条件性：若 MTOP 稳定性可接受且扫码登录可行，LOCAL_SESSION_CLI 候选；风险高于官方 API | — |

## 3. jackwener/OpenCLI（Route C）

| 层 | 状态 | 证据 |
|---|---|---|
| PROJECT_EXISTS | ✅ 是 | 28,205★，2026-03-14 创建 |
| PROJECT_MAINTAINED | ✅ 高度活跃 | 更新 2026-08-15（审计当天）；v1.0.22 Extension |
| INSTALL_WORKS | ⏳ NOT_TESTED（静态可判：npm CLI + Chrome Extension 手动安装） | 未安装 |
| AUTH_WORKS | ⏳ NOT_TESTED（静态确认模型：**复用用户已登录 Chrome 会话**，读 1688 cookie 验证登录态，非导出） | auth.js |
| SEARCH_WORKS | ⏳ NOT_TESTED | adapter 存在（clis/1688/search.js） |
| IMAGE_SEARCH_WORKS | ❌ 无此能力（1688 adapter 只有 search/item/assets/download/store；无 image-search） | adapter 列表 |
| DETAIL_WORKS | ⏳ NOT_TESTED（`opencli 1688 item`） | item.js |
| STRUCTURED_OUTPUT_WORKS | ✅ 静态确认：`-f json` + docs/JSON_CONTRACTS 风格；offer_id/member_id/shop_id 实体键 + search dedupe（offer_id 优先） | 1688.md |
| ENTITY_BINDING_WORKS | ✅ 静态确认：targetId↔tabId CDP 页面身份映射（identity.ts，miss→硬错误不猜）+ `OPENCLI_CDP_TARGET` 限定 | 源码 |
| SAFE_FOR_OUR_USE | ⚠️ **高权限 Extension**（manifest：debugger+tabs+cookies+<all_urls>）；无 telemetry/外发（只连 localhost daemon:19825）；Apache-2.0 可集成；daemon 无鉴权（localhost 信任边界）；cookie 读取仅用于登录态验证（getCookies 1688.com） | manifest/protocol/background |
| FIT_FOR_V3_5 | ⚠️ 条件性：UX 最贴近"打开 1688 帮我看"，但 Extension 权限高 + 依赖用户 Chrome 登录态；待实测 bind/结构化 | — |

## 4. 交叉对比速览

| 维度 | Route A（next-1688） | Route B（1688-cli） | Route C（OpenCLI） |
|---|---|---|---|
| License | ❌ 无（不可复制代码） | ✅ MIT | ✅ Apache-2.0 |
| 官方程度 | ✅ 官方网关 | ❌ MTOP 内部协议 | ⚠️ 页面 DOM（公开字段） |
| Credential Model | API_KEY/OAuth token | OWN_PROFILE+扫码 | EXISTING_BROWSER_SESSION |
| 图片搜同款 | 静态确认存在 | 声称支持 | ❌ 无 |
| 结构化 JSON | ✅ | ✅ | ✅ |
| 高权限/高风险 | 低（官方 API） | 中（MTOP+浏览器自动化） | 高（<all_urls>+cookies+debugger） |
| 实测状态 | NOT_TESTED（无 AK） | NOT_TESTED（需扫码） | NOT_TESTED（需装 Bridge） |
