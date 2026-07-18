import { stableHash } from "../../lib/upstream/pipeline";
import type { ShadowEvidenceValue } from "./stage15-shadow-calibration";
import type { Stage15ShadowBatch } from "./stage15-shadow-batch";

type PresentationInput = {
  titleZh: string;
  purposeZh: string;
  image: { status: "available" | "not_cached"; dataUrl: string | null; missingReason: string | null };
  price: unknown;
  dimensions: unknown;
  material: unknown;
};

type PublicEvidence<T> = {
  value: T | null;
  status: ShadowEvidenceValue<T>["status"];
  capturedAt: string | null;
  exactVariant: boolean | null;
  missingReason: string | null;
};

export type Stage15ShadowBlindEvaluationItem = {
  evaluationItemId: string;
  titleZh: string;
  purposeZh: string;
  presentationLabel: "presentation_aid_not_source_fact";
  image: PresentationInput["image"];
  price: unknown;
  dimensions: unknown;
  material: unknown;
  marketValidation: {
    monthlyBought: PublicEvidence<number>;
    categoryRank: PublicEvidence<{ rank: number; category: string }>;
    rating: PublicEvidence<number>;
    reviewCount: PublicEvidence<number>;
  };
  listingMaturity: {
    firstAvailableAt: PublicEvidence<string>;
    ageDays: PublicEvidence<number>;
  };
  buyerReviews: {
    positive: PublicEvidence<string[]>;
    negative: PublicEvidence<string[]>;
    sampleCount: PublicEvidence<number>;
  };
};

export type Stage15ShadowBlindEvaluationPacket = {
  schemaVersion: "stage15-shadow-blind-evaluation-packet.v1";
  packetVersion: string;
  itemCount: 20;
  createdAt: string;
  items: Stage15ShadowBlindEvaluationItem[];
  packetHash: string;
};

