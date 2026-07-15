import type { RankingRun, Stage1Result } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import { calibrateStage2 } from "../../lib/upstream/ranking";

export type BlindReviewMaterialInput = {
  schemaVersion: "blind-review-material.v1";
  blindReviewId: string;
  criteria: string[];
  items: Array<{
    blindItemId: string;
    candidateId: string;
    evidenceSnapshotId: string;
    title: string | null;
    sourceUrl: string;
    capturedAt: string;
    evidence: {
      price: number | null;
      rating: number | null;
      reviewCount: number | null;
      missingEvidence: string[];
    };
  }>;
};

export type NoviceVisualPresentationInput = {
  schemaVersion: "solo-novice-visual-presentation-input.v1";
  sourceBlindReviewId: string;
  sourceVisualEvidenceHash: string;
  items: Array<{
    blindItemId: string;
    image: {
      imageUrl: string | null;
      sourceType: "direct_observation";
      capturedAt: string;
      missingReason: string | null;
      localAsset: {
        status: "available" | "not_cached";
        relativePath: string | null;
        contentSha256: string | null;
        bytes: number | null;
        missingReason: string | null;
      };
    };
    chinesePresentation: {
      productTypeZh: string;
      primaryUseZh: string;
      sourceType: "ai_generated";
      status: "presentation_aid_not_source_fact";
      basedOnFields: Array<"title">;
    };
  }>;
};

const NOVICE_QUESTIONS = [
  "我是否看懂这个商品是什么？",
  "只看当前证据，我是否认为信息足够继续判断？",
  "我是否看到了明确需要进一步核实的问题？",
  "我是否愿意再花 10 分钟调查这个商品？",
  "我对以上判断的信心如何？",
  "完成本条判断实际用了多少秒？",
] as const;

export function buildNoviceBlindReviewPacket(blindReview: BlindReviewMaterialInput) {
  const body = {
    schemaVersion: "solo-novice-blind-review-packet.v1" as const,
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceEvidenceHash: stableHash(blindReview),
    purpose: "验证证据是否易懂、是否帮助决定下一步调查，以及完成判断所需时间。",
    boundary: {
      validates: ["evidence_comprehensibility", "investigation_willingness", "review_elapsed_time"],
      doesNotValidate: ["expert_operational_judgment", "profitability", "legal_or_ip_clearance", "product_value"],
    },
    questions: NOVICE_QUESTIONS,
    allowedAnswers: {
      ternary: ["yes", "no", "uncertain"],
      confidence: ["high", "medium", "low"],
    },
    reviewState: "pending_user_input" as const,
    items: blindReview.items.map((item) => ({
      blindItemId: item.blindItemId,
      title: item.title,
      sourceUrl: item.sourceUrl,
      capturedAt: item.capturedAt,
      evidence: {
        price: item.evidence.price,
        rating: item.evidence.rating,
        reviewCount: item.evidence.reviewCount,
        missingEvidence: [...item.evidence.missingEvidence],
      },
      response: {
        productUnderstood: null,
        evidenceSufficient: null,
        obviousConcern: null,
        investigateNext10Minutes: null,
        confidence: null,
        elapsedSeconds: null,
        note: null,
      },
    })),
  };
  return { ...body, packetHash: stableHash(body) };
}

