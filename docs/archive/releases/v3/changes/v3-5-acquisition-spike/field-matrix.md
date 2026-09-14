# V3.5-A — Field Matrix（统一字段矩阵，静态层 + Route B/C 实测）

> 基于三 Route 源码/文档的字段可得性静态判定 + **Route B/C 真实实测结果（2026-08-15）**；`⏳` = 待实测确认。
> 评级：AVAILABLE_STRUCTURED / AVAILABLE_RAW / CONDITIONAL / UNRELIABLE / NOT_AVAILABLE

| # | 字段 | Route A（官方网关） | Route B（1688-cli） | Route C（OpenCLI Bridge） |
|---|---|---|---|---|
| 1 | offerId | ✅ AVAILABLE_STRUCTURED（itemId；实体键） | ✅ AVAILABLE_STRUCTURED（offerId；实体键，**实测 10/10 唯一**） | ✅ AVAILABLE_STRUCTURED（offer_id；实体键 + dedupe，**实测 8/8 唯一**） |
| 2 | URL | ✅ AVAILABLE_STRUCTURED（detailUrl） | ✅ AVAILABLE_STRUCTURED（**实测**：offer url 与 offerId 同对象） | ✅ AVAILABLE_STRUCTURED（item_url，**实测**） |
| 3 | title | ✅ AVAILABLE_STRUCTURED | ✅ AVAILABLE_STRUCTURED（**实测**：search→detail 标题 3/3 一致） | ✅ AVAILABLE_STRUCTURED（**实测**：item 标题干净；**search 标题=整卡原文拼接，需解析**） |
| 4 | image | ✅ AVAILABLE_STRUCTURED（imageUrl） | ✅ AVAILABLE_STRUCTURED（**实测**：mainImage+images[5]/SKU 图） | ✅ AVAILABLE_STRUCTURED（**实测**：item main_images×10；assets 命令） |
| 5 | displayedPrice | ✅ AVAILABLE_STRUCTURED（currentPrice；语义待实测） | ✅ AVAILABLE_STRUCTURED（**实测**：priceRange/min/max=显示价 ≠ 阶梯实价） | ✅ AVAILABLE_STRUCTURED（**实测**：item price_text=阶梯实价（¥16.5，与 B 互证）；search price_text=原文需解析） |
| 6 | priceRange | ⏳ CONDITIONAL | ✅ AVAILABLE_STRUCTURED（**实测**：priceRange 存在，单值/区间按页面） | ⏳ CONDITIONAL（item 未显式区间字段；阶梯可推） |
| 7 | priceTiers | ⏳ CONDITIONAL | ✅ AVAILABLE_STRUCTURED（**实测**：priceTiers[] minQty+price） | ✅ AVAILABLE_STRUCTURED（**实测**：price_tiers[] quantity_min/price/currency） |
| 8 | displayedMOQ | ✅ AVAILABLE_STRUCTURED（quantityBegin；语义待实测） | ✅ AVAILABLE_STRUCTURED（**实测**：minOrderQty/mixOrderQty/unitName；三例均 1） | ✅ AVAILABLE_STRUCTURED（**实测**：moq_text/moq_value=1，与 B 互证） |
| 9 | SKU/specs | ✅ AVAILABLE_STRUCTURED（skuId/skuTitle；价格与 SKU 同 item 绑定） | ✅ AVAILABLE_STRUCTURED（**实测**：skus[] skuId/specs/price/multiPrice/stock/saleCount/image） | ⏳ CONDITIONAL（item 未见 sku 明细；assets 有 SKU 图；规格文本 ⏳） |
| 10 | material claim | ⏳ CONDITIONAL（selling_points 等，Seller Claim） | ✅ AVAILABLE_RAW（**实测**：attributes[] 18–40 项——卖家自报） | ✅ AVAILABLE_RAW（**实测**：visible_attributes 9 项——页面可见部分，卖家自报） |
| 11 | dimensions | ⏳ CONDITIONAL | ⏳ CONDITIONAL（**实测**：三例 attributes 未见尺寸；packageInfo 有 weight） | ⏳ CONDITIONAL（未实测到） |
| 12 | customization claim | ⏳ CONDITIONAL（Seller Claim 语义） | ✅ AVAILABLE_RAW（**实测**：attributes 含"加印LOGO/定制工艺选择"） | ✅ AVAILABLE_RAW（**实测**：customization_text/private_label_text） |
| 13 | supplier display name | ✅ AVAILABLE_STRUCTURED（company） | ✅ AVAILABLE_STRUCTURED（**实测**：supplier.name + shopUrl + years） | ✅ AVAILABLE_STRUCTURED（**实测**：seller_name/shop_name/store_name） |
| 14 | supplier platform metadata | ✅ AVAILABLE_STRUCTURED（soldCount/stockAmount/categoryId；badges ⏳） | ✅ AVAILABLE_STRUCTURED（**实测**：years/verified/turnover/orderCount/saledCount） | ✅ AVAILABLE_STRUCTURED（**实测**：store 入驻年限/工厂与服务 badges/回头率/主营类目） |
| 15 | capturedAt | ✅ 客户端记录 | ✅ 客户端记录 | ✅ 客户端记录（**实测**：store 输出含 fetched_at） |

## 实测补充（Route B/C，2026-08-15）

- **CONDITIONAL（敏感）**：
  - B：`supplier.loginId/memberId/userId` + `freight.receiveAddress`（**实测含用户默认收货地址 = PII**）；
  - C：`store` 输出**卖家公司完整地址 + 联系电话**（公开联系信息但属 PII 面）；item 含 seller `member_id`。
  - **两 Route 集成均必须字段级脱敏/丢弃**。
- **NOT_AVAILABLE（实测）**：真实成交价/成交历史、物流运费金额（两 Route 均无）；尺寸（三例均无）；**C 的 SKU 明细未结构化**（B 有）。
- **跨路线互证**：同一 offer（930374004918）B/C 实价阶梯 ¥16.5、MOQ=1、供应商、入驻年限全部一致——**两条独立路线数据一致，字段语义可信**。
- 结论：B 结构化程度最高（15 字段全结构化 + SKU 明细）；C item 结构化（10 字段级）但 search 输出为原文拼接、无 SKU 明细；A 维持静态判定（⏳ 待实测）。
