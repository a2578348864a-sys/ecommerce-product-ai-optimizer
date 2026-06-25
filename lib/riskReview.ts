export type RiskReviewItemStatus = "unchecked" | "cleared" | "needs_check" | "high_risk";

export type RiskReviewOverallStatus = "unknown" | "cleared" | "needs_check" | "high_risk";

export type RiskReviewPrecheckLevel = "not_triggered" | "low" | "medium" | "high" | "unknown";

export type RiskReviewItem = {
  key: string;
  label: string;
  description: string;
  example?: string;
  status: RiskReviewItemStatus;
  precheckLevel: RiskReviewPrecheckLevel;
  precheckReason: string;
  checkAction: string;
  evidenceHint: string;
  note: string | null;
};

export type RiskReviewSnapshot = {
  version: "risk_auto_mvp_v1" | "risk_review_mvp_v1";
  source: "rule_based_risk_precheck_mvp" | "manual_risk_review_mvp";
  mode?: "ai_rule_precheck_with_manual_review";
  overallStatus: RiskReviewOverallStatus;
  overallPrecheckLevel?: Exclude<RiskReviewPrecheckLevel, "not_triggered">;
  summary?: string;
  recommendedActions?: string[];
  items: RiskReviewItem[];
  note: string;
  disclaimer: string;
  createdAt: string;
};

export type RiskPrecheckInput = {
  productName: string;
  normalizedName?: string;
  finalReport?: unknown;
  riskResult?: unknown;
  listingResult?: unknown;
  sourcingResult?: unknown;
};

export type RiskPrecheckResult = {
  overallPrecheckLevel: "low" | "medium" | "high" | "unknown";
  summary: string;
  priorityItems: RiskReviewItem[];
  allItems: RiskReviewItem[];
  recommendedActions: string[];
  generatedAt: string;
};

export const RISK_REVIEW_DISCLAIMER = "AI / 规则预筛不能替代商标、专利、平台规则和当地法规核查。";

export const RISK_REVIEW_STATUS_LABELS: Record<RiskReviewItemStatus, string> = {
  unchecked: "未复核",
  cleared: "已人工确认暂未发现明显风险",
  needs_check: "还要继续查",
  high_risk: "高风险，先暂停",
};

export const RISK_REVIEW_OVERALL_LABELS: Record<RiskReviewOverallStatus, string> = {
  unknown: "尚未人工最终确认",
  cleared: "已按建议完成人工初步复核",
  needs_check: "仍有重点风险待查",
  high_risk: "存在高风险，建议暂停推进",
};

export const RISK_PRECHECK_LEVEL_LABELS: Record<RiskReviewPrecheckLevel, string> = {
  not_triggered: "未触发明显风险词",
  low: "低",
  medium: "中",
  high: "高",
  unknown: "信息不足",
};

type RiskReviewBaseItem = Omit<
  RiskReviewItem,
  "status" | "precheckLevel" | "precheckReason" | "checkAction" | "evidenceHint" | "note"
>;

export const RISK_REVIEW_ITEMS: RiskReviewBaseItem[] = [
  {
    key: "brand_ip",
    label: "品牌词 / IP / 仿牌风险",
    description: "标题、关键词、图片、包装或文案里是否出现品牌名、Logo、IP、影视动漫角色、奢侈品等。",
    example: "Apple、Disney、Nike、Lego、Pokemon、Marvel、迪士尼、耐克、乐高等。",
  },
  {
    key: "trademark",
    label: "商标风险",
    description: "商品标题、关键词、包装、图案、功能名称是否可能涉及注册商标或品牌化词汇。",
  },
  {
    key: "patent_design",
    label: "外观专利 / 结构专利风险",
    description: "产品外观、结构、折叠方式、安装方式、功能设计是否可能与已有爆款高度相似。",
  },
  {
    key: "platform_restricted",
    label: "平台禁售 / 限售风险",
    description: "是否可能属于 Amazon、TikTok Shop、Shopee、eBay 等平台禁止或限制销售类目。",
  },
  {
    key: "children_product",
    label: "儿童用品风险",
    description: "儿童玩具、婴儿用品、儿童服饰、儿童水杯等通常需要更严格安全标准。",
  },
  {
    key: "medical_health_claim",
    label: "医疗健康 / 功效宣称风险",
    description: "涉及治疗、矫正、止痛、减肥、保健、杀菌、改善睡眠等宣称时风险高。",
  },
  {
    key: "electronics_battery",
    label: "电子电器 / 电池 / 充电风险",
    description: "涉及插电、电池、蓝牙、无线、电热、LED、充电器等，可能需要 CE / FCC / RoHS / UL 等认证。",
  },
  {
    key: "food_cosmetic_skin",
    label: "食品 / 化妆品 / 接触皮肤风险",
    description: "接触皮肤、入口、食品相关、化妆品、美容、液体、粉末、硅胶等，合规门槛更高。",
  },
  {
    key: "logistics_hazmat",
    label: "物流 / 危险品风险",
    description: "带电、液体、粉末、磁性、刀具、喷雾、易燃、压缩气体等可能影响物流。",
  },
  {
    key: "supplier_documents",
    label: "供应商资质 / 检测报告",
    description: "当商品涉及电子、儿童、医疗、食品接触、化妆品或危险品风险时，应优先索要供应商材料。",
  },
];

