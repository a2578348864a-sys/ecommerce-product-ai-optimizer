# V3.5-A — Route C：OpenCLI + Browser Bridge（jackwener/OpenCLI）

> 静态审计（2026-08-15，源码级：sparse clone 审计 clis/1688 + extension + docs/adapters/browser）。
> **实测状态：已完成（2026-08-15，用户隔离 profile 登录 + Extension 加载 + bind 当前 Tab + C1/C2/C5 + 重启复测）**。

## 1. 项目概况

- `jackwener/OpenCLI`：**28,205★**，Apache-2.0，2026-08-15 更新（审计当天活跃）；Extension v1.0.22。
- **1688 adapter 真实存在**（任务书预判证实）：`clis/1688/` = search.js / item.js / assets.js / download.js / store.js / auth.js / shared.js（各带测试）；文档 `docs/adapters/browser/1688.md`。

## 2. 能力（1688.md 官方文档）

| 命令 | 能力 | 字段 |
|---|---|---|
| `opencli 1688 search "<query>" --limit` | 搜索公开候选（默认 20，上限 100） | 价格、MOQ、卖家链接、可见 badges；**dedupe：offer_id 优先 → item_url** |
| `opencli 1688 item <url-or-offer-id>` | 公开详情页 | 价格阶梯、MOQ、发货文本、卖家基础信息 |
| `opencli 1688 assets / download` | 页面可见媒体（主图/SKU 图/详情图/视频） | 媒体 URL（不保存二进制入仓库） |
| `opencli 1688 store <url-or-member-id>` | 公开供应商/店铺页 | 公司信息、平台年限、类目、可见服务信号 |

- 明确限制（文档）：只返回**公开页面可见**字段；**不询盘/不下单/不访问卖家后台**。
- 滑块：刷新真实 Chrome 页面人工重试（用户处理）。

## 3. 认证与 Credential Model（auth.js 源码）

- 前置：Chrome 运行 + **用户已登录 1688.com** + Browser Bridge Extension 已安装。
- `verify1688Identity`：`page.getCookies({ url: 'https://www.1688.com' })` 读当前会话 cookie（`__cn_logon__=true`、`unb`、`lid`）**仅用于验证登录态与取 user_id/name**。
- **Credential Model = EXISTING_BROWSER_SESSION**（复用用户已登录会话；**不导出/不持久化/不复制 cookie 文件**——cookie 读取发生在页面上下文内，仅身份验证用）。
- 结论：属于"优先接受"类别；非 COOKIE_COPY/TOKEN_COPY。

## 4. Bridge 架构与权限审计（extension/ 源码）

- 架构：Chrome Extension（MV3）↔ 本地 daemon（`localhost:19825`）WebSocket（`ws://localhost:19825/ext` + `/ping`）。
- **bind 机制**：`identity.ts` 维护 targetId↔tabId 映射（CDP debugger targets）；miss → 硬错误（"no guessing"）；`OPENCLI_CDP_TARGET=detail.1688.com` 可限定目标 Tab（文档 troubleshooting）。
- **Extension 权限**（manifest.json）：`debugger`、`tabs`、`cookies`、`activeTab`、`alarms`、`storage`、`tabGroups`、`downloads`；**host_permissions `<all_urls>`**。
  - 高危面：debugger + cookies + <all_urls> 组合（可对任意站点调试/读 cookie）——但审计未见外发：background 只连 localhost daemon；无 telemetry/上传端点（仅日志经 WebSocket 转发 daemon）。
  - **daemon 无鉴权**（localhost 信任边界）——本机其他进程可连该端口（风险等级中；可接受与否待实测评估）。
- 未发现：webRequest 拦截、history 读取、Profile 复制、页面内容上传。

## 5. 静态判定

