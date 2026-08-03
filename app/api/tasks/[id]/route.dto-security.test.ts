import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ mode: "owner" as "owner" | "demo", resultJson: "{}" }));
const ownerRecord = vi.hoisted(() => ({
  id: "owner-task",
  createdAt: new Date("2026-08-03T00:00:00.000Z"),
  updatedAt: new Date("2026-08-03T00:00:00.000Z"),
  type: "workflow",
  decisionStatus: "continue",
  title: "Synthetic",
  platform: "manual",
  productUrl: null,
  materialText: "Synthetic",
  source: "agent_run",
  score: 1,
  level: "low",
  oneLineSummary: "Synthetic",
  resultJson: "{}",
}));

vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: () => null,
  getAccessContext: () => state.mode === "demo"
    ? { mode: "demo", demoAccessId: "visitor-current", token: "" }
    : { mode: "owner", token: "" },
}));
vi.mock("@/lib/server/demoGuard", () => ({ requireAuthenticated: vi.fn(), requireOwnerOnly: vi.fn() }));
vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: { findFirst: () => ({ ...ownerRecord, resultJson: state.resultJson }) },
    opportunityCandidate: { findFirst: () => null },
  },
}));
vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_task_"),
  getSandboxCandidate: () => null,
  getSandboxTask: () => ({
    ...ownerRecord,
    id: "sandbox_task_public",
    demoAccessId: "visitor-current",
    createdAt: ownerRecord.createdAt.toISOString(),
    updatedAt: ownerRecord.updatedAt.toISOString(),
    resultJson: state.resultJson,
    productLifecycle: "{}",
  }),
  sandboxTaskToDetail: (task: Record<string, unknown>) => ({
    id: task.id, createdAt: task.createdAt, updatedAt: task.updatedAt, type: task.type,
    decisionStatus: task.decisionStatus, title: task.title, platform: task.platform,
    productUrl: task.productUrl, materialText: task.materialText, source: task.source,
    score: task.score, level: task.level, oneLineSummary: task.oneLineSummary,
  }),
}));
vi.mock("@/lib/server/aiImageDraftStorage", () => ({ cleanupAiImageTask: vi.fn() }));

import { GET } from "@/app/api/tasks/[id]/route";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("Owner and Visitor task detail DTO security", () => {
  beforeEach(() => {
    const hash = "b".repeat(64);
    state.resultJson = JSON.stringify({
      productName: "Synthetic",
      sourceMeta: { source: "opportunity", sourceTitle: "Safe", candidateId: "internal", contextHash: hash },
      researchVerification: { inputHash: hash, resultHash: hash },
      unknownInternalNamespace: { decisionId: "internal" },
      futureSecretField: "internal",
    });
  });

  it.each([
    ["owner", "owner-task"],
    ["demo", "sandbox_task_public"],
  ] as const)("protects the %s detail response", async (mode, id) => {
    state.mode = mode;
    const response = await GET(new NextRequest(`http://localhost/api/tasks/${id}`), context(id));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.result).toEqual({
      productName: "Synthetic",
      sourceMeta: { source: "opportunity", sourceTitle: "Safe" },
    });
    const serialized = JSON.stringify(body);
    for (const key of ["candidateId", "contextHash", "researchVerification", "inputHash", "resultHash", "decisionId", "unknownInternalNamespace", "futureSecretField"]) {
      expect(serialized).not.toContain(`\"${key}\"`);
    }
  });
});