const DEFAULT_PRECHECK = {
  precheckLevel: "not_triggered" as const,
  precheckReason: "当前文本未触发该类明显风险词，但仍需要人工结合目标平台和供应商材料确认。",
  checkAction: "保存前人工快速复核标题、图片、关键词、平台规则和供应商材料。",
  evidenceHint: "可保留商品链接、供应商回复、检测报告或平台规则截图作为复核依据。",
};

const RISK_RULES: Array<{
  key: string;
  terms: string[];
  level: "low" | "medium" | "high";
  status: RiskReviewItemStatus;
  reason: string;
  action: string;
  evidence: string;
}> = [
  {
    key: "brand_ip",
    terms: ["apple", "iphone", "disney", "nike", "adidas", "lego", "pokemon", "marvel", "hello kitty", "sanrio", "star wars", "harry potter", "tesla", "dyson", "lv", "gucci", "chanel", "rolex", "苹果", "迪士尼", "耐克", "阿迪达斯", "乐高", "宝可梦", "漫威", "三丽鸥", "星球大战", "哈利波特", "特斯拉", "戴森", "香奈儿", "劳力士"],
    level: "high",
    status: "needs_check",
    reason: "商品名或分析文本中出现明显品牌 / IP 词，可能涉及商标、版权或平台风控。",
    action: "检查标题、图片、包装和关键词是否使用品牌词或 IP 元素，并确认是否有授权。",
    evidence: "建议留存授权书、供应商声明、原图来源和最终标题关键词清单。",
  },
  {
    key: "trademark",
    terms: ["同款", "爆款", "品牌", "logo", "联名", "授权", "旗舰", "original", "genuine", "designer"],
    level: "medium",
    status: "needs_check",
    reason: "文本中出现容易引发商标核查的品牌化表达。",
    action: "检查商品名、关键词、包装图案和功能名称是否可能涉及注册商标。",
    evidence: "建议留存商标检索截图、标题关键词修改记录或供应商不侵权承诺。",
  },
  {
    key: "patent_design",
    terms: ["支架", "折叠", "磁吸", "收纳", "旋转", "升降", "自动", "结构", "安装", "夹式", "扣式", "便携", "猫砂盆", "手机支架", "桌面支架"],
    level: "medium",
    status: "needs_check",
    reason: "该类产品可能存在外观、结构、安装方式或功能设计相似风险。",
    action: "对比同类爆款外观结构，向供应商确认是否存在外观专利风险或不侵权声明。",
    evidence: "建议留存供应商声明、外观对比图、产品结构图和采购页面截图。",
  },
  {
    key: "platform_restricted",
    terms: ["防狼", "喷雾", "刀", "刀具", "电击", "武器", "烟", "烟草", "电子烟", "cbd", "药", "处方", "减肥药", "成人用品", "仿牌", "侵权"],
    level: "high",
    status: "high_risk",
    reason: "该类词可能触发平台禁售、限售或审核。",
    action: "优先查询目标平台禁售 / 限售规则，未确认前不要推进采购或上架。",
    evidence: "建议留存目标平台规则截图、类目准入要求和供应商产品说明。",
  },
  {
    key: "children_product",
    terms: ["儿童", "婴儿", "宝宝", "幼儿", "玩具", "奶瓶", "安抚", "童装", "儿童水杯"],
    level: "high",
    status: "needs_check",
    reason: "商品可能面向儿童或婴幼儿，通常需要更严格的安全、材料和标签要求。",
    action: "确认是否需要 CPC、儿童安全测试、材料安全报告、年龄标签和警示语。",
    evidence: "建议向供应商索要 CPC、测试报告、材质说明和包装标签照片。",
  },
  {
    key: "medical_health_claim",
    terms: ["治疗", "矫正", "止痛", "减肥", "保健", "杀菌", "消毒", "睡眠", "医疗", "康复", "按摩", "理疗", "血压", "血糖"],
    level: "high",
    status: "needs_check",
    reason: "文本中出现医疗健康或功效宣称相关词，容易触发法规和平台审核。",
    action: "避免未经证实的功效宣称，确认目标市场法规和平台健康类目规则。",
    evidence: "建议留存功效依据、产品说明书、认证材料和最终 Listing 文案。",
  },
  {
    key: "electronics_battery",
    terms: ["电池", "充电", "usb", "蓝牙", "无线", "led", "电热", "自动", "感应", "电动", "锂电", "插电"],
    level: "medium",
    status: "needs_check",
    reason: "文本中出现电子、电池、充电或自动化相关词，可能涉及认证和运输要求。",
    action: "确认是否需要 CE / FCC / RoHS / UL 等认证，以及电池运输要求。",
    evidence: "建议向供应商索要认证证书、检测报告、电池规格和运输证明。",
  },
  {
    key: "food_cosmetic_skin",
    terms: ["食品", "餐具", "水杯", "饭盒", "化妆品", "美容", "护肤", "液体", "粉末", "接触皮肤", "硅胶", "入口", "化妆镜"],
    level: "medium",
    status: "needs_check",
    reason: "商品可能涉及入口、食品接触、化妆美容或皮肤接触场景。",
    action: "确认材料安全、食品接触标准、化妆品或皮肤接触合规要求。",
    evidence: "建议留存材质说明、检测报告、食品接触证明或皮肤接触安全材料。",
  },
  {
    key: "logistics_hazmat",
    terms: ["电池", "液体", "粉末", "磁性", "喷雾", "压缩气体", "易燃", "刀具", "香水", "胶水", "清洁剂", "防狼喷雾"],
    level: "high",
    status: "needs_check",
    reason: "商品可能属于敏感货、危险品或需要特殊运输证明。",
    action: "确认物流渠道是否接受，是否需要 MSDS、运输鉴定或特殊包装。",
    evidence: "建议留存 MSDS、运输鉴定、物流报价和渠道限制说明。",
  },
];

