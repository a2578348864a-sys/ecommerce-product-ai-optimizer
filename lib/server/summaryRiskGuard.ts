/**
 * Summary 高风险结论硬规则拦截器
 *
 * 职责：在 AI 生成 summary 结论后，基于确定性规则做最终安全裁决。
 * 不依赖 AI，不依赖数据库，不依赖外部服务。纯函数，可在测试中独立运行。
 *
 * 规则来源：项目需求文档中的 16 类强风险标签 + 结构化字段校验。
 */

// ── 类型定义 ──

/** 硬规则输入：从 summary API 可获取的所有结构化数据 */
export type RiskGuardInput = {
  /** AI 原始输出的 verdict（中文标签） */
  aiVerdict: string;
  /** 商品名称 */
  productName: string;
  /** 商品品类 */
  category?: string;
  /** 商品描述 / 补充说明 */
  description?: string;
  /** 风险排查 overallLevel */
  riskOverallLevel?: string;
  /** 风险排查 blacklistMatches */
  riskBlacklistMatches?: string[];
  /** 货源判断 complianceBarrier */
  sourcingComplianceBarrier?: string;
  /** 货源判断 beginnerFit */
  sourcingBeginnerFit?: string;
  /** 货源判断 suggestedEntryLevel */
  sourcingSuggestedEntryLevel?: string;
  /** 货源判断 logisticsDifficulty */
  sourcingLogisticsDifficulty?: string;
  /** 货源判断 afterSalesRisk */
  sourcingAfterSalesRisk?: string;
};

/** 硬规则输出 */
export type RiskGuardResult = {
  /** 安全后的 verdict（保持现有的 5 个中文标签之一） */
  safeVerdict: string;
  /** 是否被降级（与原始 AI verdict 不同） */
  downgraded: boolean;
  /** 降级原因列表（给前端展示） */
  downgradeReasons: string[];
};

// ── 现有的 verdict 标签（保持兼容，不新增标签） ──

const VERDICT_RANK: Record<string, number> = {
  "新手可小单测试": 1,   // 最乐观
  "可做但需控制成本": 2,
  "有经验再做": 3,
  "新手不建议做": 4,
  "暂不建议做": 5,       // 最保守
};

const ALL_VERDICTS = Object.keys(VERDICT_RANK);

/** 取两个 verdict 中更保守的那个 */
function moreConservative(a: string, b: string): string {
  const ra = VERDICT_RANK[a] ?? 3;
  const rb = VERDICT_RANK[b] ?? 3;
  return ra >= rb ? a : b;
}

// ── 关键词规则表 ──

interface KeywordRule {
  /** 规则名称 */
  name: string;
  /** 匹配关键词（大小写不敏感，中文/英文混合） */
  keywords: string[];
  /** 命中后的最低 verdict */
  minVerdict: string;
  /** 降级原因模板 */
  reason: string;
}

