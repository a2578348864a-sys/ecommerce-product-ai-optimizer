export type RiskReviewItemStatus = "unchecked" | "cleared" | "needs_check" | "high_risk";

export type RiskReviewOverallStatus = "unknown" | "cleared" | "needs_check" | "high_risk";

export type RiskReviewItem = {
  key: string;
  label: string;
  description: string;
  example?: string;
  status: RiskReviewItemStatus;
  note: string | null;
};

export type RiskReviewSnapshot = {
  version: "risk_review_mvp_v1";
  source: "manual_risk_review_mvp";
  overallStatus: RiskReviewOverallStatus;
  items: RiskReviewItem[];
  note: string;
  disclaimer: string;
  createdAt: string;
};

export const RISK_REVIEW_DISCLAIMER = "AI 风险判断不能替代商标、专利、平台规则和当地法规核查。";

export const RISK_REVIEW_STATUS_LABELS: Record<RiskReviewItemStatus, string> = {
  unchecked: "未确认",
  cleared: "已确认",
  needs_check: "待核查",
  high_risk: "高风险",
};

export const RISK_REVIEW_OVERALL_LABELS: Record<RiskReviewOverallStatus, string> = {
  unknown: "尚未进行人工风险复核",
  cleared: "已完成人工初步复核",
  needs_check: "仍有风险项待核查",
  high_risk: "存在高风险项，暂不建议推进",
};

export const RISK_REVIEW_ITEMS: Array<Omit<RiskReviewItem, "status" | "note">> = [
  {
    key: "brand_ip",
    label: "品牌词 / 仿牌风险",
    description: "是否涉及品牌名、Logo、IP、影视动漫角色、明星肖像、运动品牌、奢侈品牌等。",
    example: "Apple、Disney、Nike、Lego、Pokemon、Marvel 等。",
  },
  {
    key: "trademark",
    label: "商标风险",
    description: "商品标题、关键词、包装、图案、功能名称是否可能涉及注册商标。",
  },
  {
    key: "patent_design",
    label: "外观专利 / 结构专利风险",
    description: "产品外观、结构、折叠方式、安装方式、功能设计是否可能与已有产品高度相似。",
  },
  {
    key: "platform_restricted",
    label: "平台禁售 / 限售风险",
    description: "是否可能属于 Amazon、TikTok Shop、Shopee、eBay 等平台限制类目。",
  },
  {
    key: "children_product",
    label: "儿童用品风险",
    description: "儿童玩具、婴儿用品、儿童服饰、学习用品等需要更严格安全标准。",
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
    description: "接触皮肤、入口、食品相关、化妆品、美容仪器、液体、粉末等，合规门槛高。",
  },
  {
    key: "logistics_hazmat",
    label: "物流 / 危险品风险",
    description: "带电、液体、粉末、磁性、刀具、喷雾、易燃、压缩气体等可能影响物流。",
  },
  {
    key: "supplier_documents",
    label: "供应商资质 / 检测报告",
    description: "是否需要向供应商索要 CE、FCC、RoHS、MSDS、CPC、检测报告、授权书等文件。",
  },
];

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

export function createDefaultRiskReviewItems(): RiskReviewItem[] {
  return RISK_REVIEW_ITEMS.map((item) => ({
    ...item,
    status: "unchecked",
    note: null,
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
    return {
      ...base,
      status: source ? asStatus(source.status) : "unchecked",
      note: note ? note.slice(0, 300) : null,
    };
  });

  const note = asString(raw.note).slice(0, 800);
  const touched = items.some((item) => item.status !== "unchecked" || Boolean(item.note)) || Boolean(note);
  const createdAt = asString(raw.createdAt, new Date().toISOString()).slice(0, 40) || new Date().toISOString();

  return {
    version: "risk_review_mvp_v1",
    source: "manual_risk_review_mvp",
    overallStatus: touched ? summarizeRiskReview(items) : "unknown",
    items,
    note,
    disclaimer: RISK_REVIEW_DISCLAIMER,
    createdAt,
  };
}