const SUPPLIER_DOCUMENT_ACTION = {
  precheckReason: "系统已圈出电子、儿童、医疗、食品接触、化妆品、危险品或高风险平台类目，需要供应商材料支撑。",
  checkAction: "向供应商索要 CE、FCC、RoHS、MSDS、CPC、检测报告、授权书或不侵权声明等。",
  evidenceHint: "建议保存供应商资质、检测报告、授权书、材料证明和聊天记录。",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStatus(value: unknown): RiskReviewItemStatus {
  return value === "cleared" || value === "needs_check" || value === "high_risk" || value === "unchecked"
    ? value
    : "unchecked";
}

function asPrecheckLevel(value: unknown): RiskReviewPrecheckLevel {
  return value === "not_triggered" || value === "low" || value === "medium" || value === "high" || value === "unknown"
    ? value
    : "unknown";
}

function textFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => textFromUnknown(item, depth + 1));
  if (isRecord(value)) return Object.values(value).flatMap((item) => textFromUnknown(item, depth + 1));
  return [];
}

function buildSearchText(input: RiskPrecheckInput) {
  return [
    input.productName,
    input.normalizedName,
    ...textFromUnknown(input.finalReport),
    ...textFromUnknown(input.riskResult),
    ...textFromUnknown(input.listingResult),
    ...textFromUnknown(input.sourcingResult),
  ].filter(Boolean).join(" ").toLowerCase().slice(0, 8000);
}

function findMatchedTerms(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term.toLowerCase()));
}

function precheckRank(level: RiskReviewPrecheckLevel) {
  if (level === "high") return 4;
  if (level === "medium") return 3;
  if (level === "low") return 2;
  if (level === "unknown") return 1;
  return 0;
}

function mergeLevels(current: RiskReviewPrecheckLevel, next: RiskReviewPrecheckLevel) {
  return precheckRank(next) > precheckRank(current) ? next : current;
}

export function createDefaultRiskReviewItems(): RiskReviewItem[] {
  return RISK_REVIEW_ITEMS.map((item) => ({
    ...item,
    status: "unchecked",
    note: null,
    ...DEFAULT_PRECHECK,
  }));
}

export function summarizeRiskReview(items: Array<Pick<RiskReviewItem, "status">>): RiskReviewOverallStatus {
  if (!items.length) return "unknown";
  if (items.some((item) => item.status === "high_risk")) return "high_risk";
  if (items.some((item) => item.status === "needs_check" || item.status === "unchecked")) return "needs_check";
  return "cleared";
}

