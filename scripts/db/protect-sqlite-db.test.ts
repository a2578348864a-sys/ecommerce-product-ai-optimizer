/**
 * DB-Protection.1 — DB Guard Tests
 *
 * Tests protect-sqlite-db.mjs against the project dev.db.
 * No production data, no env secrets, no AI calls.
 */

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT = "scripts/db/protect-sqlite-db.mjs";
const DEV_DB_PATH = resolve("prisma/dev.db");

function runGuard(args: string, dbUrl?: string): { exitCode: number; stdout: string; stderr: string } {
  const url = dbUrl ?? `file:${DEV_DB_PATH}`;
  try {
    const stdio = execSync(`node ${SCRIPT} ${args}`, {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
      timeout: 15000,
    });
    return { exitCode: 0, stdout: stdio.toString(), stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

// Ensure dev.db exists before running tests
if (!existsSync(DEV_DB_PATH)) {
  throw new Error("dev.db not found — DB guard tests need the project dev database.");
}

describe("DB Guard — summary", () => {
  it("summary completes without error", () => {
    const result = runGuard("summary");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("DB Protection Summary");
    expect(result.stdout).toContain("Quick check");
    expect(result.stdout).toContain("Task count");
    expect(result.stdout).toContain("Listing snapshots");
  });

  it("summary does NOT leak DATABASE_URL in output", () => {
    const result = runGuard("summary");
    expect(result.stdout).not.toContain("DATABASE_URL");
    expect(result.stdout).not.toContain("ACCESS_PASSWORD");
    expect(result.stdout).not.toContain("APP_ACCESS_PASSWORD");
  });

  it("summary reports quick_check status", () => {
    const result = runGuard("summary");
    expect(result.stdout).toContain("Quick check");
  });
});

describe("DB Guard — backup", () => {
  it("backup creates a backup file", () => {
    const result = runGuard("backup --reason unit-test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Backup created");
    expect(result.stdout).toContain("unit-test");
  });

  it("backup does not leak env secrets", () => {
    const result = runGuard("backup");
    expect(result.stdout).not.toContain("SECRET");
    expect(result.stdout).not.toContain("DATABASE_URL");
  });
});

describe("DB Guard — predeploy / postdeploy", () => {
  it("predeploy creates backup and baseline", () => {
    const result = runGuard("predeploy");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Backup saved");
    expect(result.stdout).toContain("Baseline written");
    expect(result.stdout).toContain("DB Protection Summary");
  });

  it("postdeploy passes against current state", () => {
    // First run predeploy to create baseline
    runGuard("predeploy");
    const baselinePath = resolve(".local-backups/db-guard/baseline.json");
    expect(existsSync(baselinePath)).toBe(true);

    const result = runGuard(`postdeploy --baseline ${baselinePath}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Post-deploy guard passed");
  });

  it("postdeploy fails with missing baseline", () => {
    const result = runGuard("postdeploy --baseline ./nonexistent.json");
    expect(result.exitCode).not.toBe(0);
    // Error details in stderr
    expect(result.stderr + result.stdout).toMatch(/baseline/i);
  });
});

describe("DB Guard — error handling", () => {
  it("fails with missing DATABASE_URL", () => {
    const result = runGuard("summary", "");
    expect(result.exitCode).not.toBe(0);
  });

  it("fails with nonexistent DB file", () => {
    const result = runGuard("summary", "file:./i-do-not-exist.db");
    expect(result.exitCode).not.toBe(0);
  });
});

describe("DB Guard — no env leakage", () => {
  it("predeploy output is safe", () => {
    const result = runGuard("predeploy");
    expect(result.stdout).not.toContain("ACCESS_PASSWORD");
    expect(result.stdout).not.toContain("APP_ACCESS_PASSWORD");
    expect(result.stdout).not.toMatch(/file:.*[\\/].*[\\/]/); // no full paths leaked
  });
});
