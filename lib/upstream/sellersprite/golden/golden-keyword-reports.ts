/**
 * Golden fixtures — 关键词报表（Reverse ASIN / Keyword Mining）。
 * 表头为真实样本形态（2026-08-15：ReverseASIN 32 列含重复「更新时间」、KeywordMining 21 列）；
 * 行数据全部合成脱敏（GOLDEN/SANITIZED 前缀），保留真实值形态：
 * 0–1 比例原值、需供比大数值（不 ×100）、美元价格文本、逗号分隔前十ASIN、
 * 空值列（广告流量占比/广告排名页码）、文本状态（前3页无排名/第1页 5/59）。
 */

/** 真实 Reverse ASIN 表头（32 列；「更新时间」出现两次，第二个为空列） */
export const GOLDEN_REVERSE_ASIN_HEADERS = [
  "流量词",
  "关键词翻译",
  "AC推荐词",
  "流量占比",
  "预估周曝光量",
  "关键词类型",
  "转化效果",
  "流量词类型",
  "自然流量占比",
  "广告流量占比",
  "自然排名",
  "自然排名页码",
  "更新时间",
  "广告排名",
  "广告排名页码",
  "更新时间",
  "ABA周排名",
  "月搜索量",
  "SPR",
  "标题密度",
  "购买量",
  "购买率",
  "展示量",
  "点击量",
  "商品数",
  "需供比",
  "广告竞品数",
  "点击总占比",
  "转化总占比",
  "PPC价格",
  "建议竞价范围",
  "前十ASIN",
] as const;

/** 真实 Keyword Mining 表头（21 列） */
export const GOLDEN_KEYWORD_MINING_HEADERS = [
  "关键词",
  "关键词翻译",
  "AC推荐词",
  "相关度",
  "ABA月排名",
  "ABA周排名",
  "月搜索量",
  "SPR",
  "标题密度",
  "购买量",
  "购买率",
  "展示量",
  "点击量",
  "商品数",
  "需供比",
  "广告竞品数",
  "点击总占比",
  "转化总占比",
  "PPC价格",
  "建议竞价范围",
  "前十ASIN",
] as const;

export type GoldenKeywordRow = Readonly<Record<string, string>>;

function reverseAsinRow(
  keyword: string,
  translation: string,
  trafficShare: string,
  naturalRank: string,
  rankPage: string,
  purchases: string,
  supplyDemandRatio: string,
  clickShare: string,
): GoldenKeywordRow {
  return {
    流量词: keyword,
    关键词翻译: translation,
    "AC推荐词": "Y",
    流量占比: trafficShare,
    预估周曝光量: "953946",
    关键词类型: "主要流量词",
    转化效果: "转化平稳词",
    流量词类型: "自然搜索词/AC推荐词",
    自然流量占比: "1",
    广告流量占比: "",
    自然排名: naturalRank,
    自然排名页码: rankPage,
    更新时间: "中08.15 00:26\n美08.14 09:26",
    广告排名: "前3页无排名",
    广告排名页码: "",
    ABA周排名: "4",
    月搜索量: "4471888",
    SPR: "335",
    标题密度: "50",
    购买量: purchases,
    购买率: "0.0031",
    展示量: "112350392",
    点击量: "1964238",
    商品数: "2514",
    需供比: supplyDemandRatio,
    广告竞品数: "626",
    点击总占比: clickShare,
    转化总占比: "0.0742",
    PPC价格: "$3.22",
    建议竞价范围: "$2.42-$4.03",
    前十ASIN: "B0GOLD0001,B0GOLD0002,B0GOLD0003",
  };
}

/** 脱敏 Reverse ASIN 行（5 行，值形态对应真实样本） */
export const GOLDEN_REVERSE_ASIN_ROWS: ReadonlyArray<GoldenKeywordRow> = [
  reverseAsinRow("golden bottle", "金色水瓶", "0.2949", "5", "第1页 5/59", "13862", "1,778.8", "0.3479"),
  reverseAsinRow("golden water bottle", "金色水瓶", "0.1608", "1", "第1页 1/63", "24608", "16.3", "0.1599"),
  reverseAsinRow("golden tumbler", "金色随行杯", "0.0679", "6", "第1页 6/56", "8793", "481.9", "0.471"),
  reverseAsinRow("golden flask", "金色保温壶", "0.0421", "4", "第1页 4/60", "1997", "178.4", "0.3538"),
  reverseAsinRow("golden straw lid", "金色吸管盖", "0.0331", "9", "第1页 9/71", "1521", "23.6", "0.123"),
];

function keywordMiningRow(
  keyword: string,
  translation: string,
  relevance: string,
  abaMonthly: string,
  abaWeekly: string,
  searches: string,
  purchases: string,
  supplyDemandRatio: string,
  clickShare: string,
  conversionShare: string,
): GoldenKeywordRow {
  return {
    关键词: keyword,
    关键词翻译: translation,
    "AC推荐词": "Y",
    相关度: relevance,
    ABA月排名: abaMonthly,
    ABA周排名: abaWeekly,
    月搜索量: searches,
    SPR: "335",
    标题密度: "50",
    购买量: purchases,
    购买率: "0.0031",
    展示量: "112350392",
    点击量: "1964238",
    商品数: "3450",
    需供比: supplyDemandRatio,
    广告竞品数: "514",
    点击总占比: clickShare,
    转化总占比: conversionShare,
    PPC价格: "$3.28",
    建议竞价范围: "$2.46-$4.10",
    前十ASIN: "B0GOLD0001,B0GOLD0002,B0GOLD0003",
  };
}

/** 脱敏 Keyword Mining 行（5 行，值形态对应真实样本） */
export const GOLDEN_KEYWORD_MINING_ROWS: ReadonlyArray<GoldenKeywordRow> = [
  keywordMiningRow("golden", "金色", "100", "5", "2", "4471888", "13863", "1,296.2", "0.3663", "0.0579"),
  keywordMiningRow("gollden", "金色(拼写变体)", "95", "112483", "97655", "15785", "155", "5.1", "0.1887", "0"),
  keywordMiningRow("golden bottle", "金色水瓶", "92.9", "544209", "391291", "2741", "11", "1.1", "0.3624", "0.0476"),
  keywordMiningRow("golden water bottle", "金色水瓶", "88.4", "72068", "53242", "22931", "161", "7.6", "0.4038", "0"),
  keywordMiningRow("golden tumbler", "金色随行杯", "85.1", "190234", "120987", "8912", "77", "3.9", "0.214", "0.031"),
];
