import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeSourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";
import {
  assertCandidateWriteIsolationHasNoTransientFiles,
  candidateWriteTestPrisma,
  disposeCandidateWriteIsolation,
  initializeCandidateWriteIsolation,
  installCandidateWriteNetworkIsolation,
  resetCandidateWriteIsolation,
} from "@/tests/helpers/candidateWriteIsolation";

const TEST_PASSWORD = "test-only-password";
const NOW = Date.parse("2026-07-25T01:00:00.000Z");

vi.mock("@/lib/server/db", async () => {
  const isolation = await import("@/tests/helpers/candidateWriteIsolation");
  return { prisma: isolation.candidateWriteTestPrisma };
});

vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => TEST_PASSWORD,
  checkAccessPassword: () => null,
  getAccessContext: (request: { headers: Headers }) => {
    const subject = request.headers.get("x-characterization-subject");
    if (subject === "owner") {
      return { mode: "owner" as const, token: "fake-owner-token" };
    }
    if (subject?.startsWith("visitor-")) {
      return {
        mode: "demo" as const,
        token: `fake-${subject}-token`,
        demoAccessId: subject,
      };
    }
    return null;
  },
}));

import { createSourceProof } from "@/lib/server/sourceProof";
import {
  loadDemoSandboxStore,
  saveDemoSandboxStore,
} from "@/lib/server/demoSandbox";
import { POST } from "./route";

type TestSubject = "owner" | "visitor-a" | "visitor-b";
let networkIsolation: ReturnType<typeof installCandidateWriteNetworkIsolation> | undefined;

function signedItem(options: {
  subject?: string;
  title?: string;
  evidenceId?: string;
  proofNow?: number;
} = {}) {
  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: options.evidenceId ?? "characterization-evidence-a",
    origin: "public_url",
    capturedAt: "2026-07-25T00:58:00.000Z",
    submittedUrl: "https://example.com/feed.xml",
    finalUrl: "https://example.com/feed.xml",
    candidateUrl: "https://example.com/products/foldable-widget-stand",
    sourceRelation: "document_item",
    sourceHost: "example.com",
    sourceType: "rss",
    transportSecurity: "https",
    retrieval: {
      status: "retrieved",
      httpStatus: 200,
      contentType: "application/rss+xml",
      robots: "allowed",
      redirectCount: 0,
    },
    observations: {
      title: options.title ?? "Foldable Widget Stand",
      categoryHint: "Desk accessories",
      signalText: "Portable lightweight generic metal stand",
      priceText: null,
      hasImage: null,
    },
    extractionSignals: ["rss_item"],
  });
  const ruleAssessment = assessSourceEvidenceV2(
    sourceEvidence,
    "2026-07-25T00:59:00.000Z",
  );
  const sourceProof = createSourceProof({
    subject: options.subject ?? "owner",
    evidenceHash: createEvidenceHash(sourceEvidence),
    assessmentHash: createAssessmentHash(ruleAssessment),
    sourceType: sourceEvidence.sourceType,
    now: options.proofNow ?? NOW,
  });
  return {
    name: "forged client name",
    status: "analyzed",
    score: 100,
    convertedTaskId: "forged-task",
    sourceMetaJson: JSON.stringify({ integrity: "signed_source_v2", forged: true }),
    analysisJson: JSON.stringify({ forged: true }),
    sourceEvidence,
    ruleAssessment,
    sourceProof,
  };
}

function legacyItem(name = "Manual Product", overrides: Record<string, unknown> = {}) {
  return {
    name,
    rawInput: `${name} raw`,
    link: "https://example.com/manual-product",
    score: 66,
    source: "Manual source",
    keyword: "manual",
    riskLevel: "yellow",
    riskLabel: "人工复核",
    summaryLabel: "Legacy input",
    ...overrides,
  };
}

function request(subject: TestSubject, body: unknown) {
  return new Request("http://localhost/api/opportunity-candidates", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-characterization-subject": subject,
    },
    body: JSON.stringify(body),
  });
}

