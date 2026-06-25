/* ------------------------------------------------------------------ */
/*  Agent Run Snapshot — save + replay helpers                        */
/* ------------------------------------------------------------------ */

export type AgentRunStep = {
  key: string;
  label: string;
  status: "not_started" | "running" | "completed" | "needs_manual_review" | "warning" | "failed";
  summary?: string;
};

export type AgentRunSnapshot = {
  version: 1;
  source: "agent_run";
  productName: string;
  createdAt: string;
  runMode: "controlled_agent_workflow";
  steps: AgentRunStep[];
  finalVerdict?: string;
  riskLevel?: string;
  beginnerFit?: string;
  canTestSmallBatch?: boolean;
  nextSteps?: string[];
  manualConfirmed: boolean;
  manualConfirmedAt?: string;
  profitSnapshot?: unknown;
  riskReviewSnapshot?: unknown;
};

export type ListingPrepSnapshot = {
  keywordPool: {
    coreWords: string[];
    longTailWords: string[];
    sceneWords: string[];
    crowdWords: string[];
    attributeWords: string[];
    riskWordReminder: string;
  };
  titleStructure: {
    formula: string;
    recommendedTitle: string;
    breakdown: string[];
  };
  bulletDrafts: string[];
  searchTerms: {
    draft: string;
    reminders: string[];
  };
  imageMaterialNeeds: string[];
  manualSupplementChecklist: string[];
  complianceExpressionReminders: string[];
};

/* ------------------------------------------------------------------ */
/*  builders                                                           */
/* ------------------------------------------------------------------ */

