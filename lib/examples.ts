// 填入示例数据 — 所有页面共享一致的商品信息
// 用户点「填入示例」按钮即可一键填充全字段，方便测试全流程

export const EXAMPLE_PRODUCT = {
  productName: "硅胶折叠水杯",
  category: "户外用品",
  targetPlatform: "shopify" as const,
  targetPrice: "19.99 USD",
  description:
    "食品级硅胶材质，可折叠收纳，容量350ml，带挂扣，适合户外徒步露营使用。重量仅80g，折叠后厚度不到5cm，放进背包侧袋无压力。",
  claims: "食品级硅胶、IPX4防水、可折叠、轻量化",
};

export const EXAMPLE_ACCESS_PASSWORD = "888888";

export const EXAMPLE_SOURCING = {
  ...EXAMPLE_PRODUCT,
};

export const EXAMPLE_RISK = {
  ...EXAMPLE_PRODUCT,
};

export const EXAMPLE_PRODUCT_PROFIT = {
  name: EXAMPLE_PRODUCT.productName,
  description: EXAMPLE_PRODUCT.description,
  targetPlatform: EXAMPLE_PRODUCT.targetPlatform,
  targetCountry: "US",
  currency: "USD" as const,
  purchasePrice: "18",
  domesticShippingFee: "3",
  internationalShippingFee: "25",
  otherCost: "0",
  commissionRate: "15",
  expectedProfitRate: "30",
  manualSellingPrice: "",
  weight: "0.15",
  packageLength: "",
  packageWidth: "",
  packageHeight: "",
  stock: "100",
};

export const EXAMPLE_VIRAL = {
  title: "露营神器！这个折叠水杯太方便了",
  productUrl: "",
  platform: "xhs",
  materialText:
    "户外露营必备好物！\n\n食品级硅胶折叠水杯，350ml容量刚刚好。折叠后只有5cm厚，带金属挂扣直接挂包上，完全不占地方。\n\nIPX4防水实测两周完全不漏，比普通水杯轻了一半还要多。关键是颜值也在线，拍照超出片！\n\n评论区的宝子们问最多的就是会不会漏水，统一回复：正常使用没漏过，但别装开水长时间闷着。#露营装备 #户外好物 #折叠水杯",
};
