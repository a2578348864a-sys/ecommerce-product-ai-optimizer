/**
 * V3.5 — 1688-cli sanitized fixtures（Contract §78：真实数据不入仓库）
 *
 * 结构照抄 1688-cli v0.1.47 实测输出（Route B Spike 2026-08-15），
 * 但所有敏感/个人值已替换为假值：
 * - supplier.userId / loginId / memberId → 假账号标识
 * - freight.receiveAddress → 假地址（"某省某市"）
 * - 图片 URL → 占位域（img.example.test）
 * - 店铺 URL → 占位域
 * 保留真实数字结构（displayedPrice ¥21.30 vs priceTiers ¥16.5 的差异即实测语义）。
 */

export const SANITIZED_SEARCH_RESPONSE = {
  keyword: "保温杯",
  sort: "relevance",
  filters: { priceMin: null, priceMax: null, province: null, city: null, verified: "any", minTurnover: null, excludeAds: false },
  totalBeforeFilter: 60,
  total: 3,
  offers: [
    {
      offerId: "674035283676",
      title: "跨境750ml大容量小口瓶304不锈钢保温杯户外运动车载便携磨砂水杯",
      price: { text: "¥16", min: 16, max: 16 },
      supplier: { name: "永康市迎庆杯业有限公司", shopUrl: "http://shop-a.example.test", years: 11 },
      location: { province: "浙江", city: "武义县" },
      bizType: "生产加工",
      verified: { factory: true, business: false, superFactory: false },
      tags: ["退货包运费", "后天达", "先采后付"],
      demand: { orderCountText: "22010", orderCount: 22010, repurchaseRateText: null, repurchaseRate: null },
      isP4P: false,
      turnover: "22010",
      url: "https://detail.1688.com/offer/674035283676.html",
      image: "https://img.example.test/a.jpg,https://img.example.test/b.jpg,https://img.example.test/c.jpg",
    },
    {
      offerId: "930374004918",
      title: "新款不锈钢保温杯钢盖简约保温杯女生高颜值便携手提杯真空保温杯",
      price: { text: "¥16.5", min: 16.5, max: 16.5 },
      supplier: { name: "永康市希杰工贸有限公司", shopUrl: "http://shop-b.example.test", years: 2 },
      location: { province: "浙江", city: "金华市" },
      bizType: "生产加工",
      verified: { factory: true, business: false, superFactory: false },
      tags: ["退货包运费"],
      demand: { orderCountText: "4264", orderCount: 4264, repurchaseRateText: null, repurchaseRate: null },
      isP4P: true,
      turnover: "4264",
      url: "https://detail.1688.com/offer/930374004918.html",
      image: "https://img.example.test/d.jpg",
    },
    {
      offerId: "1069362910649",
      title: "迪士尼疯狂动物城保温杯高颜值背带水杯学生上学专用便携水杯子",
      price: { text: "¥25.5", min: 25.5, max: 25.5 },
      supplier: { name: "永康市美事达家居用品有限公司", shopUrl: "http://shop-c.example.test", years: 4 },
      location: { province: "浙江", city: "金华市" },
      bizType: "生产加工",
      verified: { factory: true, business: false, superFactory: false },
      tags: [],
      demand: { orderCountText: "32", orderCount: 32, repurchaseRateText: null, repurchaseRate: null },
      isP4P: false,
      turnover: "32",
      url: "https://detail.1688.com/offer/1069362910649.html",
      image: "https://img.example.test/e.jpg",
    },
  ],
} as const;

/** offer 详情（脱敏：userId/loginId 假值、receiveAddress 假地址、图片占位） */
export const SANITIZED_OFFER_RESPONSE = {
  offerId: "930374004918",
  title: "新款不锈钢保温杯钢盖简约保温杯女生高颜值便携手提杯真空保温杯",
  url: "https://detail.1688.com/offer/930374004918.html",
  priceRange: "￥21.30",
  priceMin: 21.3,
  priceMax: 21.3,
  unitName: "个",
  minOrderQty: 1,
  mixOrderQty: 1,
  priceTiers: [{ minQty: 1, price: 16.5 }],
  detailUrl: "https://itemcdn.example.test/1688offer/fake-id",
  attributes: [
    { name: "内胆材质", value: "304不锈钢" },
    { name: "品牌", value: "希杰" },
    { name: "功能", value: "加厚,便携,真空,保温,可定制,防摔" },
    { name: "材质", value: "内304外201" },
    { name: "是否有第三方检测报告", value: "没有" },
    { name: "加工定制", value: "是" },
    { name: "加印LOGO", value: "可以" },
    { name: "容量", value: "600ml【定制联系客服】" },
  ],
  packageInfo: [],
  supplier: { name: "永康市希杰工贸有限公司", loginId: "永康市希杰工贸有限公司", memberId: null, userId: "0000000000000" },
  freight: { receiveAddress: "某省某市", sendArea: null, province: null, city: null, unitWeight: 0.55 },
  saledCount: 3081,
  categoryId: "1043766",
  options: [
    {
      prop: "颜色",
      values: [
        { name: "白色【一杯双饮+手提绳】", imageUrl: "https://img.example.test/white.jpg" },
        { name: "粉色【一杯双饮+手提绳】", imageUrl: "https://img.example.test/pink.jpg" },
      ],
    },
    { prop: "容量", values: [{ name: "600ml【定制联系客服】", imageUrl: null }] },
  ],
  skus: [
    { skuId: 5980020430300, specs: "绿色【一杯双饮+手提绳】&gt;600ml【定制联系客服】", price: 21.3, multiPrice: 16.5, stock: 5293, saleCount: 0, image: "https://img.example.test/green.jpg" },
    { skuId: 5980020430298, specs: "白色【一杯双饮+手提绳】&gt;600ml【定制联系客服】", price: 21.3, multiPrice: 16.5, stock: 3914, saleCount: 0, image: "https://img.example.test/white.jpg" },
  ],
  mainImage: "https://img.example.test/main.jpg",
  images: ["https://img.example.test/main.jpg", "https://img.example.test/sub1.jpg"],
} as const;