function validateVisualPresentation(
  blindReview: BlindReviewMaterialInput,
  presentation: NoviceVisualPresentationInput,
) {
  if (presentation.schemaVersion !== "solo-novice-visual-presentation-input.v1"
    || presentation.sourceBlindReviewId !== blindReview.blindReviewId
    || presentation.sourceVisualEvidenceHash.length === 0) {
    throw new Error("VISUAL_PRESENTATION_SOURCE_MISMATCH");
  }
  const expectedIds = blindReview.items.map((item) => item.blindItemId);
  const actualIds = presentation.items.map((item) => item.blindItemId);
  const uniqueIds = new Set(actualIds);
  if (expectedIds.length !== actualIds.length
    || uniqueIds.size !== actualIds.length
    || expectedIds.some((id) => !uniqueIds.has(id))) {
    throw new Error("VISUAL_PRESENTATION_ITEM_MISMATCH");
  }
  for (const item of presentation.items) {
    const local = item.image.localAsset;
    const localAvailable = local.status === "available";
    if (item.chinesePresentation.sourceType !== "ai_generated"
      || item.chinesePresentation.status !== "presentation_aid_not_source_fact"
      || item.chinesePresentation.productTypeZh.trim().length === 0
      || item.chinesePresentation.primaryUseZh.trim().length === 0
      || item.chinesePresentation.basedOnFields.length !== 1
      || item.chinesePresentation.basedOnFields[0] !== "title"
      || item.image.sourceType !== "direct_observation"
      || (item.image.imageUrl === null) !== (item.image.missingReason !== null)
      || (localAvailable && (local.relativePath === null
        || local.contentSha256 === null
        || !/^[a-f\d]{64}$/i.test(local.contentSha256)
        || local.bytes === null
        || local.bytes <= 0
        || local.missingReason !== null))
      || (!localAvailable && (local.relativePath !== null
        || local.contentSha256 !== null
        || local.bytes !== null
        || local.missingReason === null))) {
      throw new Error("VISUAL_PRESENTATION_ITEM_INVALID");
    }
  }
}

export function buildNoviceVisualBlindReviewPacket(
  blindReview: BlindReviewMaterialInput,
  presentation: NoviceVisualPresentationInput,
) {
  validateVisualPresentation(blindReview, presentation);
  const presentationById = new Map(presentation.items.map((item) => [item.blindItemId, item]));
  const localImageAvailableCount = presentation.items.filter((item) => item.image.localAsset.status === "available").length;
  const totalItemCount = blindReview.items.length;
  const body = {
    schemaVersion: "solo-novice-visual-blind-review-packet.v2" as const,
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceEvidenceHash: stableHash(blindReview),
    sourceVisualEvidenceHash: presentation.sourceVisualEvidenceHash,
    purpose: "用商品图和中文用途说明帮助非专业用户理解商品，再评价是否值得继续调查。",
    boundary: {
      validates: ["visual_comprehensibility", "evidence_comprehensibility", "investigation_willingness"],
      doesNotValidate: ["expert_operational_judgment", "profitability", "durability", "legal_or_ip_clearance", "product_value"],
      chinesePresentationIsSourceFact: false,
    },
    questions: NOVICE_QUESTIONS,
    allowedAnswers: {
      ternary: ["yes", "no", "uncertain"],
      confidence: ["high", "medium", "low"],
    },
    reviewState: "pending_user_input" as const,
    visualSummary: {
      totalItemCount,
      localImageAvailableCount,
      localImageCompleteness: totalItemCount === 0 ? null : localImageAvailableCount / totalItemCount,
      reviewReadiness: localImageAvailableCount === totalItemCount
        ? "ready"
        : "incomplete_visual_evidence",
    },
    items: blindReview.items.map((item) => {
      const visual = presentationById.get(item.blindItemId)!;
      return {
        blindItemId: item.blindItemId,
        title: item.title,
        sourceUrl: item.sourceUrl,
        capturedAt: item.capturedAt,
        image: structuredClone(visual.image),
        chinesePresentation: structuredClone(visual.chinesePresentation),
        evidence: {
          price: item.evidence.price,
          rating: item.evidence.rating,
          reviewCount: item.evidence.reviewCount,
          missingEvidence: [...item.evidence.missingEvidence],
        },
        response: {
          productUnderstood: null,
          evidenceSufficient: null,
          obviousConcern: null,
          investigateNext10Minutes: null,
          confidence: null,
          elapsedSeconds: null,
          note: null,
        },
      };
    }),
  };
  return { ...body, packetHash: stableHash(body) };
}

type CalibrationGroup = "high" | "medium" | "low" | "insufficient_evidence";

function calibrationGroup(result: Stage1Result): CalibrationGroup | null {
  if (result.promotionDecision === "insufficient_evidence" || result.recommendationTier === "not_ranked") {
    return "insufficient_evidence";
  }
  if (result.recommendationTier === "high") return "high";
  if (result.recommendationTier === "medium") return "medium";
  if (result.recommendationTier === "low") return "low";
  return null;
}

