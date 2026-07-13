import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveDemoAccessStore } from "@/lib/server/demoAccess";
import { saveDemoSandboxStore } from "@/lib/server/demoSandbox";

let root = "";
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "project-001-test-store-isolation-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_ACCESS_STORE_PATH", "");
  vi.stubEnv("DEMO_SANDBOX_STORE_PATH", "");
});

afterEach(() => {
  cwdSpy.mockRestore();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("test store default isolation", () => {
  it("never falls back to business data files when test overrides are absent", () => {
    saveDemoAccessStore({ version: 1, accesses: [] });
    saveDemoSandboxStore({ version: 1, tasks: [], candidates: [] });

    expect(existsSync(join(root, ".next", "test-stores", "demo-access.default.json"))).toBe(true);
    expect(existsSync(join(root, ".next", "test-stores", "demo-sandbox.default.json"))).toBe(true);
    expect(existsSync(join(root, "data", "demo-access.json"))).toBe(false);
    expect(existsSync(join(root, "data", "demo-sandbox.json"))).toBe(false);
  });
});