const KEYWORD_RULES: KeywordRule[] = [
  // 规则 1：儿童安全 / 婴幼儿 / 小部件 / 尖锐组合 → 新手不建议做
  {
    name: "儿童安全/婴幼儿",
    keywords: [
      "儿童", "婴儿", "婴幼儿", "宝宝", "小孩", "幼儿", "母婴", "新生儿",
      "baby", "infant", "toddler", "child", "kids", "children", "nursery",
      "teether", "teething", "pacifier", "feeding", "chew toy",
      "咬咬胶", "安抚", "儿童餐具", "牙胶", "童", "婴", "幼",
      "婴儿车", "儿童座椅", "婴儿床",
    ],
    minVerdict: "新手不建议做",
    reason:
      "命中儿童安全/婴幼儿风险，新手不建议直接做。涉及儿童安全的产品需要 CPC/CPSC/ASTM F963 或目标市场对应标准，合规门槛高、售后责任重。",
  },
  {
    name: "小部件",
    keywords: [
      "小部件", "小零件", "小配件", "可拆卸", "可脱落",
      "small parts", "small pieces", "detachable", "choking hazard",
    ],
    minVerdict: "有经验再做",
    reason:
      "命中「小部件」风险。如果产品可被儿童触及，需考虑 choking hazard 和年龄标识要求。在未确认目标市场规则前，不建议新手直接做。",
  },
  {
    name: "尖锐",
    keywords: [
      "尖锐", "锐利", "尖角", "锋利", "刀", "剪刀", "刃",
      "sharp", "blade", "cutting",
    ],
    minVerdict: "有经验再做",
    reason:
      "命中「尖锐」风险。尖锐边角在运输中可能造成包装破损，且有用户安全风险。需确认包装防护和平台安全标准。",
  },
  // 规则 2：食品接触 / 宠物入口 / 皮肤直接接触且材料不明 → 谨慎
  {
    name: "食品接触",
    keywords: [
      "食品接触", "食品级", "food contact", "food grade", "food safe",
      "餐具", "水杯", "饭盒", "保鲜盒", "水壶", "杯子", "碗", "盘",
      "tableware", "cup", "bottle", "container", "lunch box",
      "food container", "silicone cup", "硅胶杯", "硅胶水杯",
      "厨房", "kitchen", "饮水", "喝水",
    ],
    minVerdict: "可做但需控制成本",
    reason:
      "涉及食品接触，需要确认材质认证（FDA/LFGB/国标）、耐热耐温、气味挥发。在拿到供应商检测报告前，至多「可做但需控制成本」。",
  },
  {
    name: "宠物入口/食用接触",
    keywords: [
      "宠物入口", "宠物食用", "宠物食品接触", "猫粮", "狗粮", "宠物零食",
      "pet food", "pet treat", "dog chew", "cat food",
      "宠物碗", "宠物餐具", "慢食碗", "宠物水碗",
    ],
    minVerdict: "可做但需控制成本",
    reason:
      "涉及宠物入口/食用接触，需要确认材料安全认证和平台宠物用品规则。不同平台对宠物食品接触材料有不同要求。",
  },
  {
    name: "皮肤直接接触且材料不明",
    keywords: [
      "皮肤接触", "直接接触皮肤", "贴身", "穿戴", "佩戴",
      "skin contact", "wearable", "wristband",
      "面膜", "眼罩", "口罩",
    ],
    minVerdict: "可做但需控制成本",
    reason:
      "涉及皮肤直接接触。如果材质信息不完整，需要先拿到材质成分和皮肤刺激性检测数据再做决策。",
  },
  // 规则 3：电器/电池/液体/磁性/医疗/化妆品 → 不建议新手做
  {
    name: "电器/电池",
    keywords: [
      "电池", "锂电池", "充电", "电子", "带电", "电器", "电源",
      "USB充电", "电池款", "电热", "电动",
      "battery", "lithium", "rechargeable", "electronic", "electric",
      "charger", "USB", "power bank", "充电宝", "暖手宝",
    ],
    minVerdict: "新手不建议做",
    reason:
      "涉及电器/电池，合规成本高：电池运输需 UN38.3 检测报告，目标市场有电子电气认证要求（FCC/CE/UL 等），平台电池类目有特殊审核。售后风险（电池衰减、充电安全）也需要考虑。",
  },
  {
    name: "磁性",
    keywords: [
      "磁铁", "磁力", "磁性", "磁吸",
      "magnet", "magnetic",
    ],
    minVerdict: "新手不建议做",
    reason:
      "涉及磁性产品。磁铁玩具有严格安全标准（ASTM F963/EN71 磁通量指数），误食可能导致严重伤害。非玩具类磁铁也需确认目标市场规则。",
  },
  {
    name: "液体",
    keywords: [
      "液体", "液体类", "流体",
      "liquid", "fluid", "gel",
    ],
    minVerdict: "新手不建议做",
    reason:
      "涉及液体，物流有运输限制（防漏包装、FBA 液体审核），破损风险高，且部分平台对液体类目有禁限售规则。",
  },
  {
    name: "医疗/化妆品",
    keywords: [
      "医疗", "医用", "医药", "药品", "药物", "治疗", "疗效", "诊断",
      "化妆品", "美妆", "护肤", "美白", "祛痘", "抗皱", "防晒", "彩妆",
      "medical", "cosmetic", "skincare", "beauty", "cream", "serum",
      "lotion", "ointment",
    ],
    minVerdict: "新手不建议做",
    reason:
      "涉及医疗/化妆品。医疗产品需 FDA 510(k)/CE 医疗器械指令等注册认证；化妆品需 FDA 注册/CPNP 等。不同国家法规差异大，合规成本和周期远超普通品类。",
  },
  {
    name: "加热/取暖",
    keywords: [
      "加热", "取暖", "发热", "加热杯", "电热杯", "暖杯垫",
      "heater", "heating", "warming",
    ],
    minVerdict: "新手不建议做",
    reason:
      "涉及加热/取暖功能。这类产品在大部分平台属于高风险品类，需要额外的安全认证（UL/ETL/GS 等），且售后风险（过热、起火、烫伤）较高。",
  },
  {
    name: "灯具",
    keywords: [
      "灯", "灯具", "照明", "露营灯", "夜灯",
      "lamp", "light", "lighting", "LED light",
    ],
    minVerdict: "有经验再做",
    reason:
      "涉及灯具/照明。带电产品需要电子电气认证，且部分平台对照明类目有能效标签（Energy Label）要求。",
  },
  // 规则 4：侵权高风险 → 暂不建议做
  {
    name: "侵权/仿牌",
    keywords: [
      "侵权", "仿牌", "品牌同款", "明星同款", "IP周边",
      "卡通角色", "动漫周边", "影视周边", "游戏周边",
      "迪士尼", "漫威", "任天堂", "宝可梦", "Hello Kitty",
      "infringement", "counterfeit", "knockoff", "replica",
      "同款", "仿", "山寨",
    ],
    minVerdict: "暂不建议做",
    reason:
      "命中侵权高风险关键词。涉及品牌/IP/外观专利风险，在未完成侵权排查和获得品牌授权之前，暂不建议做。平台对侵权产品零容忍，可能导致封店。",
  },
  // 规则 5：大件/承重/家具
  {
    name: "大件/承重/家具",
    keywords: [
      "大件", "承重", "家具", "桌椅", "折叠桌", "露营桌",
      "table", "chair", "furniture", "folding table", "camping table",
      "heavy", "oversized", "托盘", "货架",
    ],
    minVerdict: "有经验再做",
    reason:
      "涉及大件/承重/家具。物流体积大、运费高、破损风险高，退换货成本高。承重宣称需要测试证据。售后复杂度远高于轻小件。",
  },
];

