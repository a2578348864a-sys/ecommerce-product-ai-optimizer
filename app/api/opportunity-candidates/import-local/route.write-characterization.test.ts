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
  saveSignedSandboxCandidates,
} from "@/lib/server/demoSandbox";
import {
  preflightCandidateSaveBatch,
} from "@/lib/server/candidateSourceSave";
import {
  saveSignedCandidates,
} from "@/lib/server/opportunityCandidateService";
import { POST } from "./route";

type TestSubject = "owner" | "visitor-a";
let networkIsolation: ReturnType<typeof installCandidateWriteNetworkIsolation> | undefined;

function localDraft(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-local-forged",
    name,
    rawInput: `${name} raw`,
    link: "https://example.com/local-product",
    score: 77,
    source: "Local draft",
    keyword: "local",
    riskLevel: "yellow",
    riskLabel: "人工复核",
    summaryLabel: "Local summary",
    status: "analyzed",
    candidateStatus: "rejected",
    convertedTaskId: "forged-task",
    sourceMetaJson: JSON.stringify({ integrity: "signed_source_v2", forged: true }),
    analysisJson: JSON.stringify({ trusted: true }),
    scopeId: "forged-scope",
    demoAccessId: "visitor-b",
    subject: "demo:visitor-b",
    ...overrides,
  };
}

function request(
  subject: TestSubject,
  items: readonly unknown[],
  extraBody: Record<string, unknown> = {},
) {
  return new Request("http://localhost/api/opportunity-candidates/import-local", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-characterization-subject": subject,
    },
    body: JSON.stringify({ items, ...extraBody }),
  });
}

async function post(
  subject: TestSubject,
  items: readonly unknown[],
  extraBody: Record<string, unknown> = {},
) {
  const response = await POST(request(subject, items, extraBody) as never);
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

function signedPreflightItem(
  subject: "owner" | "demo:visitor-a",
  title = "Foldable Widget Stand",
) {
  const sourceEvidence = normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: `import-signed-${title.toLowerCase().replaceAll(" ", "-")}`,
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

beforeAll(async () => {
  await initializeCandidateWriteIsolation();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  networkIsolation = installCandidateWriteNetworkIsolation("candidate-import");
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

describe("POST /api/opportunity-candidates/import-local REQUEST_CONTRACT", () => {
  it("imports an Owner local draft while stripping authority and signed-source fields", async () => {
    const { response, body } = await post("owner", [localDraft("Owner Local Product")]);
    const stored = await ownerCandidates();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, imported: 1, skipped: 0 });
    expect(stored).toHaveLength(1);
    expect(stored[0].id).not.toBe("opp-local-forged");
    expect(stored[0]).toMatchObject({
      name: "Owner Local Product",
      status: "pending",
      convertedTaskId: null,
      source: "Local draft",
    });
    expect(stored[0].sourceMetaJson).toContain("legacy_unverified");
    expect(stored[0].sourceMetaJson).not.toContain("forged");
    expect(stored[0].analysisJson).not.toContain("trusted");
  });

  it("binds a Visitor import to the authenticated Visitor instead of body scope fields", async () => {
    const { response, body } = await post(
      "visitor-a",
      [localDraft("Visitor Local Product")],
      {
        scopeId: "forged-scope",
        demoAccessId: "visitor-b",
        subject: "demo:visitor-b",
      },
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      imported: 1,
      skipped: 0,
      isSandbox: true,
      sourceMode: "demo_sandbox",
    });
    expect(visitorCandidates("visitor-a")).toHaveLength(1);
    expect(visitorCandidates("visitor-a")[0].id).not.toBe("opp-local-forged");
    expect(visitorCandidates("visitor-a")[0]).toMatchObject({
      demoAccessId: "visitor-a",
      name: "Visitor Local Product",
      status: "pending",
      convertedTaskId: null,
    });
    expect(visitorCandidates("visitor-b")).toHaveLength(0);
    expect(await ownerCandidates()).toHaveLength(0);
  });

  it("rejects a zero-item Visitor import", async () => {
    const { response, body } = await post("visitor-a", []);
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(visitorCandidates()).toHaveLength(0);
  });

  it.each([
    ["Visitor 20", "visitor-a", 20, 200, 20],
    ["Visitor 21", "visitor-a", 21, 400, 0],
    ["Owner 21", "owner", 21, 200, 21],
  ] as const)("freezes the current %s item limit", async (
    _label,
    subject,
    count,
    expectedStatus,
    expectedStored,
  ) => {
    const items = Array.from(
      { length: count },
      (_, index) => localDraft(`Local Product ${index + 1}`),
    );
    const { response, body } = await post(subject, items);

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(body).toMatchObject({ ok: true, imported: count, skipped: 0 });
    } else {
      expect(body).toMatchObject({
        ok: false,
        error: { code: "import_limit_exceeded" },
      });
    }
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates())
      .toHaveLength(expectedStored);
  });

  it.each([
    ["Owner", "owner"],
    ["Visitor", "visitor-a"],
  ] as const)("rejects a duplicate identity inside one %s import batch", async (_label, subject) => {
    const { response, body } = await post(subject, [
      localDraft("Import Duplicate"),
      localDraft("  IMPORT   DUPLICATE  "),
    ]);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "candidate_source_conflict" },
    });
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates()).toHaveLength(0);
  });

  it("maps an existing Owner legacy identity to updated and imported=1, skipped=0", async () => {
    expect((await post("owner", [localDraft("Existing Local")])).response.status).toBe(200);
    const existing = (await ownerCandidates())[0];

    const { response, body } = await post("owner", [
      localDraft("Existing Local", { score: 93, keyword: "changed" }),
    ]);
    const stored = await ownerCandidates();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, imported: 1, skipped: 0 });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: existing.id,
      score: 93,
      keyword: "changed",
      status: "pending",
    });
  });

  it("maps an existing Visitor legacy identity to another created row and imported=1", async () => {
    expect((await post("visitor-a", [localDraft("Existing Local")])).response.status).toBe(200);

    const { response, body } = await post("visitor-a", [
      localDraft("Existing Local", { score: 93 }),
    ]);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, imported: 1, skipped: 0 });
    expect(visitorCandidates()).toHaveLength(2);
    expect(visitorCandidates().map((item) => item.score)).toEqual([77, 93]);
  });

  it.each([
    ["Owner", "owner", "owner"],
    ["Visitor", "visitor-a", "demo:visitor-a"],
  ] as const)("rejects a %s local import that collides with a signed Candidate", async (
    _label,
    subject,
    proofSubject,
  ) => {
    const signed = signedPreflightItem(proofSubject);
    if (subject === "owner") {
      await saveSignedCandidates([signed]);
    } else {
      saveSignedSandboxCandidates("visitor-a", [signed]);
    }
    const before = subject === "owner" ? await ownerCandidates() : visitorCandidates();

    const { response, body } = await post(subject, [
      localDraft("Foldable Widget Stand"),
    ]);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "candidate_source_conflict" },
    });
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates()).toEqual(before);
  });

  it.each([
    ["Owner partly invalid", "owner", [localDraft("Safe Item"), null]],
    ["Owner entirely invalid", "owner", [null, 42]],
    ["Visitor partly invalid", "visitor-a", [localDraft("Safe Item"), null]],
    ["Visitor entirely invalid", "visitor-a", [null, 42]],
  ] as const)("rejects the whole %s batch without partial writes", async (
    _label,
    subject,
    items,
  ) => {
    const { response, body } = await post(subject, items);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(subject === "owner" ? await ownerCandidates() : visitorCandidates()).toHaveLength(0);
  });
});
