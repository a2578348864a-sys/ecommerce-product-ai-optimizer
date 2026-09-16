/**
 * V3 Current Research Normalization — Visitor fixture journeys（临时 sandbox store，零真实数据影响）。
 * - need_info fixture：保存 need_info 决定 → 完成被拒（research_need_info）→ 仍留在商品研究（active_need_info）
 * - rejected fixture：保存 abandoned 决定 → 完成 → researchCompletion=abandoned → 已放弃历史（historical_abandoned）+ 幂等
 * - creative_ready fixture：保存 → 完成 → completed → historical_completed + 决定只读
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempRoot = mkdtempSync(join(tmpdir(), "qz-research-normalization-"));
const sandboxStorePath = join(tempRoot, "demo-sandbox.json");
const accessStorePath = join(tempRoot, "demo-access.json");

beforeAll(() => {
  writeFileSync(sandboxStorePath, JSON.stringify({ version: 1, tasks: [], candidates: [] }));
  writeFileSync(accessStorePath, JSON.stringify({ version: 1, accesses: [] }));
  process.env.DEMO_SANDBOX_STORE_PATH = sandboxStorePath;
  process.env.DEMO_ACCESS_STORE_PATH = accessStorePath;
});

afterAll(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  delete process.env.DEMO_ACCESS_STORE_PATH;
  rmSync(tempRoot, { recursive: true, force: true });
});

import { createSandboxCandidate, createSandboxTaskAndLinkCandidate } from "@/lib/server/demoSandbox";
import {
  completeCurrentResearch,
  getProductResearchDecisionState,
  updateProductResearchDecision,
} from "@/lib/server/productResearchRecordStore";
import { classifyResearchLifecycle } from "@/lib/researchLifecycle";

const DEMO = "visitor-fixture";
const context = {
  mode: "demo" as const,
  token: "",
  demoAccessId: DEMO,
  isActive: true,
  isExpired: false,
  remainingAiCalls: 0,
};

function decide(status: "creative_ready" | "needs_information" | "abandoned", reason: string, nextAction: string | null) {
  return { decisionId: randomUUID(), status, reason, nextAction };
}

async function fixtureTask() {
  const candidate = await createSandboxCandidate(DEMO, {
    name: "Fixture Water Bottle",
    status: "worth_analyzing",
  });
  const task = await createSandboxTaskAndLinkCandidate(DEMO, candidate.id, {
    type: "workflow",
    resultJson: JSON.stringify({
      type: "workflow",
      candidateToTask: { version: 1, candidateId: candidate.id, confirmation: "research_started", confirmedAt: "2026-08-17T00:00:00.000Z" },
    }),
  });
  return task.id;
}

describe("V3 Current Research Normalization fixture journeys（visitor / 临时 store）", () => {
  it("need_info：完成被拒（research_need_info）→ 仍留在商品研究（active_need_info）", async () => {
    const taskId = await fixtureTask();
    const saved = await updateProductResearchDecision(context, taskId, {
      expectedRevision: 1,
      decision: decide("needs_information", "需补充货源证据", "收集 1688 货源"),
    });
    expect(saved.kind).toBe("created");
    expect(saved.state.record?.revision).toBe(1);

    await expect(completeCurrentResearch(context, taskId, {}))
      .rejects.toMatchObject({ code: "research_need_info", status: 409 });

    const state = await getProductResearchDecisionState(context, taskId);
    expect(state.readOnly).toBe(false);
    const lifecycle = classifyResearchLifecycle({
      decisionStatus: "need_info",
      result: { researchRecord: state.record },
      type: "workflow",
    });
    expect(lifecycle).toMatchObject({ lifecycle: "active", detail: "active_need_info" });
  });

  it("rejected：abandoned 决定 → 完成 → historical_abandoned（已放弃历史）+ 幂等", async () => {
    const taskId = await fixtureTask();
    await updateProductResearchDecision(context, taskId, {
      expectedRevision: 1,
      decision: decide("abandoned", "放弃该商品研究", null),
    });

    const completed = await completeCurrentResearch(context, taskId, {});
    expect(completed.lifecycle).toBe("abandoned");
    expect(completed.idempotent).toBe(false);

    const lifecycle = classifyResearchLifecycle({
      decisionStatus: "rejected",
      result: { researchCompletion: { schema: "research-completion.v1", status: completed.lifecycle } },
      type: "workflow",
    });
    expect(lifecycle).toMatchObject({ lifecycle: "historical", detail: "historical_abandoned" });

    const again = await completeCurrentResearch(context, taskId, {});
    expect(again.idempotent).toBe(true);
    expect(again.lifecycle).toBe("abandoned");
  });

  it("creative_ready：保存 → 完成 → historical_completed + 决定只读", async () => {
    const taskId = await fixtureTask();
    await updateProductResearchDecision(context, taskId, {
      expectedRevision: 1,
      decision: decide("creative_ready", "证据完整可继续", null),
    });

    const completed = await completeCurrentResearch(context, taskId, {});
    expect(completed.lifecycle).toBe("completed");

    const lifecycle = classifyResearchLifecycle({
      decisionStatus: "continue",
      result: { researchCompletion: { schema: "research-completion.v1", status: completed.lifecycle } },
      type: "workflow",
    });
    expect(lifecycle).toMatchObject({ lifecycle: "historical", detail: "historical_completed" });

    const state = await getProductResearchDecisionState(context, taskId);
    expect(state.readOnly).toBe(true);
  });
});
