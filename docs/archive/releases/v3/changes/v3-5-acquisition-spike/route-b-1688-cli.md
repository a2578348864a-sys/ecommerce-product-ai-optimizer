# V3.5-A — Route B：1688-cli（superjack2050/1688-cli）

> 静态审计（2026-08-15，源码级）。**实测状态：已完成（2026-08-15，扫码登录 + 真实搜索/详情/图搜/重启复测）**。

## 1. 项目概况

- `superjack2050/1688-cli`：57★，TypeScript，Node >=20，**MIT license**，v0.1.47，2026-08-14 更新（活跃）。
- 定位（README）：AI-agent-friendly CLI for 1688 sourcing / product research / **supplier evaluation / procurement inquire / order management**（后三者超出 V3.5 边界——只审计不调用）。
- bin：`1688`（dist/cli.js）；含 daemon 常驻模式（`~/.1688/daemon.pid`）。

## 2. 供应链审计（package.json / postinstall / 依赖）

- dependencies：playwright ^1.48 + playwright-extra（浏览器自动化）。
- `postinstall: node scripts/postinstall.mjs`：
  - 系统 Chrome 存在则跳过 Chromium 安装；否则自动下载（按时区选镜像）。
  - **会读取 `BB1688_HOME ?? ~/.1688/daemon.pid` 并 SIGTERM 旧 daemon**（工具自有目录；文件系统访问范围明确）。
  - CI/`BB1688_SKIP_POSTINSTALL` 可跳过；失败非致命（打印恢复指引）。
- 未发现未知远程代码执行/安装后脚本外网行为（postinstall 仅 Chromium 下载 + daemon 重启）。
- MTOP：keywords + 源码确认使用 **1688 内部 MTOP 协议**（`mtop.1688.buycenter.*`、`parseMtopJsonp`、`hijack window.lib.mtop.request`）——**undocumented 接口，非官方公开 API**（docs/playbooks/add-mtop-capture.md 为其抓包机制）。

## 3. 登录模型（源码证据）

- `1688 login` → 打开 `https://login.1688.com/member/signin.htm?tbpm=1`（官方登录页，**用户扫码/账密自己输入**）；非交互模式保存 QR PNG 到 `~/.1688/login-qr.png` 让用户扫。
- 会话：Playwright `launchPersistentContext(profileDir)`——**工具自有 profile**（`~/.1688/profiles/`，可多 profile + proper-lockfile 锁）；**不读用户 Chrome/浏览器 Cookie**。
- **Credential Model = OWN_PROFILE + USER_QR_LOGIN**（优先接受类别）。
- Session 恢复：exit code 3 = 未登录/过期 → 提示 `1688 login`（不循环重试）。

## 4. 风控与错误（SAFETY.md 源码文档）

- exit 4 = 滑块验证 → 提示用户 `--headed` 重跑一次，**滑块用户手动**（不自动绕）。
- exit 8 = 登录完成但 cookie 缺失 → 报告；exit 9 = 网络错误（有界重试）。
- 写命令（seller inquire/chat、cart、order、checkout）**存在但 V3.5 禁止调用**（任务书十九/二十五节）。

## 5. 能力（文档 + 命令树）

- search（产品搜索，含排序）、item/offer detail、image search（README 声称）、compare、supplier inspect（信任信号）、store 等。
- 输出：JSON（docs/JSON_CONTRACTS.md + `-f json`）。
- 实体键：offerId / URL。

## 6. 静态判定

| 项 | 状态 |
|---|---|
| License | ✅ MIT（可集成） |
| 官方程度 | ❌ MTOP 内部协议（非官方公开 API；页面/协议变更风险高） |
| Credential Model | ✅ OWN_PROFILE + USER_QR_LOGIN（安全可接受） |
| 风控 | ⚠️ 滑块需人工（可接受，但海外 IP 稳定性未知——待实测） |
| 写动作 | ⚠️ 存在（inquiry/cart/order）——正式集成必须禁用/不暴露 |
| 结构化 | ✅ JSON 契约文档存在 |
| Entity Binding | ⏳ 待实测（静态：以 offerId/URL 为键） |
| 实测 | NOT_TESTED（需扫码配合） |
| 风险 | 中：MTOP 稳定性/合规 + 浏览器自动化维护成本 |

