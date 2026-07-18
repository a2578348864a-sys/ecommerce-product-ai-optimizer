import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage15ShadowBlindEvaluationPacket } from "./stage15-shadow-blind-evaluation";
import {
  buildStage15ShadowEvaluationProjections,
  validateStage15ShadowCombinedHumanEvaluationResult,
} from "./stage15-shadow-combined-human-evaluation";

function packet() {
  const body = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-packet.v1" as const,
    batchLabel: "Batch C",
    status: "pending_human_evaluation" as const,
    proofLevel: "real_public_category_page_evidence" as const,
    blindBoundary: {
      hidesProductIdentity: true,
      hidesStage1RankAndScore: true,
      hidesStage15Status: true,
      hidesShadowPolicyAndPrediction: true,
    },
    items: Array.from({ length: 20 }, (_, index) => ({
      schemaVersion: "stage15-shadow-combined-human-evaluation-item.v1" as const,
      evaluationItemId: `C-${String(index + 1).padStart(2, "0")}`,
      presentationAid: { purpose: "desk organization", status: "presentation_aid_not_source_fact" as const },
      sourceEvidence: { title: `Item ${index + 1}` },
    })),
  };
  return { ...body, packetHash: stableHash(body) };
}

function bindings(sourcePacketHash: string) {
  const body = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-bindings.private.v1" as const,
    batchId: "stage15-shadow-calibration-c-20260717-01",
    packetHash: sourcePacketHash,
    bindings: Array.from({ length: 20 }, (_, index) => ({
      evaluationItemId: `C-${String(index + 1).padStart(2, "0")}`,
      productKey: `amazon:US:B0${String(index + 1).padStart(8, "0")}`,
      candidateId: `candidate-${index + 1}`,
      evidenceSnapshotId: `evidence-${index + 1}`,
      platformProductId: `B0${String(index + 1).padStart(8, "0")}`,
      sourceUrl: `https://www.amazon.com/dp/B0${String(index + 1).padStart(8, "0")}`,
    })),
  };
  return { ...body, bindingHash: stableHash(body) };
}

function completed(sourcePacketHash: string) {
  return {
    schemaVersion: "stage15-shadow-combined-human-evaluation-result.v1",
    batchId: "stage15-shadow-calibration-c-20260717-01",
    sourcePacketHash,
    status: "completed",
    completedAt: "2026-07-17T06:00:00.000Z",
    answers: Array.from({ length: 20 }, (_, index) => ({
      evaluationItemId: `C-${String(index + 1).padStart(2, "0")}`,
      productUnderstood: "yes",
      investigateNext10Minutes: index < 12 ? "yes" : "no",
      screeningEvidenceSufficient: "yes",
      worthFurtherInvestigation: index < 12 ? "yes" : "no",
      evidenceSufficient: "yes",
      dominantSignals: ["market_validation"],
      confidence: "medium",
      reason: `人工理由 ${index + 1}`,
    })),
  };
}

function shadowPacket(): Stage15ShadowBlindEvaluationPacket {
  const items = Array.from({ length: 20 }, (_, index) => ({
    evaluationItemId: `SC-${String(index + 1).padStart(2, "0")}`,
    titleZh: `Item ${index + 1}`,
    purposeZh: "用途",
    presentationLabel: "presentation_aid_not_source_fact" as const,
    image: { status: "not_cached" as const, dataUrl: null, missingReason: "not_cached" },
    price: null,
    dimensions: null,
    material: null,
    marketValidation: {} as never,
    listingMaturity: {} as never,
    buyerReviews: {} as never,
  }));
  const body = {
    schemaVersion: "stage15-shadow-blind-evaluation-packet.v1" as const,
    packetVersion: "stage15-shadow-blind-evaluation-packet.v1",
    itemCount: 20 as const,
    createdAt: "2026-07-17T05:00:00.000Z",
    items,
  };
  return { ...body, packetHash: stableHash(body) };
}

describe("Stage 1.5 combined human evaluation", () => {
  it("validates exactly 20 complete answers and preserves the human wording", () => {
    const sourcePacket = packet();
    const result = validateStage15ShadowCombinedHumanEvaluationResult(
      completed(sourcePacket.packetHash),
      sourcePacket,
      bindings(sourcePacket.packetHash),
    );
    expect(result.answers).toHaveLength(20);
    expect(result.answers[0].reason).toBe("人工理由 1");
    expect(result.resultHash).toBe(stableHash({
      schemaVersion: result.schemaVersion,
      batchId: result.batchId,
      sourcePacketHash: result.sourcePacketHash,
      status: result.status,
      completedAt: result.completedAt,
      answers: result.answers,
      boundary: result.boundary,
    }));
  });

  it("fails closed on missing, duplicate, malformed, unbound, or tampered answers", () => {
    const sourcePacket = packet();
    const privateBindings = bindings(sourcePacket.packetHash);
    const cases: unknown[] = [];
    const missing = completed(sourcePacket.packetHash);
    missing.answers.pop();
    cases.push(missing);
    const duplicate = completed(sourcePacket.packetHash);
    duplicate.answers[19].evaluationItemId = duplicate.answers[0].evaluationItemId;
    cases.push(duplicate);
    const invalid = completed(sourcePacket.packetHash);
    invalid.answers[0].worthFurtherInvestigation = "sell";
    cases.push(invalid);
    const blankReason = completed(sourcePacket.packetHash);
    blankReason.answers[0].reason = " ";
    cases.push(blankReason);
    cases.push({ ...completed(sourcePacket.packetHash), sourcePacketHash: "tampered" });
    for (const value of cases) {
      expect(() => validateStage15ShadowCombinedHumanEvaluationResult(value, sourcePacket, privateBindings)).toThrow();
    }
    expect(() => validateStage15ShadowCombinedHumanEvaluationResult(
      completed(sourcePacket.packetHash),
      sourcePacket,
      { ...privateBindings, bindingHash: "tampered" },
    )).toThrow("SHADOW_COMBINED_BINDING_INVALID");
  });

  it("projects the same human answer into Stage 1.5 and standard shadow contracts by product binding", () => {
    const sourcePacket = packet();
    const privateBindings = bindings(sourcePacket.packetHash);
    const combinedResult = validateStage15ShadowCombinedHumanEvaluationResult(
      completed(sourcePacket.packetHash),
      sourcePacket,
      privateBindings,
    );
    const standardPacket = shadowPacket();
    const reversed = [...privateBindings.bindings].reverse();
    const projections = buildStage15ShadowEvaluationProjections({
      combinedResult,
      combinedBindings: privateBindings.bindings,
      novicePacketHash: "a".repeat(64),
      shadowPacket: standardPacket,
      shadowBindings: reversed.map((binding, index) => ({
        evaluationItemId: standardPacket.items[index].evaluationItemId,
        productKey: binding.productKey,
      })),
    });
    expect(projections.noviceResponses.answers[0]).toMatchObject({
      blindItemId: "C-01",
      productUnderstood: "yes",
      investigateNext10Minutes: "yes",
      evidenceSufficient: "yes",
      confidence: "medium",
      note: "人工理由 1",
    });
    expect(projections.shadowResult.answers.find((answer) => answer.evaluationItemId === "SC-20"))
      .toMatchObject({ worthFurtherInvestigation: "yes", reason: "人工理由 1" });
    expect(projections.shadowResult.resultHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
