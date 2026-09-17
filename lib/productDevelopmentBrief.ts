/**
 * Product Development Decision Brief (商品开发决策卡)
 *
 * 目标：
 * 强化 Agent 的核心商业定位——“帮助跨境团队判断一个商品是否值得开发”。
 * 30 秒内清晰回答：
 *   1. 到底值不值得做？（推进 / 先小单验证 / 暂不建议）
 *   2. 为什么？（市场需求、1688 供应链可行性、合规与侵权防线，每一项带证据引用）
 *   3. 怎么做？（目标人群、针对 VOC 痛点的改进切入点、与供应商洽谈时的验货清单与下一步行动）
 *
 * 核心原则：
 *   - 纯只读投影层（Pure Projection）：不写库、不改现有 Snapshot 结构、不调 AI Provider。
 *   - 严格向下兼容（Fail-soft）：历史任务无证据时自动基于旧分析报告降级，不抛错。
 *   - 证据第一性：优先使用 Amazon 页面、VOC 买家痛点、1688 报价和合规风控数据。
 */

import {
  buildEvidenceContext,
  type EvidenceContextV1,
  type EvidenceSignal,
} from "@/lib/server/evidenceContext";

export const PRODUCT_DEVELOPMENT_BRIEF_VERSION = "product-development-brief-v1" as const;

export type DecisionBriefRecommendation = "promote" | "validate_first" | "abandon";

export type BriefEvidenceSignal = {
  text: string;
  evidenceRef: string;
  sourceType: "amazon" | "voc" | "sourcing" | "risk" | "sellersprite" | "manual";
  tagLabel: string;
  level?: "info" | "warning" | "danger" | "success";
};

export type DecisionBasisSection = {
  title: string;
  status: "positive" | "caution" | "negative" | "unknown";
  statusLabel: string;
  summary: string;
  signals: BriefEvidenceSignal[];
};

export type ActionableAdvice = {
  /** 目标买家画像与典型使用场景 */
  targetAudience: string;
  /** 差异化卖点 / 产品改进切入点（针对买家 VOC 痛点） */
  keyDifferentiator: string;
  /** 与供应商核验清单（价格阶梯、打样周期、包装、质检标准、资质证书） */
  supplierCheckpoints: string[];
  /** 下一步核心行动 */
  nextSteps: string[];
};

export type EvidenceReadiness = {
  amazon: boolean;
  voc: boolean;
  sourcing: boolean;
  risk: boolean;
  overallScore: number; // 0 - 100
  readinessLabel: string;
};

export type ProductDevelopmentBrief = {
  version: typeof PRODUCT_DEVELOPMENT_BRIEF_VERSION;
  recommendation: DecisionBriefRecommendation;
  recommendationLabel: string;
  recommendationTone: string;
  badgeText: string;

  /** 30秒一句话核心裁决 */
  headline: string;

  /** 证据准备度概览 */
  evidenceReadiness: EvidenceReadiness;

  /** 三大维度决策支撑依据 */
  basis: {
    market: DecisionBasisSection;
    sourcing: DecisionBasisSection;
    risk: DecisionBasisSection;
  };

  /** 针对开发阶段的实操建议 */
  advice: ActionableAdvice;

  /** 证据引用标签列表（汇总） */
  evidenceCitations: BriefEvidenceSignal[];

  /** 是否为无证据平滑降级 */
  isFallback: boolean;
  /** 缺失证据提醒（gaps） */
  gaps: string[];
};

