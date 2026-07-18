import { describe, expect, it } from "vitest";

import { buildStage15SourceNativeEvaluationMaterials } from "./stage15-source-native-evaluation";
import { generateStage15SourceNativeWorkbenches } from "./generate-stage15-source-native-workbenches";

// The source-native evaluation test exports its fixture through the material builder's real Task5 batch input.
// This focused renderer test uses a material-shaped object to keep its boundary purely local and network-free.
function materials() {
  const card = { evaluationItemId: "operator-eval-1", title: "Desk organiser", price: 20, currency: "USD", rating: 4.5, reviewCount: 8, missingReasons: ["not_captured"], capturedAt: "2026-07-17T12:00:00.000Z", imageAssetRefs: ["asset:placeholder"] };
  const packet = { schemaVersion: "stage15-source-native-operator-packet.v1", batchId: "b", cards: Array.from({ length: 20 }, (_, index) => ({ ...card, evaluationItemId: `operator-eval-${index + 1}` })), packetHash: "a".repeat(64) };
  const outcomePacket = { schemaVersion: "stage15-source-native-outcome-packet.v1", batchId: "b", frozenAt: "2026-07-17T12:00:00.000Z", cards: Array.from({ length: 20 }, (_, index) => ({ ...card, evaluationItemId: `outcome-eval-${index + 1}`, display: { brand: "Brand", model: "Model", variant: "Variant" }, specifications: { dimensions: "10 x 8 cm", weight: "240 g", materials: ["alloy"], features: ["modular"] }, reviewSignals: [{ sentiment: "positive", rating: 5, reviewedAt: "2026-07-01", signal: "durable signal", evidenceRef: "evidence:1" }], qualitySignals: [{ sentiment: "positive", signal: "durable quality" }] })), packetHash: "b".repeat(64) };
  const operatorAnswers = packet.cards.map((item) => ({ evaluationItemId: item.evaluationItemId, productUnderstood: null, evidenceSufficient: null, obviousConcern: null, investigateNext10Minutes: null, confidence: null, elapsedSeconds: null, note: "" }));
  const outcomeAnswers = outcomePacket.cards.map((item) => ({ evaluationItemId: item.evaluationItemId, productUnderstood: null, evidenceSufficient: null, worthFurtherInvestigation: null, dominantSignals: [], confidence: null, elapsedSeconds: null, reason: "" }));
  return { operator: { packet, template: { role: "screening_operator", slot: "screening_operator", sourcePacketHash: packet.packetHash, packetHash: packet.packetHash, status: "pending", answers: operatorAnswers } }, outcome: { packet: outcomePacket, assessorA: { template: { role: "outcome_assessor_a", slot: "outcome_assessor_a", sourcePacketHash: outcomePacket.packetHash, packetHash: outcomePacket.packetHash, status: "pending", roleIndependenceAttested: null, answers: outcomeAnswers } }, assessorB: { template: { role: "outcome_assessor_b", slot: "outcome_assessor_b", sourcePacketHash: outcomePacket.packetHash, packetHash: outcomePacket.packetHash, status: "pending", roleIndependenceAttested: null, answers: outcomeAnswers } } } } as unknown as ReturnType<typeof buildStage15SourceNativeEvaluationMaterials>;
}

describe("source-native local evaluation workbenches", () => {
  it("returns three blank local-only role/hash-separated HTML workbenches without bindings, URLs, or forbidden cross-role content", () => {
    const rendered = generateStage15SourceNativeWorkbenches(materials());
    expect(rendered.operator.html).toContain("localStorage");
    expect(rendered.operator.html).toContain("screening_operator:" + "a".repeat(64));
    expect(rendered.assessorA.html).toContain("outcome_assessor_a:" + "b".repeat(64));
    expect(rendered.assessorB.html).toContain("outcome_assessor_b:" + "b".repeat(64));
    expect(new Set([rendered.operator.storageKey, rendered.assessorA.storageKey, rendered.assessorB.storageKey]).size).toBe(3);
    expect(rendered.operator.html).not.toMatch(/bindings|sourceUrl|specifications|reviewSignals|qualitySignals|rankingRunId/iu);
    expect(rendered.assessorA.html).not.toMatch(/rankingRunId|totalScore|componentScores|promotionDecision|recommendationTier|\badvance\b|\bwatch\b|\breject\b/iu);
    expect(rendered.operator.html).toContain("answers:collect()");
    expect(rendered.operator.html).not.toContain("dominantSignals");
    expect(rendered.assessorA.html).toContain("answers.length!==20");
    expect(rendered.assessorA.html).toContain("result.resultHash=await digest(result)");
    expect(rendered.operator.html).not.toContain("addEventListener('input',save)");
    expect(rendered.assessorA.html).toContain('value="true"');
    expect(rendered.assessorA.html).not.toContain('value="false"');
    expect(rendered.operator.html).not.toMatch(/https?:\/\//iu);
    const assessorVisibleDom = rendered.assessorA.html.split("<script>")[0];
    expect(assessorVisibleDom).toContain("Brand");
    expect(assessorVisibleDom).toContain("10 x 8 cm");
    expect(assessorVisibleDom).toContain("durable signal");
    expect(rendered.operator.html.split("<script>")[0]).not.toContain("Brand");
  });
});
