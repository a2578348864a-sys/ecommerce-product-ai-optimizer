import { afterEach, describe, expect, it } from "vitest";
import {
  isExplicitPublicShowcaseRelease,
  isExplicitLocalOwner,
  isPublicShowcaseNodeInstancesOne,
  evaluatePublicShowcaseReleaseGate,
} from "@/lib/server/releaseGates";

afterEach(() => {
  delete process.env.QX_RUNTIME_MODE;
});

describe("PUBLIC_RELEASE 显式运行模式门禁（§26）", () => {
  it("env missing → BLOCKED（不允许 env missing 通过 Release Gate）", () => {
    delete process.env.QX_RUNTIME_MODE;
    expect(isExplicitPublicShowcaseRelease()).toBe(false);
  });
  it("显式 public_showcase → PASS；大小写不敏感", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    expect(isExplicitPublicShowcaseRelease()).toBe(true);
    process.env.QX_RUNTIME_MODE = "Public_Showcase";
    expect(isExplicitPublicShowcaseRelease()).toBe(true);
  });
  it("显式 local_owner → 非公开发布；无认证回环信任仅显式启用（§25）", () => {
    process.env.QX_RUNTIME_MODE = "local_owner";
    expect(isExplicitPublicShowcaseRelease()).toBe(false);
    expect(isExplicitLocalOwner()).toBe(true);
  });
});

describe("单实例不变量（§12）", () => {
  it("fork_mode + instances=1 → PASS", () => {
    expect(isPublicShowcaseNodeInstancesOne(1, "fork_mode")).toBe(true);
  });
  it("instances>1 或 cluster → BLOCKED", () => {
    expect(isPublicShowcaseNodeInstancesOne(2, "fork_mode")).toBe(false);
    expect(isPublicShowcaseNodeInstancesOne(1, "cluster_mode")).toBe(false);
    expect(isPublicShowcaseNodeInstancesOne(undefined, undefined)).toBe(false);
  });
});

describe("evaluatePublicShowcaseReleaseGate（组合）", () => {
  it("全部满足 → pass", () => {
    process.env.QX_RUNTIME_MODE = "public_showcase";
    const r = evaluatePublicShowcaseReleaseGate({ instances: 1, execMode: "fork_mode" });
    expect(r.pass).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });
  it("env missing 或多实例 → 列出全部阻断原因", () => {
    delete process.env.QX_RUNTIME_MODE;
    const r = evaluatePublicShowcaseReleaseGate({ instances: 2, execMode: "cluster_mode" });
    expect(r.pass).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });
});