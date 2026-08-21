import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateGraph, Annotation, START, END, interrupt, Command } from "@langchain/langgraph";

import { checkpointDbPath, defaultCheckpointPath, openCheckpoint } from "@/lib/v4/checkpoint";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "v4-checkpoint-"));
});
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

const State = Annotation.Root({
  n: Annotation<number>,
  entered: Annotation<boolean>({ reducer: (a, b) => b ?? a, default: () => false }),
});
const inc = async (state: { n: number; entered: boolean }) => {
  if (!state.entered) {
    interrupt({ node: "inc", entered: true });
  }
  return { n: state.n + 1, entered: true };
};
const build = (checkpointer: ReturnType<typeof openCheckpoint>["saver"]) =>
  new StateGraph(State)
    .addNode("inc", inc)
    .addEdge(START, "inc")
    .addEdge("inc", END)
    .compile({ checkpointer });

describe("Checkpoint adapter (SqliteSaver, control-flow only)", () => {
  it("defaultCheckpointPath is under .tmp/v4-graph", () => {
    expect(defaultCheckpointPath("run-1")).toBe(join(".tmp", "v4-graph", "checkpoints-run-1.db"));
  });

  it("checkpointDbPath defaults to .tmp/v4-graph and honors baseDir", () => {
    expect(checkpointDbPath("run-1")).toBe(join(".tmp", "v4-graph", "checkpoints-run-1.db"));
    expect(checkpointDbPath("run-1", "/tmp/cp")).toBe(join("/tmp/cp", "checkpoints-run-1.db"));
    expect(checkpointDbPath("run-1")).toBe(defaultCheckpointPath("run-1"));
  });

  it("persists graph state across close/reopen (process restart simulation)", async () => {
    const dbPath = join(root, "cp.db");
    const cfg = { configurable: { thread_id: "t1" } };

    // First "process": run to interrupt (node paused, not returned)
    const h1 = openCheckpoint(dbPath);
    const g1 = build(h1.saver);
    await g1.invoke({ n: 0 }, cfg);
    const snap1 = await g1.getState(cfg);
    expect((snap1.values as { n: number }).n).toBe(0);
    expect((snap1.values as { entered: boolean }).entered).toBe(false);
    expect(snap1.next).toEqual(["inc"]);
    h1.close();

    // Second "process": reopen same DB, resume -> continues from checkpoint
    const h2 = openCheckpoint(dbPath);
    const g2 = build(h2.saver);
    const snap2 = await g2.getState(cfg);
    expect((snap2.values as { n: number }).n).toBe(0);
    expect(snap2.next).toEqual(["inc"]);
    const r2 = await g2.invoke(new Command({ resume: "go" }), cfg);
    expect((r2 as { n: number }).n).toBe(1);
    const snap3 = await g2.getState(cfg);
    expect(snap3.next).toEqual([]);
    h2.close();
  });

  it("separate thread_ids are isolated in the same DB", async () => {
    const dbPath = join(root, "cp2.db");
    const set = async (_s: unknown, cfg: { configurable: { thread_id: string } }) => ({ n: cfg.configurable.thread_id === "t1" ? 1 : 2 });
    const h = openCheckpoint(dbPath);
    const g = new StateGraph(State)
      .addNode("set", set as never)
      .addEdge(START, "set")
      .addEdge("set", END)
      .compile({ checkpointer: h.saver });
    await g.invoke({ n: 0 }, { configurable: { thread_id: "t1" } });
    await g.invoke({ n: 0 }, { configurable: { thread_id: "t2" } });
    const s1 = await g.getState({ configurable: { thread_id: "t1" } });
    const s2 = await g.getState({ configurable: { thread_id: "t2" } });
    expect((s1.values as { n: number }).n).toBe(1);
    expect((s2.values as { n: number }).n).toBe(2);
    h.close();
  });
});