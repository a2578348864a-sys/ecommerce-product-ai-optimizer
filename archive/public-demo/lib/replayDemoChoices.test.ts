import { afterEach, describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDemoChoice, saveDemoChoice, resetDemoChoice } from "./replayDemoChoices";

describe("replayDemoChoices (gate 6 store, form contract)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "replay-choice-"));
  });
  it("save/get/upsert/reset with bundle isolation", () => {
    const a = { bundleId: "b1", gateA: "continue_sourcing", note: "ok", at: "2026-08-22T00:00:00.000Z" };
    const b = { bundleId: "b2", gateB: "content_ready", at: "2026-08-22T00:00:00.000Z" };
    saveDemoChoice(dir, "guest-1", a);
    saveDemoChoice(dir, "guest-1", b);
    expect(getDemoChoice(dir, "guest-1", "b1")?.gateA).toBe("continue_sourcing");
    expect(getDemoChoice(dir, "guest-1", "b2")?.gateB).toBe("content_ready");
    saveDemoChoice(dir, "guest-1", { ...a, gateA: "abandon", at: "x" });
    expect(getDemoChoice(dir, "guest-1", "b1")?.gateA).toBe("abandon");
    expect(getDemoChoice(dir, "guest-1", "b1")?.note).toBe("ok");
    resetDemoChoice(dir, "guest-1", "b1");
    expect(getDemoChoice(dir, "guest-1", "b1")).toBeNull();
    expect(getDemoChoice(dir, "guest-1", "b2")?.gateB).toBe("content_ready");
  });
  it("invalid id rejected (path injection)", () => {
    expect(() => saveDemoChoice(dir, "..%2Fevil", { bundleId: "b1", at: "x" } as never)).toThrow();
  });
  it("writes file atomically", () => {
    saveDemoChoice(dir, "guest-2", { bundleId: "b1", gateA: "continue_sourcing", at: "x" });
    expect(existsSync(join(dir, "data", "replay-demo-choices", "guest-2.json"))).toBe(true);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
});