## 7. 对 V3.5 的含义（静态层）

- 登录模型安全（自有 profile），但 **MTOP 内部协议是主要风险**（不依赖官方公开契约，随时可能失效；且其查询走 1688 页面/内部接口，合规边界模糊）。
- 若 Route A（官方 API）不可用，Route B 是 LOCAL_SESSION_CLI 候选，但**稳定性/合规风险显著高于官方 API**，正式采用前必须实测 session 持久、风控表现与 JSON 契约。

## 8. Real-World Validation（2026-08-15，实测进行中）

### 8.1 INSTALL_WORKS = **YES**（TEMP 隔离目录实测）

- 方式：`git clone --depth 1` → 目录内 `npm install`（197 packages，postinstall 检测到系统 Chrome 跳过 Chromium 下载）→ `npm run build`（tsc 构建 dist）成功。
- `node dist/cli.js --version` → **0.1.47**；`--help` 命令树完整（login/search/research/compare/supplier/image-search/offer/similar + 写命令 inbox/seller/cart/checkout/shipped/stuck/fake-shipped/seller-history）。
- **写命令确认存在但 V3.5 全部禁止调用**（INQUIRY_ACTIONS=0/ORDERS=0/PAYMENTS=0 保持）。
- `login --help`：扫码（默认 300s 超时；`--headed` 真实窗口；`--profile default`；自动启动 daemon；`--no-daemon` 可关）。
- 未触碰正式 package.json（npm install 误在 spike 根执行一次已恢复 package-lock，随后在隔离目录正确安装）。

### 8.2 登录/实测状态

- **AUTH_WORKS / SEARCH / IMAGE_SEARCH / DETAIL / 重启复测**：⏳ 待用户扫码（USER_ACTION_REQUIRED 已发出）。
- **未登录 fail-closed 实测（PASS）**：未登录执行 `search "保温杯" --json` →
  - exit code **3**；JSON `{"ok":false,"code":"NOT_LOGGED_IN","message":"Session expired. Run 1688 login.","recoveryAction":"pause_for_manual_login","retryable":false}`；
  - 诊断 currentUrl 指向 `login.taobao.com`（匿名会话登录墙——与 V3.5 probe 一致）；
  - artifact 目录 `~/.1688/runs/<ts>-search`（工具自有目录，允许）。
  - **结论**：fail-closed 明确（不猜测数据），且证明匿名自动化同样撞登录墙——**必须用户扫码登录后才可能工作**。

### 8.3 AUTH_WORKS = **YES**（真实扫码登录）

- `login --headed --timeout 600` → 弹出真实 Chrome 窗口（工具自有 profile `~/.1688/profiles/default`，与用户日常 Chrome 隔离）→ 用户手机扫码 → `{"ok":true}` 成功；daemon 自动启动。
- 首次执行遇到 `LOCK_BUSY`（上一次 fail-closed 测试残留 daemon 持锁）——`daemon stop` + 清理 `.lock.lock` 后正常。**这是工具自身锁管理问题（残留锁需手动清理），记录为轻微缺陷**。
- `whoami` → `loggedIn=true`（**账号标识符不入文档**；敏感证据纪律遵守）。
- **Credential Model 实测确认 = OWN_PROFILE + USER_QR_LOGIN**（用户扫码，工具未读取/复制任何用户 Chrome Cookie）。未出现 COOKIE_COPY/TOKEN_COPY/SIGN_COPY 场景，评级维持"优先接受"。

### 8.4 SEARCH_WORKS = **YES**（关键词搜索实测）