// ── 结构化字段规则 ──

/**
 * 基于风险排查 / 货源判断的结构化字段做降级。
 * 这些字段比关键词匹配更可靠（是 AI 已经分析过的结论）。
 */
function checkStructuredFields(input: RiskGuardInput, currentVerdict: string): { verdict: string; reasons: string[] } {
  const reasons: string[] = [];
  let verdict = currentVerdict;

  // riskOverallLevel 降级
  if (input.riskOverallLevel === "red") {
    reasons.push("风险排查总体评级为「高风险」(red)，基于硬规则覆盖。");
    verdict = moreConservative(verdict, "暂不建议做");
  } else if (input.riskOverallLevel === "yellow") {
    reasons.push("风险排查总体评级为「需注意」(yellow)，建议至少保持「可做但需控制成本」。");
    verdict = moreConservative(verdict, "可做但需控制成本");
  }

  // blacklistMatches 不为空
  if ((input.riskBlacklistMatches || []).length > 0) {
    const matches = (input.riskBlacklistMatches || []).join("、");
    reasons.push(`命中高风险类目「${matches}」。建议先确认平台对该品类的具体规则和资质要求。`);
    verdict = moreConservative(verdict, "有经验再做");
  }

  // sourcing 结构化字段
  if (input.sourcingComplianceBarrier === "high") {
    reasons.push("货源分析标注合规门槛为「高」。");
    verdict = moreConservative(verdict, "有经验再做");
  }

  if (input.sourcingSuggestedEntryLevel === "experienced") {
    reasons.push("货源分析建议入门级别为「需资深运营」(experienced)，新手不具备独立操作条件。");
    verdict = moreConservative(verdict, "新手不建议做");
  } else if (input.sourcingSuggestedEntryLevel === "intermediate") {
    reasons.push("货源分析建议入门级别为「有经验可做」(intermediate)。");
    verdict = moreConservative(verdict, "可做但需控制成本");
  }

  if (input.sourcingBeginnerFit === "low") {
    reasons.push("货源分析标注新手适合度为「低」。");
    verdict = moreConservative(verdict, "有经验再做");
  }

  if (input.sourcingLogisticsDifficulty === "high") {
    reasons.push("货源分析标注物流难度为「高」，大件/易碎/特殊包装品类。");
    verdict = moreConservative(verdict, "有经验再做");
  }

  if (input.sourcingAfterSalesRisk === "high") {
    reasons.push("货源分析标注售后风险为「高」，退货/纠纷概率较大。");
    verdict = moreConservative(verdict, "有经验再做");
  }

  return { verdict, reasons };
}

