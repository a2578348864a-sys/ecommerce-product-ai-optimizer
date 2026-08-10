import { describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { claimSmokeAuthorization, resetSmokeAuthorizationLedger } from "@/lib/server/smokeOneShotGuard";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "smoke-guard-test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.SMOKE_GUARD_DIR = dir;
});

describe("smokeOneShotGuard", () => {
  it("首次 claim → claimed", () => {
    resetSmokeAuthorizationLedger();
    expect(claimSmokeAuthorization("auth-test-1")).toBe("claimed");
  });

  it("同一 ID 再次运行 → already_claimed（Provider 调用前拒绝）", () => {
    resetSmokeAuthorizationLedger();
    expect(claimSmokeAuthorization("auth-test-2")).toBe("claimed");
    expect(claimSmokeAuthorization("auth-test-2")).toBe("already_claimed");
    expect(claimSmokeAuthorization("auth-test-2")).toBe("already_claimed");
  });

  it("不同 ID 互不影响", () => {
    resetSmokeAuthorizationLedger();
    expect(claimSmokeAuthorization("auth-test-3a")).toBe("claimed");
    expect(claimSmokeAuthorization("auth-test-3b")).toBe("claimed");
  });

  it("空/超长 ID → 拒绝", () => {
    expect(() => claimSmokeAuthorization("  ")).toThrow(/required/);
    expect(() => claimSmokeAuthorization("x".repeat(200))).toThrow(/too_long/);
  });

  it("并发同 ID：只有 1 个成功（原子 create-if-absent）", async () => {
    resetSmokeAuthorizationLedger();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => Promise.resolve().then(() => claimSmokeAuthorization("auth-concurrent-1"))),
    );
    const claimedCount = results.filter((r) => r === "claimed").length;
    expect(claimedCount).toBe(1);
    expect(results.filter((r) => r === "already_claimed").length).toBe(7);
  });
});