- 3 个关键词实测：`不锈钢保温杯`、`Snoopy 午餐包`、`实木砧板`，均成功（latency 6.2–10.5s）。
- 每次返回 10 条，**10/10 唯一 offerId**；每条 offer 为单一 JSON 对象：offerId/title/price/supplier(名称+店铺URL+年限)/location/bizType/verified(factory/business/superFactory)/tags/demand(orderCount)/isP4P/turnover/url/image —— **结构化同实体绑定（结构层 Wrong Entity=0）**。
- **search→detail 交叉验证**：3 个 offer 详情与搜索结果 title+supplier 全部一致（3/3）——搜索卡片与详情页绑定一致。
- P4P 广告位有 `isP4P` 标记（10 条中 5 条），未混淆；`demand.orderCount` 为平台元数据（不计分、不作为事实）。
- 相关度：`不锈钢保温杯` 结果均为同类保温杯/冰霸杯（Case A 部分相似/相似级）；`Snoopy 午餐包` 10 条中 4 条含 Snoopy/史努比（Case B 相关，但形式为保温袋而非 Igloo 硬壳午餐桶——实体级 partial）；`实木砧板` 覆盖 Case C 砧板场景。**关键词搜索可稳定产出同品类候选，但"同款/同设计"仍需人工甄别（相似≠同款）**。

### 8.5 IMAGE_SEARCH_WORKS = **NO**（fail-open 缺陷，实测）

- 输入 3 张**不同** Amazon 主图（OtterBox 杯 / Igloo Snoopy 午餐盒 / KINTO 杯）→ 3 次均返回**完全相同的 8 条无关商品**（EVA 防滑胶垫/小药瓶/奶茶杯/拼豆/发泄球/手机链等），`exit 0`、**无任何错误或告警**，`total=60`。
- 诊断（直接驱动 profile 浏览器打开结果页）：`offer_search.htm?imageId=...` 实际渲染的是**「以图搜款」上传落地页**（含热门推荐流），并非视觉搜索结果 → CLI 的 capture 逻辑（`keep:'largest'`，src/session/search-capture.ts）把落地页推荐流当成"结果"返回。
- 每次调用 imageId 不同（上传步骤确实发生），但结果页不识别该 imageId → **上传流程产出无效 imageId + 无结果页状态校验 = 设计缺陷（fail-open）**；`--headed` 复测结果一致（排除滑块因素）。
- 分类：**设计缺陷**（无"结果页确为视觉结果"的校验，静默返回兜底数据）；疑似与 1688 视觉搜索后端在本环境不可用有关（见 8.6）。修复需改动 capture/上传流程，成本超出 Spike 范围 → **MAINTENANCE_RISK_HIGH，不 fork 修复**。
- **判定**：该命令对 3 个输入全部 Wrong Entity（100% 无关），**不可用于任何下游**；Route B 的 IMAGE_SEARCH = **NOT_PROVEN**。

### 8.6 SIMILAR（找同款）实测 = fail-closed UNAVAILABLE

- `similar 930374004918` → `{"ok":false,"code":"SIMILAR_UNAVAILABLE","message":"1688 official similar-offer entry point did not return comparable offers...","recoveryAction":"none","retryable":false}`，currentUrl 指向 **`air.1688.com/kapp/1688-search/pc-image-search/?offerIds=...&scene=similar_search`**（1688 官方视觉/相似搜索引擎）。
- 官方 similar 引擎在本环境**未返回可比商品**——与 image-search 失效同源（视觉搜索后端受限：海外 IP/风控或后端处理未完成）。
- **对照价值**：同一后端失效，`similar` 命令 fail-closed（明确报错不伪造），`image-search` 命令 fail-open（静默返回兜底数据）——两个命令的错误处理质量不对称，正式集成若采用本工具必须**只信任显式 `ok:true` + 结果相关性校验**的路径。

### 8.7 DETAIL_WORKS = **YES**（3 个 offer 详情实测）

- `offer <3 个真实 offerId>` 一次成功（latency ~13s），每 offer 输出结构化字段：
  - `priceRange/priceMin/priceMax`（页面显示价）、`priceTiers[]`（数量阶梯价）、`skus[]`（skuId/specs/price/multiPrice/stock/saleCount/image）、`attributes[]`（18–40 项）、`supplier`、`freight`、`saledCount`、`categoryId`、`options[]`（颜色等）、`mainImage/images[]`、`packageInfo[]`、`minOrderQty/mixOrderQty/unitName`、`detailUrl`。