function sortForSelection(left: Stage1Result, right: Stage1Result) {
  if (left.rank === null && right.rank !== null) return 1;
  if (left.rank !== null && right.rank === null) return -1;
  return (left.rank ?? 0) - (right.rank ?? 0) || left.candidateId.localeCompare(right.candidateId);
}

export function buildSoloStage2CalibrationPacket(
  ranking: RankingRun,
  blindReview: BlindReviewMaterialInput,
) {
  const blindByCandidate = new Map(blindReview.items.map((item) => [item.candidateId, item]));
  if (blindByCandidate.size !== ranking.results.length
    || ranking.results.some((item) => !blindByCandidate.has(item.candidateId))) {
    throw new Error("BLIND_REVIEW_CANDIDATE_MISMATCH");
  }

  const groups: Record<CalibrationGroup, Stage1Result[]> = {
    high: [],
    medium: [],
    low: [],
    insufficient_evidence: [],
  };
  for (const result of ranking.results) {
    const group = calibrationGroup(result);
    if (group !== null) groups[group].push(result);
  }

  const selected = (Object.keys(groups) as CalibrationGroup[]).flatMap((group) =>
    groups[group].sort(sortForSelection).slice(0, 2).map((result, index) => ({ group, result, index })),
  );
  const samples = selected.map(({ group, result, index }) => {
    const blind = blindByCandidate.get(result.candidateId)!;
    const evidenceInputs = {
      supplierUrl: null,
      supplierCapturedAt: null,
      moq: null,
      bom: null,
      firstMile: null,
      platformCommission: null,
      fba: null,
      packaging: null,
      storage: null,
      returnReserve: null,
      packageLengthCm: null,
      packageWidthCm: null,
      packageHeightCm: null,
      packageWeightKg: null,
      logisticsEvidenceUrl: null,
      complianceEvidenceUrl: null,
      executionRiskNotes: null,
      humanContinueDecision: null,
      humanDecisionReason: null,
    };
    const calibration = calibrateStage2({
      candidateId: result.candidateId,
      currency: "USD",
      salePrice: blind.evidence.price,
      bom: evidenceInputs.bom,
      firstMile: evidenceInputs.firstMile,
      platformCommission: evidenceInputs.platformCommission,
      fba: evidenceInputs.fba,
      packaging: evidenceInputs.packaging,
      storage: evidenceInputs.storage,
      returnReserve: evidenceInputs.returnReserve,
    });
    return {
      sampleId: `stage2-${group.replaceAll("_", "-")}-${String(index + 1).padStart(2, "0")}`,
      calibrationGroup: group,
      candidateId: result.candidateId,
      productKey: result.productKey,
      systemContext: {
        rank: result.rank,
        promotionDecision: result.promotionDecision,
        recommendationTier: result.recommendationTier,
        confidence: result.confidence,
      },
      sourceEvidence: {
        title: blind.title,
        sourceUrl: blind.sourceUrl,
        capturedAt: blind.capturedAt,
        salePrice: blind.evidence.price,
        currency: "USD" as const,
        rating: blind.evidence.rating,
        reviewCount: blind.evidence.reviewCount,
        missingEvidence: [...blind.evidence.missingEvidence],
      },
      evidenceInputs,
      calibration,
    };
  });

  const selectionCounts = samples.reduce<Record<CalibrationGroup, number>>((counts, sample) => {
    counts[sample.calibrationGroup] += 1;
    return counts;
  }, { high: 0, medium: 0, low: 0, insufficient_evidence: 0 });
  const body = {
    schemaVersion: "solo-stage2-objective-calibration-packet.v1" as const,
    status: "pending_evidence" as const,
    revealBoundary: "open_only_after_novice_blind_review_is_locked",
    selectionMethod: "deterministic_stratified_v1" as const,
    sourceRankingRunId: ranking.rankingRunId,
    sourceRankingInputHash: ranking.inputHash,
    sourceBlindReviewId: blindReview.blindReviewId,
    selectionCounts,
    requiredEvidenceBoundary: {
      supplierAndCostValuesRequireSource: true,
      complianceRequiresHumanVerification: true,
      missingCommercialInputsResult: "profit_insufficient_evidence",
      stage1RankingMayNotBeRewritten: true,
    },
    samples,
  };
  return { ...body, packetHash: stableHash(body) };
}

