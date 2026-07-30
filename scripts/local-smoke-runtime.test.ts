import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { findDemoAccessByPassword } from "@/lib/server/demoAccess";

const SCRIPT = resolve("scripts/local-smoke-runtime.mjs");
const TEST_ROOT = mkdtempSync(join(tmpdir(), "qingxuan-smoke-runtime-test-"));

async function loadRuntime() {
  return import(pathToFileURL(SCRIPT).href);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("local isolated Smoke Runtime", () => {
  it("parses only the controlled lifecycle commands and port 3115", async () => {
    const runtime = await loadRuntime();
    const root = join(TEST_ROOT, "seller-preview-3115-parse");
    expect(runtime.parseSmokeRuntimeArguments([
      "start", "--runtime-root", root, "--port", "3115",
    ])).toEqual({ action: "start", runtimeRoot: root, port: "3115" });
    expect(() => runtime.parseSmokeRuntimeArguments([
      "start", "--runtime-root", root, "--port", "3005",
    ])).toThrow("smoke_port_must_be_3115");
    expect(() => runtime.parseSmokeRuntimeArguments([
      "start", "--runtime-root", "relative", "--port", "3115",
    ])).toThrow("smoke_runtime_root_absolute_required");
    expect(() => runtime.parseSmokeRuntimeArguments(["unknown"])).toThrow("smoke_action_invalid");
  });

  it("keeps every runtime artifact under a new non-Git root outside the worktree", async () => {
    const runtime = await loadRuntime();
    const allowedParent = join(TEST_ROOT, "qingxuan-smoke");
    mkdirSync(allowedParent);
    const runtimeRoot = join(allowedParent, "seller-preview-3115-paths");
    const paths = runtime.resolveSmokeRuntimePaths({
      runtimeRoot,
      allowedParent,
      worktreeRoot: resolve("."),
      pathExists: () => false,
      isInsideGitRepository: () => false,
      hasReparsePoint: () => false,
    });
    expect(paths).toMatchObject({
      runtimeRoot,
      databasePath: join(runtimeRoot, "dev.db"),
      demoAccessStorePath: join(runtimeRoot, "demo-access.json"),
      demoSandboxStorePath: join(runtimeRoot, "demo-sandbox.json"),
      markerPath: join(runtimeRoot, "smoke-runtime.json"),
    });
    expect(() => runtime.resolveSmokeRuntimePaths({
      runtimeRoot: resolve("."),
      allowedParent,
      worktreeRoot: resolve("."),
      pathExists: () => false,
      isInsideGitRepository: () => false,
      hasReparsePoint: () => false,
    })).toThrow("smoke_runtime_inside_worktree");
    expect(() => runtime.resolveSmokeRuntimePaths({
      runtimeRoot: join(allowedParent, "seller-preview-3115-git"),
      allowedParent,
      worktreeRoot: resolve("."),
      pathExists: () => false,
      isInsideGitRepository: () => true,
      hasReparsePoint: () => false,
    })).toThrow("smoke_runtime_inside_git_repository");
    expect(() => runtime.resolveSmokeRuntimePaths({
      runtimeRoot: join(allowedParent, "seller-preview-3115-link"),
      allowedParent,
      worktreeRoot: resolve("."),
      pathExists: () => false,
      isInsideGitRepository: () => false,
      hasReparsePoint: () => true,
    })).toThrow("smoke_runtime_reparse_point_forbidden");
  });

  it("creates a one-record Visitor store accepted by the existing authentication module", async () => {
    const runtime = await loadRuntime();
    const root = join(TEST_ROOT, "visitor-store");
    mkdirSync(root);
    const storePath = join(root, "demo-access.json");
    const visitorPassword = "synthetic-visitor-test-only";
    const result = runtime.createSyntheticDemoAccessStore({
      storePath,
      plainPassword: visitorPassword,
      now: new Date("2026-07-30T00:00:00.000Z"),
      randomBytesImpl: (size: number) => Buffer.alloc(size, 7),
    });
    vi.stubEnv("DEMO_ACCESS_STORE_PATH", storePath);

    expect(result.recordCount).toBe(1);
    expect(findDemoAccessByPassword(visitorPassword)).toMatchObject({
      label: "3115 本机合成 Smoke Visitor",
      isActive: true,
      maxAiCalls: 1,
      usedAiCalls: 0,
    });
    const stored = readFileSync(storePath, "utf8");
    expect(stored).not.toContain(visitorPassword);
    expect(stored).toContain("\"version\": 1");
  });

  it("sanitizes inherited credentials and keeps synthetic secrets out of CLI and marker data", async () => {
    const runtime = await loadRuntime();
    const ownerSentinel = "OWNER_SENTINEL_SECRET";
    const visitorASentinel = "VISITOR_A_SENTINEL_SECRET";
    const visitorBSentinel = "VISITOR_B_SENTINEL_SECRET";
    const env = runtime.buildSanitizedSmokeEnvironment({
      parentEnv: {
        PATH: "safe-path",
        SYSTEMROOT: "safe-system",
        ACCESS_PASSWORD: "real-owner-must-not-pass",
        OPENAI_API_KEY: "real-ai-must-not-pass",
        DATABASE_URL: "file:./real.db",
      },
      ownerPassword: "synthetic-owner",
      databasePath: "C:\\safe\\dev.db",
      demoAccessStorePath: "C:\\safe\\demo-access.json",
      demoSandboxStorePath: "C:\\safe\\demo-sandbox.json",
    });
    expect(env).toMatchObject({
      PATH: "safe-path",
      SYSTEMROOT: "safe-system",
      ACCESS_PASSWORD: "synthetic-owner",
      DEMO_ACCESS_STORE_PATH: "C:\\safe\\demo-access.json",
      DEMO_SANDBOX_STORE_PATH: "C:\\safe\\demo-sandbox.json",
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.APP_ACCESS_PASSWORD).toBeUndefined();

    const spec = runtime.buildSmokeServeLaunchSpec({
      runtimeRoot: "C:\\safe\\runtime",
      worktreeRoot: "C:\\safe\\worktree",
      port: "3115",
      launchId: "launch-public-id",
      env,
    });
    expect(spec.args.join(" ")).not.toContain("synthetic-owner");
    const marker = runtime.buildSmokeMarker({
      runtimeRoot: "C:\\safe\\runtime",
      worktreeRoot: "C:\\safe\\worktree",
      port: "3115",
      databasePath: "C:\\safe\\runtime\\dev.db",
      demoAccessStorePath: "C:\\safe\\runtime\\demo-access.json",
      demoSandboxStorePath: "C:\\safe\\runtime\\demo-sandbox.json",
      launchId: "launch-public-id",
      createdAt: "2026-07-30T00:00:00.000Z",
    });
    expect(JSON.stringify(marker)).not.toContain("synthetic-owner");
    expect(JSON.stringify(marker)).not.toContain("synthetic-visitor");
    expect(marker).not.toHaveProperty("password");
    expect(marker).not.toHaveProperty("token");
    const cliOutput = runtime.formatSmokeRuntimeStartOutput({
      status: "smoke_runtime_started",
      ownerPassword: ownerSentinel,
      visitorPassword: visitorASentinel,
      runtimeRoot: "C:\\safe\\runtime",
      port: 3115,
      ownedPid: 4242,
      listenerPid: 4343,
      databasePath: "C:\\safe\\runtime\\dev.db",
      demoAccessStorePath: "C:\\safe\\runtime\\demo-access.json",
      demoSandboxStorePath: "C:\\safe\\runtime\\demo-sandbox.json",
      createdAt: "2026-07-30T00:00:00.000Z",
    });
    expect(cliOutput).not.toContain(ownerSentinel);
    expect(cliOutput).not.toContain(visitorASentinel);
    expect(cliOutput).not.toContain(visitorBSentinel);
    expect(JSON.parse(cliOutput)).toEqual({
      status: "smoke_runtime_started",
      runtimeRoot: "C:\\safe\\runtime",
      port: 3115,
      ownedPid: 4242,
      listenerPid: 4343,
      databasePath: "C:\\safe\\runtime\\dev.db",
      demoAccessStorePath: "C:\\safe\\runtime\\demo-access.json",
      demoSandboxStorePath: "C:\\safe\\runtime\\demo-sandbox.json",
      createdAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it("never writes synthetic credentials to CLI stdout or stderr and releases the CLI result", async () => {
    const runtime = await loadRuntime();
    const root = join(TEST_ROOT, "seller-preview-3115-cli-output");
    const ownerSentinel = "OWNER_SENTINEL_SECRET";
    const visitorASentinel = "VISITOR_A_SENTINEL_SECRET";
    const visitorBSentinel = "VISITOR_B_SENTINEL_SECRET";
    const started = {
      status: "smoke_runtime_started",
      ownerPassword: ownerSentinel,
      visitorPassword: visitorASentinel,
      runtimeRoot: root,
      port: 3115,
      ownedPid: 4242,
      listenerPid: 4343,
      databasePath: join(root, "dev.db"),
      demoAccessStorePath: join(root, "demo-access.json"),
      demoSandboxStorePath: join(root, "demo-sandbox.json"),
      createdAt: "2026-07-30T00:00:00.000Z",
    };
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runtime.runSmokeRuntimeCli([
      "start", "--runtime-root", root, "--port", "3115",
    ], {
      startSmokeRuntimeImpl: async () => started,
      writeStdout: (value: string) => stdout.push(value),
      writeStderr: (value: string) => stderr.push(value),
    });

    const output = `${stdout.join("\n")}\n${stderr.join("\n")}`;
    expect(exitCode).toBe(0);
    expect(output).not.toContain(ownerSentinel);
    expect(output).not.toContain(visitorASentinel);
    expect(output).not.toContain(visitorBSentinel);
    expect(stderr).toEqual([]);
    expect(started).not.toHaveProperty("ownerPassword");
    expect(started).not.toHaveProperty("visitorPassword");

    const failureStdout: string[] = [];
    const failureStderr: string[] = [];
    const failureExitCode = await runtime.runSmokeRuntimeCli([
      "start", "--runtime-root", root, "--port", "3115",
    ], {
      startSmokeRuntimeImpl: async () => {
        throw new Error(`${ownerSentinel}:${visitorBSentinel}`);
      },
      writeStdout: (value: string) => failureStdout.push(value),
      writeStderr: (value: string) => failureStderr.push(value),
    });
    const failureOutput = `${failureStdout.join("\n")}\n${failureStderr.join("\n")}`;
    expect(failureExitCode).toBe(1);
    expect(failureOutput).not.toContain(ownerSentinel);
    expect(failureOutput).not.toContain(visitorASentinel);
    expect(failureOutput).not.toContain(visitorBSentinel);
    expect(failureStdout).toEqual([]);
    expect(failureStderr).toEqual([JSON.stringify({ status: "smoke_runtime_failed" })]);
  });

  it("uses only migrate deploy with the worktree-local locked Prisma CLI", async () => {
    const runtime = await loadRuntime();
    const spec = runtime.buildPrismaMigrationSpec({
      worktreeRoot: "C:\\safe\\worktree",
      databasePath: "C:\\safe\\runtime\\dev.db",
      baseEnv: { SYSTEMROOT: "safe-system" },
      platform: "win32",
    });
    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toEqual([
      "C:\\safe\\worktree\\node_modules\\prisma\\build\\index.js",
      "migrate",
      "deploy",
    ]);
    expect(spec.env.DATABASE_URL).toBe("file:C:/safe/runtime/dev.db");
    expect(spec.args.join(" ")).not.toMatch(/migrate dev|db push|db seed|seed/i);
  });

  it("refuses PID reuse and builds only an owned PID tree stop command", async () => {
    const runtime = await loadRuntime();
    const marker = {
      schemaVersion: "qingxuan-local-smoke-runtime.v1",
      runtimeRoot: "C:\\safe\\runtime",
      worktreeRoot: "C:\\safe\\worktree",
      port: 3115,
      launchId: "launch-public-id",
      ownedPid: 4242,
      listenerPid: 4343,
    };
    const valid = {
      pid: 4242,
      parentPid: 1,
      commandLine: "\"node.exe\" \"C:\\safe\\worktree\\scripts\\local-smoke-runtime.mjs\" serve --runtime-root \"C:\\safe\\runtime\" --port 3115 --launch-id launch-public-id",
    };
    expect(runtime.validateOwnedRuntimeProcess(marker, valid)).toBe(true);
    expect(() => runtime.validateOwnedRuntimeProcess(marker, {
      ...valid,
      commandLine: "\"node.exe\" unrelated.mjs",
    })).toThrow("smoke_owned_process_identity_mismatch");
    expect(runtime.buildOwnedTreeStopSpec(4242, "win32")).toEqual({
      command: "taskkill.exe",
      args: ["/PID", "4242", "/T", "/F"],
    });
  });

  it("cleanup removes only a stopped runtime with its valid owned marker", async () => {
    const runtime = await loadRuntime();
    const allowedParent = join(TEST_ROOT, "cleanup-parent");
    const runtimeRoot = join(allowedParent, "seller-preview-3115-cleanup");
    mkdirSync(runtimeRoot, { recursive: true });
    const marker = runtime.buildSmokeMarker({
      runtimeRoot,
      worktreeRoot: resolve("."),
      port: "3115",
      databasePath: join(runtimeRoot, "dev.db"),
      demoAccessStorePath: join(runtimeRoot, "demo-access.json"),
      demoSandboxStorePath: join(runtimeRoot, "demo-sandbox.json"),
      launchId: "cleanup-public-id",
      createdAt: "2026-07-30T00:00:00.000Z",
    });
    writeFileSync(join(runtimeRoot, "smoke-runtime.json"), `${JSON.stringify(marker)}\n`);
    writeFileSync(join(runtimeRoot, "synthetic-only.txt"), "synthetic");

    runtime.cleanupSmokeRuntime({
      runtimeRoot,
      allowedParent,
      worktreeRoot: resolve("."),
      isProcessAlive: () => false,
      isInsideGitRepository: () => false,
      hasReparsePoint: () => false,
    });
    expect(existsSync(runtimeRoot)).toBe(false);
  });

  it("contains no global browser or process-name termination path", () => {
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).not.toMatch(new RegExp("taskkill[^\\n]*/IM|chrome|edge|firefox|brave|opera", "i"));
    expect(source).not.toMatch(/migrate\s+dev|db\s+push|db\s+seed/i);
    expect(source).not.toMatch(/show-credentials|formatOneTimeSmokeCredentials/i);
  });
});
