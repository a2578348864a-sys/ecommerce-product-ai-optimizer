import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxCandidate: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxCandidateId: (id: string) => id.startsWith("sandbox_candidate_"),
  getSandboxCandidate: mocks.getSandboxCandidate,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    opportunityCandidate: {
      findUnique: mocks.findUnique,
    },
  },
}));

import { getAuthoritativeCandidate } from "@/lib/server/candidateAuthority";

const visitorContext = (demoAccessId: string) => ({
  mode: "demo" as const,
  token: `${demoAccessId}-token`,
  demoAccessId,
  isActive: true,
  isExpired: false,
  remainingAiCalls: 5,
});
const ownerContext = { mode: "owner" as const, token: "owner-token" };

const SANDBOX_CANDIDATE = {
  id: "sandbox_candidate_a",
  name: "Visitor A Product",
  rawInput: "Visitor A Product",
  link: null,
  score: 0,
  source: "SellerSprite ProductBatch",
  keyword: "",
  riskLevel: "unknown",
  riskLabel: "需人工核验",
  summaryLabel: "研究候选",
  status: "worth_analyzing",
  sourceMetaJson: "{}",
  analysisJson: "{}",
  convertedTaskId: null,
  originProductBatchItemId: "item-a",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSandboxCandidate.mockImplementation((demoAccessId, candidateId) => (
    demoAccessId === "visitor-a" && candidateId === SANDBOX_CANDIDATE.id
      ? SANDBOX_CANDIDATE
      : null
  ));
});

describe("Candidate Authority identity isolation", () => {
  it("lets Visitor A read only Visitor A's sandbox Candidate", async () => {
    await expect(getAuthoritativeCandidate(
      visitorContext("visitor-a"),
      SANDBOX_CANDIDATE.id,
    )).resolves.toMatchObject({ id: SANDBOX_CANDIDATE.id, name: "Visitor A Product" });

    await expect(getAuthoritativeCandidate(
      visitorContext("visitor-b"),
      SANDBOX_CANDIDATE.id,
    )).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("keeps Owner and Visitor Candidate namespaces mutually unreadable", async () => {
    mocks.findUnique.mockResolvedValue({
      ...SANDBOX_CANDIDATE,
      id: "owner-candidate-a",
      originProductBatchItemId: null,
    });

    await expect(getAuthoritativeCandidate(
      ownerContext,
      SANDBOX_CANDIDATE.id,
    )).resolves.toBeNull();
    await expect(getAuthoritativeCandidate(
      visitorContext("visitor-a"),
      "owner-candidate-a",
    )).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
