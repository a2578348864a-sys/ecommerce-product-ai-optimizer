import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  resultJson: "{}",
}));

vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: () => null,
  getAccessContext: () => ({ mode: "demo", demoAccessId: "visitor-current", token: "" }),
}));
vi.mock("@/lib/server/demoGuard", () => ({ requireAuthenticated: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ prisma: {} }));
vi.mock("@/lib/server/demoSandbox", () => ({
  listSandboxCandidates: () => [],
  listSandboxTasks: () => [{
    id: "sandbox_task_public",
    demoAccessId: "visitor-current",
    type: "workflow",
    title: "Synthetic",
    decisionStatus: "continue",
    platform: "manual",
    productUrl: null,
    materialText: "Synthetic",
    source: "agent_run",
    score: 1,
    level: "low",
    oneLineSummary: "Synthetic",
    resultJson: state.resultJson,
    productLifecycle: "{}",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  }],
  sandboxTaskToListItem: (task: Record<string, unknown>) => ({
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    type: task.type,
    decisionStatus: task.decisionStatus,
    title: task.title,
    platform: task.platform,
    productUrl: task.productUrl,
    materialText: task.materialText,
    source: task.source,
    score: task.score,
    level: task.level,
    oneLineSummary: task.oneLineSummary,
  }),
}));

import { GET } from "@/app/api/tasks/route";

describe("Visitor task list DTO security", () => {
  beforeEach(() => {
    const hash = "a".repeat(64);
    state.resultJson = JSON.stringify({
      productName: "Synthetic",
      sourceMeta: { source: "opportunity", sourceTitle: "Safe", candidateId: "internal", contextHash: hash },
      researchVerification: { inputHash: hash, resultHash: hash },
      actorRef: "internal",
      decisionId: "internal",
      futureSecretField: "internal",
    });
  });

  it("returns an explicit allowlist and no internal binding fields", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.items[0].result).toMatchObject({
      productName: "Synthetic",
      legacyListSummary: {
        hasCandidateSource: true,
        workflow: { productName: "Synthetic" },
      },
    });
    expect(body.data.items[0].result).not.toHaveProperty("sourceMeta");
    const serialized = JSON.stringify(body);
    for (const key of ["candidateId", "contextHash", "researchVerification", "inputHash", "resultHash", "actorRef", "decisionId", "futureSecretField"]) {
      expect(serialized).not.toContain(`\"${key}\"`);
    }
  });
});
