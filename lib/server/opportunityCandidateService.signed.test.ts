import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateSaveItem } from "@/lib/server/candidateSourceSave";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    opportunityCandidate: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: mocks.findUnique,
      create: vi.fn(),
      update: mocks.update,
      delete: vi.fn(),
    },
  },
}));

import { CandidateSourceSaveError } from "@/lib/server/candidateSourceSave";
import { saveLegacyCandidates, saveSignedCandidates, updateCandidate } from "@/lib/server/opportunityCandidateService";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const BASE_TIME = new Date("2026-07-11T12:00:00.000Z");

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
    sourceMetaJson: signedSourceMeta(evidenceHash),
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

function signedSourceMeta(evidenceHash = HASH_A) {
  return JSON.stringify({
    version: "candidate-source-meta-v2",
    integrity: "signed_source_v2",
    evidenceHash,
    sourceEvidence: {
      version: "candidate-source-v2",
      origin: "public_url",
      sourceType: "html",
    },
    proof: {
      issuedAt: "2026-07-11T11:00:00.000Z",
      expiresAt: "2026-07-11T13:00:00.000Z",
      sourceType: "html",
    },
  });
}

function validSignedStoredChain() {
  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: "service-policy-evidence",
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

function record(id: string, name: string, options: { evidenceHash?: string; legacy?: boolean; validChain?: boolean } = {}) {
  const sourceMetaJson = options.legacy
    ? JSON.stringify({ integrity: "legacy_unverified" })
    : options.validChain
      ? validSignedStoredChain().sourceMetaJson
      : signedSourceMeta(options.evidenceHash ?? HASH_A);
  const analysisJson = options.validChain
    ? validSignedStoredChain().analysisJson
    : "{}";
  return {
    id,
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
    sourceMetaJson,
    analysisJson,
    convertedTaskId: null,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    lastActionAt: BASE_TIME,
  };
}

function installTransaction() {
  const committed: ReturnType<typeof record>[] = [];
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const staged: ReturnType<typeof record>[] = [];
    const tx = {
      opportunityCandidate: {
        findMany: mocks.findMany,
        create: vi.fn(async ({ data }: { data: CandidateSaveItem }) => {
          const created = record(`created-${staged.length + 1}`, data.name, { evidenceHash: data.evidenceHash });
          staged.push(created);
          return created;
        }),
        update: mocks.update,
      },
    };
    const result = await callback(tx);
    committed.push(...staged);
    return result;
  });
  return committed;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.findUnique.mockResolvedValue(null);
});

