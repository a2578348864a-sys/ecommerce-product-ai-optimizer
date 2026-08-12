#!/usr/bin/env node

// Keep this executable module on LF; see .gitattributes.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const LOCAL_DATABASE_URL = "file:./dev.db";
const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = "3005";
const MIN_LOCAL_PORT = 1024;
const MAX_LOCAL_PORT = 65535;

export function normalizeLocalPort(port = LOCAL_PORT) {
  const rawPort = typeof port === "number" ? String(port) : port;
  if (typeof rawPort !== "string" || !/^\d+$/.test(rawPort)) {
    throw new Error("local_port_invalid");
  }
  const numericPort = Number(rawPort);
  if (!Number.isInteger(numericPort) || numericPort < MIN_LOCAL_PORT || numericPort > MAX_LOCAL_PORT) {
    throw new Error("local_port_out_of_range");
  }
  return String(numericPort);
}

export function parseWindowsTcpListeners(output, port) {
  const normalizedPort = normalizeLocalPort(port);
  const portSuffix = `:${normalizedPort}`;
  return String(output)
    .split(/\r?\n/)
    .flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns[0] !== "TCP" || columns[3] !== "LISTENING" || !columns[1]?.endsWith(portSuffix)) {
        return [];
      }
      const pid = Number(columns[4]);
      return Number.isInteger(pid) && pid > 0 ? [{ address: columns[1], pid }] : [];
    });
}

export function findLocalPortListeners({
  port,
  execFileSyncImpl = execFileSync,
  platform = process.platform,
} = {}) {
  const normalizedPort = normalizeLocalPort(port);
  if (platform !== "win32") return [];
  try {
    const output = execFileSyncImpl("netstat.exe", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return parseWindowsTcpListeners(output, normalizedPort);
  } catch {
    return [];
  }
}

export async function assertLocalPortAvailable({
  host = LOCAL_HOST,
  port = LOCAL_PORT,
  createProbeServer = createServer,
  findListeners = findLocalPortListeners,
} = {}) {
  const normalizedPort = normalizeLocalPort(port);
  await new Promise((resolveProbe, rejectProbe) => {
    const probe = createProbeServer();
    probe.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        const listeners = findListeners({ port: normalizedPort });
        const listenerSummary = listeners.length > 0
          ? listeners.map((listener) => `${listener.address}@${listener.pid}`).join(",")
          : "unknown";
        rejectProbe(new Error(`local_port_in_use:${normalizedPort}:listeners=${listenerSummary}`));
        return;
      }
      rejectProbe(new Error(`local_port_probe_failed:${normalizedPort}`));
    });
    probe.listen({ host, port: Number(normalizedPort), exclusive: true }, () => {
      probe.close((error) => {
        if (error) rejectProbe(new Error(`local_port_probe_failed:${normalizedPort}`));
        else resolveProbe();
      });
    });
  });
}

export function parseLocalRuntimeArguments(args = []) {
  const [requestedMode, ...options] = args;
  const checkOnly = requestedMode === "check";
  const mode = checkOnly ? "start" : requestedMode;
  const parsed = { mode, checkOnly, port: LOCAL_PORT };
  const allowedOptions = new Map([
    ["--port", "port"],
    ["--database-path", "databasePath"],
    ["--demo-access-store-path", "demoAccessStorePath"],
  ]);
  const seen = new Set();
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    const value = options[index + 1];
    if (option === "--port" && value === undefined) throw new Error("local_port_invalid");
    if (!allowedOptions.has(option) || value === undefined || seen.has(option)) {
      throw new Error("local_runtime_arguments_invalid");
    }
    seen.add(option);
    parsed[allowedOptions.get(option)] = option === "--port" ? normalizeLocalPort(value) : value;
  }
  if (Boolean(parsed.databasePath) !== Boolean(parsed.demoAccessStorePath)) {
    throw new Error("local_isolated_paths_required_together");
  }
  return parsed;
}