// ── 主入口 ──

/**
 * 对 AI 生成的 summary verdict 实施硬规则拦截。
 *
 * 处理顺序：
 * 1. 关键词匹配（16 类强风险标签）
 * 2. 结构化字段降级（risk + sourcing 字段）
 * 3. 信息不足兜底
 * 4. 返回安全结论 + 降级原因
 *
 * @param input - 所有可用于判断的结构化数据
 * @returns 安全后的 verdict + 降级信息
 */
export function applyHardGuard(input: RiskGuardInput): RiskGuardResult {
  const allReasons: string[] = [];
  let safeVerdict = input.aiVerdict;

  // 如果 AI 未返回有效 verdict，给一个保守默认值
  if (!ALL_VERDICTS.includes(safeVerdict)) {
    safeVerdict = "可做但需控制成本";
    allReasons.push("AI 未返回有效结论，使用保守默认值。");
  }

  // 构建全文搜索文本
  const fullText = [
    input.productName,
    input.category,
    input.description,
    (input.riskBlacklistMatches || []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // ── 阶段 1：关键词规则匹配 ──
  for (const rule of KEYWORD_RULES) {
    const matched = rule.keywords.some((kw) => fullText.includes(kw.toLowerCase()));
    if (!matched) continue;

    const newVerdict = moreConservative(safeVerdict, rule.minVerdict);
    if (newVerdict !== safeVerdict) {
      allReasons.push(rule.reason);
      safeVerdict = newVerdict;
    }
  }

  // 组合规则：儿童 + 小部件 + 尖锐 → 强制升级到「新手不建议做」或更高
  const hitChild = fullText.includes("儿童") || fullText.includes("婴儿") || fullText.includes("婴幼儿")
    || fullText.includes("baby") || fullText.includes("infant") || fullText.includes("toddler")
    || fullText.includes("child") || fullText.includes("kids");
  const hitSmallParts = fullText.includes("小部件") || fullText.includes("小零件")
    || fullText.includes("small parts") || fullText.includes("detachable");
  const hitSharp = fullText.includes("尖锐") || fullText.includes("锋利")
    || fullText.includes("sharp") || fullText.includes("blade");

  if (hitChild && (hitSmallParts || hitSharp)) {
    const combo = [
      hitChild ? "儿童/婴幼儿" : "",
      hitSmallParts ? "小部件" : "",
      hitSharp ? "尖锐" : "",
    ].filter(Boolean).join("+");
    allReasons.push(
      `组合命中「${combo}」高风险组合。涉及儿童安全+物理危害的产品，合规门槛极高，新手不建议直接做。`
    );
    safeVerdict = moreConservative(safeVerdict, "新手不建议做");
  }

  // ── 阶段 2：结构化字段降级 ──
  const structResult = checkStructuredFields(input, safeVerdict);
  for (const reason of structResult.reasons) {
    if (!allReasons.includes(reason)) {
      allReasons.push(reason);
    }
  }
  safeVerdict = moreConservative(safeVerdict, structResult.verdict);

  // ── 阶段 3：信息不足兜底 ──
  const hasMinimalInfo =
    (input.productName?.length || 0) > 3 &&
    ((input.category?.length || 0) > 0 ||
      (input.description?.length || 0) > 15 ||
      (input.riskOverallLevel || "").length > 0 ||
      (input.sourcingComplianceBarrier || "").length > 0);

  if (!hasMinimalInfo && safeVerdict === "新手可小单测试") {
    allReasons.push(
      "输入信息不足（商品名称过短或无结构化分析数据），无法做出肯定推荐。建议先完成货源判断和风险排查后再评估。"
    );
    safeVerdict = moreConservative(safeVerdict, "可做但需控制成本");
  }

  // ── 去重降级原因 ──
  const uniqueReasons = [...new Set(allReasons)];

  return {
    safeVerdict,
    downgraded: safeVerdict !== input.aiVerdict,
    downgradeReasons: uniqueReasons,
  };
}
