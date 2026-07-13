import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CandidateSaveItem } from "@/lib/server/candidateSourceSave";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import {
  loadDemoSandboxStore,
  saveDemoSandboxStore,
  saveLegacySandboxCandidates,
  saveSignedSandboxCandidates,
  sandboxCandidateToListItem,
  updateSandboxCandidate,
} from "@/lib/server/demoSandbox";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "candidate-signed-sandbox-"));
const TEST_STORE_PATH = join(TEST_ROOT, "sandbox.json");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function draft(name: string, evidenceHash = HASH_A): CandidateSaveItem {
  return {
    name,
    rawInput: name,
    link: "https://example.com/product",
    score: 79,
    source: "网页抓取 · example.com",
    keyword: "desk",
    riskLevel: "green",
    riskLabel: "低风险",
    summaryLabel: "候选可评估",
    status: "pending",
    convertedTaskId: null,
    evidenceHash,
    assessmentHash: "c".repeat(64),
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "signed_source_v2",
      evidenceHash,
      sourceEvidence: { version: "candidate-source-v2", origin: "public_url", sourceType: "html" },
      proof: {
        issuedAt: "2026-07-11T11:00:00.000Z",
        expiresAt: "2026-07-11T13:00:00.000Z",
        sourceType: "html",
      },
    }),
    analysisJson: JSON.stringify({ integrity: "signed_source_v2" }),
  };
}

function legacyDraft(name: string): CandidateSaveItem {
  return {
    ...draft(name),
    evidenceHash: undefined,
    assessmentHash: undefined,
    status: "pending",
    convertedTaskId: null,
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "legacy_unverified",
      origin: "manual_or_legacy",
    }),
    analysisJson: JSON.stringify({
      version: "candidate-analysis-v2",
      integrity: "legacy_unverified",
      origin: "manual_or_legacy",
    }),
  };
}

function validSignedStoredChain() {
  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: "sandbox-policy-evidence",
    origin: "public_url",
    capturedAt: "2026-07-11T11:00:00.000Z",
    submittedUrl: "https://example.com/product",
    finalUrl: "https://example.com/product",
    candidateUrl: "https://example.com/product",
    sourceRelation: "document",
    sourceHost: "example.com",
    sourceType: "html",
    transportSecurity: "https",
    retrieval: {
      status: "retrieved",
      httpStatus: 200,
      contentType: "text/html",
      robots: "allowed",
      redirectCount: 0,
    },
    observations: {
      title: "Product A",
      categoryHint: null,
      signalText: "product",
      priceText: null,
      hasImage: true,
    },
    extractionSignals: ["product_page"],
  });
  const ruleAssessment = normalizeRuleAssessmentV1({
    version: "candidate-rule-v1",
    algorithm: "radar-score-v1",
    evidenceHash: createEvidenceHash(sourceEvidence),
    computedAt: "2026-07-11T11:01:00.000Z",
    candidateType: "product_candidate",
    scores: { demandSignal: 70, supplyEase: 70, risk: 30, beginnerFit: 70, final: 70 },
    riskFlags: [],
    reasons: ["规则评分"],
    queueSuggestion: "review",
  });
  return {
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "signed_source_v2",
      evidenceHash: createEvidenceHash(sourceEvidence),
      sourceEvidence,
      proof: {
        issuedAt: "2026-07-11T11:01:00.000Z",
        expiresAt: "2026-07-11T13:01:00.000Z",
        sourceType: sourceEvidence.sourceType,
      },
    }),
    analysisJson: JSON.stringify({
      version: "candidate-analysis-v2",
      integrity: "signed_source_v2",
      assessmentHash: createAssessmentHash(ruleAssessment),
      ruleAssessment,
    }),
  };
}

beforeEach(() => {
  process.env.DEMO_SANDBOX_STORE_PATH = TEST_STORE_PATH;
  saveDemoSandboxStore({ version: 1, tasks: [], candidates: [] });
});

