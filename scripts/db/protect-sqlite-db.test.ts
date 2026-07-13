/**
 * DB-Protection.1 — DB Guard Tests
 *
 * Tests protect-sqlite-db.mjs against the project dev.db.
 * No production data, no env secrets, no AI calls.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const SCRIPT = resolve("scripts/db/protect-sqlite-db.mjs");
const TEST_ROOT = mkdtempSync(join(tmpdir(), "db-guard-test-"));
const TEST_DB_PATH = join(TEST_ROOT, "test.db");
const PRISMA_TEST_DB_URL = `file:${TEST_DB_PATH.replaceAll("\\", "/")}`;
const TEST_DB_URL = PRISMA_TEST_DB_URL;

function runGuard(args: string, dbUrl?: string): { exitCode: number; stdout: string; stderr: string } {
  const url = dbUrl ?? TEST_DB_URL;
  try {
    const stdio = execFileSync(process.execPath, [SCRIPT, ...args.split(" ")], {
      cwd: TEST_ROOT,
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

beforeAll(async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: PRISMA_TEST_DB_URL } } });
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ViralAnalysisRecord" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "resultJson" TEXT NOT NULL
      )
    `);
  } finally {
    await prisma.$disconnect();
  }
  expect(existsSync(TEST_DB_PATH)).toBe(true);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

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
    const baselinePath = join(TEST_ROOT, ".local-backups", "db-guard", "baseline.json");
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
