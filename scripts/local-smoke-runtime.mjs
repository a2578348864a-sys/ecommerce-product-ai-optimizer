#!/usr/bin/env node

// Keep this executable module on LF; see .gitattributes.
import {
  execFileSync,
  spawn,
  spawnSync,
} from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalPortAvailable,
  findLocalPortListeners,
} from "./local-next-runtime.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SMOKE_SCHEMA_VERSION = "qingxuan-local-smoke-runtime.v1";
const SMOKE_PORT = "3115";
const LOCAL_HOST = "127.0.0.1";
const SAFE_ENVIRONMENT_KEYS = [
  "APPDATA",
  "COMSPEC",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
];

function normalizePathForComparison(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathWithin(parentPath, childPath) {
  const pathFromParent = relative(
    normalizePathForComparison(parentPath),
    normalizePathForComparison(childPath),
  );
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function assertAbsoluteLocalPath(path, errorCode) {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error(errorCode);
  if (path.startsWith("\\\\")) throw new Error("smoke_network_path_forbidden");
  return resolve(path);
}

function findExistingAncestor(path) {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error("smoke_existing_ancestor_missing");
    current = parent;
  }
  return current;
}

export function hasReparsePoint(path) {
  let current = findExistingAncestor(path);
  while (true) {
    if (lstatSync(current).isSymbolicLink()) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function isInsideGitRepository(path) {
  const existingAncestor = findExistingAncestor(path);
  try {
    return execFileSync(
      "git.exe",
      ["-C", existingAncestor, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    ).trim() === "true";
  } catch {
    return false;
  }
}

export function parseSmokeRuntimeArguments(args = []) {
  const [action, ...options] = args;
  if (!["start", "status", "stop", "cleanup", "serve"].includes(action)) {
    throw new Error("smoke_action_invalid");
  }
  const values = {};
  const allowedOptions = new Map([
    ["--runtime-root", "runtimeRoot"],
    ["--port", "port"],
    ["--launch-id", "launchId"],
  ]);
  const seen = new Set();
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    const value = options[index + 1];
    if (!allowedOptions.has(option) || value === undefined || seen.has(option)) {
      throw new Error("smoke_arguments_invalid");
    }
    seen.add(option);
    values[allowedOptions.get(option)] = value;
  }
  const runtimeRoot = assertAbsoluteLocalPath(
    values.runtimeRoot,
    "smoke_runtime_root_absolute_required",
  );
  if (action === "start" || action === "serve") {
    if (values.port !== SMOKE_PORT) throw new Error("smoke_port_must_be_3115");
  } else if (values.port !== undefined) {
    throw new Error("smoke_arguments_invalid");
  }
  if (action === "serve" && !values.launchId) throw new Error("smoke_launch_id_required");
  if (action !== "serve" && values.launchId !== undefined) throw new Error("smoke_arguments_invalid");
  return action === "start"
    ? { action, runtimeRoot, port: SMOKE_PORT }
    : action === "serve"
      ? { action, runtimeRoot, port: SMOKE_PORT, launchId: values.launchId }
      : { action, runtimeRoot };
}

export function getDefaultSmokeParent() {
  return resolve(homedir(), "Desktop", "qingxuan-smoke");
}

export function resolveSmokeRuntimePaths({
  runtimeRoot,
  allowedParent = getDefaultSmokeParent(),
  worktreeRoot = process.cwd(),
  pathExists = existsSync,
  isInsideGitRepository: insideGit = isInsideGitRepository,
  hasReparsePoint: containsReparsePoint = hasReparsePoint,
} = {}) {
  const root = assertAbsoluteLocalPath(runtimeRoot, "smoke_runtime_root_absolute_required");
  const parent = assertAbsoluteLocalPath(allowedParent, "smoke_parent_absolute_required");
  const worktree = resolve(worktreeRoot);
  if (isPathWithin(worktree, root) || isPathWithin(root, worktree)) {
    throw new Error("smoke_runtime_inside_worktree");
  }
  if (dirname(root) !== parent) throw new Error("smoke_runtime_parent_invalid");
  if (pathExists(root)) throw new Error("smoke_runtime_root_exists");
  if (insideGit(parent)) throw new Error("smoke_runtime_inside_git_repository");
  if (containsReparsePoint(parent)) throw new Error("smoke_runtime_reparse_point_forbidden");
  return {
    runtimeRoot: root,
    databasePath: join(root, "dev.db"),
    demoAccessStorePath: join(root, "demo-access.json"),
    demoSandboxStorePath: join(root, "demo-sandbox.json"),
    markerPath: join(root, "smoke-runtime.json"),
    logPath: join(root, "runtime.log"),
  };
}

function hashSyntheticPassword(password, salt) {
  return `sha256:${createHash("sha256").update(salt + password).digest("hex")}`;
}

export function createSyntheticDemoAccessStore({
  storePath,
  plainPassword,
  now = new Date(),
  randomBytesImpl = randomBytes,
} = {}) {
  if (!plainPassword) throw new Error("smoke_visitor_password_required");
  const salt = randomBytesImpl(16).toString("hex");
  const record = {
    id: `demo_${randomBytesImpl(8).toString("hex")}`,
    label: "3115 本机合成 Smoke Visitor",
    passwordHash: hashSyntheticPassword(plainPassword, salt),
    salt,
    expiresAt: null,
    maxAiCalls: 1,
    usedAiCalls: 0,
    isActive: true,
    createdAt: now.toISOString(),
    lastUsedAt: null,
    notes: "Disposable local smoke runtime only.",
  };
  writeFileSync(storePath, `${JSON.stringify({ version: 1, accesses: [record] }, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { recordCount: 1 };
}

export function createSyntheticDemoSandboxStore(storePath) {
  writeFileSync(
    storePath,
    `${JSON.stringify({ version: 1, tasks: [], candidates: [] }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

export function buildSanitizedSmokeEnvironment({
  parentEnv = process.env,
  ownerPassword,
  databasePath,
  demoAccessStorePath,
  demoSandboxStorePath,
} = {}) {
  const env = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = parentEnv[key] ?? parentEnv[key.toLowerCase()];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  env.NODE_ENV = "production";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.ACCESS_PASSWORD = ownerPassword;
  env.DATABASE_URL = `file:${resolve(databasePath).replaceAll("\\", "/")}`;
  env.DEMO_ACCESS_STORE_PATH = resolve(demoAccessStorePath);
  env.DEMO_SANDBOX_STORE_PATH = resolve(demoSandboxStorePath);
  return env;
}

export function buildSmokeServeLaunchSpec({
  runtimeRoot,
  worktreeRoot,
  port = SMOKE_PORT,
  launchId,
  env,
} = {}) {
  return {
    command: process.execPath,
    args: [
      SCRIPT_PATH,
      "serve",
      "--runtime-root",
      resolve(runtimeRoot),
      "--port",
      port,
      "--launch-id",
      launchId,
    ],
    options: {
      cwd: resolve(worktreeRoot),
      env,
      detached: true,
      windowsHide: true,
    },
  };
}

export function buildPrismaMigrationSpec({
  worktreeRoot,
  databasePath,
  baseEnv,
} = {}) {
  return {
    command: process.execPath,
    args: [
      join(resolve(worktreeRoot), "node_modules", "prisma", "build", "index.js"),
      "migrate",
      "deploy",
    ],
    env: {
      ...baseEnv,
      DATABASE_URL: `file:${resolve(databasePath).replaceAll("\\", "/")}`,
    },
  };
}

export function buildSmokeMarker({
  runtimeRoot,
  worktreeRoot,
  port = SMOKE_PORT,
  databasePath,
  demoAccessStorePath,
  demoSandboxStorePath,
  launchId,
  createdAt,
  ownedPid,
  listenerPid,
  stoppedAt,
} = {}) {
  return {
    schemaVersion: SMOKE_SCHEMA_VERSION,
    runtimeRoot: resolve(runtimeRoot),
    worktreeRoot: resolve(worktreeRoot),
    port: Number(port),
    databasePath: resolve(databasePath),
    demoAccessStorePath: resolve(demoAccessStorePath),
    demoSandboxStorePath: resolve(demoSandboxStorePath),
    launchId,
    createdAt,
    ...(Number.isInteger(ownedPid) ? { ownedPid } : {}),
    ...(Number.isInteger(listenerPid) ? { listenerPid } : {}),
    ...(stoppedAt ? { stoppedAt } : {}),
  };
}

export function formatSmokeRuntimeStartOutput({
  status,
  runtimeRoot,
  port,
  ownedPid,
  listenerPid,
  databasePath,
  demoAccessStorePath,
  demoSandboxStorePath,
  createdAt,
} = {}) {
  return JSON.stringify({
    status,
    runtimeRoot,
    port,
    ownedPid,
    listenerPid,
    databasePath,
    demoAccessStorePath,
    demoSandboxStorePath,
    createdAt,
  });
}

function releaseSmokeRuntimeCredentials(result) {
  if (!result || typeof result !== "object") return;
  delete result.ownerPassword;
  delete result.visitorPassword;
}

function assertMarker(marker, runtimeRoot) {
  if (marker?.schemaVersion !== SMOKE_SCHEMA_VERSION) throw new Error("smoke_marker_invalid");
  if (resolve(marker.runtimeRoot) !== resolve(runtimeRoot)) throw new Error("smoke_marker_root_mismatch");
  if (marker.port !== Number(SMOKE_PORT)) throw new Error("smoke_marker_port_invalid");
  return marker;
}

function readSmokeMarker(runtimeRoot) {
  const markerPath = join(resolve(runtimeRoot), "smoke-runtime.json");
  if (!existsSync(markerPath)) throw new Error("smoke_marker_missing");
  return assertMarker(JSON.parse(readFileSync(markerPath, "utf8")), runtimeRoot);
}

function writeSmokeMarker(marker) {
  writeFileSync(
    join(marker.runtimeRoot, "smoke-runtime.json"),
    `${JSON.stringify(marker, null, 2)}\n`,
    "utf8",
  );
}

export function validateOwnedRuntimeProcess(marker, processInfo) {
  if (!Number.isInteger(marker?.ownedPid) || processInfo?.pid !== marker.ownedPid) {
    throw new Error("smoke_owned_process_identity_mismatch");
  }
  const commandLine = String(processInfo.commandLine ?? "").toLowerCase();
  const requiredFragments = [
    "local-smoke-runtime.mjs",
    " serve ",
    String(marker.runtimeRoot).toLowerCase(),
    `--port ${marker.port}`,
    String(marker.launchId).toLowerCase(),
  ];
  if (!requiredFragments.every((fragment) => commandLine.includes(fragment))) {
    throw new Error("smoke_owned_process_identity_mismatch");
  }
  return true;
}

export function buildOwnedTreeStopSpec(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("smoke_owned_pid_invalid");
  if (platform !== "win32") throw new Error("smoke_platform_unsupported");
  return { command: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"] };
}

function queryWindowsProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { exit 3 }",
    "[pscustomobject]@{ pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; commandLine = [string]$p.CommandLine } | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    return JSON.parse(execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    ));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  return queryWindowsProcess(pid) !== null;
}

function isDescendantProcess(pid, ancestorPid) {
  const visited = new Set();
  let currentPid = pid;
  while (Number.isInteger(currentPid) && currentPid > 0 && !visited.has(currentPid)) {
    if (currentPid === ancestorPid) return true;
    visited.add(currentPid);
    const processInfo = queryWindowsProcess(currentPid);
    if (!processInfo) return false;
    currentPid = processInfo.parentPid;
  }
  return false;
}

function assertNoLocalEnvironmentFiles(worktreeRoot) {
  const forbiddenFiles = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ];
  const existing = forbiddenFiles.filter((name) => existsSync(join(worktreeRoot, name)));
  if (existing.length > 0) throw new Error("smoke_local_environment_file_present");
}

function wait(delayMs) {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

async function waitForOwnedListener({ port, ownedPid, timeoutMs = 30_000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listeners = findLocalPortListeners({ port })
      .filter((listener) => listener.address === `${LOCAL_HOST}:${port}`);
    for (const listener of listeners) {
      if (isDescendantProcess(listener.pid, ownedPid)) return listener;
    }
    if (!isProcessAlive(ownedPid)) throw new Error("smoke_owned_process_exited_before_listen");
    await wait(250);
  }
  throw new Error("smoke_listener_timeout");
}

function runLockedMigrations({ worktreeRoot, databasePath, env }) {
  const spec = buildPrismaMigrationSpec({
    worktreeRoot,
    databasePath,
    baseEnv: env,
  });
  if (!existsSync(spec.command) || !existsSync(spec.args[0])) {
    throw new Error("smoke_prisma_cli_missing");
  }
  const result = spawnSync(spec.command, spec.args, {
    cwd: worktreeRoot,
    env: spec.env,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("smoke_prisma_migrate_deploy_failed");
}

export async function startSmokeRuntime({
  runtimeRoot,
  port = SMOKE_PORT,
  allowedParent = getDefaultSmokeParent(),
  worktreeRoot = process.cwd(),
  parentEnv = process.env,
} = {}) {
  if (port !== SMOKE_PORT) throw new Error("smoke_port_must_be_3115");
  const root = assertAbsoluteLocalPath(runtimeRoot, "smoke_runtime_root_absolute_required");
  const parent = assertAbsoluteLocalPath(allowedParent, "smoke_parent_absolute_required");
  if (dirname(root) !== parent) throw new Error("smoke_runtime_parent_invalid");
  if (isInsideGitRepository(parent)) throw new Error("smoke_runtime_inside_git_repository");
  if (hasReparsePoint(parent)) throw new Error("smoke_runtime_reparse_point_forbidden");
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const paths = resolveSmokeRuntimePaths({
    runtimeRoot: root,
    allowedParent: parent,
    worktreeRoot,
  });
  assertNoLocalEnvironmentFiles(worktreeRoot);
  await assertLocalPortAvailable({ host: LOCAL_HOST, port });

  mkdirSync(paths.runtimeRoot);
  let ownedPid;
  try {
    const ownerPassword = randomBytes(18).toString("base64url");
    const visitorPassword = randomBytes(18).toString("base64url");
    const launchId = randomUUID();
    const createdAt = new Date().toISOString();
    const env = buildSanitizedSmokeEnvironment({
      parentEnv,
      ownerPassword,
      databasePath: paths.databasePath,
      demoAccessStorePath: paths.demoAccessStorePath,
      demoSandboxStorePath: paths.demoSandboxStorePath,
    });

    runLockedMigrations({ worktreeRoot: resolve(worktreeRoot), databasePath: paths.databasePath, env });
    createSyntheticDemoAccessStore({
      storePath: paths.demoAccessStorePath,
      plainPassword: visitorPassword,
    });
    createSyntheticDemoSandboxStore(paths.demoSandboxStorePath);

    const logHandle = openSync(paths.logPath, "ax");
    let child;
    try {
      const spec = buildSmokeServeLaunchSpec({
        runtimeRoot: paths.runtimeRoot,
        worktreeRoot,
        port,
        launchId,
        env,
      });
      child = spawn(spec.command, spec.args, {
        ...spec.options,
        stdio: ["ignore", logHandle, logHandle],
      });
      ownedPid = child.pid;
      if (!Number.isInteger(ownedPid)) throw new Error("smoke_owned_pid_missing");
      child.unref();
    } finally {
      closeSync(logHandle);
    }

    const initialMarker = buildSmokeMarker({
      ...paths,
      worktreeRoot,
      port,
      launchId,
      createdAt,
      ownedPid,
    });
    writeSmokeMarker(initialMarker);
    const listener = await waitForOwnedListener({ port, ownedPid });
    const marker = { ...initialMarker, listenerPid: listener.pid };
    writeSmokeMarker(marker);
    return {
      status: "smoke_runtime_started",
      ownerPassword,
      visitorPassword,
      port: Number(port),
      ownedPid,
      listenerPid: listener.pid,
      runtimeRoot: paths.runtimeRoot,
      databasePath: paths.databasePath,
      demoAccessStorePath: paths.demoAccessStorePath,
      demoSandboxStorePath: paths.demoSandboxStorePath,
      createdAt,
    };
  } catch (error) {
    if (Number.isInteger(ownedPid)) {
      const processInfo = queryWindowsProcess(ownedPid);
      const marker = existsSync(paths.markerPath) ? readSmokeMarker(paths.runtimeRoot) : null;
      if (processInfo && marker) {
        validateOwnedRuntimeProcess(marker, processInfo);
        const stopSpec = buildOwnedTreeStopSpec(ownedPid);
        spawnSync(stopSpec.command, stopSpec.args, { windowsHide: true, stdio: "ignore" });
      }
    }
    if (!Number.isInteger(ownedPid) && existsSync(paths.runtimeRoot)) {
      rmSync(paths.runtimeRoot, { recursive: true, force: false });
    }
    throw error;
  }
}

async function serveSmokeRuntime({ runtimeRoot, port, launchId, worktreeRoot = process.cwd() }) {
  const databasePath = process.env.DATABASE_URL?.startsWith("file:")
    ? process.env.DATABASE_URL.slice(5).replaceAll("/", "\\")
    : "";
  const demoAccessStorePath = process.env.DEMO_ACCESS_STORE_PATH;
  if (!databasePath || !demoAccessStorePath) throw new Error("smoke_serve_environment_invalid");
  const child = spawn(
    process.execPath,
    [
      join(worktreeRoot, "scripts", "local-next-runtime.mjs"),
      "start",
      "--port",
      port,
      "--database-path",
      databasePath,
      "--demo-access-store-path",
      demoAccessStorePath,
    ],
    {
      cwd: worktreeRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  await new Promise((resolveServe, rejectServe) => {
    child.once("error", rejectServe);
    child.once("exit", (code, signal) => {
      if (signal) rejectServe(new Error(`smoke_next_stopped_by_${signal}`));
      else if (code !== 0) rejectServe(new Error(`smoke_next_exit_${code ?? "unknown"}`));
      else resolveServe();
    });
  });
  void runtimeRoot;
  void launchId;
}

export function getSmokeRuntimeStatus({ runtimeRoot } = {}) {
  const marker = readSmokeMarker(runtimeRoot);
  const owned = Number.isInteger(marker.ownedPid) ? queryWindowsProcess(marker.ownedPid) : null;
  const listener = findLocalPortListeners({ port: SMOKE_PORT })
    .find((entry) => entry.address === `${LOCAL_HOST}:${SMOKE_PORT}`) ?? null;
  return {
    status: owned ? "running" : "stopped",
    runtimeRoot: marker.runtimeRoot,
    port: marker.port,
    ownedPid: marker.ownedPid ?? null,
    listenerPid: listener?.pid ?? null,
  };
}

export function stopSmokeRuntime({ runtimeRoot } = {}) {
  const marker = readSmokeMarker(runtimeRoot);
  if (!Number.isInteger(marker.ownedPid)) throw new Error("smoke_owned_pid_missing");
  const processInfo = queryWindowsProcess(marker.ownedPid);
  if (processInfo) {
    validateOwnedRuntimeProcess(marker, processInfo);
    const stopSpec = buildOwnedTreeStopSpec(marker.ownedPid);
    const result = spawnSync(stopSpec.command, stopSpec.args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) throw new Error("smoke_owned_process_stop_failed");
  }
  const stoppedMarker = { ...marker, stoppedAt: new Date().toISOString() };
  writeSmokeMarker(stoppedMarker);
  return { status: "smoke_runtime_stopped", ownedPid: marker.ownedPid };
}

export function cleanupSmokeRuntime({
  runtimeRoot,
  allowedParent = getDefaultSmokeParent(),
  worktreeRoot = process.cwd(),
  isProcessAlive: processAlive = isProcessAlive,
  isInsideGitRepository: insideGit = isInsideGitRepository,
  hasReparsePoint: containsReparsePoint = hasReparsePoint,
} = {}) {
  const root = assertAbsoluteLocalPath(runtimeRoot, "smoke_runtime_root_absolute_required");
  const parent = assertAbsoluteLocalPath(allowedParent, "smoke_parent_absolute_required");
  if (dirname(root) !== parent) throw new Error("smoke_runtime_parent_invalid");
  if (isPathWithin(worktreeRoot, root) || isPathWithin(root, worktreeRoot)) {
    throw new Error("smoke_runtime_inside_worktree");
  }
  if (insideGit(parent)) throw new Error("smoke_runtime_inside_git_repository");
  if (containsReparsePoint(parent)) throw new Error("smoke_runtime_reparse_point_forbidden");
  const marker = readSmokeMarker(root);
  if (Number.isInteger(marker.ownedPid) && processAlive(marker.ownedPid)) {
    throw new Error("smoke_runtime_still_running");
  }
  rmSync(root, { recursive: true, force: false });
  return { status: "smoke_runtime_cleaned", runtimeRoot: root };
}

export async function runSmokeRuntimeCli(
  args = process.argv.slice(2),
  {
    startSmokeRuntimeImpl = startSmokeRuntime,
    serveSmokeRuntimeImpl = serveSmokeRuntime,
    getSmokeRuntimeStatusImpl = getSmokeRuntimeStatus,
    stopSmokeRuntimeImpl = stopSmokeRuntime,
    cleanupSmokeRuntimeImpl = cleanupSmokeRuntime,
    writeStdout = console.log,
    writeStderr = console.error,
  } = {},
) {
  let started;
  try {
    const parsed = parseSmokeRuntimeArguments(args);
    if (parsed.action === "start") {
      started = await startSmokeRuntimeImpl(parsed);
      writeStdout(formatSmokeRuntimeStartOutput(started));
      return 0;
    }
    if (parsed.action === "serve") {
      await serveSmokeRuntimeImpl(parsed);
      return 0;
    }
    if (parsed.action === "status") {
      writeStdout(JSON.stringify(getSmokeRuntimeStatusImpl(parsed)));
      return 0;
    }
    if (parsed.action === "stop") {
      writeStdout(JSON.stringify(stopSmokeRuntimeImpl(parsed)));
      return 0;
    }
    writeStdout(JSON.stringify(cleanupSmokeRuntimeImpl(parsed)));
    return 0;
  } catch {
    writeStderr(JSON.stringify({ status: "smoke_runtime_failed" }));
    return 1;
  } finally {
    releaseSmokeRuntimeCredentials(started);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  runSmokeRuntimeCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