export type SoloStage2CalibrationPacket = ReturnType<typeof buildSoloStage2CalibrationPacket>;

const STAGE2_EVIDENCE_REQUIREMENTS = [
  { field: "supplierUrl", category: "supplier_identity_and_cost", whyNeededZh: "确认供应商和报价对应同一商品变体。", acceptableEvidenceZh: "可公开核验的供应商商品页 URL。" },
  { field: "supplierCapturedAt", category: "supplier_identity_and_cost", whyNeededZh: "证明供应商页面证据的时间有效性。", acceptableEvidenceZh: "供应商页面的实际采集时间。" },
  { field: "moq", category: "supplier_identity_and_cost", whyNeededZh: "判断最低起订量是否超过当前资金能力。", acceptableEvidenceZh: "与目标变体对应的供应商 MOQ。" },
  { field: "bom", category: "supplier_identity_and_cost", whyNeededZh: "计算广告前单件贡献利润。", acceptableEvidenceZh: "与目标变体和 MOQ 对应的单件采购成本。" },
  { field: "packageLengthCm", category: "package_and_logistics", whyNeededZh: "确定计费体积和物流边界。", acceptableEvidenceZh: "目标包装的外箱长度。" },
  { field: "packageWidthCm", category: "package_and_logistics", whyNeededZh: "确定计费体积和物流边界。", acceptableEvidenceZh: "目标包装的外箱宽度。" },
  { field: "packageHeightCm", category: "package_and_logistics", whyNeededZh: "确定计费体积和物流边界。", acceptableEvidenceZh: "目标包装的外箱高度。" },
  { field: "packageWeightKg", category: "package_and_logistics", whyNeededZh: "确定头程和履约计费重量。", acceptableEvidenceZh: "目标包装的实际毛重。" },
  { field: "firstMile", category: "package_and_logistics", whyNeededZh: "计算商品进入目标市场前的单件物流成本。", acceptableEvidenceZh: "与包装尺寸、重量和运输方案匹配的单件头程成本。" },
  { field: "logisticsEvidenceUrl", category: "package_and_logistics", whyNeededZh: "让物流费用和边界可追溯。", acceptableEvidenceZh: "承运商报价、物流计算结果或可复核来源 URL。" },
  { field: "platformCommission", category: "platform_costs_and_reserves", whyNeededZh: "计算 Amazon 平台佣金。", acceptableEvidenceZh: "适用类目的官方费率或可复核费用结果。" },
  { field: "fba", category: "platform_costs_and_reserves", whyNeededZh: "计算目标包装对应的履约费用。", acceptableEvidenceZh: "与尺寸重量匹配的 FBA 单件费用。" },
  { field: "packaging", category: "platform_costs_and_reserves", whyNeededZh: "计算单件包装材料和处理成本。", acceptableEvidenceZh: "目标包装方案的单件成本。" },
  { field: "storage", category: "platform_costs_and_reserves", whyNeededZh: "预留合理的单件仓储成本。", acceptableEvidenceZh: "基于体积和周转假设的可复核仓储费用。" },
  { field: "returnReserve", category: "platform_costs_and_reserves", whyNeededZh: "避免把退货损失错误当成利润。", acceptableEvidenceZh: "有来源或明确假设边界的单件退货准备金。" },
  { field: "complianceEvidenceUrl", category: "compliance_and_execution", whyNeededZh: "核实监管、认证和知识产权待办。", acceptableEvidenceZh: "官方规则、专业检索或人工核实来源 URL。" },
  { field: "executionRiskNotes", category: "compliance_and_execution", whyNeededZh: "记录安装、质量、耐用性和执行风险的已核实结果。", acceptableEvidenceZh: "带来源边界的人工核实备注；未知必须明确写未知。" },
] as const;

const PROFIT_INPUT_FIELDS = [
  "bom", "firstMile", "platformCommission", "fba", "packaging", "storage", "returnReserve",
] as const;

