import { describe, expect, it } from "vitest";
import {
  buildSourceImportCandidateSaveInput,
  sourceImportSaveSuccessMessage,
} from "@/lib/client/sourceImportCandidateSave";

const sourceEvidence = {
  version: "candidate-source-v2" as const,
  evidenceId: "source-ui-a",
  origin: "public_url" as const,
  capturedAt: "2026-07-11T12:00:00.000Z",
  submittedUrl: "https://example.com/feed.xml",
  finalUrl: "https://example.com/feed.xml",
  candidateUrl: "https://example.com/products/widget",
  sourceRelation: "document_item" as const,
  sourceHost: "example.com",
  sourceType: "rss" as const,
  transportSecurity: "https" as const,
  retrieval: {
    status: "retrieved" as const,
    httpStatus: 200,
    contentType: "application/rss+xml",
    robots: "allowed" as const,
    redirectCount: 0,
  },
  observations: {
    title: "Widget Stand",
    categoryHint: "Desk accessories",
    signalText: "Portable stand",
    priceText: null,
    hasImage: null,
  },
  extractionSignals: ["rss_item"],
};

const ruleAssessment = {
  version: "candidate-rule-v1" as const,
  algorithm: "radar-evidence-v2",
  evidenceHash: "a".repeat(64),
  computedAt: "2026-07-11T12:00:00.000Z",
  candidateType: "product_candidate",
  scores: { demandSignal: 82, supplyEase: 74, risk: 31, beginnerFit: 88, final: 79 },
  riskFlags: [],
  reasons: ["规则评分"],
  queueSuggestion: "review" as const,
};

describe("source-import Candidate save payload", () => {
  it("passes the signed trio without client-generated source or analysis JSON", () => {
    const input = buildSourceImportCandidateSaveInput({
      title: "Widget Stand",
      sourceUrl: "https://example.com/products/widget",
      sourceType: "rss",
      sourceHost: "example.com",
      categoryHint: "Desk accessories",
      keyword: "desk",
      riskHint: "",
      riskLevel: "green",
      summaryLabel: "候选可评估",
      score: 79,
      demandSignalScore: 82,
      supplyEaseScore: 74,
      riskScore: 31,
      beginnerFitScore: 88,
      candidateType: "product_candidate",
      sourceEvidence,
      ruleAssessment,
      sourceProof: "sourceproof_v1.payload.signature",
    });

    expect(input).toMatchObject({
      name: "Widget Stand",
      sourceEvidence,
      ruleAssessment,
      sourceProof: "sourceproof_v1.payload.signature",
    });
    expect(input).not.toHaveProperty("sourceMetaJson");
    expect(input).not.toHaveProperty("analysisJson");
    expect(input).not.toHaveProperty("status");
    expect(input).not.toHaveProperty("convertedTaskId");
  });

  it("reports created and unchanged counts without calling updates", () => {
    expect(sourceImportSaveSuccessMessage(2, 1)).toBe("已导入候选池：新增 2 个，已有相同来源 1 个。");
    expect(sourceImportSaveSuccessMessage(0, 1)).toBe("候选已在池中，来源一致，无需重复导入。");
  });

  it.each([
    [{ ...ruleAssessment, candidateType: "category_hint", queueSuggestion: "watch" as const }],
    [{ ...ruleAssessment, candidateType: "product_candidate", queueSuggestion: "reject" as const }],
    [{ ...ruleAssessment, algorithm: "radar-score-v1" }],
  ])("fails closed before building a save payload for a non-saveable signed result", (blockedAssessment) => {
    expect(() => buildSourceImportCandidateSaveInput({
      title: "Widget Stand",
      sourceUrl: "https://example.com/products/widget",
      sourceType: "rss",
      sourceHost: "example.com",
      categoryHint: "Desk accessories",
      keyword: "desk",
      riskHint: "",
      riskLevel: "green",
      summaryLabel: "候选可评估",
      score: 79,
      demandSignalScore: 82,
      supplyEaseScore: 74,
      riskScore: 31,
      beginnerFitScore: 88,
      candidateType: blockedAssessment.candidateType,
      sourceEvidence,
      ruleAssessment: blockedAssessment,
      sourceProof: "sourceproof_v1.payload.signature",
    })).toThrow("SOURCE_IMPORT_CANDIDATE_NOT_SAVEABLE");
  });
});