describe("updateCandidate source integrity policy", () => {
  it.each([undefined, false, "true", 1])(
    "rejects an unverified ready transition without strict acknowledgement %j",
    async (sourceReviewAcknowledged) => {
      const existing = record("legacy-a", "Product A", { legacy: true });
      mocks.findUnique.mockResolvedValue(existing);

      await expect(updateCandidate("legacy-a", { status: "worth_analyzing" }, {
        sourceReviewAcknowledged,
        requestedFields: ["status", "sourceReviewAcknowledged"],
      })).rejects.toMatchObject({ code: "source_review_required" });
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("accepts an explicitly acknowledged unverified ready transition", async () => {
    const existing = record("legacy-a", "Product A", { legacy: true });
    const updated = { ...existing, status: "worth_analyzing", updatedAt: new Date("2026-07-11T12:01:00.000Z") };
    mocks.findUnique.mockResolvedValue(existing);
    mocks.update.mockResolvedValue(updated);

    const result = await updateCandidate("legacy-a", { status: "worth_analyzing" }, {
      sourceReviewAcknowledged: true,
      requestedFields: ["status", "sourceReviewAcknowledged"],
    });

    expect(result).toMatchObject({ status: "worth_analyzing", sourceIntegrity: "unverified" });
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("allows a previously ready unverified Candidate to continue without repeat acknowledgement", async () => {
    const existing = { ...record("legacy-a", "Product A", { legacy: true }), status: "worth_analyzing" };
    mocks.findUnique.mockResolvedValue(existing);
    mocks.update.mockResolvedValue({ ...existing, status: "analyzed" });

    await expect(updateCandidate("legacy-a", { status: "analyzed" }, {
      requestedFields: ["status"],
    })).resolves.toMatchObject({ status: "analyzed" });
  });

  it.each(["link", "score", "keyword", "name"])("locks signed source-derived PATCH field %s", async (field) => {
    const existing = record("signed-a", "Product A");
    mocks.findUnique.mockResolvedValue(existing);

    await expect(updateCandidate("signed-a", { score: 88 }, {
      requestedFields: [field],
    })).rejects.toMatchObject({ code: "verified_source_fields_locked" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps signed manual status updates writable", async () => {
    const existing = record("signed-a", "Product A", { validChain: true });
    mocks.findUnique.mockResolvedValue(existing);
    mocks.update.mockResolvedValue({ ...existing, status: "worth_analyzing" });

    await expect(updateCandidate("signed-a", { status: "worth_analyzing" }, {
      requestedFields: ["status"],
    })).resolves.toMatchObject({ status: "worth_analyzing", sourceIntegrity: "verified_public" });
  });

  it("requires acknowledgement when signed source metadata has an invalid Assessment chain", async () => {
    const existing = record("signed-a", "Product A");
    mocks.findUnique.mockResolvedValue(existing);
    mocks.update.mockResolvedValue({ ...existing, status: "worth_analyzing" });

    await expect(updateCandidate("signed-a", { status: "worth_analyzing" }, {
      requestedFields: ["status"],
    })).rejects.toMatchObject({ code: "source_review_required" });

    await expect(updateCandidate("signed-a", { status: "worth_analyzing" }, {
      sourceReviewAcknowledged: true,
      requestedFields: ["status", "sourceReviewAcknowledged"],
    })).resolves.toMatchObject({ status: "worth_analyzing" });
  });
});

describe("saveSignedCandidates", () => {
  it("creates all new Candidates inside one transaction", async () => {
    const committed = installTransaction();
    const result = await saveSignedCandidates([draft("Product A"), draft("Product B", HASH_B)]);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(result.items.map((item) => item.name)).toEqual(["Product A", "Product B"]);
    expect(result.items.every((item) => item.sourceIntegrity === "verified_public")).toBe(true);
    expect(committed).toHaveLength(2);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns same Evidence as unchanged without update or create", async () => {
    const existing = record("existing-a", "  PRODUCT   A ", { evidenceHash: HASH_A });
    mocks.findMany.mockResolvedValue([existing]);
    const committed = installTransaction();

    const result = await saveSignedCandidates([draft("Product A")]);

    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(result.items[0].id).toBe("existing-a");
    expect(result.items[0].updatedAt).toBe(BASE_TIME.toISOString());
    expect(committed).toHaveLength(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["different signed Evidence", record("existing-b", "Product A", { evidenceHash: HASH_B })],
    ["legacy Candidate", record("legacy-a", "Product A", { legacy: true })],
  ])("rejects %s before any create", async (_label, existing) => {
    mocks.findMany.mockResolvedValue([existing]);
    const committed = installTransaction();

    await expect(saveSignedCandidates([draft("Product A"), draft("Product B", HASH_B)]))
      .rejects.toMatchObject({ code: "candidate_source_conflict" });
    expect(committed).toHaveLength(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not commit the first create when the second create fails", async () => {
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      let calls = 0;
      const tx = {
        opportunityCandidate: {
          findMany: mocks.findMany,
          create: vi.fn(async ({ data }: { data: CandidateSaveItem }) => {
            calls += 1;
            if (calls === 2) throw new Error("simulated create failure");
            return record("staged-only", data.name, { evidenceHash: data.evidenceHash });
          }),
          update: mocks.update,
        },
      };
      return callback(tx);
    });

    await expect(saveSignedCandidates([draft("Product A"), draft("Product B", HASH_B)]))
      .rejects.toThrow("simulated create failure");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("fails closed when duplicate existing normalized identities are already present", async () => {
    mocks.findMany.mockResolvedValue([
      record("duplicate-a", "Product A", { evidenceHash: HASH_A }),
      record("duplicate-b", " product   a ", { evidenceHash: HASH_A }),
    ]);
    installTransaction();

    await expect(saveSignedCandidates([draft("Product A")]))
      .rejects.toBeInstanceOf(CandidateSourceSaveError);
  });
});

describe("saveLegacyCandidates downgrade guard", () => {
  it("rejects the whole legacy batch before writes when a signed identity exists", async () => {
    mocks.findMany.mockResolvedValue([
      record("signed-a", "Product A", { evidenceHash: HASH_A }),
    ]);
    const committed = installTransaction();

    await expect(saveLegacyCandidates([
      { ...draft("Product B", HASH_B), evidenceHash: undefined },
      { ...draft("Product A"), evidenceHash: undefined },
    ])).rejects.toMatchObject({ code: "candidate_source_conflict" });

    expect(committed).toHaveLength(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("resets an updated unverified Candidate to pending for fresh human review", async () => {
    const existing = { ...record("legacy-a", "Product A", { legacy: true }), status: "worth_analyzing" };
    mocks.findMany.mockResolvedValue([existing]);
    mocks.update.mockResolvedValue({
      ...existing,
      score: 79,
      status: "pending",
      sourceMetaJson: JSON.stringify({ integrity: "legacy_unverified" }),
      updatedAt: new Date("2026-07-11T12:05:00.000Z"),
    });
    installTransaction();

    const result = await saveLegacyCandidates([
      legacyDraft("Product A"),
    ]);

    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(result.items[0].sourceIntegrity).toBe("unverified");
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { id: "legacy-a" } });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ status: "pending" });
  });
});
