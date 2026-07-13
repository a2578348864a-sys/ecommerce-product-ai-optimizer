import { describe, expect, it, vi } from "vitest";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeSourceEvidenceV2,
  type SourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { getSignedSourceQueuePolicy } from "@/lib/ruleAssessmentPolicy";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";

vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => "phase-2-c-deterministic-test-password",
}));

import {
  CandidateSourceSaveError,
  preflightCandidateSaveBatch,
} from "@/lib/server/candidateSourceSave";
import { createSourceProof } from "@/lib/server/sourceProof";

const NOW = Date.parse("2026-07-12T12:00:00.000Z");
const COMPUTED_AT = "2026-07-12T11:59:30.000Z";

type AcceptanceCase = {
  label: string;
  evidenceId: string;
  documentUrl: string;
  candidateUrl: string | null;
  sourceRelation: "document" | "document_item";
  title: string;
  signalText: string;
  expectedType: "product_candidate" | "category_hint" | "rejected";
  expectedQueue: "review" | "watch" | "reject";
  canSave: boolean;
  defaultSelected: boolean;
};

const CASES: AcceptanceCase[] = [
  {
    label: "Shopify-shaped product detail (deterministic mock)",
    evidenceId: "phase-2-c-shopify-product",
    documentUrl: "https://shop.example/products/foldable-phone-stand",
    candidateUrl: "https://shop.example/products/foldable-phone-stand",
    sourceRelation: "document",
    title: "Foldable Phone Stand",
    signalText: "Portable lightweight generic metal desk accessory",
    expectedType: "product_candidate",
    expectedQueue: "review",
    canSave: true,
    defaultSelected: true,
  },
  {
    label: "Amazon-shaped category boundary (deterministic mock)",
    evidenceId: "phase-2-c-amazon-category",
    documentUrl: "https://market.example/bestsellers/kitchen",
    candidateUrl: null,
    sourceRelation: "document_item",
    title: "Shop by Kitchen",
    signalText: "Best sellers category navigation",
    expectedType: "category_hint",
    expectedQueue: "watch",
    canSave: false,
    defaultSelected: false,
  },
  {
    label: "Product Hunt anti-bot page (deterministic mock)",
    evidenceId: "phase-2-c-product-hunt-blocked",
    documentUrl: "https://launch.example/",
    candidateUrl: null,
    sourceRelation: "document_item",
    title: "Just a moment...",
    signalText: "Enable JavaScript and cookies to continue",
    expectedType: "rejected",
    expectedQueue: "reject",
    canSave: false,
    defaultSelected: false,
  },
  {
    label: "eBay-shaped error page (deterministic mock)",
    evidenceId: "phase-2-c-market-error",
    documentUrl: "https://market.example/item/123",
    candidateUrl: null,
    sourceRelation: "document_item",
    title: "Error Page | Marketplace",
    signalText: "The page you requested is unavailable",
    expectedType: "rejected",
    expectedQueue: "reject",
    canSave: false,
    defaultSelected: false,
  },
];

function evidenceFor(sample: AcceptanceCase): SourceEvidenceV2 {
  const url = new URL(sample.documentUrl);
  return normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: sample.evidenceId,
    origin: "public_url",
    capturedAt: "2026-07-12T11:59:00.000Z",
    submittedUrl: sample.documentUrl,
    finalUrl: sample.documentUrl,
    candidateUrl: sample.candidateUrl,
    sourceRelation: sample.sourceRelation,
    sourceHost: url.hostname,
    sourceType: "html",
    transportSecurity: "https",
    retrieval: {
      status: "retrieved",
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      robots: "not_present",
      redirectCount: 0,
    },
    observations: {
      title: sample.title,
      categoryHint: null,
      signalText: sample.signalText,
      priceText: null,
      hasImage: null,
    },
    extractionSignals: ["html_title"],
  });
}

function signedItem(sample: AcceptanceCase, subject: string) {
  const sourceEvidence = evidenceFor(sample);
  const ruleAssessment = assessSourceEvidenceV2(sourceEvidence, COMPUTED_AT);
  return {
    sourceEvidence,
    ruleAssessment,
    sourceProof: createSourceProof({
      subject,
      evidenceHash: createEvidenceHash(sourceEvidence),
      assessmentHash: createAssessmentHash(ruleAssessment),
      sourceType: sourceEvidence.sourceType,
      now: NOW,
    }),
  };
}

