# V3.5 Implementation — Keyword / URL / Detail Acquisition（Phase 2）

> 合同：§18/§20/§21/§60/§61

## 1. 架构

`LocalSession1688CliDriver`（`lib/server/sourcingAcquisition.ts`）：
- 1688-cli **不加入 npm 依赖**；作为检测到的本地外部工具（env `V35_1688_CLI_PATH` → 绝对路径到 `dist/cli.js`）。
- fixed executable + fixed command allowlist（search/offer/whoami）+ args array + `shell:false` + timeout + stdout/stderr 大小限制 + exit code 校验 + ok 信封语义校验 + fail-closed 归一化。
- 工具未配置/不存在 → `acquisition_tool_not_available`（清晰错误，不是 500 mystery）。
- 版本约束：`--version` 探测，前缀 `0.1.*` 支持，否则 `tool_version_unsupported`（schema fail-closed）。

## 2. 命令语义（实测 2026-08-15/16，v0.1.47）

- `search <keyword> --max <n>`：exit 0 + 顶层 `{keyword,total,offers[]}`（**无 ok 信封**）；每条 offer 为单一对象（offerId/title/price/supplier/location/bizType/verified/tags/demand/isP4P/turnover/url/image）→ **结构层同实体绑定**。
- `offer <offerId>`：exit 0 + 单对象（priceRange/priceMin/priceMax/priceTiers/skus/attributes/supplier/freight/minOrderQty/unitName/mainImage/images/detailUrl）。
- 错误信封：exit 3 = NOT_LOGGED_IN → `auth_required`；exit 4 = 滑块 → `risk_control_required`；exit 9 + `{ok:false,code:DAEMON_PAUSED,failureKind:risk_challenge}`（真实 smoke 实测）→ `risk_control_required`。

## 3. 规范化要点（normalize.ts）

- **价格三语义分离**（实测 offer 930374004918：页面显示价 ¥21.30 vs 阶梯价 ¥16.5）——`displayedPrice`（页面显示价）/ `priceRange` / `priceTiers` 各自保留，**不归一化、不升级为采购成本**。
- **MOQ**：`displayedMoq`（minOrderQty + unitName），缺失 → null（unknown），不做解释。
- **Seller Claim ≠ Fact**：attributes[]/packageInfo[] → `seller_claim` 分类（实测含"是否有第三方检测报告:没有"等）。
- **Platform Metadata**：verified/demand.orderCount/isP4P/turnover/location/bizType/saledCount/categoryId/supplierYears → `platform_metadata`，**不转化为可靠性评分**。
- **PII 丢弃**：freight.receiveAddress（用户默认收货地址）、supplier.loginId/memberId/userId、whoami memberId/nick 一律不入任何输出。
- 卡片 image 实测为**逗号分隔 URL 字符串**（兼容数组形态）。

## 4. URL 详情获取（§20/§21）

- `validate1688OfferUrl`：仅 https + `detail.1688.com` / `m.1688.com` / `www.1688.com` + 解析 offerId（query `offerId=` 或路径 `/offer/<id>.html`）+ 无凭据 + 长度限制 → 防 SSRF / arbitrary URL fetch。
- 服务端以解析出的 offerId 调只读 detail 驱动；返回 offerId 与请求不一致 → `entity_binding_failed`。

## 5. 测试

20 个 CLI 驱动用例（假 CLI 脚本端到端真实 spawn）：valid search / zero result / CLI missing / 未配置 / unsupported version / exit 3 / exit 4 / exit 9 / DAEMON_PAUSED / 非 JSON / ok:false / 恶意关键词（控制字符/超长）/ 超时 / offerId 非法（含写命令名 cart/order/checkout/inquiry 全部拒绝）/ 返回 offerId 不一致 / 敏感字段零泄漏。

## 6. 真实 smoke 状态

见 real-smoke.md：实现代码首次真实 smoke 被 1688-cli daemon 风控暂停（DAEMON_PAUSED，risk_challenge）阻塞 → `REAL_CLI_SMOKE = BLOCKED_BY_RISK_CONTROL`；错误映射已按实测修正（exit 9 + DAEMON_PAUSED → risk_control_required）。