async function post(subject: TestSubject, body: unknown) {
  const response = await POST(request(subject, body) as never);
  return { response, body: await response.json() };
}

async function ownerCandidates() {
  return candidateWriteTestPrisma.opportunityCandidate.findMany({
    orderBy: { createdAt: "asc" },
  });
}

function visitorCandidates(subject = "visitor-a") {
  return loadDemoSandboxStore().candidates.filter((item) => item.demoAccessId === subject);
}

async function seedOwnerCandidate(input: {
  id: string;
  name: string;
  status?: string;
  convertedTaskId?: string | null;
  sourceMetaJson?: string;
  analysisJson?: string;
}) {
  return candidateWriteTestPrisma.opportunityCandidate.create({
    data: {
      id: input.id,
      name: input.name,
      rawInput: input.name,
      status: input.status ?? "pending",
      convertedTaskId: input.convertedTaskId ?? null,
      sourceMetaJson: input.sourceMetaJson ?? "{}",
      analysisJson: input.analysisJson ?? "{}",
    },
  });
}

function seedVisitorCandidate(input: {
  id: string;
  demoAccessId?: string;
  name: string;
  status?: string;
  convertedTaskId?: string | null;
  sourceMetaJson?: string;
  analysisJson?: string;
}) {
  const store = loadDemoSandboxStore();
  store.candidates.push({
    id: input.id,
    demoAccessId: input.demoAccessId ?? "visitor-a",
    name: input.name,
    rawInput: input.name,
    link: null,
    score: 50,
    source: "seed",
    keyword: "",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "",
    status: input.status ?? "pending",
    sourceMetaJson: input.sourceMetaJson ?? "{}",
    analysisJson: input.analysisJson ?? "{}",
    createdAt: "2026-07-25T00:00:00.000Z",
    convertedTaskId: input.convertedTaskId ?? null,
    lastActionAt: null,
  });
  saveDemoSandboxStore(store);
}

beforeAll(async () => {
  await initializeCandidateWriteIsolation();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW + 1_000);
  networkIsolation = installCandidateWriteNetworkIsolation("candidate-post");
  await resetCandidateWriteIsolation();
});