export type Stage15ShadowBlindEvaluationAnswer = {
  evaluationItemId: string;
  worthFurtherInvestigation: "yes" | "no" | "insufficient_evidence";
  evidenceSufficient: "yes" | "no";
  dominantSignals: Array<"market_validation" | "listing_maturity" | "buyer_reviews" | "product_fit" | "risk" | "other">;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type Stage15ShadowBlindEvaluationResult = {
  schemaVersion: "stage15-shadow-blind-evaluation-result.v1";
  packetHash: string;
  completedAt: string;
  answers: Stage15ShadowBlindEvaluationAnswer[];
  resultHash: string;
};

function publicEvidence<T>(value: ShadowEvidenceValue<T>): PublicEvidence<T> {
  return {
    value: value.value,
    status: value.status,
    capturedAt: value.capturedAt,
    exactVariant: value.exactVariant,
    missingReason: value.missingReason,
  };
}

const PUBLIC_FORBIDDEN = /amazon:US:|\bB0[A-Z0-9]{8}\b|https?:\/\/|productKey|candidateId|totalScore|componentScores|promotionDecision|recommendationTier|\badvance\b|\bwatch\b|\bStage\s+1\b/iu;

export function buildStage15ShadowBlindEvaluation(input: {
  batch: Stage15ShadowBatch;
  packetVersion: "stage15-shadow-blind-evaluation-packet.v1";
  presentationByProductKey: Record<string, PresentationInput>;
  createdAt: string;
}) {
  if (input.batch.productKeys.length !== 20 || Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error("SHADOW_BLIND_PACKET_INPUT_INVALID");
  }
  const observations = new Map(input.batch.observations.map((value) => [value.productKey, value]));
  const ordered = [...input.batch.productKeys].sort((left, right) =>
    stableHash(`${input.batch.batchId}|${input.packetVersion}|${left}`)
      .localeCompare(stableHash(`${input.batch.batchId}|${input.packetVersion}|${right}`)));
  const bindings: Array<{ evaluationItemId: string; productKey: string; observationHash: string }> = [];
  const items = ordered.map((productKey, index): Stage15ShadowBlindEvaluationItem => {
    const observation = observations.get(productKey);
    const presentation = input.presentationByProductKey[productKey];
    if (!observation || !presentation || !presentation.titleZh.trim() || !presentation.purposeZh.trim()) {
      throw new Error("SHADOW_BLIND_PRESENTATION_MISSING");
    }
    const evaluationItemId = `${input.batch.role === "calibration" ? "C" : "V"}-${String(index + 1).padStart(2, "0")}`;
    bindings.push({ evaluationItemId, productKey, observationHash: observation.observationHash });
    return {
      evaluationItemId,
      titleZh: presentation.titleZh,
      purposeZh: presentation.purposeZh,
      presentationLabel: "presentation_aid_not_source_fact",
      image: presentation.image,
      price: presentation.price,
      dimensions: presentation.dimensions,
      material: presentation.material,
      marketValidation: {
        monthlyBought: publicEvidence(observation.marketValidation.monthlyBought),
        categoryRank: publicEvidence(observation.marketValidation.categoryRank),
        rating: publicEvidence(observation.marketValidation.rating),
        reviewCount: publicEvidence(observation.marketValidation.reviewCount),
      },
      listingMaturity: {
        firstAvailableAt: publicEvidence(observation.listingMaturity.firstAvailableAt),
        ageDays: publicEvidence(observation.listingMaturity.ageDays),
      },
      buyerReviews: {
        positive: publicEvidence(observation.buyerReviews.positive),
        negative: publicEvidence(observation.buyerReviews.negative),
        sampleCount: publicEvidence(observation.buyerReviews.sampleCount),
      },
    };
  });
  const body = {
    schemaVersion: "stage15-shadow-blind-evaluation-packet.v1" as const,
    packetVersion: input.packetVersion,
    itemCount: 20 as const,
    createdAt: input.createdAt,
    items,
  };
  if (PUBLIC_FORBIDDEN.test(JSON.stringify(body))) throw new Error("SHADOW_BLIND_PACKET_LEAK_DETECTED");
  const packet: Stage15ShadowBlindEvaluationPacket = { ...body, packetHash: stableHash(body) };
  return {
    packet,
    bindings,
    resultTemplate: {
      schemaVersion: "stage15-shadow-blind-evaluation-result.v1",
      packetHash: packet.packetHash,
      completedAt: null,
      answers: items.map((item) => ({
        evaluationItemId: item.evaluationItemId,
        worthFurtherInvestigation: null,
        evidenceSufficient: null,
        dominantSignals: [],
        confidence: null,
        reason: "",
      })),
    },
  };
}

export function validateStage15ShadowBlindEvaluationResult(
  value: unknown,
  packet: Stage15ShadowBlindEvaluationPacket,
): Stage15ShadowBlindEvaluationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("SHADOW_BLIND_RESULT_INVALID");
  const result = value as Record<string, unknown>;
  if (result.schemaVersion !== "stage15-shadow-blind-evaluation-result.v1"
    || result.packetHash !== packet.packetHash || typeof result.completedAt !== "string"
    || Number.isNaN(Date.parse(result.completedAt)) || !Array.isArray(result.answers)
    || result.answers.length !== 20) throw new Error("SHADOW_BLIND_RESULT_INVALID");
  const expectedIds = new Set(packet.items.map((item) => item.evaluationItemId));
  const allowedDecisions = new Set(["yes", "no", "insufficient_evidence"]);
  const allowedSufficiency = new Set(["yes", "no"]);
  const allowedSignals = new Set(["market_validation", "listing_maturity", "buyer_reviews", "product_fit", "risk", "other"]);
  const allowedConfidence = new Set(["high", "medium", "low"]);
  const answers = result.answers.map((raw): Stage15ShadowBlindEvaluationAnswer => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("SHADOW_BLIND_ANSWER_INVALID");
    const answer = raw as Record<string, unknown>;
    if (typeof answer.evaluationItemId !== "string" || !expectedIds.has(answer.evaluationItemId)
      || !allowedDecisions.has(String(answer.worthFurtherInvestigation))
      || !allowedSufficiency.has(String(answer.evidenceSufficient))
      || !Array.isArray(answer.dominantSignals) || answer.dominantSignals.length === 0
      || !answer.dominantSignals.every((signal) => allowedSignals.has(String(signal)))
      || !allowedConfidence.has(String(answer.confidence))
      || typeof answer.reason !== "string" || !answer.reason.trim()) throw new Error("SHADOW_BLIND_ANSWER_INVALID");
    return answer as Stage15ShadowBlindEvaluationAnswer;
  });
  if (new Set(answers.map((answer) => answer.evaluationItemId)).size !== 20) throw new Error("SHADOW_BLIND_ANSWER_IDENTITY_INVALID");
  const body = {
    schemaVersion: "stage15-shadow-blind-evaluation-result.v1" as const,
    packetHash: packet.packetHash,
    completedAt: result.completedAt as string,
    answers,
  };
  return { ...body, resultHash: stableHash(body) };
}

export function buildStage15ShadowBlindEvaluationReadme(): string {
  return `# 影子校准盲化评价说明

逐项判断它是否值得继续调查；这不是“值得销售”或“能赚钱”的结论。

- 选择：值得继续调查／不值得继续调查／证据不足。
- 图片、中文名称和用途只是展示辅助，不是来源事实。
- 价格、评分、评论数等缺失时按缺失处理，不要猜测。
- 理由请保留你的原话，并说明主导信号与信心。
`;
}