- **字段可用性（对照 field-matrix 15 项，实测口径）**：
  - AVAILABLE_STRUCTURED：offerId、title、URL、mainImage/images、价格阶梯、SKU 列表、MOQ（minOrderQty）、属性表、供应商名称、saledCount、categoryId、规格/颜色 options、包规 packageInfo。
  - AVAILABLE_RAW：detailUrl（itemcdn 原始地址，仅作溯源锚点）、freight 部分字段。
  - CONDITIONAL：supplier.loginId/memberId/userId（卖家账号标识，输出中存在但**敏感**，集成必须脱敏）；freight.receiveAddress（**实测含用户 profile 默认收货地址 = PII，必须脱敏/丢弃**——工具输出面隐私缺陷，记录）。
  - UNRELIABLE：attributes 为**卖家自报**（如"是否有第三方检测报告:没有"、"是否跨境出口专供货源:否"）——Seller Claim ≠ Fact，只作线索不作事实；saledCount 语义未明（平台元数据）。
  - NOT_AVAILABLE：真实成交价/成交历史、真实销量拆分、物流运费明细（freight 无金额）。
- **price/SKU 绑定实测**：offer 930374004918 `priceRange=￥21.30`（页面显示价）而 `priceTiers[0].price=16.5`、`sku.multiPrice=16.5` —— **显示价 ≠ 采购成本**（差 ¥4.8/个）；`price` 字段为显示价、`multiPrice` 为实价阶梯。**语义维持 displayedPrice，不归一化、不升级为采购成本**。
- **MOQ 实测**：`minOrderQty=1`（三例均 1），`mixOrderQty` 部分为空——**维持 displayedMOQ 语义，不做任何归一化/解释**。

### 8.8 重启复测 = **PASS**（会话复用，无需重新扫码）

- `daemon stop` → 重启（whoami 触发自动拉起）→ `whoami loggedIn=true`（**session 复用**，未重新扫码）→ `search` 重跑成功（9.2s）→ 事件日志仅含 search/image-search/offer/similar/whoami。
- **写操作审计**：daemon `events.jsonl` 全量命令清单复核——**inquiry/cart/order/purchase/message/checkout 零调用**（PURCHASE_ACTIONS=0/INQUIRY_ACTIONS=0/SUPPLIER_MESSAGES=0/ORDERS=0/PAYMENTS=0 全部成立）。

### 8.9 Route B 实测结论

| 项 | 实测结果 |
|---|---|
| INSTALL_WORKS | ✅ YES |
| AUTH_WORKS | ✅ YES（OWN_PROFILE + USER_QR_LOGIN，实测确认） |
| SEARCH_WORKS | ✅ YES（3 关键词，绑定一致，6–10.5s） |
| IMAGE_SEARCH_WORKS | ❌ NO（fail-open：3 图返回同一批无关结果，无告警；设计缺陷 + MAINTENANCE_RISK_HIGH） |
| SIMILAR_WORKS | ❌ 官方引擎不可用（fail-closed 处理良好） |
| DETAIL_WORKS | ✅ YES（结构化 20+ 字段，显示价≠实价实证） |
| 重启稳定性 | ✅ PASS（会话复用） |
| 写操作 | ✅ 0 调用 |
| 敏感输出 | ⚠️ freight.receiveAddress（PII）+ seller 账号 id —— 集成必须脱敏 |
| 风险 | MTOP 内部协议（静态）+ 图搜 fail-open 缺陷 + receiveAddress PII |

- Route B 关键词搜索+详情路径**真实可用**，实体绑定可靠（结构层 + search→detail 交叉验证均一致），登录与重启稳定性通过；**但 image-search 不可用（NOT_PROVEN）且存在 fail-open 缺陷**，采用时必须：只用 search/offer 路径、显式校验 `ok:true`、结果相关性人工核查、脱敏 receiveAddress 与卖家账号字段。
- 遗留：图搜失效根因（上传 imageId 无效）未深挖——超出 Spike 范围；若后续需要图搜能力，Route B 不满足，需另寻路径（如 Route C 浏览器内人工图搜 or 官方 air.1688.com 能力）。