function isPathWithin(parentPath, childPath) {
  const pathFromParent = relative(resolve(parentPath), resolve(childPath));
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function assertIsolatedRuntimePaths({
  projectRoot,
  databasePath,
  demoAccessStorePath,
  smokeParentRoot,
}) {
  // UNC 前缀先于 isAbsolute 检查：UNC 路径在任何平台都是网络路径，必须拒绝
  // （Linux 的 isAbsolute("\\\\server\\share") 为 false，会先抛绝对路径错误）
  if (databasePath.startsWith("\\\\") || demoAccessStorePath.startsWith("\\\\")) {
    throw new Error("local_isolated_network_path_forbidden");
  }
  if (!isAbsolute(databasePath)) throw new Error("local_database_path_absolute_required");
  if (!isAbsolute(demoAccessStorePath)) throw new Error("local_demo_access_store_path_absolute_required");
  if (![".db", ".sqlite"].includes(extname(databasePath).toLowerCase())) {
    throw new Error("local_database_extension_invalid");
  }
  if (extname(demoAccessStorePath).toLowerCase() !== ".json") {
    throw new Error("local_demo_access_store_extension_invalid");
  }
  const runtimeRoot = dirname(resolve(databasePath));
  if (dirname(resolve(demoAccessStorePath)) !== runtimeRoot) {
    throw new Error("local_isolated_paths_root_mismatch");
  }
  if (isPathWithin(projectRoot, runtimeRoot)) {
    throw new Error("local_isolated_path_inside_worktree");
  }
  const allowedSmokeParent = resolve(
    smokeParentRoot ?? join(homedir(), "Desktop", "qingxuan-smoke"),
  );
  if (!isPathWithin(allowedSmokeParent, runtimeRoot)) {
    throw new Error("local_isolated_path_outside_smoke_parent");
  }
  let current = runtimeRoot;
  while (isPathWithin(allowedSmokeParent, current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("local_isolated_reparse_point_forbidden");
    }
    if (current === allowedSmokeParent) break;
    current = dirname(current);
  }
  return {
    databasePath: resolve(databasePath),
    demoAccessStorePath: resolve(demoAccessStorePath),
  };
}

export function buildLocalRuntimeConfig({
  cwd = process.cwd(),
  mode = "start",
  port = LOCAL_PORT,
  databasePath,
  demoAccessStorePath,
  smokeParentRoot,
  parentEnv = process.env,
} = {}) {
  if (mode !== "start" && mode !== "dev") {
    throw new Error("Local runtime mode must be start or dev.");
  }
  const projectRoot = resolve(cwd);
  const normalizedPort = normalizeLocalPort(port);
  if (Boolean(databasePath) !== Boolean(demoAccessStorePath)) {
    throw new Error("local_isolated_paths_required_together");
  }
  const isolatedPaths = databasePath && demoAccessStorePath
    ? assertIsolatedRuntimePaths({
      projectRoot,
      databasePath,
      demoAccessStorePath,
      smokeParentRoot,
    })
    : null;
  const resolvedDatabasePath = isolatedPaths?.databasePath
    ?? resolve(projectRoot, "prisma", "dev.db");
  const databaseUrl = isolatedPaths
    ? `file:${resolvedDatabasePath.replaceAll("\\", "/")}`
    : LOCAL_DATABASE_URL;
  const env = { ...parentEnv, DATABASE_URL: databaseUrl };
  if (isolatedPaths) env.DEMO_ACCESS_STORE_PATH = isolatedPaths.demoAccessStorePath;
  return {
    databasePath: resolvedDatabasePath,
    env,
    command: process.execPath,
    args: [
      resolve(projectRoot, "node_modules", "next", "dist", "bin", "next"),
      mode,
      "-H",
      LOCAL_HOST,
      "-p",
      normalizedPort,
    ],
  };
}

export function inspectLocalDatabaseFile(databasePath) {
  if (!existsSync(databasePath)) throw new Error("local_database_missing");
  const size = statSync(databasePath).size;
  if (size === 0) throw new Error("local_database_empty");
  const header = Buffer.alloc(16);
  let handle;
  try {
    handle = openSync(databasePath, "r");
    const bytesRead = readSync(handle, header, 0, header.length, 0);
    if (bytesRead !== header.length || header.toString("utf8") !== "SQLite format 3\0") {
      throw new Error("local_database_invalid");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "local_database_invalid") throw error;
    throw new Error("local_database_unreadable");
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
  return { size };
}

async function probeWithPrisma(databaseUrl) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const quickCheckRows = await prisma.$queryRawUnsafe("PRAGMA quick_check");
    const firstRow = Array.isArray(quickCheckRows) ? quickCheckRows[0] : undefined;
    const quickCheck = firstRow && typeof firstRow === "object"
      ? String(Object.values(firstRow)[0] ?? "unknown")
      : "unknown";
    const candidateCount = await prisma.opportunityCandidate.count();
    const taskCount = await prisma.viralAnalysisRecord.count();
    return { quickCheck, candidateCount, taskCount };
  } finally {
    await prisma.$disconnect();
  }
}

export async function verifyLocalDatabase({
  databasePath,
  databaseUrl = LOCAL_DATABASE_URL,
  probe = probeWithPrisma,
}) {
  inspectLocalDatabaseFile(databasePath);
  const result = await probe(databaseUrl);
  if (result.quickCheck !== "ok") throw new Error("local_database_quick_check_failed");
  if (!Number.isInteger(result.candidateCount) || !Number.isInteger(result.taskCount)) {
    throw new Error("local_database_counts_invalid");
  }
  return result;
}

export async function runLocalNext({
  cwd = process.cwd(),
  mode = "start",
  checkOnly = false,
  port = LOCAL_PORT,
  databasePath,
  demoAccessStorePath,
  smokeParentRoot,
  parentEnv = process.env,
  spawnProcess = spawn,
  probe = probeWithPrisma,
  assertPortAvailable = assertLocalPortAvailable,
} = {}) {
  const config = buildLocalRuntimeConfig({
    cwd,
    mode,
    port,
    databasePath,
    demoAccessStorePath,
    smokeParentRoot,
    parentEnv,
  });
  if (!checkOnly) await assertPortAvailable({ host: LOCAL_HOST, port: config.args.at(-1) });
  const database = await verifyLocalDatabase({
    databasePath: config.databasePath,
    databaseUrl: config.env.DATABASE_URL,
    probe,
  });

  console.log(JSON.stringify({
    status: "local_database_ready",
    quickCheck: database.quickCheck,
    candidateCount: database.candidateCount,
    taskCount: database.taskCount,
  }));
  if (checkOnly) return database;

  const child = spawnProcess(config.command, config.args, {
    cwd: resolve(cwd),
    env: config.env,
    stdio: "inherit",
    windowsHide: true,
  });
  return new Promise((resolveRun, rejectRun) => {
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (signal) rejectRun(new Error(`local_next_stopped_by_${signal}`));
      else if (code !== 0) rejectRun(new Error(`local_next_exit_${code ?? "unknown"}`));
      else resolveRun(database);
    });
  });
}

async function main() {
  await runLocalNext(parseLocalRuntimeArguments(process.argv.slice(2)));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : "local_runtime_failed";
    console.error(`Local runtime refused to start: ${reason}`);
    process.exitCode = 1;
  });
}