export function countRiskReviewItems(items: Array<Pick<RiskReviewItem, "status">>) {
  return {
    highRisk: items.filter((item) => item.status === "high_risk").length,
    needsCheck: items.filter((item) => item.status === "needs_check").length,
    cleared: items.filter((item) => item.status === "cleared").length,
    unchecked: items.filter((item) => item.status === "unchecked").length,
  };
}

function summarizePrecheckLevel(items: Array<Pick<RiskReviewItem, "precheckLevel">>): "low" | "medium" | "high" | "unknown" {
  if (!items.length) return "unknown";
  if (items.some((item) => item.precheckLevel === "high")) return "high";
  if (items.some((item) => item.precheckLevel === "medium")) return "medium";
  if (items.some((item) => item.precheckLevel === "low")) return "low";
  if (items.some((item) => item.precheckLevel === "unknown")) return "unknown";
  return "low";
}

function buildSummary(level: "low" | "medium" | "high" | "unknown", priorityItems: RiskReviewItem[]) {
  if (level === "unknown") return "当前信息不足，系统只能做基础预筛。建议先补充商品名、标题、关键词、供应商材料后再人工确认。";
  if (!priorityItems.length) return "当前文本未触发明显高优先级风险词，但仍需人工结合目标平台规则、供应商材料和最终 Listing 确认。";
  const labels = priorityItems.slice(0, 3).map((item) => item.label).join("、");
  if (level === "high") return `系统自动圈出高优先级风险：${labels}。建议先暂停推进，完成平台规则、授权或供应商材料核查后再决定。`;
  return `系统自动圈出需要优先核查的风险：${labels}。建议先完成这些项目的人工确认，再作为采购或上架参考。`;
}

function buildRecommendedActions(priorityItems: RiskReviewItem[]) {
  if (!priorityItems.length) {
    return [
      "复核标题、图片、关键词中是否出现品牌词或夸大宣称。",
      "确认目标平台类目规则和供应商基础材料。",
      "保存供应商回复、产品页面和最终 Listing 文案，便于后续追溯。",
    ];
  }

  const actions = priorityItems.map((item) => item.checkAction);
  const unique = Array.from(new Set(actions));
  return unique.slice(0, 6);
}

export function generateRiskPrecheck(input: RiskPrecheckInput): RiskPrecheckResult {
  const text = buildSearchText(input);
  const items = createDefaultRiskReviewItems();

  for (const rule of RISK_RULES) {
    const matched = findMatchedTerms(text, rule.terms);
    if (!matched.length) continue;
    const item = items.find((candidate) => candidate.key === rule.key);
    if (!item) continue;

    item.precheckLevel = mergeLevels(item.precheckLevel, rule.level);
    item.status = item.status === "high_risk" ? "high_risk" : rule.status;
    item.precheckReason = `${rule.reason} 触发词：${matched.slice(0, 5).join("、")}。`;
    item.checkAction = rule.action;
    item.evidenceHint = rule.evidence;
  }

  const brandItem = items.find((item) => item.key === "brand_ip");
  const trademarkItem = items.find((item) => item.key === "trademark");
  if (brandItem?.precheckLevel === "high" && trademarkItem && trademarkItem.precheckLevel === "not_triggered") {
    trademarkItem.precheckLevel = "high";
    trademarkItem.status = "needs_check";
    trademarkItem.precheckReason = "品牌 / IP 词命中后，需要同步核查标题、关键词、包装和图片中是否涉及注册商标。";
    trademarkItem.checkAction = "检查商品名、关键词、包装图案和功能名称是否可能涉及注册商标。";
    trademarkItem.evidenceHint = "建议留存商标检索截图、授权书、供应商不侵权承诺和最终 Listing 文案。";
  }

  const riskKeysRequiringSupplierDocs = new Set([
    "brand_ip",
    "platform_restricted",
    "children_product",
    "medical_health_claim",
    "electronics_battery",
    "food_cosmetic_skin",
    "logistics_hazmat",
  ]);
  const needsSupplierDocs = items.some((item) => riskKeysRequiringSupplierDocs.has(item.key) && precheckRank(item.precheckLevel) >= precheckRank("medium"));
  const supplierItem = items.find((item) => item.key === "supplier_documents");
  if (supplierItem && needsSupplierDocs) {
    supplierItem.precheckLevel = "medium";
    supplierItem.status = "needs_check";
    supplierItem.precheckReason = SUPPLIER_DOCUMENT_ACTION.precheckReason;
    supplierItem.checkAction = SUPPLIER_DOCUMENT_ACTION.checkAction;
    supplierItem.evidenceHint = SUPPLIER_DOCUMENT_ACTION.evidenceHint;
  }

  const priorityItems = items
    .filter((item) => item.precheckLevel === "high" || item.precheckLevel === "medium")
    .sort((a, b) => precheckRank(b.precheckLevel) - precheckRank(a.precheckLevel));
  const overallPrecheckLevel = summarizePrecheckLevel(items);
  const summary = buildSummary(overallPrecheckLevel, priorityItems);

  return {
    overallPrecheckLevel,
    summary,
    priorityItems,
    allItems: items,
    recommendedActions: buildRecommendedActions(priorityItems),
    generatedAt: new Date().toISOString(),
  };
}