const AGENT_RUN_STEPS: AgentRunStep[] = [
  { key: "normalize", label: "数据清洗", status: "not_started" },
  { key: "market", label: "市场机会判断", status: "not_started" },
  { key: "sourcing", label: "供货可行性", status: "not_started" },
  { key: "profit", label: "成本利润估算", status: "not_started" },
  { key: "risk", label: "合规 / 侵权 AI 预筛", status: "not_started" },
  { key: "listing", label: "Listing / 关键词准备", status: "not_started" },
  { key: "report", label: "最终结论", status: "not_started" },
  { key: "manual", label: "人工确认与任务沉淀", status: "not_started" },
];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function record(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Build an AgentRunSnapshot from workflow result and user confirmations */
export function buildAgentRunSnapshot(input: {
  workflowResult: Record<string, unknown> | null;
  riskReviewSnapshot: unknown;
  profitSnapshot: unknown;
  manualChecked: Record<string, boolean>;
  productName: string;
  sourceMeta?: unknown;
}): AgentRunSnapshot {
  const wr = input.workflowResult || {};
  const fr = record(wr.finalReport);
  const risk = record(wr.risk);

  const steps: AgentRunStep[] = AGENT_RUN_STEPS.map((template) => {
    const apiStep = (Array.isArray(wr.steps) ? wr.steps : []).find(
      (s: Record<string, unknown>) => record(s)?.key === (template.key === "market" ? "summary" : template.key) || record(s)?.key === (template.key === "profit" ? "sourcing" : undefined),
    );
    const status = apiStep ? (str(record(apiStep)?.status) || "completed") as AgentRunStep["status"] : "not_started";
    return { ...template, key: template.key, status, summary: str(record(apiStep)?.summary) };
  });

  // Mark manual step based on user confirmation
  const manualStep = steps.find((s) => s.key === "manual");
  if (manualStep) {
    manualStep.status = input.manualChecked.sourcing && input.manualChecked.profit && input.manualChecked.risk && input.manualChecked.listing ? "completed" : "needs_manual_review";
  }

  return {
    version: 1,
    source: "agent_run",
    productName: input.productName,
    createdAt: new Date().toISOString(),
    runMode: "controlled_agent_workflow",
    steps,
    finalVerdict: str(fr?.finalVerdict) || undefined,
    riskLevel: str(fr?.riskLevel) || str(risk?.overallLevel) || undefined,
    beginnerFit: str(fr?.beginnerFit) || undefined,
    canTestSmallBatch: fr?.canTestSmallBatch as boolean | undefined,
    nextSteps: strs(fr?.nextSteps),
    manualConfirmed: manualStep?.status === "completed",
    manualConfirmedAt: manualStep?.status === "completed" ? new Date().toISOString() : undefined,
    profitSnapshot: input.profitSnapshot || undefined,
    riskReviewSnapshot: input.riskReviewSnapshot || undefined,
  };
}

/** Build a ListingPrepSnapshot from available data */
export function buildListingPrepSnapshot(input: {
  listing?: Record<string, unknown> | null;
  riskReviewSnapshot?: unknown;
  finalReport?: Record<string, unknown> | null;
  productName?: string;
}): ListingPrepSnapshot {
  const listing = input.listing || {};
  const fr = input.finalReport || {};
  const riskReview = record(input.riskReviewSnapshot);
  const keywords = strs(listing.keywords);
  const coreWords = keywords.slice(0, 3);
  const longTailWords = keywords.slice(3, 8);

  const title = str(listing.title) || str(input.productName) || "待分析商品";

  const riskWarnings = strs(riskReview?.complianceWarnings);

  return {
    keywordPool: {
      coreWords,
      longTailWords,
      sceneWords: [],
      crowdWords: [],
      attributeWords: [],
      riskWordReminder: [
        "避免品牌词、竞品词和侵权词",
        "不使用绝对化宣传词",
        ...riskWarnings.slice(0, 3),
      ].join("；"),
    },
    titleStructure: {
      formula: "核心词 + 属性词 + 场景词 / 人群词",
      recommendedTitle: title,
      breakdown: [
        `核心词：${coreWords.length > 0 ? coreWords.join("、") : "待人工补充"}`,
        "需要人工确认：品牌名是否允许出现在标题中、是否有平台标题字符限制、不得承诺平台合规或无侵权",
      ],
    },
    bulletDrafts: [
      "核心使用场景 — 待人工补充（适用于什么场景、解决什么问题）",
      "材质 / 尺寸 / 兼容性 — 待人工补充（精确的尺寸、材质、重量、适配型号）",
      "安装 / 使用方式 — 待人工补充（是否需要安装、使用步骤、便利性）",
      "包装 / 配件 — 待人工补充（包装清单、包含配件、赠品）",
      "售后 / 注意事项 — 待人工补充（质保期、退换货政策、使用提醒、安全警告）",
    ],
    searchTerms: {
      draft: keywords.join(" "),
      reminders: [
        "需根据平台后台规则人工调整",
        "不要重复标题中已有的核心词过多",
        "避免品牌词、竞品词和侵权词",
        "使用单数/复数、同义词、常见拼写错误变体",
      ],
    },
    imageMaterialNeeds: [
      "主图：白底产品图，展示产品全貌",
      "场景图：产品在实际使用场景中的展示",
      "尺寸 / 参数图：标注关键尺寸、重量、规格参数",
      "细节图：材质纹理、接口、按键等特写",
      "包装 / 配件图：包装外观、内含配件全家福",
      "证书 / 资质 / 警示图：如涉及认证，准备证书或警示标识图",
    ],
    manualSupplementChecklist: [
      "精确的产品尺寸（长 × 宽 × 高 / 直径）",
      "材质成分（塑料类型、金属牌号、面料成分）",
      "产品净重和包装后毛重",
      "适配型号 / 兼容性信息",
      "包装清单（主件、配件、说明书等）",
      "认证文件（CE / FCC / CPC / RoHS / MSDS 等）",
      "供应商授权书 / 品牌授权书",
      "商标 / 专利 / 外观设计核查结果",
      "平台规则限制（如亚马逊类目要求、危险品审核）",
      "目标市场当地法规要求（如加州 Prop 65、欧盟 REACH）",
    ],
    complianceExpressionReminders: [
      "Listing 上架准备包不能替代平台规则、商标专利和当地法规核查",
      "所有内容在发布前需由运营人员人工最终确认",
      "系统只做预筛和建议，不构成合规、法律或商业决策依据",
      ...strs(listing.complianceNotes),
    ],
  };
}

/** Check if a task's resultJson contains an agentRunSnapshot */
export function isAgentRunTask(resultJson: unknown): boolean {
  const r = record(resultJson);
  if (!r) return false;
  const snapshot = record(r.agentRunSnapshot);
  return !!(snapshot && snapshot.source === "agent_run");
}

/** Extract agentRunSnapshot from resultJson, or null */
export function extractAgentRunSnapshot(resultJson: unknown): AgentRunSnapshot | null {
  const r = record(resultJson);
  if (!r) return null;
  const snapshot = record(r.agentRunSnapshot);
  if (!snapshot || snapshot.source !== "agent_run") return null;
  return snapshot as unknown as AgentRunSnapshot;
}

/** Extract listingPrepSnapshot from resultJson, or null */
export function extractListingPrepSnapshot(resultJson: unknown): ListingPrepSnapshot | null {
  const r = record(resultJson);
  if (!r) return null;
  const snapshot = record(r.listingPrepSnapshot);
  if (!snapshot) return null;
  return snapshot as unknown as ListingPrepSnapshot;
}