function expectPreflightError(run: () => unknown, code: CandidateSourceSaveError["code"]) {
  expect(run).toThrowError(CandidateSourceSaveError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("Phase 2-C deterministic source-import acceptance", () => {
  it.each(CASES)("classifies $label without external access", (sample) => {
    const firstEvidence = evidenceFor(sample);
    const secondEvidence = evidenceFor(sample);
    const firstAssessment = assessSourceEvidenceV2(firstEvidence, COMPUTED_AT);
    const secondAssessment = assessSourceEvidenceV2(secondEvidence, COMPUTED_AT);
    const policy = getSignedSourceQueuePolicy(firstAssessment);

    expect(createEvidenceHash(firstEvidence)).toBe(createEvidenceHash(secondEvidence));
    expect(createAssessmentHash(firstAssessment)).toBe(createAssessmentHash(secondAssessment));
    expect(firstAssessment).toMatchObject({
      candidateType: sample.expectedType,
      queueSuggestion: sample.expectedQueue,
    });
    expect(policy).toMatchObject({
      canSave: sample.canSave,
      defaultSelected: sample.defaultSelected,
    });
  });

  it("keeps the pure preflight boundary write-free and accepts only eligible product Evidence", () => {
    const positive = CASES[0];
    const preflight = preflightCandidateSaveBatch(
      [signedItem(positive, "owner")],
      { mode: "owner" },
      NOW + 1_000,
    );

    expect(preflight).toMatchObject({
      mode: "signed_source_v2",
      items: [{
        name: positive.title,
        status: "pending",
        link: positive.candidateUrl,
      }],
    });

    for (const blocked of CASES.filter((sample) => !sample.canSave)) {
      expectPreflightError(() => preflightCandidateSaveBatch(
        [signedItem(blocked, "owner")],
        { mode: "owner" },
        NOW + 1_000,
      ), "candidate_batch_invalid");
    }
  });

  it("binds acceptance to Owner or one Visitor and rejects cross-subject reuse", () => {
    const positive = CASES[0];
    const ownerItem = signedItem(positive, "owner");
    const visitorItem = signedItem(positive, "demo:visitor-a");

    expect(preflightCandidateSaveBatch([ownerItem], { mode: "owner" }, NOW + 1_000).items)
      .toHaveLength(1);
    expect(preflightCandidateSaveBatch(
      [visitorItem],
      { mode: "demo", demoAccessId: "visitor-a" },
      NOW + 1_000,
    ).items).toHaveLength(1);
    expectPreflightError(() => preflightCandidateSaveBatch(
      [visitorItem],
      { mode: "demo", demoAccessId: "visitor-b" },
      NOW + 1_000,
    ), "source_proof_invalid");
  });

  it("is idempotent inside one batch and fails closed on same-name conflicting Evidence", () => {
    const positive = CASES[0];
    const original = signedItem(positive, "owner");
    const duplicate = signedItem(positive, "owner");
    expect(preflightCandidateSaveBatch(
      [original, duplicate],
      { mode: "owner" },
      NOW + 1_000,
    ).items).toHaveLength(1);

    const conflictingSample = {
      ...positive,
      evidenceId: "phase-2-c-shopify-product-conflict",
      documentUrl: "https://other-shop.example/products/foldable-phone-stand",
      candidateUrl: "https://other-shop.example/products/foldable-phone-stand",
    };
    expectPreflightError(() => preflightCandidateSaveBatch(
      [original, signedItem(conflictingSample, "owner")],
      { mode: "owner" },
      NOW + 1_000,
    ), "candidate_source_conflict");
  });

  it("rejects a tampered assessment instead of downgrading to legacy", () => {
    const item = signedItem(CASES[0], "owner");
    const tampered = {
      ...item,
      ruleAssessment: {
        ...item.ruleAssessment,
        scores: { ...item.ruleAssessment.scores, final: 100 },
      },
    };

    expectPreflightError(() => preflightCandidateSaveBatch(
      [tampered],
      { mode: "owner" },
      NOW + 1_000,
    ), "source_proof_invalid");
  });
});
