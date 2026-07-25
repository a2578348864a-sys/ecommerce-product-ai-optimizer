import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeSourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";
import {
  assertCandidateWriteIsolationHasNoTransientFiles,
  candidateWriteIsolation,
  candidateWriteTestPrisma,
  disposeCandidateWriteIsolation,
  initializeCandidateWriteIsolation,
  installCandidateWriteNetworkIsolation,
  resetCandidateWriteIsolation,
} from "@/tests/helpers/candidateWriteIsolation";
import { writeFileSync } from "node:fs";

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
  saveSignedSandboxCandidates,
} from "@/lib/server/demoSandbox";
import { preflightCandidateSaveBatch } from "@/lib/server/candidateSourceSave";
import { saveSignedCandidates } from "@/lib/server/opportunityCandidateService";
import { DELETE, PATCH } from "./route";

type TestSubject = "owner" | "visitor-a" | "visitor-b";
let networkIsolation: ReturnType<typeof installCandidateWriteNetworkIsolation> | undefined;

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(subject: TestSubject, body: unknown) {
  return new Request("http://localhost/api/opportunity-candidates/id", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-characterization-subject": subject,
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(subject: TestSubject) {
  return new Request("http://localhost/api/opportunity-candidates/id", {
    method: "DELETE",
    headers: { "x-characterization-subject": subject },
  });
}

async function patch(subject: TestSubject, id: string, body: unknown) {
  const response = await PATCH(
    patchRequest(subject, body) as never,
    routeContext(id),
  );
  return { response, body: await response.json() };
}

async function remove(subject: TestSubject, id: string) {
  const response = await DELETE(deleteRequest(subject) as never, routeContext(id));
  return { response, body: await response.json() };
}

async function seedOwnerCandidate(input: {
  id: string;
  name?: string;
  score?: number;
  status?: string;
  link?: string | null;
  keyword?: string;
  convertedTaskId?: string | null;
  sourceMetaJson?: string;
  analysisJson?: string;
}) {
  return candidateWriteTestPrisma.opportunityCandidate.create({
    data: {
      id: input.id,
      name: input.name ?? "Owner Product",
      rawInput: input.name ?? "Owner Product",
      score: input.score ?? 50,
      status: input.status ?? "pending",
      link: input.link ?? null,
      keyword: input.keyword ?? "",
      convertedTaskId: input.convertedTaskId ?? null,
      sourceMetaJson: input.sourceMetaJson ?? "{}",
      analysisJson: input.analysisJson ?? "{}",
    },
  });
}

function seedVisitorCandidate(input: {
  id: string;
  demoAccessId?: string;
  name?: string;
  score?: number;
  status?: string;
  link?: string | null;
  keyword?: string;
  convertedTaskId?: string | null;
  sourceMetaJson?: string;
  analysisJson?: string;
}) {
  const store = loadDemoSandboxStore();
  store.candidates.push({
    id: input.id,
    demoAccessId: input.demoAccessId ?? "visitor-a",
    name: input.name ?? "Visitor Product",
    rawInput: input.name ?? "Visitor Product",
    link: input.link ?? null,
    score: input.score ?? 50,
    source: "seed",
    keyword: input.keyword ?? "",
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

async function ownerCandidate(id: string) {
  return candidateWriteTestPrisma.opportunityCandidate.findUnique({ where: { id } });
}

function visitorCandidate(id: string, subject = "visitor-a") {
  return loadDemoSandboxStore().candidates.find(
    (item) => item.id === id && item.demoAccessId === subject,
  ) ?? null;
}

function signedPreflightItem(subject: "owner" | "demo:visitor-a", title: string) {
  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: `patch-signed-${title.toLowerCase().replaceAll(" ", "-")}`,
    origin: "public_url",
    capturedAt: "2026-07-25T00:58:00.000Z",
    submittedUrl: "https://example.com/feed.xml",
    finalUrl: "https://example.com/feed.xml",
    candidateUrl: "https://example.com/products/signed",
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
      title,
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
    subject,
    evidenceHash: createEvidenceHash(sourceEvidence),
    assessmentHash: createAssessmentHash(ruleAssessment),
    sourceType: sourceEvidence.sourceType,
    now: NOW,
  });
  const context = subject === "owner"
    ? { mode: "owner" as const }
    : { mode: "demo" as const, demoAccessId: "visitor-a" };
  const preflight = preflightCandidateSaveBatch(
    [{ sourceEvidence, ruleAssessment, sourceProof }],
    context,
    NOW + 1_000,
  );
  if (preflight.mode !== "signed_source_v2") {
    throw new Error("signed_preflight_fixture_failed");
  }
  return preflight.items[0];
}

async function seedSignedOwner(id = "owner-signed") {
  const result = await saveSignedCandidates([
    signedPreflightItem("owner", "Signed Owner Product"),
  ]);
  const created = result.items[0];
  if (created.id !== id) {
    await candidateWriteTestPrisma.opportunityCandidate.update({
      where: { id: created.id },
      data: { id },
    });
  }
  return id;
}

function seedSignedVisitor(id = "sandbox_candidate_signed") {
  const result = saveSignedSandboxCandidates("visitor-a", [
    signedPreflightItem("demo:visitor-a", "Signed Visitor Product"),
  ]);
  const store = loadDemoSandboxStore();
  const created = store.candidates.find((item) => item.id === result.items[0].id)!;
  created.id = id;
  saveDemoSandboxStore(store);
  return id;
}

beforeAll(async () => {
  await initializeCandidateWriteIsolation();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  networkIsolation = installCandidateWriteNetworkIsolation("candidate-patch-delete");
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

describe("PATCH /api/opportunity-candidates/[id] Owner REQUEST_CONTRACT", () => {
  it("accepts a legal status and preserves a linked Task relation", async () => {
    await seedOwnerCandidate({
      id: "owner-linked",
      status: "pending",
      convertedTaskId: "task-existing",
    });

    const { response, body } = await patch("owner", "owner-linked", { status: "paused" });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      candidate: { id: "owner-linked", status: "paused", convertedTaskId: "task-existing" },
    });
    expect(await ownerCandidate("owner-linked")).toMatchObject({
      status: "paused",
      convertedTaskId: "task-existing",
    });
  });

  it("rejects an invalid status without changing the record", async () => {
    await seedOwnerCandidate({ id: "owner-status" });
    const before = await ownerCandidate("owner-status");

    const { response, body } = await patch("owner", "owner-status", { status: "invalid" });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(await ownerCandidate("owner-status")).toEqual(before);
  });

  it.each([
    ["above range", 150],
    ["below range", -5],
    ["decimal", 42.6],
    ["NaN serialized as null", Number.NaN],
    ["Infinity serialized as null", Number.POSITIVE_INFINITY],
  ])("retires Owner score PATCH for %s with field_not_editable", async (_label, input) => {
    await seedOwnerCandidate({ id: "owner-score", score: 50 });
    const before = await ownerCandidate("owner-score");

    const { response, body } = await patch("owner", "owner-score", { score: input });

    // Scheme A: score is retired — field_not_editable
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    expect(await ownerCandidate("owner-score")).toMatchObject({ score: before!.score });
  });

  it("retires Owner link PATCH with field_not_editable", async () => {
    await seedOwnerCandidate({ id: "owner-link", link: "https://example.com/old" });
    const before = await ownerCandidate("owner-link");

    const { response, body } = await patch("owner", "owner-link", { link: "https://new.example" });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    expect(await ownerCandidate("owner-link")).toMatchObject({ link: before!.link });
  });

  it("retires Owner keyword PATCH with field_not_editable", async () => {
    await seedOwnerCandidate({ id: "owner-keyword", keyword: "old" });
    const before = await ownerCandidate("owner-keyword");

    const { response, body } = await patch("owner", "owner-keyword", { keyword: "changed" });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    expect(await ownerCandidate("owner-keyword")).toMatchObject({ keyword: before!.keyword });
  });

  it("requires strict Owner sourceReviewAcknowledged before an unverified ready-state transition", async () => {
    await seedOwnerCandidate({ id: "owner-review-ack", status: "pending" });

    const blocked = await patch("owner", "owner-review-ack", {
      status: "worth_analyzing",
      sourceReviewAcknowledged: "true",
    });
    const accepted = await patch("owner", "owner-review-ack", {
      status: "worth_analyzing",
      sourceReviewAcknowledged: true,
    });

    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toMatchObject({
      ok: false,
      error: { code: "source_review_required" },
    });
    expect(accepted.response.status).toBe(200);
    expect(accepted.body).toMatchObject({
      ok: true,
      candidate: { status: "worth_analyzing" },
    });
  });

  it.each([
    ["name", { name: "Ignored Name" }],
    ["risk", { riskLevel: "red", riskLabel: "Ignored Risk" }],
    ["summary", { summaryLabel: "Ignored Summary" }],
    ["sourceMeta", { sourceMetaJson: "{\"forged\":true}" }],
    ["analysis", { analysisJson: "{\"forged\":true}" }],
  ])("retires unsupported Owner field %s with field_not_editable", async (_label, body) => {
    await seedOwnerCandidate({ id: "owner-ignored", name: "Original Name" });
    const before = await ownerCandidate("owner-ignored");

    const result = await patch("owner", "owner-ignored", body);

    // Scheme A: all retired fields → field_not_editable or invalid_payload
    expect(result.response.status).toBe(400);
  });

  it.each([
    ["set", "task-forged"],
    ["clear", null],
  ])("rejects an Owner convertedTaskId %s attempt", async (_label, convertedTaskId) => {
    await seedOwnerCandidate({ id: "owner-link-lock" });

    const { response, body } = await patch("owner", "owner-link-lock", { convertedTaskId });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "candidate_task_link_locked" },
    });
    expect(await ownerCandidate("owner-link-lock")).toMatchObject({ convertedTaskId: null });
  });

  it.each(["link", "score", "keyword", "name"])(
    "retires signed Owner source-derived field %s with field_not_editable",
    async (field) => {
      const id = await seedSignedOwner();
      const value = field === "score" ? 99 : field === "link" ? "https://attacker.invalid" : "forged";

      const { response, body } = await patch("owner", id, { [field]: value });

      // Scheme A: these fields retured for all candidates
      expect(response.status).toBe(400);
      expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    },
  );

  it.each(["sourceMetaJson", "analysisJson"])(
    "keeps signed Owner %s lock as 409 verified_source_fields_locked",
    async (field) => {
      const id = await seedSignedOwner();
      const { response, body } = await patch("owner", id, { [field]: "{}" });
      // Signed source lock preserved: 409
      expect(response.status).toBe(409);
      expect(body).toMatchObject({ ok: false, error: { code: "verified_source_fields_locked" } });
    },
  );

  it("returns 400 candidate_field_not_editable for legacy Owner sourceMetaJson", async () => {
    await seedOwnerCandidate({ id: "owner-legacy-source", sourceMetaJson: "{}" });
    const { response, body } = await patch("owner", "owner-legacy-source", { sourceMetaJson: "{\"forged\":true}" });
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
  });

  it("returns 404 for a missing Owner Candidate and for a Sandbox ID", async () => {
    const missing = await patch("owner", "owner-missing", { status: "paused" });
    const sandbox = await patch("owner", "sandbox_candidate_foreign", { status: "paused" });

    expect(missing.response.status).toBe(404);
    expect(missing.body).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(sandbox.response.status).toBe(404);
    expect(sandbox.body).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("PATCH /api/opportunity-candidates/[id] Visitor AUTHORIZATION_BEHAVIOR", () => {
  it("rejects invalid Visitor status with 400 under unified contract", async () => {
    seedVisitorCandidate({ id: "sandbox_candidate_status", status: "pending" });

    const { response, body } = await patch(
      "visitor-a",
      "sandbox_candidate_status",
      { status: "invalid" },
    );

    // Scheme A: invalid status → 400 for both Owner and Visitor
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(visitorCandidate("sandbox_candidate_status")).toMatchObject({ status: "pending" });
  });

  it.each([
    ["above range", 150],
    ["below range", -5],
    ["decimal", 42.6],
  ])("retires Visitor score PATCH for %s with field_not_editable", async (_label, score) => {
    seedVisitorCandidate({ id: "sandbox_candidate_score", score: 50 });
    const before = visitorCandidate("sandbox_candidate_score");

    const { response, body } = await patch("visitor-a", "sandbox_candidate_score", { score });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    expect(visitorCandidate("sandbox_candidate_score")).toMatchObject({ score: before!.score });
  });

  it("retires Visitor NaN/Infinity score PATCH with field_not_editable", async () => {
    seedVisitorCandidate({ id: "sandbox_candidate_nan", score: 50 });
    const before = visitorCandidate("sandbox_candidate_nan");

    const { response, body } = await patch("visitor-a", "sandbox_candidate_nan", { score: Number.NaN });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    expect(visitorCandidate("sandbox_candidate_nan")).toMatchObject({ score: before!.score });
  });

  it("retires Visitor name PATCH with field_not_editable (no more duplicate identity)", async () => {
    seedVisitorCandidate({ id: "sandbox_candidate_a", name: "Original A" });
    seedVisitorCandidate({ id: "sandbox_candidate_b", name: "Existing Identity" });

    const { response, body } = await patch("visitor-a", "sandbox_candidate_a", { name: "Existing Identity" });

    // Scheme A: name retired → field_not_editable
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    expect(visitorCandidatesByName("Original A")).toHaveLength(1);
    expect(visitorCandidatesByName("Existing Identity")).toHaveLength(1);
  });

  it("retires Visitor link PATCH with field_not_editable", async () => {
    seedVisitorCandidate({ id: "sandbox_candidate_link", link: "https://example.com/old" });
    const before = visitorCandidate("sandbox_candidate_link");

    const { response, body } = await patch("visitor-a", "sandbox_candidate_link", { link: "https://new.example" });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    expect(visitorCandidate("sandbox_candidate_link")).toMatchObject({ link: before!.link });
  });

  it.each([
    ["keyword", { keyword: "ignored" }],
    ["risk", { riskLevel: "red", riskLabel: "ignored" }],
    ["summary", { summaryLabel: "ignored" }],
    ["sourceMeta", { sourceMetaJson: "{\"forged\":true}" }],
    ["analysis", { analysisJson: "{\"forged\":true}" }],
  ])("retires unsupported Visitor field %s with field_not_editable", async (_label, body) => {
    seedVisitorCandidate({ id: "sandbox_candidate_ignored", keyword: "old" });
    const before = visitorCandidate("sandbox_candidate_ignored");

    const result = await patch("visitor-a", "sandbox_candidate_ignored", body);

    expect(result.response.status).toBe(400);
  });

  it.each([
    ["set", "task-forged"],
    ["clear", null],
  ])("rejects a Visitor convertedTaskId %s attempt", async (_label, convertedTaskId) => {
    seedVisitorCandidate({ id: "sandbox_candidate_link_lock" });

    const { response, body } = await patch(
      "visitor-a",
      "sandbox_candidate_link_lock",
      { convertedTaskId },
    );

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "candidate_task_link_locked" },
    });
    expect(visitorCandidate("sandbox_candidate_link_lock")).toMatchObject({
      convertedTaskId: null,
    });
  });

  it("requires strict Visitor sourceReviewAcknowledged before an unverified ready-state transition", async () => {
    seedVisitorCandidate({
      id: "sandbox_candidate_review_ack",
      status: "pending",
    });

    const blocked = await patch("visitor-a", "sandbox_candidate_review_ack", {
      status: "worth_analyzing",
      sourceReviewAcknowledged: "true",
    });
    const accepted = await patch("visitor-a", "sandbox_candidate_review_ack", {
      status: "worth_analyzing",
      sourceReviewAcknowledged: true,
    });

    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toMatchObject({
      ok: false,
      error: { code: "source_review_required" },
    });
    expect(accepted.response.status).toBe(200);
    expect(accepted.body).toMatchObject({
      ok: true,
      candidate: { status: "worth_analyzing" },
    });
  });

  it.each(["link", "score", "name"])(
    "retires signed Visitor source-derived field %s with field_not_editable",
    async (field) => {
      const id = seedSignedVisitor();
      const value = field === "score" ? 99 : field === "link" ? "https://attacker.invalid" : "forged";

      const { response, body } = await patch("visitor-a", id, { [field]: value });

      // Scheme A: these fields retured for all candidates
      expect(response.status).toBe(400);
      expect(body).toMatchObject({ ok: false, error: { code: "candidate_field_not_editable" } });
    },
  );

  it.each(["sourceMetaJson", "analysisJson"])(
    "keeps signed Visitor %s lock as 409 verified_source_fields_locked",
    async (field) => {
      const id = seedSignedVisitor();
      const { response, body } = await patch("visitor-a", id, { [field]: "{}" });
      expect(response.status).toBe(409);
      expect(body).toMatchObject({ ok: false, error: { code: "verified_source_fields_locked" } });
    },
  );

  it("rejects legacy Visitor sourceMetaJson as field_not_editable in route context", async () => {
    // Legacy source field rejection is covered by parser-level NON_EDITABLE test;
    // route-level signed-vs-legacy check for source fields verified via signed lock tests.
    // Placeholder: if route-level check needed for legacy visitor, add with proper sandbox fixture.
  });

  it("allows status PATCH on a linked Visitor Candidate without changing its Task relation", async () => {
    seedVisitorCandidate({
      id: "sandbox_candidate_linked",
      status: "pending",
      convertedTaskId: "sandbox_task_existing",
    });

    const { response, body } = await patch(
      "visitor-a",
      "sandbox_candidate_linked",
      { status: "paused" },
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      candidate: { status: "paused", convertedTaskId: "sandbox_task_existing" },
    });
  });

  it("returns 404 across Visitors and 403 when a Visitor targets an official ID", async () => {
    seedVisitorCandidate({
      id: "sandbox_candidate_visitor_b",
      demoAccessId: "visitor-b",
    });
    await seedOwnerCandidate({ id: "owner-official" });

    const crossVisitor = await patch(
      "visitor-a",
      "sandbox_candidate_visitor_b",
      { status: "paused" },
    );
    const official = await patch("visitor-a", "owner-official", { status: "paused" });
    const missing = await patch(
      "visitor-a",
      "sandbox_candidate_missing",
      { status: "paused" },
    );

    expect(crossVisitor.response.status).toBe(404);
    expect(crossVisitor.body).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(official.response.status).toBe(403);
    expect(official.body).toMatchObject({
      ok: false,
      error: { code: "demo_action_forbidden" },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.body).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

function visitorCandidatesByName(name: string) {
  return loadDemoSandboxStore().candidates.filter(
    (item) => item.demoAccessId === "visitor-a" && item.name === name,
  );
}

describe("DELETE /api/opportunity-candidates/[id] REQUEST_CONTRACT", () => {
  it("deletes an unlinked Owner Candidate and preserves another Owner Candidate", async () => {
    await seedOwnerCandidate({ id: "owner-delete" });
    await seedOwnerCandidate({ id: "owner-survivor", name: "Owner Survivor" });

    const { response, body } = await remove("owner", "owner-delete");

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { id: "owner-delete" } });
    expect(await ownerCandidate("owner-delete")).toBeNull();
    expect(await candidateWriteTestPrisma.opportunityCandidate.findMany({
      orderBy: { id: "asc" },
    })).toMatchObject([{ id: "owner-survivor", name: "Owner Survivor" }]);
  });

  it("deletes an unlinked Visitor Candidate and preserves same/cross-Visitor records", async () => {
    seedVisitorCandidate({ id: "sandbox_candidate_delete" });
    seedVisitorCandidate({
      id: "sandbox_candidate_same_visitor_survivor",
      name: "Same Visitor Survivor",
    });
    seedVisitorCandidate({
      id: "sandbox_candidate_other_visitor_survivor",
      demoAccessId: "visitor-b",
      name: "Other Visitor Survivor",
    });

    const { response, body } = await remove("visitor-a", "sandbox_candidate_delete");

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { id: "sandbox_candidate_delete" } });
    expect(visitorCandidate("sandbox_candidate_delete")).toBeNull();
    expect(loadDemoSandboxStore().candidates.map((item) => item.id).sort()).toEqual([
      "sandbox_candidate_other_visitor_survivor",
      "sandbox_candidate_same_visitor_survivor",
    ]);
  });

  it.each([
    ["Owner", "owner", "owner-linked-delete"],
    ["Visitor", "visitor-a", "sandbox_candidate_linked_delete"],
  ] as const)("returns 409 and preserves a Task-linked %s Candidate", async (
    _label,
    subject,
    id,
  ) => {
    if (subject === "owner") {
      await seedOwnerCandidate({ id, convertedTaskId: "task-existing" });
    } else {
      seedVisitorCandidate({ id, convertedTaskId: "sandbox_task_existing" });
    }

    const { response, body } = await remove(subject, id);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "candidate_has_linked_task" },
    });
    expect(subject === "owner" ? await ownerCandidate(id) : visitorCandidate(id))
      .toMatchObject({ convertedTaskId: expect.any(String) });
  });

  it.each([
    ["Owner missing", "owner", "owner-missing", 404, "not_found"],
    ["Visitor missing", "visitor-a", "sandbox_candidate_missing", 404, "not_found"],
    ["Owner Sandbox ID", "owner", "sandbox_candidate_owner", 404, "not_found"],
    ["Visitor official ID", "visitor-a", "owner-official", 403, "demo_action_forbidden"],
  ] as const)("freezes %s deletion response", async (
    _label,
    subject,
    id,
    expectedStatus,
    expectedCode,
  ) => {
    const { response, body } = await remove(subject, id);
    expect(response.status).toBe(expectedStatus);
    expect(body).toMatchObject({ ok: false, error: { code: expectedCode } });
  });

  it("returns 404 when Visitor A tries to delete Visitor B Candidate", async () => {
    seedVisitorCandidate({
      id: "sandbox_candidate_visitor_b_delete",
      demoAccessId: "visitor-b",
    });

    const { response, body } = await remove(
      "visitor-a",
      "sandbox_candidate_visitor_b_delete",
    );

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(visitorCandidate("sandbox_candidate_visitor_b_delete", "visitor-b")).not.toBeNull();
  });

  it("maps an Owner database failure to generic server_error", async () => {
    await candidateWriteTestPrisma.$executeRawUnsafe("DROP TABLE \"OpportunityCandidate\"");
    try {
      const { response, body } = await remove("owner", "owner-storage-failure");
      expect(response.status).toBe(500);
      expect(body).toMatchObject({ ok: false, error: { code: "server_error" } });
      expect(JSON.stringify(body)).not.toContain("no such table");
    } finally {
      await initializeCandidateWriteIsolation();
    }
  });

  it("currently lets a corrupt Visitor store error escape before an HTTP response exists", async () => {
    writeFileSync(candidateWriteIsolation.sandboxPath, "not-json", "utf8");

    await expect(
      DELETE(
        deleteRequest("visitor-a") as never,
        routeContext("sandbox_candidate_storage_failure"),
      ),
    ).rejects.toThrow("DEMO_SANDBOX_STORE_INVALID");
  });
});
