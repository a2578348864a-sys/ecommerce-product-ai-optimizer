# V3.5 — Field Availability（1688 字段可得性调查）

> 说明：由于当前环境 1688 强制登录墙（见 browser-feasibility.md），本表基于——
> ① 1688 公开产品知识/官方帮助文档（[1688 客服中心](https://114.1688.com/kb/detail/20732087.html)、[1688 商品详情 API 文档](https://developer.aliyun.com/article/1676157)）；
> ② 第三方 API 文档示例（[item_get 示例](https://blog.itpub.net/70047598/viewspace-3096606/)）；
> ③ 页面结构通用常识。
> **标注为「公开资料评估，非本环境实测」**。字段语义以 1688 页面实际展示为准（用户人工导入时逐条确认）。

## 1. 24 字段可得性

| # | 字段 | 可得性 | 理由 |
|---|---|---|---|
| 1 | 商品标题 | **CONDITIONAL** | 页面展示可靠；但含营销词（"厂家直销/爆款"），语义需剥离 |
| 2 | 商品 URL | **RELIABLE** | 用户粘贴/页面地址栏，可追溯 |
| 3 | 商品/offer ID | **CONDITIONAL** | URL 中 offerId 可解析；需用户提供页面时人工核对 |
| 4 | 主图 | **RELIABLE（展示）/ UNRELIABLE（匹配）** | 图片可得，但图片相似 ≠ 同款（任务书十四节） |
| 5 | 当前展示价格 | **CONDITIONAL** | "¥x 起"为最低规格价；促销价/登录价并存（任务书十六节） |
| 6 | 价格区间 | **CONDITIONAL** | 多 SKU 区间价展示常见；是否含税/运费口径不明 |
| 7 | 阶梯价 | **CONDITIONAL** | 页面可展示；需绑定起批量理解 |
| 8 | MOQ/起批量 | **CONDITIONAL** | 展示常见；语义可能是单 SKU/总数量/混批/定制 MOQ——不能直接归一化（任务书十七节） |
| 9 | SKU/规格 | **CONDITIONAL** | 页面可展示；可能需展开选择 |
| 10 | 材质 | **UNRELIABLE（Seller Claim）** | 供应商描述，可能营销化（任务书四-18） |
| 11 | 尺寸 | **CONDITIONAL** | 页面常见；单位/规格口径需人工确认 |
| 12 | 重量 | **CONDITIONAL** | 页面常见；毛重/净重口径不明 |
| 13 | 包装 | **CONDITIONAL** | 展示常有；数量/尺寸需确认 |
| 14 | 颜色 | **RELIABLE（展示）** | 展示可靠；SKU 绑定 |
| 15 | 定制信息 | **UNRELIABLE（Seller Claim）** | "支持定制/定制 MOQ"为供应商自述，需询盘确认 |
| 16 | 是否支持代发 | **UNRELIABLE（Seller Claim）** | 供应商自述；"支持代发 ≠ 适合跨境"（任务书四-13） |
| 17 | 发货地 | **CONDITIONAL** | 页面常见；城市粒度，真实仓未必一致 |
| 18 | 店铺名称 | **RELIABLE（展示）** | 展示可靠；仅展示 |
| 19 | 店铺年限 | **CONDITIONAL（Platform Metadata）** | 平台展示；不等于履约能力（任务书四-15） |
| 20 | 供应商类型（厂家/经销） | **UNRELIABLE（Seller Claim）** | 自述标签；"厂家直销"需核实 |
| 21 | 页面销量/成交信息 | **CONDITIONAL（Platform Metadata）** | 平台展示；不等于供应稳定性（任务书四-16） |
| 22 | 认证/资质展示 | **UNRELIABLE** | 认证图片展示 ≠ 认证真实有效（任务书四-17） |
| 23 | 国内物流/运费信息 | **CONDITIONAL** | 页面可能有；运费口径（到付/包邮/体积重）需确认 |
| 24 | 页面更新时间 | **NOT_AVAILABLE（页面常缺）** | 常不展示；无法可靠取得 |

## 2. Evidence Nature 分类（任务书十三节）

| Nature | 适用字段 | 示例 |
|---|---|---|
| A. Page Snapshot | 标题/URL/offerId/价格展示/区间/阶梯价/MOQ 展示/SKU/尺寸/重量/包装/颜色/发货地/店铺名/销量展示 | "页面当前显示 ¥18–¥26" |
| B. Seller Claim | 材质/定制/代发/供应商类型/认证 | "厂家直销"、"支持定制"——**≠ Human Confirmed Fact** |
| C. Platform Metadata | 店铺年限/平台标签/成交信息 | "平台显示：店铺 5 年" |
| D. Derived Comparison | 规格对比（Amazon 30cm vs 1688 页面 25cm） | "存在尺寸差异"（系统推导，需双源数据） |
| E. Unknown / Needs Confirmation | 真实采购成交价/国际物流/出口资质适用性/真实 MOQ 语义 | "需询盘确认" |

## 3. 结论

- **无一个字段天然是 RELIABLE 的"事实"**：绝大多数为 CONDITIONAL（展示层可靠、语义需确认）或 Seller Claim。
- 最可靠的 3 个：URL / offerId / 店铺名（可追溯标识），但也只是"标识"，不是"事实"。
- **页面价格 ≠ 采购成本**（任务书十九节）；**MOQ 语义不能安全归一化**（任务书十七节）。
- 这决定了 sourcing-evidence.v1 的字段性质：全部标 Nature，禁止"事实化"。
