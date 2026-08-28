import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUNTIME_SCRIPT = resolve("scripts/local-next-runtime.mjs");
const TEST_ROOT = mkdtempSync(join(tmpdir(), "local-next-runtime-test-"));

async function loadRuntime() {
  return import(pathToFileURL(RUNTIME_SCRIPT).href);
}

async function listenOnLoopback(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: "127.0.0.1", port: 0 }, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_listener_address_missing");
  return (address as AddressInfo).port;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("local Next runtime", () => {
  it("keeps the dedicated local database and default loopback 3005 behavior", async () => {
    expect(existsSync(RUNTIME_SCRIPT)).toBe(true);
    const runtime = await loadRuntime();
    const config = runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      mode: "start",
      parentEnv: { DATABASE_URL: "file:./wrong.db", PRESERVED_VALUE: "yes" },
    });
    // 合同：DATABASE_URL 与 databasePath 指向同一文件（绝对 SQLite URL）；父进程错误 DATABASE_URL 必须被覆盖
    expect(config.env.DATABASE_URL).toBe("file:" + resolve("fixture-project", "prisma", "dev.db").replaceAll("\\", "/"));
    expect(config.env.DATABASE_URL).toBe("file:" + config.databasePath.replaceAll("\\", "/"));
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
  });

  it("default config DATABASE_URL points to the same file as databasePath (real CJK repo path)", async () => {
    const runtime = await loadRuntime();
    const config = runtime.buildLocalRuntimeConfig({ cwd: process.cwd(), mode: "start", parentEnv: {} });
    const expectedAbs = resolve("prisma", "dev.db");
    expect(config.databasePath).toBe(expectedAbs);
    expect(config.env.DATABASE_URL).toBe("file:" + expectedAbs.replaceAll("\\", "/"));
    expect(config.env.DATABASE_URL).toBe("file:" + config.databasePath.replaceAll("\\", "/"));
    expect(config.databasePath).toContain("跨境电商AI工具");
    expect(config.env.DATABASE_URL).toContain("跨境电商AI工具");
    expect(config.env.DATABASE_URL).not.toBe("file:./dev.db");
  });

  it("isolated config DATABASE_URL points to the same file as its validated databasePath", async () => {
    const runtime = await loadRuntime();
    const smokeParentRoot = join(TEST_ROOT, "qingxuan-smoke-samefile");
    const runtimeRoot = join(smokeParentRoot, "t");
    mkdirSync(runtimeRoot, { recursive: true });
    const databasePath = join(runtimeRoot, "dev.db");
    const demoAccessStorePath = join(runtimeRoot, "demo-access.json");
    const config = runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      mode: "start",
      databasePath,
      demoAccessStorePath,
      smokeParentRoot,
      parentEnv: {},
    });
    expect(config.env.DATABASE_URL).toBe("file:" + config.databasePath.replaceAll("\\", "/"));
    expect(config.env.DATABASE_URL).toBe("file:" + databasePath.replaceAll("\\", "/"));
  });

  it("uses one explicit validated loopback port without changing the default", async () => {
    const runtime = await loadRuntime();
    const temporaryConfig = runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      mode: "start",
      port: "3105",
      parentEnv: {},
    });
    expect(temporaryConfig.args.slice(-4)).toEqual(["-H", "127.0.0.1", "-p", "3105"]);
    expect(temporaryConfig.args.filter((argument: string) => argument === "-p")).toHaveLength(1);
    expect(runtime.parseLocalRuntimeArguments(["start", "--port", "3105"])).toEqual({
      mode: "start",
      checkOnly: false,
      port: "3105",
    });
  });

  it("uses an explicit isolated SQLite and Visitor store without changing the host", async () => {
    const runtime = await loadRuntime();
    const smokeParentRoot = join(TEST_ROOT, "qingxuan-smoke");
    const runtimeRoot = join(smokeParentRoot, "seller-preview-3115-test");
    mkdirSync(runtimeRoot, { recursive: true });
    const databasePath = join(runtimeRoot, "dev.db");
    const demoAccessStorePath = join(runtimeRoot, "demo-access.json");
    const config = runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      mode: "start",
      port: "3115",
      databasePath,
      demoAccessStorePath,
      smokeParentRoot,
      parentEnv: { ACCESS_PASSWORD: "synthetic-owner-only" },
    });

    expect(config.databasePath).toBe(databasePath);
    expect(config.env.DATABASE_URL).toBe(`file:${databasePath.replaceAll("\\", "/")}`);
    expect(config.env.DEMO_ACCESS_STORE_PATH).toBe(demoAccessStorePath);
    expect(config.env.ACCESS_PASSWORD).toBe("synthetic-owner-only");
    expect(config.args.slice(-4)).toEqual(["-H", "127.0.0.1", "-p", "3115"]);
    expect(config.args).not.toContain("synthetic-owner-only");
    expect(runtime.parseLocalRuntimeArguments([
      "start",
      "--port", "3115",
      "--database-path", databasePath,
      "--demo-access-store-path", demoAccessStorePath,
    ])).toEqual({
      mode: "start",
      checkOnly: false,
      port: "3115",
      databasePath,
      demoAccessStorePath,
    });
  });

  it("rejects partial, relative, unsafe, and worktree-local isolated paths", async () => {
    const runtime = await loadRuntime();
    const smokeParentRoot = join(TEST_ROOT, "qingxuan-smoke");
    const runtimeRoot = join(smokeParentRoot, "seller-preview-3115-test");
    mkdirSync(runtimeRoot, { recursive: true });
    const databasePath = join(runtimeRoot, "dev.db");
    const demoAccessStorePath = join(runtimeRoot, "demo-access.json");

    expect(() => runtime.parseLocalRuntimeArguments([
      "start", "--database-path", databasePath,
    ])).toThrow("local_isolated_paths_required_together");
    expect(() => runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      databasePath: "relative.db",
      demoAccessStorePath,
      smokeParentRoot,
    })).toThrow("local_database_path_absolute_required");
    expect(() => runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      databasePath: join(runtimeRoot, "dev.txt"),
      demoAccessStorePath,
      smokeParentRoot,
    })).toThrow("local_database_extension_invalid");
    expect(() => runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      databasePath,
      demoAccessStorePath: join(smokeParentRoot, "other", "demo-access.json"),
      smokeParentRoot,
    })).toThrow("local_isolated_paths_root_mismatch");
    expect(() => runtime.buildLocalRuntimeConfig({
      cwd: runtimeRoot,
      databasePath,
      demoAccessStorePath,
      smokeParentRoot,
    })).toThrow("local_isolated_path_inside_worktree");
    expect(() => runtime.buildLocalRuntimeConfig({
      cwd: resolve("fixture-project"),
      databasePath: "\\\\server\\share\\dev.db",
      demoAccessStorePath: "\\\\server\\share\\demo-access.json",
      smokeParentRoot: "\\\\server\\share",
    })).toThrow("local_isolated_network_path_forbidden");
  });

  it("rejects invalid, out-of-range, missing, and duplicate explicit port values", async () => {
    const runtime = await loadRuntime();
    const base = { cwd: resolve("fixture-project"), mode: "start", parentEnv: {} };
    expect(() => runtime.buildLocalRuntimeConfig({ ...base, port: "" })).toThrow("local_port_invalid");
    expect(() => runtime.buildLocalRuntimeConfig({ ...base, port: "not-a-port" })).toThrow("local_port_invalid");
    expect(() => runtime.buildLocalRuntimeConfig({ ...base, port: "1023" })).toThrow("local_port_out_of_range");
    expect(() => runtime.buildLocalRuntimeConfig({ ...base, port: "65536" })).toThrow("local_port_out_of_range");
    expect(() => runtime.parseLocalRuntimeArguments(["start", "--port"])).toThrow("local_port_invalid");
    expect(() => runtime.parseLocalRuntimeArguments(["start", "--port", "3105", "--port", "3106"])).toThrow("local_runtime_arguments_invalid");
  });

  it("refuses an occupied port with listener details and does not stop the owner", async () => {
    const runtime = await loadRuntime();
    const owner = createServer();
    const port = await listenOnLoopback(owner);
    try {
      await expect(runtime.assertLocalPortAvailable({
        host: "127.0.0.1",
        port,
        findListeners: () => [{ address: `127.0.0.1:${port}`, pid: 4242 }],
      })).rejects.toThrow(`local_port_in_use:${port}:listeners=127.0.0.1:${port}@4242`);
      expect(owner.listening).toBe(true);
    } finally {
      await closeServer(owner);
    }
  });

  it("checks an explicit port before reading the local database or launching Next", async () => {
    const runtime = await loadRuntime();
    let probeWasCalled = false;
    let spawnWasCalled = false;
    await expect(runtime.runLocalNext({
      cwd: resolve("fixture-project"),
      mode: "start",
      port: "3105",
      assertPortAvailable: async () => { throw new Error("local_port_in_use:3105:listeners=127.0.0.1:3105@4242"); },
      probe: async () => {
        probeWasCalled = true;
        return { quickCheck: "ok", candidateCount: 0, taskCount: 0 };
      },
      spawnProcess: () => {
        spawnWasCalled = true;
        throw new Error("test_spawn_must_not_run");
      },
    })).rejects.toThrow("local_port_in_use:3105:listeners=127.0.0.1:3105@4242");
    expect(probeWasCalled).toBe(false);
    expect(spawnWasCalled).toBe(false);
  });

  it("does not control PM2, Nginx, scheduled tasks, or watchdogs", () => {
    const source = readFileSync(RUNTIME_SCRIPT, "utf8");
    expect(source).not.toMatch(/pm2|nginx|scheduledtask|schtasks|watchdog/i);
  });

  it("fails closed before launch when the local SQLite file is missing, empty, or invalid", async () => {
    const runtime = await loadRuntime();
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
  });
});
