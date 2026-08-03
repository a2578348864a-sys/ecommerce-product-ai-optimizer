import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
} from "@/lib/server/taskResultJsonMutation";

let tempDirectory = "";

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "qx-pr1-sandbox-cas-"));
  process.env.DEMO_SANDBOX_STORE_PATH = join(tempDirectory, "sandbox.json");
});

afterEach(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  rmSync(tempDirectory, { recursive: true, force: true });
});

function mutateVisitor(task: Awaited<ReturnType<typeof createTrustedSandboxTask>>, demoAccessId: string, marker: string) {
  return mutateTaskResultJson({
    context: {
      mode: "demo",
      demoAccessId,
      token: "synthetic-test-token",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 5,
    },
    taskId: task.id,
    writer: "listing-pack",
    expectedStorageVersion: { resultJson: task.resultJson, updatedAt: task.updatedAt },
    mutate: (document) => ({
      result: { ...document, listingPackSnapshot: { marker } },
      value: null,
    }),
  });
}

describe("Visitor product-research shared mutation CAS", () => {
  it("updates only the owning Visitor through the shared namespace writer", async () => {
    const task = await createTrustedSandboxTask("visitor-a", { resultJson: '{"unknownNamespace":{"keep":true}}' });
    await mutateVisitor(task, "visitor-a", "winner");
    expect(JSON.parse(getSandboxTask("visitor-a", task.id)!.resultJson)).toEqual({
      unknownNamespace: { keep: true },
      listingPackSnapshot: { marker: "winner" },
    });
  });

  it("returns conflict for a stale snapshot and does not overwrite the winner", async () => {
    const task = await createTrustedSandboxTask("visitor-a", { resultJson: '{"unknownNamespace":{"keep":true}}' });
    await mutateVisitor(task, "visitor-a", "winner");
    await expect(mutateVisitor(task, "visitor-a", "loser")).rejects.toMatchObject({
      code: "task_result_conflict",
      status: 409,
    } satisfies Partial<TaskResultJsonMutationError>);
    expect(JSON.parse(getSandboxTask("visitor-a", task.id)!.resultJson).listingPackSnapshot)
      .toEqual({ marker: "winner" });
  });

  it("returns not_found across Visitor identities without publishing a file change", async () => {
    const task = await createTrustedSandboxTask("visitor-a", { resultJson: "{}" });
    const before = getSandboxTask("visitor-a", task.id);
    await expect(mutateVisitor(task, "visitor-b", "forbidden")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    } satisfies Partial<TaskResultJsonMutationError>);
    expect(getSandboxTask("visitor-a", task.id)).toEqual(before);
  });
});
