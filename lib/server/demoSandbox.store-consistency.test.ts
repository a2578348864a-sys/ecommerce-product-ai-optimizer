import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSandboxCandidate,
  createTrustedSandboxTask,
  deleteSandboxTask,
  getSandboxCandidate,
  getSandboxTask,
  importSellerSpriteCandidatesForVisitor,
  listSandboxCandidates,
  listSandboxTasks,
  updateSandboxCandidate,
  updateSandboxTask,
} from "@/lib/server/demoSandbox";
import { replaceDemoSandboxStoreForTest } from "@/lib/server/demoSandbox.testSupport";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";

function visitorContext(demoAccessId: string) {
  return {
    mode: "demo" as const,
    token: "synthetic-visitor-token",
    demoAccessId,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 0,
  };
}

function sellerSpriteRow() {
  return {
    rowHash: "a".repeat(64),
    rowNumber: 2,
    asin: "B0TEST0001",
    parentAsin: null,
    title: "Synthetic SellerSprite candidate",
    amazonUrl: "https://www.amazon.com/dp/B0TEST0001",
    imageUrl: null,
    priceUsd: 10,
    rating: 4.5,
    reviewCount: 20,
    brand: "Synthetic",
    category: "Synthetic",
    searchRank: 1,
    estimatedMonthlySales: 10,
    estimatedMonthlyRevenueUsd: 100,
  };
}

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

  it("preserves a SellerSprite import racing with a Task update", async () => {
    const visitorId = "visitor-sellersprite-task-race";
    const task = await createTrustedSandboxTask(visitorId, { resultJson: "{}" });
    let entered!: () => void;
    const mutationEntered = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const mutationRelease = new Promise<void>((resolve) => { release = resolve; });

    const taskMutation = mutateTaskResultJson({
      context: visitorContext(visitorId),
      taskId: task.id,
      writer: "listing-pack",
      mutate: async (current) => {
        entered();
        await mutationRelease;
        return {
          result: { ...current, listingPackSnapshot: { source: "synthetic" } },
          value: null,
        };
      },
    });
    await mutationEntered;
    const importWrite = importSellerSpriteCandidatesForVisitor(visitorId, {
      rows: [sellerSpriteRow()],
      sourceFileSha256: "b".repeat(64),
      importedAt: "2026-08-03T00:00:00.000Z",
    });
    release();
    const [, imported] = await Promise.all([taskMutation, importWrite]);

    expect(imported.created).toHaveLength(1);
    expect(listSandboxCandidates(visitorId)).toHaveLength(1);
    expect(JSON.parse(getSandboxTask(visitorId, task.id)?.resultJson ?? "{}")).toMatchObject({
      listingPackSnapshot: { source: "synthetic" },
    });
  });

  it("preserves a Candidate update racing with a Task update", async () => {
    const visitorId = "visitor-candidate-task-race";
    const task = await createTrustedSandboxTask(visitorId, { resultJson: "{}" });
    const candidate = await createSandboxCandidate(visitorId, { name: "Synthetic candidate" });
    await Promise.all([
      updateSandboxTask(visitorId, task.id, { oneLineSummary: "Task updated" }),
      updateSandboxCandidate(visitorId, candidate.id, { summaryLabel: "Candidate updated" }),
    ]);

    expect(getSandboxTask(visitorId, task.id)?.oneLineSummary).toBe("Task updated");
    expect(getSandboxCandidate(visitorId, candidate.id)?.summaryLabel).toBe("Candidate updated");
  });

  it("deletes a Task and unlinks its Candidate atomically after a racing Task writer", async () => {
    const visitorId = "visitor-delete-unlink-race";
    const task = await createTrustedSandboxTask(visitorId, { resultJson: "{}" });
    const candidate = await createSandboxCandidate(visitorId, { name: "Synthetic linked candidate" });
    replaceDemoSandboxStoreForTest({
      version: 1,
      tasks: [task],
      candidates: [{ ...candidate, convertedTaskId: task.id }],
    });
    let entered!: () => void;
    const mutationEntered = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const mutationRelease = new Promise<void>((resolve) => { release = resolve; });
    const taskMutation = mutateTaskResultJson({
      context: visitorContext(visitorId),
      taskId: task.id,
      writer: "listing-pack",
      mutate: async (current) => {
        entered();
        await mutationRelease;
        return {
          result: { ...current, listingPackSnapshot: { source: "synthetic" } },
          value: null,
        };
      },
    });
    await mutationEntered;
    const deleteWrite = deleteSandboxTask(visitorId, task.id);
    release();
    await Promise.all([taskMutation, deleteWrite]);

    expect(getSandboxTask(visitorId, task.id)).toBeNull();
    expect(getSandboxCandidate(visitorId, candidate.id)?.convertedTaskId).toBeNull();
  });

  it("preserves all writes across 100 deterministic mixed Store races", async () => {
    const visitorId = "visitor-100-round-race";
    const sentinelTask = await createTrustedSandboxTask(visitorId, {
      title: "Sentinel task",
      resultJson: JSON.stringify({ unknownNamespace: { keep: true } }),
    });
    const sentinelCandidate = await createSandboxCandidate(visitorId, { name: "Sentinel candidate" });

    for (let round = 0; round < 100; round += 1) {
      await Promise.all([
        updateSandboxCandidate(visitorId, sentinelCandidate.id, { summaryLabel: `Candidate round ${round}` }),
        mutateTaskResultJson({
          context: visitorContext(visitorId),
          taskId: sentinelTask.id,
          writer: "listing-pack",
          mutate: (current) => ({
            result: { ...current, listingPackSnapshot: { round } },
            value: null,
          }),
        }),
      ]);
    }

    expect(listSandboxTasks(visitorId)).toHaveLength(1);
    expect(listSandboxCandidates(visitorId)).toHaveLength(1);
    const savedTask = getSandboxTask(visitorId, sentinelTask.id);
    expect(JSON.parse(savedTask?.resultJson ?? "{}")).toMatchObject({
      unknownNamespace: { keep: true },
      listingPackSnapshot: { round: 99 },
    });
    expect(getSandboxCandidate(visitorId, sentinelCandidate.id)?.summaryLabel).toBe("Candidate round 99");
    expect(listSandboxTasks("visitor-other")).toHaveLength(0);
    expect(listSandboxCandidates("visitor-other")).toHaveLength(0);
  });
});
