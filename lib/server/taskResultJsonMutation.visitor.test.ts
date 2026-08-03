import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";

let root = "";
const visitor = {
  mode: "demo" as const,
  token: "",
  demoAccessId: "visitor-a",
  isActive: true,
  isExpired: false,
  remainingAiCalls: 0,
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "product-research-visitor-cas-"));
  process.env.DEMO_SANDBOX_STORE_PATH = join(root, "sandbox.json");
});

afterEach(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  rmSync(root, { recursive: true, force: true });
});

describe("Visitor task resultJson subject-lock CAS", () => {
  it("re-reads inside the subject lock and rejects one stale concurrent namespace writer", async () => {
    const task = createSandboxTask("visitor-a", {
      type: "workflow",
      resultJson: JSON.stringify({ unknownNamespace: { keep: true } }),
      decisionStatus: "continue",
    });
    const expectedStorageVersion = { resultJson: task.resultJson, updatedAt: task.updatedAt };
    const calls = await Promise.allSettled([
      mutateTaskResultJson({
        context: visitor,
        taskId: task.id,
        writer: "lifecycle",
        expectedStorageVersion,
        mutate: (document) => ({
          result: { ...document, productLifecycle: { state: "watching" } },
          value: null,
          visitorProductLifecycle: JSON.stringify({ state: "watching" }),
          updatedAt: "2026-08-03T01:00:00.000Z",
        }),
      }),
      mutateTaskResultJson({
        context: visitor,
        taskId: task.id,
        writer: "listing-pack",
        expectedStorageVersion,
        mutate: (document) => ({
          result: { ...document, listingPackSnapshot: { source: "synthetic" } },
          value: null,
          updatedAt: "2026-08-03T01:00:01.000Z",
        }),
      }),
    ]);
    expect(calls.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(calls.find((result) => result.status === "rejected"))
      .toMatchObject({ reason: { code: "task_result_conflict", status: 409 } });

    await mutateTaskResultJson({
      context: visitor,
      taskId: task.id,
      writer: "listing-pack",
      mutate: (document) => ({
        result: { ...document, listingPackSnapshot: { source: "retry" } },
        value: null,
        updatedAt: "2026-08-03T01:00:02.000Z",
      }),
    });
    await mutateTaskResultJson({
      context: visitor,
      taskId: task.id,
      writer: "lifecycle",
      mutate: (document) => ({
        result: { ...document, productLifecycle: { state: "ready" } },
        value: null,
        visitorProductLifecycle: JSON.stringify({ state: "ready" }),
        updatedAt: "2026-08-03T01:00:03.000Z",
      }),
    });
    const saved = getSandboxTask("visitor-a", task.id)!;
    const result = JSON.parse(saved.resultJson);
    expect(result.unknownNamespace).toEqual({ keep: true });
    expect(result.listingPackSnapshot).toEqual({ source: "retry" });
    expect(result.productLifecycle).toEqual({ state: "ready" });
  });

  it("does not expose or mutate another Visitor's task", async () => {
    const task = createSandboxTask("visitor-a", { type: "workflow", resultJson: "{}" });
    await expect(mutateTaskResultJson({
      context: { ...visitor, demoAccessId: "visitor-b" },
      taskId: task.id,
      writer: "listing-pack",
      mutate: (document) => ({ result: { ...document, listingPackSnapshot: {} }, value: null }),
    })).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(getSandboxTask("visitor-a", task.id)?.resultJson).toBe("{}");
  });
});
