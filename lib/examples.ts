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
  title: "TikTok viral kitchen gadget - portable mini blender",
  productUrl: "https://www.tiktok.com/@example/video/example-portable-blender",
  platform: "tiktok",
  materialText:
    "Portable mini blender for smoothie lovers! USB-C rechargeable, 380ml capacity, blends ice and frozen fruit in 30 seconds. Only 450g, fits in any bag. Perfect for gym, office, camping.\n\nPrice: $19.99\n\nComments asking most: does it leak? how many blends per charge? is it loud?\n\nHashtags: #kitchengadgets #tiktokmademebuyit #portableblender #amazonfinds",
};
