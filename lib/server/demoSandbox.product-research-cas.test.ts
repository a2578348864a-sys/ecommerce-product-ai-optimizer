import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSandboxTask,
  getSandboxTask,
  updateSandboxTaskResearchRecordCas,
} from "@/lib/server/demoSandbox";

let tempDirectory = "";

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "qx-pr1-sandbox-cas-"));
  process.env.DEMO_SANDBOX_STORE_PATH = join(tempDirectory, "sandbox.json");
});

afterEach(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Visitor product-research CAS", () => {
  it("updates only the owning Visitor when both old resultJson and updatedAt match", async () => {
    const task = createSandboxTask("visitor-a", {
      resultJson: '{"researchRecord":{"revision":1}}',
      decisionStatus: "continue",
    });

    const result = await updateSandboxTaskResearchRecordCas("visitor-a", task.id, {
      expectedResultJson: task.resultJson,
      expectedUpdatedAt: task.updatedAt,
      resultJson: '{"researchRecord":{"revision":2}}',
      decisionStatus: "need_info",
      updatedAt: "2026-08-03T03:00:00.000Z",
    });

    expect(result.status).toBe("updated");
    expect(getSandboxTask("visitor-a", task.id)).toMatchObject({
      resultJson: '{"researchRecord":{"revision":2}}',
      decisionStatus: "need_info",
      updatedAt: "2026-08-03T03:00:00.000Z",
    });
  });

  it("returns conflict for stale snapshots and does not overwrite the winner", async () => {
    const task = createSandboxTask("visitor-a", {
      resultJson: '{"researchRecord":{"revision":1}}',
    });
    const winner = await updateSandboxTaskResearchRecordCas("visitor-a", task.id, {
      expectedResultJson: task.resultJson,
      expectedUpdatedAt: task.updatedAt,
      resultJson: '{"researchRecord":{"revision":2}}',
      decisionStatus: "need_info",
      updatedAt: "2026-08-03T03:00:00.000Z",
    });
    const loser = await updateSandboxTaskResearchRecordCas("visitor-a", task.id, {
      expectedResultJson: task.resultJson,
      expectedUpdatedAt: task.updatedAt,
      resultJson: '{"researchRecord":{"revision":999}}',
      decisionStatus: "rejected",
      updatedAt: "2026-08-03T03:01:00.000Z",
    });

    expect(winner.status).toBe("updated");
    expect(loser.status).toBe("conflict");
    expect(getSandboxTask("visitor-a", task.id)?.resultJson).toBe('{"researchRecord":{"revision":2}}');
  });

  it("returns not_found across Visitor identities without publishing a file change", async () => {
    const task = createSandboxTask("visitor-a", { resultJson: "{}" });
    const before = getSandboxTask("visitor-a", task.id);

    const result = await updateSandboxTaskResearchRecordCas("visitor-b", task.id, {
      expectedResultJson: task.resultJson,
      expectedUpdatedAt: task.updatedAt,
      resultJson: '{"researchRecord":{"revision":2}}',
      decisionStatus: "rejected",
      updatedAt: "2026-08-03T03:00:00.000Z",
    });

    expect(result.status).toBe("not_found");
    expect(getSandboxTask("visitor-a", task.id)).toEqual(before);
  });
});
