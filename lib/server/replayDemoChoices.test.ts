import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDemoChoices, saveDemoChoice, resetDemoChoices } from "./replayDemoChoices";

describe("replayDemoChoices（门禁 6 存储）", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "replay-choice-"));
  });
  it("保存/读取/upsert/重置，且 bundleId 隔离", () => {
    const a = { bundleId: "b1", gateId: "gate_a", decision: "continue_sourcing", note: "ok", at: "2026-08-22T00:00:00.000Z" };
    const b = { bundleId: "b2", gateId: "gate_a", decision: "needs_information", at: "2026-08-22T00:00:00.000Z" };
    expect(saveDemoChoice(dir, "guest-1", a)).toHaveLength(1);
    expect(saveDemoChoice(dir, "guest-1", b)).toHaveLength(1); // 不同 bundle 筛选
    expect(getDemoChoices(dir, "guest-1", "b1")).toHaveLength(1);
    expect(getDemoChoices(dir, "guest-1", "b1")[0].decision).toBe("continue_sourcing");
    // upsert 同 bundle+gate
    expect(saveDemoChoice(dir, "guest-1", { ...a, decision: "abandon" })).toHaveLength(1);
    expect(getDemoChoices(dir, "guest-1", "b1")[0].decision).toBe("abandon");
    // 重置 b1 → 清空，b2 保留
    expect(resetDemoChoices(dir, "guest-1", "b1")).toHaveLength(0);
    expect(getDemoChoices(dir, "guest-1", "b2")).toHaveLength(1);
  });
  it("非法 id 拒绝（路径注入防护）", () => {
    expect(() => getDemoChoices(dir, "..%2Fevil", "b1")).toThrow();
  });
  it("目录写入（原子替换后文件存在）", () => {
    saveDemoChoice(dir, "guest-2", { bundleId: "b1", gateId: "g", decision: "continue", at: "x" });
    expect(existsSync(join(dir, "data", "replay-demo-choices", "guest-2.json"))).toBe(true);
  });
});
