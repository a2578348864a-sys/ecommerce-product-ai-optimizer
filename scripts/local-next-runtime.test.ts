import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUNTIME_SCRIPT = resolve("scripts/local-next-runtime.mjs");
const TEST_ROOT = mkdtempSync(join(tmpdir(), "local-next-runtime-test-"));

async function loadRuntime() {
  return import(pathToFileURL(RUNTIME_SCRIPT).href);
}

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("local Next runtime", () => {
  it("provides dedicated local scripts that always bind Prisma to prisma/dev.db", async () => {
    expect(existsSync(RUNTIME_SCRIPT)).toBe(true);
    if (!existsSync(RUNTIME_SCRIPT)) return;

    const runtime = await loadRuntime();
    const config = runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      mode: "start",
      parentEnv: {
        DATABASE_URL: "file:./wrong.db",
        PRESERVED_VALUE: "yes",
      },
    });

    expect(config.env.DATABASE_URL).toBe("file:./dev.db");
    expect(config.env.PRESERVED_VALUE).toBe("yes");
    expect(config.databasePath).toBe(resolve("fixture-project", "prisma", "dev.db"));
    expect(config.args).toEqual([
      resolve("fixture-project", "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      "3005",
    ]);

    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(packageJson.scripts["start:local"]).toBe("node scripts/local-next-runtime.mjs start");
    expect(packageJson.scripts["dev:local"]).toBe("node scripts/local-next-runtime.mjs dev");
    expect(packageJson.scripts["check:local"]).toBe("node scripts/local-next-runtime.mjs check");
  });

  it("fails closed before launch when the local SQLite file is missing, empty, or invalid", async () => {
    const runtime = await loadRuntime();
    expect(typeof runtime.inspectLocalDatabaseFile).toBe("function");
    if (typeof runtime.inspectLocalDatabaseFile !== "function") return;
    const missingPath = join(TEST_ROOT, "missing.db");
    const emptyPath = join(TEST_ROOT, "empty.db");
    const invalidPath = join(TEST_ROOT, "invalid.db");
    writeFileSync(emptyPath, "");
    writeFileSync(invalidPath, "not sqlite");

    expect(() => runtime.inspectLocalDatabaseFile(missingPath)).toThrow("local_database_missing");
    expect(() => runtime.inspectLocalDatabaseFile(emptyPath)).toThrow("local_database_empty");
    expect(() => runtime.inspectLocalDatabaseFile(invalidPath)).toThrow("local_database_invalid");
  });

  it("requires SQLite quick_check before reporting the local database ready", async () => {
    const runtime = await loadRuntime();
    expect(typeof runtime.verifyLocalDatabase).toBe("function");
    if (typeof runtime.verifyLocalDatabase !== "function") return;
    const databasePath = join(TEST_ROOT, "valid.db");
    writeFileSync(databasePath, Buffer.from("SQLite format 3\0test fixture"));

    await expect(runtime.verifyLocalDatabase({
      databasePath,
      databaseUrl: "file:./dev.db",
      probe: async (databaseUrl: string) => {
        expect(databaseUrl).toBe("file:./dev.db");
        return { quickCheck: "ok", candidateCount: 9, taskCount: 3 };
      },
    })).resolves.toEqual({ quickCheck: "ok", candidateCount: 9, taskCount: 3 });

    await expect(runtime.verifyLocalDatabase({
      databasePath,
      databaseUrl: "file:./dev.db",
      probe: async () => ({ quickCheck: "corrupt", candidateCount: 0, taskCount: 0 }),
    })).rejects.toThrow("local_database_quick_check_failed");
  });
});