afterEach(() => {
  try {
    networkIsolation?.assertUnused();
    assertCandidateWriteIsolationHasNoTransientFiles();
  } finally {
    try {
      networkIsolation?.restore();
    } finally {
      networkIsolation = undefined;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  }
});

afterAll(async () => {
  await disposeCandidateWriteIsolation();
});

describe("POST /api/opportunity-candidates signed REQUEST_CONTRACT", () => {
  it.each([
    ["Owner", "owner", "owner"],
    ["Visitor", "visitor-a", "demo:visitor-a"],
  ] as const)("persists one valid %s signed Candidate with server-derived fields", async (
    _label,
    subject,
    proofSubject,
  ) => {
    const input = signedItem({ subject: proofSubject });
    const { response, body } = await post(subject, { items: [input] });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      created: 1,
      updated: 0,
      unchanged: 0,
      sourceMode: "signed_source_v2",
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      name: "Foldable Widget Stand",
      status: "pending",
      score: 72,
      convertedTaskId: null,
      sourceIntegrity: "verified_public",
    });
    const persisted = subject === "owner"
      ? (await ownerCandidates())[0]
      : visitorCandidates()[0];
    const sourceMeta = JSON.parse(persisted.sourceMetaJson);
    const analysis = JSON.parse(persisted.analysisJson);
    expect(sourceMeta).toMatchObject({
      integrity: "signed_source_v2",
      evidenceHash: createEvidenceHash(input.sourceEvidence),
      sourceEvidence: input.sourceEvidence,
    });
    expect(analysis).toMatchObject({
      integrity: "signed_source_v2",
      assessmentHash: createAssessmentHash(input.ruleAssessment),
      ruleAssessment: input.ruleAssessment,
    });
    if (subject === "owner") {
      expect(await ownerCandidates()).toHaveLength(1);
      expect(visitorCandidates()).toHaveLength(0);
    } else {
      expect(visitorCandidates()).toHaveLength(1);
      expect(await ownerCandidates()).toHaveLength(0);
    }
  });

  it.each([
    ["Owner", "owner", "owner"],
    ["Visitor", "visitor-a", "demo:visitor-a"],
  ] as const)("accepts the current 21-item %s signed batch without a Route limit", async (
    _label,
    subject,
    proofSubject,
  ) => {
    const items = Array.from({ length: 21 }, (_, index) => signedItem({
      subject: proofSubject,
      title: `Foldable Widget Stand ${String(index + 1).padStart(2, "0")}`,
      evidenceId: `characterization-batch-${index + 1}`,
    }));

    const { response, body } = await post(subject, { items });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      created: 21,
      updated: 0,
      unchanged: 0,
      sourceMode: "signed_source_v2",
    });
    expect(body.items).toHaveLength(21);
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates()).toHaveLength(21);
  });

  it("rejects an empty signed batch as invalid_payload without writing", async () => {
    const { response, body } = await post("owner", { items: [] });
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(await ownerCandidates()).toHaveLength(0);
  });

  it.each([
    ["missing sourceEvidence", "candidate_batch_invalid", (item: ReturnType<typeof signedItem>) => ({ ...item, sourceEvidence: undefined })],
    ["missing ruleAssessment", "candidate_batch_invalid", (item: ReturnType<typeof signedItem>) => ({ ...item, ruleAssessment: undefined })],
    ["missing sourceProof", "candidate_batch_invalid", (item: ReturnType<typeof signedItem>) => ({ ...item, sourceProof: undefined })],
    ["expired proof", "source_proof_invalid", () => signedItem({ proofNow: NOW - 2 * 60 * 60 * 1_000 })],
    ["wrong Owner proof subject", "source_proof_invalid", () => signedItem({ subject: "demo:visitor-a" })],
    ["tampered Evidence hash", "source_proof_invalid", (item: ReturnType<typeof signedItem>) => ({
      ...item,
      sourceEvidence: {
        ...item.sourceEvidence,
        observations: { ...item.sourceEvidence.observations, title: "Tampered title" },
      },
    })],
    ["tampered Assessment hash", "source_proof_invalid", (item: ReturnType<typeof signedItem>) => ({
      ...item,
      ruleAssessment: {
        ...item.ruleAssessment,
        scores: { ...item.ruleAssessment.scores, final: item.ruleAssessment.scores.final + 1 },
      },
    })],
  ] as const)("fails closed for %s", async (_label, expectedCode, mutate) => {
    const item = signedItem();
    const { response, body } = await post("owner", { items: [mutate(item)] });
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(await ownerCandidates()).toHaveLength(0);
  });

  it("rejects a proof issued to Visitor A when Visitor B submits it", async () => {
    const { response, body } = await post("visitor-b", {
      items: [signedItem({ subject: "demo:visitor-a" })],
    });
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "source_proof_invalid" } });
    expect(visitorCandidates("visitor-a")).toHaveLength(0);
    expect(visitorCandidates("visitor-b")).toHaveLength(0);
  });

  it("deduplicates same-identity same-Hash items inside one batch", async () => {
    const item = signedItem();
    const { response, body } = await post("owner", { items: [item, item] });
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    expect(body.items).toHaveLength(1);
    expect(await ownerCandidates()).toHaveLength(1);
  });

  it("rejects same-identity different-Hash items inside one batch", async () => {
    const { response, body } = await post("owner", {
      items: [
        signedItem({ evidenceId: "identity-hash-a" }),
        signedItem({ evidenceId: "identity-hash-b" }),
      ],
    });
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(await ownerCandidates()).toHaveLength(0);
  });

  it.each([
    ["Owner", "owner", "owner"],
    ["Visitor", "visitor-a", "demo:visitor-a"],
  ] as const)("returns unchanged for an existing same-Hash %s Candidate", async (
    _label,
    subject,
    proofSubject,
  ) => {
    const item = signedItem({ subject: proofSubject });
    const first = await post(subject, { items: [item] });
    const before = subject === "owner" ? await ownerCandidates() : visitorCandidates();
    const second = await post(subject, { items: [item] });
    const after = subject === "owner" ? await ownerCandidates() : visitorCandidates();

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(second.body).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(second.body.items[0].id).toBe(first.body.items[0].id);
    expect(after).toHaveLength(before.length);
  });

  it.each([
    ["different signed Hash", "signed"],
    ["legacy record", "legacy"],
    ["ambiguous duplicate identity", "ambiguous"],
  ] as const)("rejects an existing %s before creating another Owner item", async (_label, kind) => {
    if (kind === "signed") {
      const prior = await post("owner", {
        items: [signedItem({ evidenceId: "existing-different-hash" })],
      });
      expect(prior.response.status).toBe(200);
    } else {
      await seedOwnerCandidate({ id: "legacy-a", name: "Foldable Widget Stand" });
      if (kind === "ambiguous") {
        await seedOwnerCandidate({ id: "legacy-b", name: "  FOLDABLE   WIDGET STAND  " });
      }
    }

    const before = await ownerCandidates();
    const { response, body } = await post("owner", {
      items: [signedItem({ evidenceId: "new-signed-hash" })],
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(await ownerCandidates()).toEqual(before);
  });

  it.each([
    ["different signed Hash", "signed"],
    ["legacy record", "legacy"],
    ["ambiguous duplicate identity", "ambiguous"],
  ] as const)("rejects a Visitor signed save over an existing %s", async (_label, kind) => {
    if (kind === "signed") {
      const prior = await post("visitor-a", {
        items: [signedItem({
          subject: "demo:visitor-a",
          evidenceId: "visitor-existing-different-hash",
        })],
      });
      expect(prior.response.status).toBe(200);
    } else {
      seedVisitorCandidate({
        id: "visitor-legacy-a",
        name: "Foldable Widget Stand",
      });
      if (kind === "ambiguous") {
        seedVisitorCandidate({
          id: "visitor-legacy-b",
          name: "  FOLDABLE   WIDGET STAND  ",
        });
      }
    }
    const before = visitorCandidates();

    const { response, body } = await post("visitor-a", {
      items: [signedItem({
        subject: "demo:visitor-a",
        evidenceId: "visitor-new-signed-hash",
      })],
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(visitorCandidates()).toEqual(before);
  });

  it.each([
    ["Owner", "owner", "owner"],
    ["Visitor", "visitor-a", "demo:visitor-a"],
  ] as const)("rolls back the whole %s signed batch when one existing identity conflicts", async (
    _label,
    subject,
    proofSubject,
  ) => {
    const existing = signedItem({
      subject: proofSubject,
      title: "Existing Conflict Product",
      evidenceId: "existing-conflict",
    });
    expect((await post(subject, { items: [existing] })).response.status).toBe(200);
    const before = subject === "owner" ? await ownerCandidates() : visitorCandidates();

    const { response, body } = await post(subject, {
      items: [
        signedItem({
          subject: proofSubject,
          title: "New Batch Product",
          evidenceId: "new-batch-product",
        }),
        signedItem({
          subject: proofSubject,
          title: "Existing Conflict Product",
          evidenceId: "changed-conflict",
        }),
      ],
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates()).toEqual(before);
  });

  it("rolls back the real Owner SQLite transaction when the second insert fails", async () => {
    await candidateWriteTestPrisma.$executeRawUnsafe(`
      CREATE TRIGGER "characterization_fail_second_signed_insert"
      BEFORE INSERT ON "OpportunityCandidate"
      WHEN NEW."name" = 'Transaction Failure Product'
      BEGIN
        SELECT RAISE(ABORT, 'characterization_forced_second_insert_failure');
      END
    `);
    try {
      const { response, body } = await post("owner", {
        items: [
          signedItem({
            title: "Transaction Safe Product",
            evidenceId: "transaction-safe-product",
          }),
          signedItem({
            title: "Transaction Failure Product",
            evidenceId: "transaction-failure-product",
          }),
        ],
      });

      expect(response.status).toBe(500);
      expect(body).toMatchObject({ ok: false, error: { code: "server_error" } });
      expect(await ownerCandidates()).toHaveLength(0);
    } finally {
      await candidateWriteTestPrisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS \"characterization_fail_second_signed_insert\"",
      );
    }
  });
});

describe("POST /api/opportunity-candidates legacy REQUEST_CONTRACT", () => {
  it.each([
    ["Owner", "owner"],
    ["Visitor", "visitor-a"],
  ] as const)("creates the first %s legacy Candidate with cleaned authority fields", async (
    _label,
    subject,
  ) => {
    const { response, body } = await post(subject, {
      items: [legacyItem("Legacy Product", {
        status: "analyzed",
        convertedTaskId: "forged-task",
        sourceMetaJson: JSON.stringify({ integrity: "signed_source_v2", forged: true }),
        analysisJson: JSON.stringify({ trusted: true }),
      })],
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      created: 1,
      updated: 0,
      sourceMode: "legacy_unverified",
    });
    expect(body).not.toHaveProperty("unchanged");
    expect(body.items[0]).toMatchObject({
      name: "Legacy Product",
      status: "pending",
      convertedTaskId: null,
      sourceIntegrity: "unverified",
    });
    expect(JSON.stringify(body)).not.toContain("forged");
    expect(JSON.stringify(body)).not.toContain("trusted");
  });

  it("updates the existing Owner identity but appends a duplicate Visitor identity", async () => {
    const firstOwner = await post("owner", { items: [legacyItem("Repeated Product")] });
    const secondOwner = await post("owner", { items: [legacyItem("  REPEATED   PRODUCT  ")] });
    expect(firstOwner.body).toMatchObject({ created: 1, updated: 0 });
    expect(secondOwner.body).toMatchObject({ created: 0, updated: 1 });
    expect((await ownerCandidates()).map((item) => item.id)).toEqual([firstOwner.body.items[0].id]);

    const firstVisitor = await post("visitor-a", { items: [legacyItem("Repeated Product")] });
    const secondVisitor = await post("visitor-a", { items: [legacyItem("  REPEATED   PRODUCT  ")] });
    expect(firstVisitor.body).toMatchObject({ created: 1, updated: 0 });
    expect(secondVisitor.body).toMatchObject({ created: 1, updated: 0 });
    expect(visitorCandidates()).toHaveLength(2);
    expect(new Set(visitorCandidates().map((item) => item.id)).size).toBe(2);
  });

  it.each(["analyzed", "paused", "rejected", "worth_analyzing"])(
    "Owner overwrites changed fields and resets an unlinked %s legacy record to pending",
    async (status) => {
    await seedOwnerCandidate({
      id: "owner-stateful",
      name: "Stateful Product",
      status,
    });

    const { response, body } = await post("owner", {
      items: [legacyItem("Stateful Product", {
        score: 91,
        link: "https://example.com/changed",
        keyword: "changed",
      })],
    });
    const stored = await candidateWriteTestPrisma.opportunityCandidate.findUnique({
      where: { id: "owner-stateful" },
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ created: 0, updated: 1 });
    expect(stored).toMatchObject({
      id: "owner-stateful",
      status: "pending",
      score: 91,
      link: "https://example.com/changed",
      keyword: "changed",
    });
    },
  );

  it.each(["analyzed", "paused", "rejected", "worth_analyzing"])(
    "Visitor appends a new pending record when an existing unlinked identity is %s",
    async (status) => {
      seedVisitorCandidate({
        id: `visitor-${status}`,
        name: "Stateful Product",
        status,
      });
      const { response, body } = await post("visitor-a", {
        items: [legacyItem("Stateful Product", { score: 88 })],
      });

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ created: 1, updated: 0 });
      expect(visitorCandidates()).toHaveLength(2);
      expect(visitorCandidates().map((item) => item.status)).toEqual([status, "pending"]);
    },
  );

  it.each([
    ["signed identity", "signed"],
    ["Task-linked identity", "linked"],
  ] as const)("rejects a legacy overwrite of a %s for Owner and Visitor", async (_label, kind) => {
    if (kind === "signed") {
      expect((await post("owner", { items: [signedItem()] })).response.status).toBe(200);
      expect((await post("visitor-a", {
        items: [signedItem({ subject: "demo:visitor-a" })],
      })).response.status).toBe(200);
    } else {
      await seedOwnerCandidate({
        id: "owner-linked",
        name: "Foldable Widget Stand",
        convertedTaskId: "task-owner",
      });
      seedVisitorCandidate({
        id: "visitor-linked",
        name: "Foldable Widget Stand",
        convertedTaskId: "task-visitor",
      });
    }
    const ownerBefore = await ownerCandidates();
    const visitorBefore = visitorCandidates();

    const owner = await post("owner", { items: [legacyItem("Foldable Widget Stand")] });
    const visitor = await post("visitor-a", { items: [legacyItem("Foldable Widget Stand")] });

    expect(owner.response.status).toBe(409);
    expect(owner.body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(visitor.response.status).toBe(409);
    expect(visitor.body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(await ownerCandidates()).toEqual(ownerBefore);
    expect(visitorCandidates()).toEqual(visitorBefore);
  });

  it.each([
    ["Owner", "owner"],
    ["Visitor", "visitor-a"],
  ] as const)("rejects a duplicate identity inside one %s legacy batch", async (_label, subject) => {
    const { response, body } = await post(subject, {
      items: [legacyItem("Batch Duplicate"), legacyItem(" batch   duplicate ")],
    });
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates()).toHaveLength(0);
  });

  it.each([
    ["Owner", "owner", "owner"],
    ["Visitor", "visitor-a", "demo:visitor-a"],
  ] as const)("does not persist the safe item in a mixed %s legacy conflict batch", async (
    _label,
    subject,
    proofSubject,
  ) => {
    expect((await post(subject, {
      items: [signedItem({ subject: proofSubject, title: "Protected Product" })],
    })).response.status).toBe(200);
    const before = subject === "owner" ? await ownerCandidates() : visitorCandidates();

    const { response, body } = await post(subject, {
      items: [legacyItem("Safe New Product"), legacyItem("Protected Product")],
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates()).toEqual(before);
  });

  it("fails closed for duplicate Owner legacy identities but Visitor appends a third record", async () => {
    await seedOwnerCandidate({ id: "owner-duplicate-a", name: "Ambiguous Product" });
    await seedOwnerCandidate({ id: "owner-duplicate-b", name: " ambiguous   product " });
    seedVisitorCandidate({ id: "visitor-duplicate-a", name: "Ambiguous Product" });
    seedVisitorCandidate({ id: "visitor-duplicate-b", name: " ambiguous   product " });

    const owner = await post("owner", { items: [legacyItem("Ambiguous Product")] });
    const visitor = await post("visitor-a", { items: [legacyItem("Ambiguous Product")] });

    expect(owner.response.status).toBe(409);
    expect(owner.body).toMatchObject({
      ok: false,
      error: { code: "candidate_source_conflict" },
    });
    expect(await ownerCandidates()).toHaveLength(2);
    expect(visitor.response.status).toBe(200);
    expect(visitor.body).toMatchObject({ ok: true, created: 1, updated: 0 });
    expect(visitorCandidates()).toHaveLength(3);
  });

  it("rejects an empty legacy batch without writing", async () => {
    const { response, body } = await post("visitor-a", { items: [] });
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(visitorCandidates()).toHaveLength(0);
  });
});
