import type { Stage15ScreeningPreviewItem } from "@/lib/stage15ScreeningPreview";

export type Stage15NoviceGuidance = {
  sourceType: "derived_presentation";
  doesNotChangeDecision: true;
  whyThisStatus: string;
  confirmedFacts: string[];
  unknownFacts: string[];
  nextAction: string;
  stopCondition: string;
};

function whyThisStatus(item: Stage15ScreeningPreviewItem): string {
  if (item.status === "advance") {
    return "它进入短名单有三个原因：1. 市场资料达到最低要求；2. 你之前明确表示理解商品并愿意继续调查；3. 在这些可继续调查的商品里，它按现有 Stage 1 排名获得本批最多 5 个调查名额之一。页面评分和评论数量只是参考；评论数量不是销量，也不代表质量，不能证明利润或值得采购。";
  }
  if (item.status === "watch") {
    const allGatesPassed = Object.values(item.gates).every(Boolean);
    return allGatesPassed
      ? "三项门禁均已通过，但没有获得本批最多 5 个调查名额，因此保留观察；这不是质量或商业否定。"
      : "市场层证据可继续阅读，但至少一项人工门禁不是明确的“是”，因此保留观察，不进入优先调查名额。";
  }
  if (item.status === "reject") {
    return "Stage 1 已将它标记为本批不继续；新证据不会自动恢复它，只有人工复核后才能另行决定。";
  }
  return "市场证据不足，当前不能正常比较或进入调查名额；缺失不等于数值为 0，也不等于商品一定不好。";
}

function productSpecificUnknown(item: Stage15ScreeningPreviewItem): string {
  const productText = `${item.productTypeZh} ${item.title ?? ""}`;
  if (/悬挂|挂式|hanging/i.test(productText)) {
    return "尚未验证实际尺寸、衣柜适配方式，以及承重、长期变形或耐用情况。";
  }
  if (/收纳袋|收纳箱|收纳篮|storage bag|storage bin|basket/i.test(productText)) {
    return "尚未验证实际尺寸或容量、材质，以及拉链、提手或叠放结构的耐用情况。";
  }
  return "尚未验证实际尺寸、材质和关键结构的耐用情况。";
}

function nextAction(item: Stage15ScreeningPreviewItem): string {
  const productText = `${item.productTypeZh} ${item.title ?? ""}`;
  if (/悬挂|挂式|hanging/i.test(productText)) {
    return "先找到并记录这款商品的实际尺寸、衣柜适配方式，以及承重或长期变形证据；找不到就保持未确认。";
  }
  if (/收纳袋|收纳箱|收纳篮|storage bag|storage bin|basket/i.test(productText)) {
    return "先找到并记录这款商品的实际尺寸或容量、材质，以及拉链、提手或叠放结构的耐用证据；找不到就保持未确认。";
  }
  return "先找到并记录这款商品的实际尺寸、材质和关键结构证据；找不到就保持未确认。";
}

function stopCondition(item: Stage15ScreeningPreviewItem): string {
  if (item.status === "reject") {
    return "没有可靠的新证据足以支持人工复核时，保持本批不继续。";
  }
  if (item.status === "insufficient") {
    return "最低市场证据没有补齐前停止比较；补不到就保持市场证据不足。";
  }
  return "Stage 1.5 什么时候停止：如果实际尺寸、能否装进目标衣柜、承重或耐用情况查不清，或者查清后明显不适合目标场景，就不要再花时间调查它。价格、评分或评论数量不能替代这些检查；评论反复出现同一缺陷可以作为反向证据，但评论数量本身不是销量或质量证明。Stage 2 以后再判断供应商、平台费用、运费、利润和合规，本页不作这些结论。";
}

export function buildStage15NoviceGuidance(
  item: Stage15ScreeningPreviewItem,
): Stage15NoviceGuidance {
  const confirmedFacts: string[] = [];
  const unknownFacts: string[] = [];

  if (item.evidence.price === null) unknownFacts.push("页面价格尚未获得。");
  else confirmedFacts.push(`页面记录价格：${item.evidence.price} USD。`);

  if (item.evidence.rating === null) unknownFacts.push("页面评分尚未获得。");
  else confirmedFacts.push(`页面记录评分：${item.evidence.rating}。`);

  if (item.evidence.reviewCount === null) unknownFacts.push("页面评论数尚未获得。");
  else confirmedFacts.push(`页面记录评论数：${item.evidence.reviewCount}。`);

  confirmedFacts.push(
    `市场证据门禁：${item.gates.screeningEvidenceSufficient ? "通过" : "未通过"}；理解商品：${item.gates.userUnderstandsProduct ? "是" : "否"}；愿意继续调查：${item.gates.willingToContinueResearch ? "是" : "否"}。`,
  );
  confirmedFacts.push(...item.reasons.supportingEvidence.map((value) => `现有支持证据：${value}`));

  if (item.reasons.counterEvidence.length === 0) {
    unknownFacts.push("当前证据包没有记录反向证据；这不等于没有风险。");
  } else {
    confirmedFacts.push(...item.reasons.counterEvidence.map((value) => `现有反向证据：${value}`));
  }
  unknownFacts.push(...item.reasons.missingEvidence.map((value) => `尚未确认：${value}`));
  unknownFacts.push(productSpecificUnknown(item));
  unknownFacts.push("供应商、平台费用、物流、利润和合规尚未做专业商业验证。");

  return {
    sourceType: "derived_presentation",
    doesNotChangeDecision: true,
    whyThisStatus: whyThisStatus(item),
    confirmedFacts,
    unknownFacts,
    nextAction: nextAction(item),
    stopCondition: stopCondition(item),
  };
}