| 项 | 状态 |
|---|---|
| License | ✅ Apache-2.0 |
| 官方程度 | ⚠️ 页面 DOM 提取（公开字段；非官方 API——页面变化敏感，1688.md 自述 item 对 active browser target 敏感） |
| Credential Model | ✅ EXISTING_BROWSER_SESSION（cookie 仅登录态验证） |
| Bridge 机制 | ✅ 真实存在（Extension + CDP + tab bind + OPENCLI_CDP_TARGET） |
| 权限 | ⚠️ 高（<all_urls>+cookies+debugger）；无外发/telemetry；daemon 无鉴权 |
| 实体键 | ✅ offer_id/member_id/shop_id + dedupe（offer_id 优先） |
| 图片搜同款 | ❌ 1688 adapter 无 image-search 能力 |
| 实测 | NOT_TESTED（需装 Bridge + 用户 Chrome 已登录） |
| 风险 | 中-高：Extension 权限面 + daemon 信任边界 + 页面结构依赖 |

## 6. 对 V3.5 的含义（静态层）

- **UX 最贴近"我打开 1688，它帮我看"**：用户已登录 Chrome + bind 当前 Tab + 结构化输出 + offer 实体键——任务书预判的"产品体验最接近"成立。
- 主要顾虑：① 高权限 Extension（<all_urls>）是否可接受需用户/安全评审确认；② daemon 无鉴权；③ 无 image-search。
- 若实测（bind/search/item/store）稳定且 Wrong Entity=0 → BROWSER_BRIDGE 正式候选；否则降级为参考。

## 7. Real-World Validation（2026-08-15，实测进行中）

### 7.1 安装准备 = 就绪（TEMP 隔离）

- CLI：`npm install --prefix <TEMP>/opencli-prefix @jackwener/opencli` → **1.8.6** 可运行；`opencli 1688 --help` 确认子命令：**search / item / store / assets / download / login / whoami**（read 类 = search/item/store/assets/download；**无 image-search**——与静态审计一致）。
- Extension：源码 `extension/` 目录已含构建产物 `dist/background.js`（Load unpacked 可直接加载）；**实际 manifest 权限复核与静态审计一致**（MV3：debugger/tabs/cookies/activeTab/storage/tabGroups/downloads + host_permissions `<all_urls>`，v1.0.22）。
- Browser Bridge 文档确认：`opencli browser <session> bind` 可 attach **用户手动打开的 Chrome Tab**；"Browser commands reuse your Chrome login session. You must be logged into the target website"——EXISTING_BROWSER_SESSION 文档级确认。
- daemon：CLI 自动启动，localhost:19825（与审计一致）；测试后须停 daemon 并建议卸载 Extension。

### 7.2 实测状态

- **AUTH / SEARCH / ITEM / CURRENT-TAB / STORE / 重启复测**：⏳ **NOT_TESTED——待用户完成隔离 profile 准备**（USER_ACTION_REQUIRED 已发出，2026-08-15；连续多轮未完成）。
  - 用户待办：双击 `D:\Workspace\tmp\opencli-route-c\launch-test-chrome.bat`（隔离 profile `D:\Workspace\tmp\opencli-route-c\test-profile` + Load unpacked `…\OpenCLI\extension`）→ 新窗口**只登录 1688** → 打开搜索结果页 → 保持窗口。
  - 前置复核已全部通过：实际 manifest 权限与审计一致；daemon 运行中且监听 **127.0.0.1:19825（仅本机回环）**；Extension 当前 **disconnected**（用户未启动）。
  - 未连接 fail-closed 实测（PASS，见下）；**一旦用户完成准备，即可执行 C1 search / C2 item / C3 当前 Tab bind / C5 store + 重启复测（daemon 停→重连）**，测试后停 daemon 并建议卸载 Extension。
- **未连接 fail-closed 实测（PASS）**：无 Extension/daemon 时执行 `opencli 1688 search "保温杯" -f json` →
  - exit **69**；`{ok:false, error:{code:"BROWSER_CONNECT", message:"Browser Bridge extension not connected", help:"…下载 release → chrome://extensions → Load unpacked"}}`。
  - **结论**：未连接时明确报错 + 安装指引（fail-closed，不猜测）；必须用户已登录 Chrome + Extension 连接后才可能工作。

### 7.3 实测结果（2026-08-15，全部 PASS）

