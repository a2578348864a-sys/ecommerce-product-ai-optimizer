import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveEvidenceConflictRecovery } from "@/lib/client/evidenceConflictRecovery";

const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");

/*
 * 轮 15：Listing 409 自动恢复（源码级 + 决策单测）。
 * fake-DOM 无法触发 React 19 合成事件（轮 14 记录），真实点击交互由 CDP 真实浏览器验收；
 * 本文件验证：①冲突决策函数复用轮 14 语义；②组件接线存在（自动重试 effect + 二次冲突文案）。
 */

describe("ListingHandoffSection 409 自动恢复（轮 15）", () => {
  it("接线存在：首次冲突启用自动恢复；二次冲突提示「创作资料又发生变化，请再试一次」", () => {
    expect(source).toContain("resolveEvidenceConflictRecovery");
    expect(source).toContain("setConflictPending(true)");
    expect(source).toContain("正在自动获取最新版本并重试");
    expect(source).toContain("创作资料又发生变化，请再试一次");
    expect(source).toContain("lastConflictVersionRef");
    expect(source).toContain("void generate();");
  });
  it("复用轮 14 冲突决策语义：首次重试、二次停止", () => {
    expect(resolveEvidenceConflictRecovery(409, "task_result_conflict", false)).toEqual({ retry: true, message: null });
    expect(resolveEvidenceConflictRecovery(409, "task_result_conflict", true)).toEqual({ retry: false, message: "资料刚刚更新，请再试一次。" });
  });
});
