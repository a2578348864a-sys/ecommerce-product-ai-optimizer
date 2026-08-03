import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSandboxCandidate,
  createTrustedSandboxTask,
  getSandboxTask,
  listSandboxCandidates,
  listSandboxTasks,
} from "@/lib/server/demoSandbox";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";

let root = "";
let storePath = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "demo-sandbox-store-consistency-"));
  storePath = join(root, "demo-sandbox.json");
  process.env.DEMO_SANDBOX_STORE_PATH = storePath;
});

afterEach(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
  rmSync(root, { recursive: true, force: true });
  expect(existsSync(root)).toBe(false);
});

describe("Visitor sandbox whole-store consistency", () => {
  it("preserves a Candidate created while a real task result writer is in flight", async () => {
    const visitorId = "visitor-store-consistency";
    const task = await createTrustedSandboxTask(visitorId, {
      resultJson: JSON.stringify({ unknownNamespace: { keep: true } }),
    });
    let mutationEntered!: () => void;
    const entered = new Promise<void>((resolve) => { mutationEntered = resolve; });
    let releaseMutation!: () => void;
    const release = new Promise<void>((resolve) => { releaseMutation = resolve; });

    const taskMutation = mutateTaskResultJson({
      context: {
        mode: "demo",
        token: "synthetic-visitor-token",
        demoAccessId: visitorId,
        isActive: true,
        isExpired: false,
        remainingAiCalls: 0,
      },
      taskId: task.id,
      writer: "listing-pack",
      mutate: async (current) => {
        mutationEntered();
        await release;
        return {
          result: { ...current, listingPackSnapshot: { source: "synthetic" } },
          value: null,
        };
      },
    });

    await entered;
    const candidateWrite = createSandboxCandidate(visitorId, {
      name: "Synthetic candidate",
    });
    releaseMutation();
    await Promise.all([taskMutation, candidateWrite]);

    expect(listSandboxCandidates(visitorId)).toHaveLength(1);
    const storedTask = getSandboxTask(visitorId, task.id);
    expect(JSON.parse(storedTask?.resultJson ?? "{}")).toMatchObject({
      unknownNamespace: { keep: true },
      listingPackSnapshot: { source: "synthetic" },
    });
  });

  it("preserves concurrent Candidate writes for the same Visitor", async () => {
    await Promise.all([
      createSandboxCandidate("visitor-a", { name: "Synthetic candidate A" }),
      createSandboxCandidate("visitor-a", { name: "Synthetic candidate B" }),
    ]);
    expect(listSandboxCandidates("visitor-a").map((item) => item.name).sort()).toEqual([
      "Synthetic candidate A",
      "Synthetic candidate B",
    ]);
  });

  it("serializes different Visitors that share the same physical Store", async () => {
    await Promise.all([
      createTrustedSandboxTask("visitor-a", { title: "Synthetic task A" }),
      createTrustedSandboxTask("visitor-b", { title: "Synthetic task B" }),
    ]);
    expect(listSandboxTasks("visitor-a")).toHaveLength(1);
    expect(listSandboxTasks("visitor-b")).toHaveLength(1);
    expect(readFileSync(storePath, "utf8")).toContain("Synthetic task A");
    expect(readFileSync(storePath, "utf8")).toContain("Synthetic task B");
  });

  it("releases the Store lock after a writer throws", async () => {
    const task = await createTrustedSandboxTask("visitor-a", { resultJson: "{}" });
    await expect(mutateTaskResultJson({
      context: {
        mode: "demo",
        token: "synthetic-visitor-token",
        demoAccessId: "visitor-a",
        isActive: true,
        isExpired: false,
        remainingAiCalls: 0,
      },
      taskId: task.id,
      writer: "listing-pack",
      mutate: () => { throw new Error("synthetic writer failure"); },
    })).rejects.toThrow("synthetic writer failure");
    await expect(createSandboxCandidate("visitor-a", { name: "After failure" })).resolves.toMatchObject({
      name: "After failure",
    });
  });

  it("fails closed on corrupt Store text without overwriting it", async () => {
    writeFileSync(storePath, "not-json", "utf8");
    await expect(createSandboxCandidate("visitor-a", { name: "Must not save" }))
      .rejects.toThrow("DEMO_SANDBOX_STORE_INVALID");
    expect(readFileSync(storePath, "utf8")).toBe("not-json");
  });
});