- **准备路径**：`launch-test-chrome.bat`（隔离 profile `D:\Workspace\tmp\opencli-route-c\test-profile` + `--load-extension`）。**实测发现：Chrome 151 忽略命令行 `--load-extension`，扩展未自动加载**（daemon 显示 disconnected；profile 无扩展）→ 用户需手动 `chrome://extensions` → 开发者模式 → Load unpacked `…\OpenCLI\extension`。**首装摩擦记录：命令行加载不可靠，必须手动加载（新手门槛+1）**。
- **C3 bind = PASS（EXISTING_BROWSER_SESSION 实证）**：`opencli browser v35 bind` 绑定**用户真实打开的 1688 买家工作台 Tab**（`work.1688.com`，登录态确认；账号标识与页面内容不入文档）；`state` 可见完整登录会话。**无任何 Cookie 导出/复制/持久化**（store 输出 `strategy:"cookie"` 指页面上下文内取数，非导出——单独报告：无 cookie 文件、无日志外发）。
- **C1 search = PASS（2 关键词）**：`opencli 1688 search '不锈钢保温杯' / 'Snoopy 午餐包' -f json`（latency 5.6s / 6.8s）→ 各 8 条，**8/8 唯一 offer_id**；每条对象含 offer_id/item_url/seller_name/seller_url/rank。
  - **实体绑定 = 同对象内绑定（Wrong Entity=0 实测）**；但 **title/price_text 为整卡原文拼接**（标题+价格+销量+徽章+卖家名全在一个字符串里，含 `¥ 12 .5` 空格格式）——**价格/字段需二次解析，结构化程度低于 Route B**（B 有 price{text,min,max}/supplier{name,shopUrl,years} 分离结构）。
  - 相关度与 Route B 一致：保温杯同类候选；Snoopy 8 条中 4 条含史努比（实体级 partial）。
- **C2 item = PASS**：`opencli 1688 item 930374004918 -f json`（latency 10.9s）→ **结构化**：offer_id/item_url/main_images×10/price_text/price_tiers[{quantity_min,price,currency}]/currency/moq_text/moq_value/seller_name/seller_url/shop_name/origin_place/delivery_days_text/customization_text/private_label_text/visible_attributes×9/sales_text。
  - **跨路线交叉验证（B vs C 同一 offer）**：实价阶梯 **¥16.5 两边一致**、MOQ=1 一致、供应商名称一致、入驻年限一致（B years=2 ↔ C 入驻2年）——**两条独立路线数据互证，实体绑定与价格语义可信**。
  - visible_attributes 仅 9 项（页面可见部分），少于 Route B 的 attributes 40 项（B 走 MTOP 更全）；价格语义：item 的 price_text=阶梯实价（比 B 的显示价 21.30 更接近采购价，但**仍按 displayedPrice/参考价处理，非采购成本**）。
- **C5 store = PASS**：`opencli 1688 store shop5s48135yy5482 -f json`（latency 23.5s）→ store_name/company_name/入驻年限/位置/工厂与服务 badges/回头率/主营类目。
  - **⚠️ 输出含卖家公司完整地址 + 联系电话（公开联系信息但属个人/公司 PII）——集成必须脱敏**。
- **重启复测 = PASS（摩擦≈0）**：`daemon stop` → 状态 not running → 直接再跑 `item` → **daemon 自动拉起 + Extension 自动重连（19s）+ 无需重新 bind + 无需重新登录**（用户浏览器会话天然持久）→ 绑定 Tab 原样保持。**reconnect friction = 零人工步骤**。
- **测试后清理**：两个 daemon 均已停止；**建议用户关闭测试窗口后移除 Extension 并删除测试 profile**（高权限 Bridge 不留后台运行）。
- **Current Tab UX 价值判断 = HIGH VALUE（结构论证）**：命令直接驱动用户已登录浏览器（可见导航、无扫码、无复制粘贴、零重连摩擦）；相对代价=高权限扩展首装摩擦 + 用户需保持浏览器/扩展存在。**明显优于手工复制粘贴**（每候选零人工步 vs 手工搜索/复制/粘贴多步）。
