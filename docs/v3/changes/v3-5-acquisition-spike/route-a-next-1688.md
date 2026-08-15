# V3.5-A — Route A：1688 官方 / AI AK / API（next-1688 生态）

> 静态审计（2026-08-15，源码级：TEMP 浅克隆 + gh API）。**实测状态：NOT_TESTED（用户无 AK，不伪造调用）**。

## 1. 仓库与官方关系

- 组织 `next-1688`（2026-03-02 创建，24 仓）；代表：`1688-product-find`（167★，SKILL v1.7.0）、`1688-source-suppliers`（554★）、`1688-item-select`（628★）、`1688-supplychain-api-procurement`（0★）、`1688-sourcing-inquiry`（99★）。
- **官方关系**（源码级证据）：endpoint 全部指向官方域名——
  - 授权页：`https://air.1688.com/app/tai/oauth_page/index.html`
  - API 网关：`https://skills-gateway.1688.com/api/*`（`/api/find_product/1.0.0`、`get_token_by_auth_code/1.0.0`、`refresh_token/1.0.0`、`revoke_token/1.0.0`、`query_all_scope/1.0.0`）
  - AK 获取入口：`https://clawhub.1688.com/`（configure.md 明示）
  - **结论：1688 官方 Skills 网关 + 官方 Claw 平台**（org 本身无官网声明，但端点域名是权威证据）。

## 2. 认证模型（源码证据）

- **双模式**（_auth.py）：AUTH_MODE_OAUTH（OAuth 2.1 + PKCE：authorize.py + callback_server.py + token_manager + secure_store）与 AUTH_MODE_AK（AK + HMAC-SHA256 签名）。
- `cli.py get_ak`：启动本地回调服务器（localhost）→ 打开 `air.1688.com` 授权页 → 用户浏览器正常登录授权 → AK/OAuth token 自动保存。
- Token 存储：`workspace/.1688-oauth/`（`.env` + secure_store 加密）。
- 错误处理：Token 过期/无效/吊销 → `GatewayAuthError`（fail-closed，可检测可恢复）；限流 429/网关 5xx 自动重试 3 次（指数退避）。
- **Credential Model = API_KEY（+ OAuth token 本地加密存储）**——优先接受类别。

## 3. AK 获取门槛（静态推断，未实测申请）

- 官方文档描述：前往 `clawhub.1688.com` 获取 API_KEY。
- 获取流程为**浏览器正常登录 1688 账号 → 授权**（get_ak 自动化），非企业资质强制（静态推断：文档未提及企业资质/收费；**真实门槛需用户实测确认**——标注为待验证项）。
- 用户当前无 AK → `ROUTE_A_ACCESS = BLOCKED_BY_ACCESS_REQUIREMENT`（本轮不注册/不申请/不伪造）。

## 4. 返回 Schema（_http.py 源码）

统一商品结构（`_parse_product_item`）：

| 字段 | 来源键 | 说明 |
|---|---|---|
| product_id | itemId | **实体键（offerId）** |
| title | title | 商品标题 |
| image_url | imageUrl | 主图 |
| detail_url | detailUrl / 拼接 | `detail.1688.com/offer/{id}.html`（**可回链**） |
| similarity_score | score | 官方返回的相似度分数（**仅记录为 API 字段；V3.5 合同仍用五态匹配，禁止当结论**） |
| price | currentPrice | 展示价（单值；是否最低 SKU 价需实测） |
| sku_id / sku_title | skuId / skuTitle | SKU 绑定（**价格与 SKU 同 item 绑定**——实体完整性好） |
| quantity_begin | quantityBegin | **MOQ 候选字段（官方语义需实测确认，不自动升级为真实 MOQ）** |
| unit | unit | 单位 |
| supplier | company | 供应商显示名 |
| sold_count / stock_amount | soldOut / storeAmount | 平台展示销量/库存（Platform Metadata） |
| user_id / member_id | userId / memberId | 卖家 ID（可回链 store） |
| category_id | cateId | 类目 |
| promotion_tags / service_infos / selling_points | — | 展示性信息 |

- 能力：text_search / image_search / link_search（URL 找货）/ compare / configure（AK）。
- 输出：标准 JSON（success/markdown/data）+ 网关错误码体系。

## 5. 静态判定

| 项 | 状态 |
|---|---|
| 官方程度 | ✅ 官方网关（域名证据） |
| 结构化 | ✅ 标准 JSON + 统一商品结构 |
| Entity Binding | ✅ 静态确认（offerId 内绑定 title/image/price/sku/supplier；detail_url 可回链） |
| 图片搜索 | ✅ 代码存在（capabilities/image_search）；质量待实测 |
| price/MOQ 语义 | ⚠️ 字段存在；语义（最低 SKU/起售价/阶梯）需实测确认；合同仍三态保护 |
| License | ❌ 无 license（product-find/source-suppliers）——**不可复制代码**；仅可参考 API 协议 |
| 实测 | NOT_TESTED（无 AK；ROUTE_A_ACCESS=BLOCKED_BY_ACCESS_REQUIREMENT） |
| 风险 | 低（官方 API）；AK 本地存储需安全配置 |

## 6. 对 V3.5 的含义（静态层）

- 技术形态**最正规**（官方网关/OAuth/结构化/可回链/实体绑定强）。
- 两个阻塞点：① 用户无 AK（实测需授权获取）；② 参考代码无 license（正式实现须独立对接官方网关，不复制其代码）。
- 若用户获取 AK 成功 → Route A 成为 **API_FIRST 首选候选**（需实测 search/image/detail 后定）。