export type ProductDevelopmentBriefInput = {
  resultJson?: unknown;
  workflowResult?: {
    sourcing?: unknown;
    risk?: unknown;
    summary?: unknown;
    listing?: unknown;
    finalReport?: unknown;
  } | null;
  profitSnapshot?: unknown;
  riskReviewSnapshot?: unknown;
  evidenceContext?: EvidenceContextV1 | null;
  productName?: string;
  decisionStatus?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifySourceType(evidenceRef: string): BriefEvidenceSignal["sourceType"] {
  if (evidenceRef.startsWith("ev:browser:")) return "amazon";
  if (evidenceRef.startsWith("ev:voc:") || evidenceRef.startsWith("ev:reviewEvidence:")) return "voc";
  if (evidenceRef.startsWith("ev:sourcing:")) return "sourcing";
  if (evidenceRef.startsWith("riskReviewSnapshot") || evidenceRef.startsWith("ev:candidate:riskFlag")) return "risk";
  if (evidenceRef.startsWith("ev:sellersprite:")) return "sellersprite";
  return "manual";
}

function formatTagLabel(signal: EvidenceSignal): string {
  const ref = signal.evidenceRef || "";
  if (ref.startsWith("ev:browser:")) {
    if (signal.field === "price") return "Amazon 售价";
    if (signal.field === "rating") return "Amazon 评分";
    if (signal.field === "reviewCount") return "Amazon 评论量";
    if (signal.field === "bsr") return "Amazon BSR";
    return "Amazon 页面";
  }
  if (ref.startsWith("ev:voc:") || ref.startsWith("ev:reviewEvidence:")) {
    if (signal.reviewCount && signal.reviewCount > 0) return `VOC ${signal.reviewCount}条痛点`;
    return "VOC 买家痛点";
  }
  if (ref.startsWith("ev:sourcing:")) {
    return signal.offerId ? `1688 #${signal.offerId.slice(-4)}` : "1688 供货价";
  }
  if (ref.startsWith("riskReviewSnapshot") || ref.startsWith("ev:candidate:riskFlag")) {
    return signal.level ? `${signal.level.toUpperCase()} 风险` : "合规预警";
  }
  if (ref.startsWith("ev:sellersprite:")) {
    return "SellerSprite";
  }
  return "证据引用";
}

/**
 * 纯只读投影：将已有研究数据与 Evidence Context 编译为商品开发决策卡
 */
export function buildProductDevelopmentBrief(input: ProductDevelopmentBriefInput = {}): ProductDevelopmentBrief {
  const result = isRecord(input.resultJson) ? input.resultJson : {};
  const wf = input.workflowResult || null;

  // 1. 提取已有分析模块
  const finalReport = isRecord(wf?.finalReport)
    ? wf?.finalReport
    : isRecord(result.finalReport)
      ? (result.finalReport as Record<string, unknown>)
      : null;

  const sourcing = isRecord(wf?.sourcing)
    ? wf?.sourcing
    : isRecord(result.sourcing)
      ? (result.sourcing as Record<string, unknown>)
      : null;

  const risk = isRecord(wf?.risk)
    ? wf?.risk
    : isRecord(result.risk)
      ? (result.risk as Record<string, unknown>)
      : null;

  const summary = isRecord(wf?.summary)
    ? wf?.summary
    : isRecord(result.summary)
      ? (result.summary as Record<string, unknown>)
      : null;

  const profit = isRecord(input.profitSnapshot)
    ? (input.profitSnapshot as Record<string, unknown>)
    : isRecord(result.profitSnapshot)
      ? (result.profitSnapshot as Record<string, unknown>)
      : null;

  const riskSnap = isRecord(input.riskReviewSnapshot)
    ? (input.riskReviewSnapshot as Record<string, unknown>)
    : isRecord(result.riskReviewSnapshot)
      ? (result.riskReviewSnapshot as Record<string, unknown>)
      : null;

  // 2. 获取或提取 EvidenceContextV1
  const evidenceContext: EvidenceContextV1 = input.evidenceContext
    ? input.evidenceContext
    : buildEvidenceContext({
        resultJson: isRecord(input.resultJson) ? input.resultJson : undefined,
      });

  const { availableSources, marketSignals, customerPainPoints, supplierSignals, riskSignals, gaps } = evidenceContext;

  const sourceCount = [
    availableSources.amazon,
    availableSources.voc,
    availableSources.sourcing,
    availableSources.risk,
  ].filter(Boolean).length;

  const overallScore = sourceCount * 25;
  const readinessLabel =
    sourceCount === 4
      ? "证据链完整（高可信度）"
      : sourceCount >= 2
        ? `证据链部分就绪（${sourceCount}/4 项已核验）`
        : "缺少一手证据（依赖基础推导）";

  const isFallback = sourceCount === 0;

  // 3. 收集格式化的证据标签
  const citations: BriefEvidenceSignal[] = [];
  const mapSignal = (s: EvidenceSignal, defaultLevel: BriefEvidenceSignal["level"] = "info"): BriefEvidenceSignal => {
    const sourceType = classifySourceType(s.evidenceRef);
    let level = defaultLevel;
    if (sourceType === "risk") {
      level = s.level === "red" || s.level === "high" ? "danger" : "warning";
    } else if (sourceType === "voc") {
      level = "warning";
    } else if (sourceType === "sourcing") {
      level = "info";
    } else if (sourceType === "amazon") {
      level = "success";
    }
    return {
      text: s.text,
      evidenceRef: s.evidenceRef,
      sourceType,
      tagLabel: formatTagLabel(s),
      level,
    };
  };

  const marketCitations = marketSignals.map((s) => mapSignal(s, "info"));
  const vocCitations = customerPainPoints.map((s) => mapSignal(s, "warning"));
  const supplierCitations = supplierSignals.map((s) => mapSignal(s, "info"));
  const riskCitations = riskSignals.map((s) => mapSignal(s, "danger"));

  citations.push(...marketCitations, ...vocCitations, ...supplierCitations, ...riskCitations);

  // 4. 评估三大维度（市场、供应链、风险）
  // ── 市场维度 ──
  let marketStatus: DecisionBasisSection["status"] = "unknown";
  let marketStatusLabel = "待获取市场数据";
  let marketSummary = "尚未提取到 Amazon 详情页销售与评价数据，需核查实际买家需求。";

  if (availableSources.amazon || availableSources.voc || marketSignals.length > 0) {
    const hasLowRating = marketSignals.some(
      (m) => m.field === "rating" && typeof m.text === "string" && /([12]\.\d|3\.[0-3])\s*\/\s*5/.test(m.text),
    );
    const hasHighVocPain = customerPainPoints.length >= 2;
    if (hasLowRating) {
      marketStatus = "negative";
      marketStatusLabel = "买家口碑濒临崩塌";
      marketSummary = "Amazon 页面评分显著低于 3.5 星，属于高退货率或严重质量缺陷品类，建议规避。";
    } else if (hasHighVocPain) {
      marketStatus = "caution";
      marketStatusLabel = "需求旺盛但痛点集中";
      const topPain = customerPainPoints[0]?.text || "买家存在集中差评";
      marketSummary = `市场具备可观关注度，但买家对产品质量/细节有明显抱怨（首要痛点：${topPain}），需做针对性改进。`;
    } else {
      marketStatus = "positive";
      marketStatusLabel = "市场验证良好";
      marketSummary = "Amazon 页面数据与评价表现平稳，且未发现买家集中差评风险。";
    }
  } else if (finalReport || summary) {
    marketStatus = "caution";
    marketStatusLabel = "基于行业推导";
    marketSummary = asString(summary?.summary || finalReport?.finalVerdict, "具备常规市场需求，但缺乏详情页一手数据支撑。");
  }

  // ── 供应链维度 ──
  let sourcingStatus: DecisionBasisSection["status"] = "unknown";
  let sourcingStatusLabel = "待核验供应链";
  let sourcingSummary = "缺少 1688 实际供货价与 MOQ 数据，无法核算真实毛利。";

  const purchaseCost = asNumber(profit?.purchaseCost);
  const salePrice = asNumber(profit?.salePrice);
  const marginRate = asNumber(profit?.estimatedMarginRate);
  const estProfit = asNumber(profit?.estimatedProfit);

  if (availableSources.sourcing || supplierSignals.length > 0 || (purchaseCost !== null && salePrice !== null)) {
    if (marginRate !== null && marginRate < 0.15 && estProfit !== null && estProfit < 15) {
      sourcingStatus = "negative";
      sourcingStatusLabel = "利润空间过薄";
      sourcingSummary = `当前测算毛利率仅 ${(marginRate * 100).toFixed(1)}%（预估单件利润 ¥${estProfit.toFixed(1)}），抗运费与广告波动能力弱。`;
    } else if (sourcing?.feasibility === "low") {
      sourcingStatus = "negative";
      sourcingStatusLabel = "供应链门槛极高";
      sourcingSummary = asString(sourcing?.summary, "1688 货源稀缺或定制开模门槛高，不易组织货源。");
    } else if (sourcing?.feasibility === "high" || (marginRate !== null && marginRate >= 0.3)) {
      sourcingStatus = "positive";
      sourcingStatusLabel = "货源充沛且利润健康";
      const marginDesc = marginRate !== null ? `，预估毛利率 ${(marginRate * 100).toFixed(1)}%` : "";
      sourcingSummary = `已有匹配供应商资源${marginDesc}，具备小单启动可行性。`;
    } else {
      sourcingStatus = "caution";
      sourcingStatusLabel = "可行但需控成本";
      sourcingSummary = asString(sourcing?.summary, "可找到常规货源，但需与工厂重点确认包装、阶梯报价与起订门槛。");
    }
  } else if (sourcing) {
    sourcingStatus = sourcing.feasibility === "high" ? "positive" : sourcing.feasibility === "low" ? "negative" : "caution";
    sourcingStatusLabel = sourcing.feasibility === "high" ? "货源可行" : sourcing.feasibility === "low" ? "货源受限" : "需核对报价";
    sourcingSummary = asString(sourcing.summary, "已完成基础货源评估，建议索样对比。");
  }

  // ── 风险维度 ──
  const rawRiskLevel = asString(risk?.overallLevel || riskSnap?.overallLevel || finalReport?.riskLevel).toLowerCase();
  const blacklistMatches: string[] = Array.isArray(risk?.blacklistMatches)
    ? risk.blacklistMatches.filter((x): x is string => typeof x === "string")
    : [];

  let riskSectionStatus: DecisionBasisSection["status"] = "unknown";
  let riskSectionStatusLabel = "待核验合规";
  let riskSectionSummary = "尚未进行针对性的侵权与平台禁限售筛查。";

  const hasHighRiskSignal = riskSignals.some(
    (s) => s.level === "red" || s.level === "high" || s.level === "danger"
  );

  if (rawRiskLevel === "red" || rawRiskLevel === "high" || blacklistMatches.length > 0 || hasHighRiskSignal) {
    riskSectionStatus = "negative";
    riskSectionStatusLabel = "存在高风险拦截项";
    riskSectionSummary = blacklistMatches.length > 0
      ? `命中高风险黑名单标签：${blacklistMatches.join("、")}，上架极易遭遇平台下架或专利侵权处罚。`
      : asString(risk?.summary, "存在显著的侵权或平台限制风险，不建议贸然投入。");
  } else if ((rawRiskLevel === "green" || rawRiskLevel === "low") && !hasHighRiskSignal) {
    riskSectionStatus = "positive";
    riskSectionStatusLabel = "风险低且合规清晰";
    riskSectionSummary = asString(riskSnap?.summary || risk?.summary, "常规普货，未检测到显著专利、外观侵权或平台类目准入限制。");
  } else if (rawRiskLevel === "yellow" || rawRiskLevel === "medium" || riskSignals.length > 0) {
    riskSectionStatus = "caution";
    riskSectionStatusLabel = "中度风险需复核";
    riskSectionSummary = asString(risk?.summary, "涉及常规类目资质或功能宣称规范，需确保具备对应认证或出厂质检文件。");
  } else {
    riskSectionStatus = "caution";
    riskSectionStatusLabel = "待确认侵权资质";
    riskSectionSummary = "普货常规要求，建议上架前检索商标及外观专利。";
  }

  // 5. 核心决策裁决（Recommendation）
  let recommendation: DecisionBriefRecommendation = "validate_first";
  let recommendationLabel = "建议先验证（需补充关键证据或小单测款）";
  let recommendationTone = "border-amber-200 bg-amber-50 text-amber-800";
  let badgeText = "建议先验证";
  let headline = "";

  const verdictText = asString(finalReport?.finalVerdict || summary?.verdict);

  // 判定规则 1：高风险或明确淘汰项 -> abandon
  if (
    riskSectionStatus === "negative" ||
    sourcingStatus === "negative" ||
    /不建议|放弃|淘汰|高风险/.test(verdictText) ||
    input.decisionStatus === "abandon"
  ) {
    recommendation = "abandon";
    recommendationLabel = "暂不建议（风险较高或利润微薄）";
    recommendationTone = "border-rose-200 bg-rose-50 text-rose-800";
    badgeText = "暂不建议投入";

    if (riskSectionStatus === "negative") {
      headline = `该品类存在显著合规或侵权隐患（${blacklistMatches[0] || "合规阻断"}），继续推进面临下架或封店风险，建议放弃当前款式。`;
    } else if (sourcingStatus === "negative") {
      headline = "采购成本过高或利润模型测算处于微利/亏损区间，无法支撑测款与海外仓运费开支，建议转向更具成本优势的替代品。";
    } else {
      headline = verdictText || "AI 综合评估该商品目前不具备健康的投入产出比，建议跨境团队暂时搁置或重新寻找方向。";
    }
  }
  // 判定规则 2：低风险 + 供应链畅通 + 具备证据支持 -> promote
  else if (
    riskSectionStatus === "positive" &&
    sourcingStatus === "positive" &&
    marketStatus !== "negative" &&
    !summary?.downgraded
  ) {
    recommendation = "promote";
    recommendationLabel = "建议推进（具备测款潜力）";
    recommendationTone = "border-emerald-200 bg-emerald-50 text-emerald-800";
    badgeText = "建议推进测款";

    const diffHint = customerPainPoints.length > 0
      ? `针对买家抱怨集中的问题（如“${customerPainPoints[0].text.slice(0, 30)}...”）进行微改进，将形成极强护城河。`
      : "货源与毛利模型健康，可快速进入打样与测款上架阶段。";

    headline = `该商品市场需求明确且合规风险可控，1688 供应链具备成本优势。${diffHint}`;
  }
  // 判定规则 3：默认需要小批量验证或补充证据 -> validate_first
  else {
    recommendation = "validate_first";
    recommendationLabel = "建议先小单验证（控制首批投入）";
    recommendationTone = "border-amber-200 bg-amber-50 text-amber-800";
    badgeText = "建议先验证";

    const reasonItems: string[] = [];
    if (gaps.length > 0) reasonItems.push(gaps[0].slice(0, 25));
    if (customerPainPoints.length > 0) reasonItems.push("吸收买家差评改进细节");
    if (riskSectionStatus === "caution") reasonItems.push("确认类目认证资质");

    const reasonSummary = reasonItems.length > 0 ? `重点：${reasonItems.join("、")}` : "控制首批试单量（20-50件）";
    headline = `商品具备一定开发机会，但仍有关键参数需要实单核验。建议先小批量测款（${reasonSummary}），切勿直接重资金备货。`;
  }

  // 6. 生成实操开发建议（Actionable Advice）
  // 目标人群
  const allContextText = [
    asString(input.productName),
    asString(result.productName),
    ...customerPainPoints.map((p) => p.text),
    ...marketSignals.map((m) => m.text),
    ...supplierSignals.map((s) => s.text),
  ].join(" ");

  let targetAudience = "注重实用性与性价比的家庭及个人消费者";
  if (/kids|儿童|学生|school|baby|infant|toddler/i.test(allContextText)) {
    targetAudience = "家有学龄儿童的年轻父母群体，核心关注食品安全级材质、耐摔耐用性及清洗便捷度。";
  } else if (/kitchen|cooking|counter|utensil|餐具|厨房/i.test(allContextText)) {
    targetAudience = "注重台面整洁与厨房品质感的美国家居主妇/料理爱好者，看重容量分区与防滑稳固性。";
  } else if (/sports|outdoor|fitness|gym|travel|运动|户外/i.test(allContextText)) {
    targetAudience = "户外运动与健身爱好者，重点诉求轻量化、便携性与高密封防漏。";
  }

  // 差异化改良方向（直接从 VOC 提取）
  let keyDifferentiator = "优化现有竞品被买家诟病做工粗糙的问题，升级加固关键受力结构并随附清晰使用说明。";
  if (customerPainPoints.length > 0) {
    const topPain = customerPainPoints[0];
    keyDifferentiator = `攻克竞品核心痛点：针对买家高频抱怨的「${topPain.text.slice(0, 50)}」，要求供应商在配件契合度、抗摔性能或密封胶圈上提供改良款，并在后续主图突出展示该改进点。`;
  }

  // 与供应商核验清单
  const supplierCheckpoints: string[] = [
    "实物样品测试：采购 2-3 家样品对比实物做工，重点测试结构紧密性、毛刺处理及抗摔防漏能力。",
    "起订量与阶梯价：确认首单小试单（20-50 件）是否支持，以及后续加单到 200-500 件时的阶梯优惠报价。",
    "出厂包装防损：确认外箱是否具备电商防跌落包装标准（五层瓦楞纸、内衬气泡袋），降低长途跨境破损率。",
    "质检报告与资质：核对工厂是否具备 ISO 认证、出口资质以及产品对应的检测报告（如 FDA/CE/CPC）。",
  ];

  // 下一步行动
  const nextSteps: string[] = [];
  if (recommendation === "abandon") {
    nextSteps.push("停止对该具体款式的进一步调研与打样投入。");
    nextSteps.push("若该类目市场需求仍大，可寻找规避了侵权点或具有专利授权的替代款式重新评估。");
    nextSteps.push("在任务中心更新状态为「建议放弃」，归档本次调研证据。");
  } else if (recommendation === "promote") {
    nextSteps.push("向 1688 意向供应商发起打样申请，核实样品质感与发货时效。");
    nextSteps.push("基于已有买家痛点完成产品微改良确认，并开始规划视觉主图与 Listing 卖点。");
    nextSteps.push("核算头程物流与 FBA 仓储费用，锁定首批 30-100 件小批量试单。");
  } else {
    nextSteps.push("补充核对缺失证据：重点核实供应商真实起订量（MOQ）与目标平台准入证书。");
    nextSteps.push("安排小批量采购（10-30 件）进行实测，检验买家差评涉及的问题是否存在。");
    nextSteps.push("在研究工作台完成人工流程复核，锁定商业决策。");
  }

  return {
    version: PRODUCT_DEVELOPMENT_BRIEF_VERSION,
    recommendation,
    recommendationLabel,
    recommendationTone,
    badgeText,
    headline,
    evidenceReadiness: {
      amazon: availableSources.amazon,
      voc: availableSources.voc,
      sourcing: availableSources.sourcing,
      risk: availableSources.risk,
      overallScore,
      readinessLabel,
    },
    basis: {
      market: {
        title: "市场需求与买家声音 (VOC)",
        status: marketStatus,
        statusLabel: marketStatusLabel,
        summary: marketSummary,
        signals: marketCitations,
      },
      sourcing: {
        title: "供应链与利润测算",
        status: sourcingStatus,
        statusLabel: sourcingStatusLabel,
        summary: sourcingSummary,
        signals: supplierCitations,
      },
      risk: {
        title: "合规门槛与侵权防线",
        status: riskSectionStatus,
        statusLabel: riskSectionStatusLabel,
        summary: riskSectionSummary,
        signals: riskCitations,
      },
    },
    advice: {
      targetAudience,
      keyDifferentiator,
      supplierCheckpoints,
      nextSteps,
    },
    evidenceCitations: citations,
    isFallback,
    gaps,
  };
}
