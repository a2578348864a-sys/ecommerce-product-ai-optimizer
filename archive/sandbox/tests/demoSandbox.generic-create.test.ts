import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createGenericSandboxTask,
  listSandboxTasks,
} from "@/lib/server/demoSandbox";
import { SYSTEM_MANAGED_TASK_RESULT_KEYS } from "@/lib/server/taskResultNamespacePolicy";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "qx-generic-sandbox-"));
  process.env.DEMO_SANDBOX_STORE_PATH = join(root, "sandbox.json");
});

afterEach(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  rmSync(root, { recursive: true, force: true });
});

describe("Visitor generic task creation boundary", () => {
  it.each(SYSTEM_MANAGED_TASK_RESULT_KEYS)("rejects %s in the storage API without a partial task", (key) => {
    expect(() => createGenericSandboxTask("visitor-generic", {
      resultJson: JSON.stringify({ score: 1, [key]: { injected: true } }),
    })).toThrowError(expect.objectContaining({ code: "reserved_system_namespace", key }));
    expect(listSandboxTasks("visitor-generic")).toHaveLength(0);
  });

  it("allows an ordinary legacy/mock result", async () => {
    await createGenericSandboxTask("visitor-generic", {
      source: "mock",
      resultJson: JSON.stringify({ score: 1, sellingPoints: ["Synthetic"] }),
    });
    expect(listSandboxTasks("visitor-generic")).toHaveLength(1);
  });
});
