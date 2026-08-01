import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
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

  it("accepts the isolated converted-task fixture action without a caller-controlled port", async () => {
    const runtime = await loadRuntime();
    const root = join(TEST_ROOT, "seller-preview-3115-converted-fixture-parse");

    expect(runtime.parseSmokeRuntimeArguments([
      "seed-converted-task-fixture", "--runtime-root", root,
    ])).toEqual({ action: "seed-converted-task-fixture", runtimeRoot: root });
    expect(() => runtime.parseSmokeRuntimeArguments([
      "seed-converted-task-fixture", "--runtime-root", root, "--port", "3005",
    ])).toThrow("smoke_arguments_invalid");
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

  it("accepts only a live marker whose database and Visitor stores are owned by the isolated root", async () => {
    const runtime = await loadRuntime();
    const allowedParent = join(TEST_ROOT, "converted-fixture-targets");
    const runtimeRoot = join(allowedParent, "seller-preview-3115-owned");
    const paths = {
      databasePath: join(runtimeRoot, "dev.db"),
      demoAccessStorePath: join(runtimeRoot, "demo-access.json"),
      demoSandboxStorePath: join(runtimeRoot, "demo-sandbox.json"),
    };
    const marker = runtime.buildSmokeMarker({
      runtimeRoot,
      worktreeRoot: resolve("."),
      port: "3115",
      ...paths,
      launchId: "fixture-launch-id",
      createdAt: "2026-08-01T00:00:00.000Z",
      ownedPid: 4242,
      listenerPid: 4343,
    });
    const options = {
      runtimeRoot,
      marker,
      allowedParent,
      worktreeRoot: resolve("."),
      pathExists: () => true,
      isInsideGitRepository: () => false,
      hasReparsePoint: () => false,
      isProcessAlive: () => true,
    };

    expect(runtime.validateConvertedTaskFixtureTarget(options)).toMatchObject(paths);
    expect(() => runtime.validateConvertedTaskFixtureTarget({
      ...options,
      marker: { ...marker, port: 3005 },
    })).toThrow("smoke_marker_port_invalid");
    expect(() => runtime.validateConvertedTaskFixtureTarget({
      ...options,
      marker: { ...marker, databasePath: resolve("prisma/dev.db") },
    })).toThrow("smoke_fixture_database_path_invalid");
    expect(() => runtime.validateConvertedTaskFixtureTarget({
      ...options,
      marker: { ...marker, demoSandboxStorePath: resolve("data/demo-sandbox.json") },
    })).toThrow("smoke_fixture_sandbox_path_invalid");
    expect(() => runtime.validateConvertedTaskFixtureTarget({
      ...options,
      marker: { ...marker, ownedPid: undefined },
    })).toThrow("smoke_owned_pid_missing");
    expect(() => runtime.validateConvertedTaskFixtureTarget({
      ...options,
      isProcessAlive: () => false,
    })).toThrow("smoke_runtime_not_running");
    expect(() => runtime.validateConvertedTaskFixtureTarget({
      ...options,
      runtimeRoot: join(TEST_ROOT, "not-the-allowed-parent", "runtime"),
    })).toThrow("smoke_runtime_parent_invalid");
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

  it("creates one linked Owner fixture and one linked Visitor A fixture without populating Visitor B", async () => {
    const runtime = await loadRuntime();
    const allowedParent = join(TEST_ROOT, "converted-fixture-integration");
    const runtimeRoot = join(allowedParent, "seller-preview-3115-converted");
    mkdirSync(runtimeRoot, { recursive: true });
    const databasePath = join(runtimeRoot, "dev.db");
    const demoAccessStorePath = join(runtimeRoot, "demo-access.json");
    const demoSandboxStorePath = join(runtimeRoot, "demo-sandbox.json");
    const env = runtime.buildSanitizedSmokeEnvironment({
      parentEnv: process.env,
      ownerPassword: "synthetic-owner-test-only",
      databasePath,
      demoAccessStorePath,
      demoSandboxStorePath,
    });
    const migrate = spawnSync(process.execPath, [
      resolve("node_modules/prisma/build/index.js"), "migrate", "deploy",
    ], {
      cwd: resolve("."),
      env,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(migrate.status).toBe(0);
    writeFileSync(demoAccessStorePath, `${JSON.stringify({
      version: 1,
      accesses: [
        { id: "demo_fixture_visitor_a", label: "Synthetic Visitor A" },
        { id: "demo_fixture_visitor_b", label: "Synthetic Visitor B" },
      ],
    }, null, 2)}\n`);
    runtime.createSyntheticDemoSandboxStore(demoSandboxStorePath);
    const marker = runtime.buildSmokeMarker({
      runtimeRoot,
      worktreeRoot: resolve("."),
      port: "3115",
      databasePath,
      demoAccessStorePath,
      demoSandboxStorePath,
      launchId: "converted-fixture-test-launch",
      createdAt: "2026-08-01T00:00:00.000Z",
      ownedPid: 4242,
      listenerPid: 4343,
    });
    writeFileSync(join(runtimeRoot, "smoke-runtime.json"), `${JSON.stringify(marker, null, 2)}\n`);

    const first = await runtime.seedConvertedTaskFixture({
      runtimeRoot,
      allowedParent,
      worktreeRoot: resolve("."),
      isInsideGitRepository: () => false,
      hasReparsePoint: () => false,
      isProcessAlive: () => true,
    });
    const second = await runtime.seedConvertedTaskFixture({
      runtimeRoot,
      allowedParent,
      worktreeRoot: resolve("."),
      isInsideGitRepository: () => false,
      hasReparsePoint: () => false,
      isProcessAlive: () => true,
    });
    expect(first).toEqual({
      status: "converted_task_fixture_seeded",
      ownerCandidateCount: 1,
      ownerTaskCount: 1,
      visitorACandidateCount: 1,
      visitorATaskCount: 1,
      visitorBCandidateCount: 0,
      visitorBTaskCount: 0,
    });
    expect(second).toEqual(first);

    const prisma = new PrismaClient({
      datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } },
    });
    try {
      const ownerCandidates = await prisma.opportunityCandidate.findMany();
      const ownerTasks = await prisma.viralAnalysisRecord.findMany();
      expect(ownerCandidates).toHaveLength(1);
      expect(ownerTasks).toHaveLength(1);
      expect(ownerCandidates[0].convertedTaskId).toBe(ownerTasks[0].id);
    } finally {
      await prisma.$disconnect();
    }
    const sandbox = JSON.parse(readFileSync(demoSandboxStorePath, "utf8"));
    const visitorACandidates = sandbox.candidates.filter((item: { demoAccessId: string }) => item.demoAccessId === "demo_fixture_visitor_a");
    const visitorATasks = sandbox.tasks.filter((item: { demoAccessId: string }) => item.demoAccessId === "demo_fixture_visitor_a");
    expect(visitorACandidates).toHaveLength(1);
    expect(visitorATasks).toHaveLength(1);
    expect(visitorACandidates[0].convertedTaskId).toBe(visitorATasks[0].id);
    expect(sandbox.candidates.filter((item: { demoAccessId: string }) => item.demoAccessId === "demo_fixture_visitor_b")).toHaveLength(0);
    expect(sandbox.tasks.filter((item: { demoAccessId: string }) => item.demoAccessId === "demo_fixture_visitor_b")).toHaveLength(0);
  }, 30_000);

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

  it("publishes only aggregate fixture counts and rejects a runtime without its owned marker", async () => {
    const runtime = await loadRuntime();
    const root = join(TEST_ROOT, "seller-preview-3115-fixture-cli");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = {
      status: "converted_task_fixture_seeded",
      ownerCandidateCount: 1,
      ownerTaskCount: 1,
      visitorACandidateCount: 1,
      visitorATaskCount: 1,
      visitorBCandidateCount: 0,
      visitorBTaskCount: 0,
      ownerCandidateId: "INTERNAL_CANDIDATE_SENTINEL",
      ownerTaskId: "INTERNAL_TASK_SENTINEL",
      password: "CREDENTIAL_SENTINEL",
    };
    const exitCode = await runtime.runSmokeRuntimeCli([
      "seed-converted-task-fixture", "--runtime-root", root,
    ], {
      seedConvertedTaskFixtureImpl: async () => result,
      writeStdout: (value: string) => stdout.push(value),
      writeStderr: (value: string) => stderr.push(value),
    });
    const output = stdout.join("\n");
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(output)).toEqual({
      status: "converted_task_fixture_seeded",
      ownerCandidateCount: 1,
      ownerTaskCount: 1,
      visitorACandidateCount: 1,
      visitorATaskCount: 1,
      visitorBCandidateCount: 0,
      visitorBTaskCount: 0,
    });
    expect(output).not.toMatch(/INTERNAL_|CREDENTIAL_SENTINEL/);

    const missingRoot = join(TEST_ROOT, "missing-marker-parent", "missing-runtime");
    mkdirSync(missingRoot, { recursive: true });
    await expect(runtime.seedConvertedTaskFixture({
      runtimeRoot: missingRoot,
      allowedParent: resolve(missingRoot, ".."),
      worktreeRoot: resolve("."),
      isInsideGitRepository: () => false,
      hasReparsePoint: () => false,
      isProcessAlive: () => true,
    })).rejects.toThrow("smoke_marker_missing");
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
    expect(source).not.toMatch(/fetch\(|openai|anthropic|deepseek/i);
  });
});