export function buildStage2EvidenceGapInventory(source: SoloStage2CalibrationPacket) {
  const { packetHash: sourcePacketHash, ...sourceBody } = source;
  if (source.schemaVersion !== "solo-stage2-objective-calibration-packet.v1"
    || source.status !== "pending_evidence"
    || stableHash(sourceBody) !== sourcePacketHash) {
    throw new Error("STAGE2_GAP_SOURCE_PACKET_INVALID");
  }
  const sampleIds = source.samples.map((sample) => sample.sampleId);
  if (new Set(sampleIds).size !== sampleIds.length) {
    throw new Error("STAGE2_GAP_SOURCE_SAMPLE_MISMATCH");
  }

  const samples = source.samples.map((sample) => {
    const expectedProfitMissingInputs = [
      ...(sample.sourceEvidence.salePrice === null ? ["salePrice"] : []),
      ...PROFIT_INPUT_FIELDS.filter((field) => sample.evidenceInputs[field] === null),
    ].sort();
    const recordedProfitMissingInputs = [...sample.calibration.missingInputs].sort();
    if (sample.calibration.status !== "profit_insufficient_evidence"
      || expectedProfitMissingInputs.length !== recordedProfitMissingInputs.length
      || expectedProfitMissingInputs.some((field, index) => field !== recordedProfitMissingInputs[index])) {
      throw new Error("STAGE2_GAP_SOURCE_CALIBRATION_MISMATCH");
    }
    const evidenceGaps = STAGE2_EVIDENCE_REQUIREMENTS
      .filter(({ field }) => sample.evidenceInputs[field] === null)
      .map((requirement) => ({
        ...requirement,
        status: "missing" as const,
        currentValue: null,
        sourceRequired: true,
        doNotInferFrom: ["amazon_search_price", "rating", "review_count", "ai_generated_text"],
      }));
    const pendingHumanDecision = {
      humanContinueDecision: {
        status: sample.evidenceInputs.humanContinueDecision === null ? "pending_user_input" as const : "recorded" as const,
        currentValue: sample.evidenceInputs.humanContinueDecision,
      },
      humanDecisionReason: {
        status: sample.evidenceInputs.humanDecisionReason === null ? "pending_user_input" as const : "recorded" as const,
        currentValue: sample.evidenceInputs.humanDecisionReason,
      },
    };
    return {
      sampleId: sample.sampleId,
      calibrationGroup: sample.calibrationGroup,
      productKey: sample.productKey,
      sourceEvidence: structuredClone(sample.sourceEvidence),
      currentProfitStatus: sample.calibration.status,
      evidenceGaps,
      pendingHumanDecision,
      gates: {
        readyForProfitCalculation: false,
        readyForHumanDecision: evidenceGaps.length === 0 && recordedProfitMissingInputs.length === 0,
        blockingReasonCodes: ["profit_insufficient_evidence", ...sample.calibration.missingInputs.map((field) => `missing_${field}`)],
      },
    };
  });
  const summary = {
    sampleCount: samples.length,
    samplesBlockedForProfit: samples.filter((sample) => !sample.gates.readyForProfitCalculation).length,
    missingEvidenceFieldCount: samples.reduce((count, sample) => count + sample.evidenceGaps.length, 0),
    pendingHumanDecisionFieldCount: samples.reduce((count, sample) => count
      + (sample.pendingHumanDecision.humanContinueDecision.status === "pending_user_input" ? 1 : 0)
      + (sample.pendingHumanDecision.humanDecisionReason.status === "pending_user_input" ? 1 : 0), 0),
    readyForProfitCalculationCount: samples.filter((sample) => sample.gates.readyForProfitCalculation).length,
  };
  const body = {
    schemaVersion: "solo-stage2-evidence-gap-inventory.v1" as const,
    status: samples.every((sample) => sample.gates.readyForHumanDecision)
      ? "ready_for_human_decision" as const
      : "evidence_collection_required" as const,
    sourcePacketHash,
    sourceRankingRunId: source.sourceRankingRunId,
    sourceBlindReviewId: source.sourceBlindReviewId,
    boundary: {
      stage1RankingMayNotBeRewritten: true,
      missingValuesMayNotBeEstimated: true,
      supplierAndCostValuesRequireSource: true,
      complianceRequiresHumanVerification: true,
      thisInventoryIsNotCommercialValidation: true,
    },
    summary,
    samples,
  };
  return { ...body, packetHash: stableHash(body) };
}