export function createRiskReviewSnapshotFromPrecheck(input: RiskPrecheckInput): RiskReviewSnapshot {
  const precheck = generateRiskPrecheck(input);
  return {
    version: "risk_auto_mvp_v1",
    source: "rule_based_risk_precheck_mvp",
    mode: "ai_rule_precheck_with_manual_review",
    overallStatus: summarizeRiskReview(precheck.allItems),
    overallPrecheckLevel: precheck.overallPrecheckLevel,
    summary: precheck.summary,
    recommendedActions: precheck.recommendedActions,
    items: precheck.allItems,
    note: "",
    disclaimer: RISK_REVIEW_DISCLAIMER,
    createdAt: precheck.generatedAt,
  };
}

export function normalizeRiskReviewSnapshot(raw: unknown): RiskReviewSnapshot | null {
  if (!isRecord(raw)) return null;

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const byKey = new Map<string, Record<string, unknown>>();
  rawItems.forEach((item) => {
    if (!isRecord(item)) return;
    const key = asString(item.key);
    if (key) byKey.set(key, item);
  });

  const items = RISK_REVIEW_ITEMS.map((base) => {
    const source = byKey.get(base.key);
    const note = source ? asString(source.note) : "";
    const precheckLevel = source ? asPrecheckLevel(source.precheckLevel) : "not_triggered";
    return {
      ...base,
      status: source ? asStatus(source.status) : "unchecked",
      precheckLevel,
      precheckReason: source ? asString(source.precheckReason, DEFAULT_PRECHECK.precheckReason).slice(0, 500) : DEFAULT_PRECHECK.precheckReason,
      checkAction: source ? asString(source.checkAction, DEFAULT_PRECHECK.checkAction).slice(0, 500) : DEFAULT_PRECHECK.checkAction,
      evidenceHint: source ? asString(source.evidenceHint, DEFAULT_PRECHECK.evidenceHint).slice(0, 500) : DEFAULT_PRECHECK.evidenceHint,
      note: note ? note.slice(0, 300) : null,
    };
  });

  const note = asString(raw.note).slice(0, 800);
  const touched = items.some((item) => item.status !== "unchecked" || Boolean(item.note)) || Boolean(note);
  const createdAt = asString(raw.createdAt, new Date().toISOString()).slice(0, 40) || new Date().toISOString();
  const version = raw.version === "risk_review_mvp_v1" ? "risk_review_mvp_v1" : "risk_auto_mvp_v1";
  const source = version === "risk_review_mvp_v1" ? "manual_risk_review_mvp" : "rule_based_risk_precheck_mvp";
  const overallPrecheckLevel = summarizePrecheckLevel(items);
  const priorityItems = items
    .filter((item) => item.precheckLevel === "high" || item.precheckLevel === "medium")
    .sort((a, b) => precheckRank(b.precheckLevel) - precheckRank(a.precheckLevel));
  const summary = asString(raw.summary).slice(0, 500) || (version === "risk_review_mvp_v1"
    ? "该任务保存的是旧版人工复核清单记录，未包含规则预筛触发理由。"
    : buildSummary(overallPrecheckLevel, priorityItems));
  const recommendedActions = Array.isArray(raw.recommendedActions)
    ? raw.recommendedActions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 200)).slice(0, 8)
    : buildRecommendedActions(priorityItems);

  return {
    version,
    source,
    ...(version === "risk_auto_mvp_v1" ? { mode: "ai_rule_precheck_with_manual_review" as const } : {}),
    overallStatus: touched ? summarizeRiskReview(items) : "unknown",
    overallPrecheckLevel,
    summary,
    recommendedActions,
    items,
    note,
    disclaimer: RISK_REVIEW_DISCLAIMER,
    createdAt,
  };
}