afterEach(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("saveSignedSandboxCandidates", () => {
  it("creates the whole batch for the current Visitor in one save", () => {
    const result = saveSignedSandboxCandidates("visitor-a", [
      draft("Product A"),
      draft("Product B", HASH_B),
    ]);

    expect(result).toMatchObject({ created: 2, unchanged: 0 });
    const store = loadDemoSandboxStore();
    expect(store.candidates.map((item) => item.name)).toEqual(["Product A", "Product B"]);
    expect(store.candidates.every((item) => item.demoAccessId === "visitor-a")).toBe(true);
    expect(sandboxCandidateToListItem(store.candidates[0]).sourceIntegrity).toBe("verified_public");
  });

  it("keeps same Evidence unchanged without rewriting the file", () => {
    saveSignedSandboxCandidates("visitor-a", [draft("Product A")]);
    const before = readFileSync(TEST_STORE_PATH, "utf8");

    const result = saveSignedSandboxCandidates("visitor-a", [draft("  PRODUCT   A ")]);

    expect(result).toMatchObject({ created: 0, unchanged: 1 });
    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe(before);
  });

  it("rejects a conflicting batch without changing the store", () => {
    saveSignedSandboxCandidates("visitor-a", [draft("Product A")]);
    const before = readFileSync(TEST_STORE_PATH, "utf8");

    expect(() => saveSignedSandboxCandidates("visitor-a", [
      draft("Product B", HASH_B),
      draft("Product A", HASH_B),
    ])).toThrowError(expect.objectContaining({ code: "candidate_source_conflict" }));
    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe(before);
  });

  it("isolates same-name Candidates between Visitor A and Visitor B", () => {
    saveSignedSandboxCandidates("visitor-a", [draft("Product A")]);
    const result = saveSignedSandboxCandidates("visitor-b", [draft("Product A", HASH_B)]);

    expect(result).toMatchObject({ created: 1, unchanged: 0 });
    const store = loadDemoSandboxStore();
    expect(store.candidates).toHaveLength(2);
    expect(new Set(store.candidates.map((item) => item.demoAccessId))).toEqual(new Set(["visitor-a", "visitor-b"]));
  });

  it("fails closed when an existing same-name record is legacy or malformed", () => {
    const store = loadDemoSandboxStore();
    store.candidates.push({
      id: "sandbox_candidate_legacy",
      demoAccessId: "visitor-a",
      name: "Product A",
      rawInput: "Product A",
      link: null,
      score: 50,
      source: "legacy",
      keyword: "",
      riskLevel: "",
      riskLabel: "",
      summaryLabel: "",
      status: "pending",
      sourceMetaJson: "{}",
      analysisJson: "{}",
      createdAt: "2026-07-11T12:00:00.000Z",
    });
    saveDemoSandboxStore(store);
    const before = readFileSync(TEST_STORE_PATH, "utf8");

    expect(() => saveSignedSandboxCandidates("visitor-a", [draft("Product A")]))
      .toThrowError(expect.objectContaining({ code: "candidate_source_conflict" }));
    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe(before);
  });

  it("does not treat corrupt store text as permission to overwrite signed data", () => {
    writeFileSync(TEST_STORE_PATH, "not-json", "utf8");
    expect(() => saveSignedSandboxCandidates("visitor-a", [draft("Product A")]))
      .toThrow("DEMO_SANDBOX_STORE_INVALID");
    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe("not-json");
  });
});

describe("saveLegacySandboxCandidates downgrade guard", () => {
  it("rejects a same-name legacy save after the Visitor Candidate has converted", () => {
    const candidate = saveLegacySandboxCandidates("visitor-a", [legacyDraft("Product A")]).items[0];
    const store = loadDemoSandboxStore();
    store.candidates[0] = { ...candidate, convertedTaskId: "sandbox_task_existing" };
    saveDemoSandboxStore(store);
    const before = readFileSync(TEST_STORE_PATH, "utf8");

    expect(() => saveLegacySandboxCandidates("visitor-a", [legacyDraft("Product A")]))
      .toThrowError(expect.objectContaining({ code: "candidate_source_conflict" }));
    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe(before);
  });

  it("rejects the whole legacy batch when the current Visitor already has a signed identity", () => {
    saveSignedSandboxCandidates("visitor-a", [draft("Product A")]);
    const before = readFileSync(TEST_STORE_PATH, "utf8");

    expect(() => saveLegacySandboxCandidates("visitor-a", [
      legacyDraft("Product B"),
      legacyDraft("Product A"),
    ])).toThrowError(expect.objectContaining({ code: "candidate_source_conflict" }));

    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe(before);
  });

  it("does not let Visitor A signed data block Visitor B legacy input", () => {
    saveSignedSandboxCandidates("visitor-a", [draft("Product A")]);
    const result = saveLegacySandboxCandidates("visitor-b", [
      legacyDraft("Product A"),
    ]);

    expect(result.created).toBe(1);
    expect(loadDemoSandboxStore().candidates).toHaveLength(2);
    expect(sandboxCandidateToListItem(result.items[0]).sourceIntegrity).toBe("unverified");
  });
});

describe("updateSandboxCandidate source integrity policy", () => {
  it("requires strict acknowledgement before an unverified Candidate enters ready state", () => {
    const created = saveLegacySandboxCandidates("visitor-a", [legacyDraft("Product A")]).items[0];
    const before = readFileSync(TEST_STORE_PATH, "utf8");

    expect(() => updateSandboxCandidate("visitor-a", created.id, { status: "worth_analyzing" }, {
      sourceReviewAcknowledged: "true",
      requestedFields: ["status", "sourceReviewAcknowledged"],
    })).toThrowError(expect.objectContaining({ code: "source_review_required" }));
    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe(before);

    expect(updateSandboxCandidate("visitor-a", created.id, { status: "worth_analyzing" }, {
      sourceReviewAcknowledged: true,
      requestedFields: ["status", "sourceReviewAcknowledged"],
    })).toMatchObject({ status: "worth_analyzing" });
  });

  it("locks signed source-derived fields but allows status", () => {
    const created = saveSignedSandboxCandidates("visitor-a", [draft("Product A")]).items[0];
    const store = loadDemoSandboxStore();
    Object.assign(store.candidates.find((candidate) => candidate.id === created.id)!, validSignedStoredChain());
    saveDemoSandboxStore(store);
    const before = readFileSync(TEST_STORE_PATH, "utf8");

    expect(() => updateSandboxCandidate("visitor-a", created.id, { name: "Tampered" }, {
      requestedFields: ["name"],
    })).toThrowError(expect.objectContaining({ code: "verified_source_fields_locked" }));
    expect(readFileSync(TEST_STORE_PATH, "utf8")).toBe(before);

    expect(updateSandboxCandidate("visitor-a", created.id, { status: "worth_analyzing" }, {
      requestedFields: ["status"],
    })).toMatchObject({ status: "worth_analyzing", name: "Product A" });
  });

  it("requires acknowledgement when signed source metadata has an invalid Assessment chain", () => {
    const created = saveSignedSandboxCandidates("visitor-a", [draft("Product A")]).items[0];

    expect(() => updateSandboxCandidate("visitor-a", created.id, { status: "worth_analyzing" }, {
      requestedFields: ["status"],
    })).toThrowError(expect.objectContaining({ code: "source_review_required" }));

    expect(updateSandboxCandidate("visitor-a", created.id, { status: "worth_analyzing" }, {
      sourceReviewAcknowledged: true,
      requestedFields: ["status", "sourceReviewAcknowledged"],
    })).toMatchObject({ status: "worth_analyzing" });
  });

  it("does not let Visitor A acknowledge Visitor B Candidate", () => {
    const created = saveLegacySandboxCandidates("visitor-b", [legacyDraft("Product A")]).items[0];
    expect(updateSandboxCandidate("visitor-a", created.id, { status: "worth_analyzing" }, {
      sourceReviewAcknowledged: true,
      requestedFields: ["status", "sourceReviewAcknowledged"],
    })).toBeNull();
  });
});
