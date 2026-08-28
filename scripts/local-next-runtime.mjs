#!/usr/bin/env node
import { execFile as execFileCallback, execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  if (requestedMode === "stop") {
    const parsedStop = { mode: "stop", checkOnly: false, port: LOCAL_PORT, dryRun: false };
    const seenStop = new Set();
    for (let index = 1; index < args.length; index += 1) {
      const option = args[index];
      if (option === "--dry-run") {
        if (seenStop.has(option)) throw new Error("local_stop_arguments_invalid");
        seenStop.add(option); parsedStop.dryRun = true; continue;
      }
      if (option === "--port") {
        const value = args[index + 1];
        if (value === undefined || seenStop.has(option)) throw new Error("local_stop_arguments_invalid");
        seenStop.add(option); parsedStop.port = normalizeLocalPort(value); index += 1; continue;
      }
      throw new Error("local_stop_arguments_invalid");
    }
    return parsedStop;
  }
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
  if (mode !== "start" && mode !== "dev" && mode !== "stop") {
    throw new Error("Local runtime mode must be start, dev or stop.");
  }
  const projectRoot = resolve(cwd);
  const normalizedPort = normalizeLocalPort(port);
  if (mode !== "stop" && Boolean(databasePath) !== Boolean(demoAccessStorePath)) {
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
  // 被检查的数据库与实际传给 Prisma 的数据库必须一致：
  // 默认正式路径与 isolated 路径统一从已验证的 resolvedDatabasePath 生成绝对 SQLite URL，
  // 避免相对路径 (file:./dev.db) 被 Prisma 解析到生成目录下的空库。
  const databaseUrl = `file:${resolvedDatabasePath.replaceAll("\\", "/")}`;
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
  // 延迟加载：避免 .prisma/client 生成缺失时整个运行器（含 stop）无法加载
  const { PrismaClient } = await import("@prisma/client");
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


/* ── Safe stop contract（可验证 / fail-closed / 不误杀） ───────────────────── */

/** 路径/命令行归一化：统一分隔符、大小写，去除引号与尾随分隔符。 */
export function normalizePathText(value) {
  return String(value ?? "").replace(/["']/g, "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").trim().toLowerCase();
}

export function normalizeCommandLineText(value) {
  return String(value ?? "").replace(/["']/g, "").replace(/[\\/]+/g, "/").toLowerCase();
}

function containsCommandToken(normalizedText, token) {
  return normalizedText.split(/[\s,;]+/).includes(token);
}

/** 子进程是否为当前仓库的 Next start（入口路径必须落在 repoRoot 内）。 */
export function matchesNextStartEntry(rawCommandLine, repoRoot) {
  const cmd = normalizeCommandLineText(rawCommandLine);
  const repo = normalizePathText(repoRoot);
  if (!repo) return false;
  const needle = repo + "/node_modules/next/dist/bin/next";
  let idx = cmd.indexOf(needle);
  while (idx !== -1) {
    const before = cmd[idx - 1] ?? "";
    const after = cmd[idx + needle.length] ?? "";
    if (!/[a-z0-9_.\-]/.test(before) && !/[a-z0-9_.\-]/.test(after)) {
      if (containsCommandToken(cmd.slice(idx + needle.length), "start")) return true;
    }
    idx = cmd.indexOf(needle, idx + 1);
  }
  return false;
}

/** 祖先进程是否为当前仓库的 local-next-runtime.mjs start 启动器。 */
export function matchesRuntimeLauncher(rawCommandLine, repoRoot) {
  const cmd = normalizeCommandLineText(rawCommandLine);
  const repo = normalizePathText(repoRoot);
  if (!repo) return false;
  // 形态 1：绝对路径 <repo>/scripts/local-next-runtime.mjs
  const absNeedle = repo + "/scripts/local-next-runtime.mjs";
  let idx = cmd.indexOf(absNeedle);
  while (idx !== -1) {
    const before = cmd[idx - 1] ?? "";
    const after = cmd[idx + absNeedle.length] ?? "";
    if (!/[a-z0-9_.\-]/.test(before) && !/[a-z0-9_.\-]/.test(after)) {
      if (containsCommandToken(cmd.slice(idx + absNeedle.length), "start")) return true;
    }
    idx = cmd.indexOf(absNeedle, idx + 1);
  }
  // 形态 2：相对路径 node.exe scripts/local-next-runtime.mjs start
  // （WorkingDirectory 不体现在命令行中，repo 归属由进程链 + 状态文件交叉验证）
  const relNeedle = "scripts/local-next-runtime.mjs";
  let ridx = cmd.indexOf(relNeedle);
  while (ridx !== -1) {
    const before = cmd[ridx - 1] ?? "";
    const after = cmd[ridx + relNeedle.length] ?? "";
    if (/[\s"'()=,;|&<>]/.test(before) && !/[a-z0-9_.\-]/.test(after)) {
      if (containsCommandToken(cmd.slice(ridx + relNeedle.length), "start")) return true;
    }
    ridx = cmd.indexOf(relNeedle, ridx + 1);
  }
  return false;
}

/** 状态文件数据校验（纯）：只允许最小字段集且归属信息一致。 */
export function validateRuntimeStateData(data, target) {
  const reasons = [];
  const isRecord = data !== null && typeof data === "object" && !Array.isArray(data);
  if (!isRecord) return { ok: false, reasons: ["state_not_object"] };
  const allowed = new Set(["schemaVersion", "repoRoot", "host", "port", "launcherPid", "childPid", "startedAt"]);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) reasons.push("state_unexpected_field_" + key);
  }
  if (data.schemaVersion !== 1) reasons.push("state_schema_version_unsupported");
  if (normalizePathText(data.repoRoot) !== normalizePathText(target.repoRoot)) reasons.push("state_repo_root_mismatch");
  if (String(data.host ?? "").toLowerCase() !== String(target.host ?? "").toLowerCase()) reasons.push("state_host_mismatch");
  if (Number(data.port) !== Number(target.port)) reasons.push("state_port_mismatch");
  const launcherPid = Number(data.launcherPid);
  const childPid = Number(data.childPid);
  if (!Number.isInteger(launcherPid) || launcherPid <= 0) reasons.push("state_launcher_pid_invalid");
  if (!Number.isInteger(childPid) || childPid <= 0) reasons.push("state_child_pid_invalid");
  if (typeof data.startedAt !== "string" || Number.isNaN(Date.parse(data.startedAt))) reasons.push("state_started_at_invalid");
  return { ok: reasons.length === 0, reasons };
}

function runtimeStateFilePath(projectRoot, port) {
  return join(resolve(projectRoot), ".next", "local-runtime-" + Number(port) + ".json");
}

/** 读取并校验状态文件：absent（未启用状态文件） / valid / invalid。 */
export function describeRuntimeState(projectRoot, port, target) {
  const file = runtimeStateFilePath(projectRoot, port);
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return { status: "absent" }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: "invalid", reasons: ["state_json_parse_failed"] }; }
  const verdict = validateRuntimeStateData(parsed, target);
  if (!verdict.ok) return { status: "invalid", reasons: verdict.reasons };
  return { status: "valid", data: parsed };
}

/**
 * 安全停止唯一决策点（纯函数）：dry-run 与真实 stop 共用。
 * 输入全部来自实时证据；输出仅包含判定、原因码和有界摘要，绝不含完整命令行或环境内容。
 */
export function decideSafeStop({ target, state, evidence, dryRun = false }) {
  const host = String(target?.host ?? LOCAL_HOST).toLowerCase();
  const port = Number(target?.port ?? LOCAL_PORT);
  const listeners = Array.isArray(evidence?.listeners) ? evidence.listeners : [];
  const child = evidence?.child ?? null;
  const ancestors = Array.isArray(evidence?.ancestors) ? evidence.ancestors : [];
  const reasons = [];
  const summary = { host, port, listenerPid: null, launcherPid: null };

  if (listeners.length === 0) {
    return { decision: "none", ownershipVerified: false, wouldSignalPid: null, listenerPid: null, launcherPid: null, signalSent: false, reasons: ["no_listener"], summary };
  }
  if (listeners.length !== 1) {
    return { decision: "reject", ownershipVerified: false, wouldSignalPid: null, listenerPid: null, launcherPid: null, signalSent: false, reasons: ["listener_ambiguous"], summary };
  }
  const listener = listeners[0];
  summary.listenerPid = listener.pid;
  if (String(listener.address ?? "").toLowerCase() !== host) reasons.push("listener_address_mismatch");
  if (Number(listener.port) !== port) reasons.push("listener_port_mismatch");

  if (!child) reasons.push("child_process_missing");
  else {
    if (String(child.name ?? "").toLowerCase().replace(/\.exe$/, "") !== "node") reasons.push("child_not_node");
    if (!matchesNextStartEntry(child.commandLine ?? "", target.repoRoot)) reasons.push("child_next_entry_mismatch");
  }

  let launcherPid = null;
  for (const entry of ancestors) {
    if (entry && matchesRuntimeLauncher(entry.commandLine ?? "", target.repoRoot)) { launcherPid = Number(entry.pid); break; }
  }
  if (launcherPid === null) reasons.push("runtime_launcher_missing");
  summary.launcherPid = launcherPid;

  if (state?.status === "invalid") {
    for (const reason of state.reasons ?? []) reasons.push(reason);
  } else if (state?.status === "valid") {
    // 决策点复核：即使上层把状态判为 valid，也必须重新校验字段一致性（fail-closed）
    const verdict = validateRuntimeStateData(state.data, target);
    for (const reason of verdict.reasons) reasons.push(reason);
    if (Number(state.data.childPid) !== Number(listener.pid)) reasons.push("state_child_pid_mismatch");
    if (launcherPid !== null && Number(state.data.launcherPid) !== launcherPid) reasons.push("state_launcher_pid_mismatch");
  }
  // state.status === "absent" → legacy 判定：上方 实时监听者 + Next 入口路径 + 父链启动器 三重严格匹配已全部通过

  const ownershipVerified = reasons.length === 0;
  if (!ownershipVerified) {
    return { decision: "reject", ownershipVerified, wouldSignalPid: null, listenerPid: listener.pid, launcherPid, signalSent: false, reasons, summary };
  }
  return {
    decision: "proceed",
    ownershipVerified: true,
    wouldSignalPid: Number(listener.pid),
    listenerPid: Number(listener.pid),
    launcherPid,
    signalSent: false,
    reasons,
    summary,
  };
}

/**
 * 已确认归属后的执行层：dry-run 零信号；真实 stop 仅一次温和 SIGTERM，
 * 有界等待端口释放，永不二次终止或强制杀树。
 */
export async function executeConfirmedStop(decision, io = {}) {
  const dryRun = io.dryRun === true;
  const kill = typeof io.kill === "function" ? io.kill : (pid, signal) => process.kill(pid, signal);
  const isListening = typeof io.isListening === "function"
    ? io.isListening
    : async () => findLocalPortListeners({ port: decision.listenerPort ?? decision.summary?.port }).length > 0;
  const waitTimeoutMs = Number.isInteger(io.waitTimeoutMs) ? io.waitTimeoutMs : 15000;
  const pollIntervalMs = Number.isInteger(io.pollIntervalMs) ? io.pollIntervalMs : 250;

  if (decision.decision !== "proceed" || !ownershipVerifiedForExec(decision)) {
    throw new Error("local_stop_ownership_not_verified");
  }
  if (dryRun) {
    return { stopped: false, dryRun: true, signalSent: false, released: false, pid: decision.wouldSignalPid };
  }
  try {
    kill(decision.wouldSignalPid, "SIGTERM");
  } catch (error) {
    return { stopped: false, dryRun: false, signalSent: false, released: false, error: "local_stop_terminate_failed:" + String(error?.code ?? error?.message ?? "unknown") };
  }
  const deadline = Date.now() + waitTimeoutMs;
  let released = false;
  while (Date.now() < deadline) {
    if (!(await isListening())) { released = true; break; }
    await new Promise((resolveTick) => setTimeout(resolveTick, pollIntervalMs));
  }
  if (!released) {
    return { stopped: false, dryRun: false, signalSent: true, released: false, error: "local_stop_port_still_listening" };
  }
  return { stopped: true, dryRun: false, signalSent: true, released: true, pid: decision.wouldSignalPid };
}

function ownershipVerifiedForExec(decision) {
  return decision.ownershipVerified === true && Number.isInteger(Number(decision.wouldSignalPid)) && Number(decision.wouldSignalPid) > 0;
}

/** 原子写入运行状态文件（仅最小字段集）。 */
export async function writeRuntimeStateFileAtomically(projectRoot, port, data) {
  const dir = join(resolve(projectRoot), ".next");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "local-runtime-" + Number(port) + ".json");
  // 输出消毒：仅持久化最小字段集，调用方误传的 env/密钥绝不落盘
  const persisted = {
    schemaVersion: 1,
    repoRoot: String(data.repoRoot ?? ""),
    host: String(data.host ?? ""),
    port: Number(data.port),
    launcherPid: Number(data.launcherPid),
    childPid: Number(data.childPid),
    startedAt: String(data.startedAt ?? ""),
  };
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  writeFileSync(tmp, JSON.stringify(persisted, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

/** 仅当文件仍属于当前 launcher/child 时删除（避免误删后来者记录）。 */
export async function deleteRuntimeStateFileIfOwned(projectRoot, port, owner) {
  const file = runtimeStateFilePath(projectRoot, port);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { return false; }
  if (Number(parsed.launcherPid) !== Number(owner.launcherPid)) return false;
  if (Number(parsed.childPid) !== Number(owner.childPid)) return false;
  try { unlinkSync(file); return true; } catch { return false; }
}

/** ESM 主入口判定（导出以便测试导入本模块时不会触发 start）。 */
export function isMainEntry(moduleFilePath, argvFilePath) {
  if (!argvFilePath) return false;
  try { return resolve(argvFilePath) === resolve(moduleFilePath); } catch { return false; }
}

/** 进程链快照脚本：目标 PID 直接内联（-Command 会吞掉后续 argv，不能传参数）。 */
function buildOwnershipSnapshotScript(targetPid) {
  return [
  // Windows PowerShell 5.1 管道输出默认按 OEM 代码页，中文路径经 Node UTF-8 读取会失真为 U+FFFD；
  // 必须在任何 JSON/字符输出前把控制台输出编码固定为无 BOM UTF-8（P1 修复，仅影响输出，不改证据字段）。
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$OutputEncoding = [Console]::OutputEncoding",
  "$TargetPid = " + Number(targetPid),
  "$items = @()",
  "$current = $TargetPid",
  "for ($i = 0; $i -lt 8; $i++) {",
  "  $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$current\" -ErrorAction SilentlyContinue",
  "  if (-not $p) { break }",
  "  $items += [ordered]@{ pid = [int]$p.ProcessId; name = [string]$p.Name; commandLine = [string]$p.CommandLine; parentPid = [int]$p.ParentProcessId }",
  "  if ([int]$p.ParentProcessId -le 0) { break }",
  "  if ([int]$p.ParentProcessId -eq [int]$p.ProcessId) { break }",
  "  $current = [int]$p.ParentProcessId",
  "}",
  "ConvertTo-Json @{ chain = $items } -Compress",
].join("\n");
}

function execFilePromise(file, args) {
  return new Promise((resolveExec, rejectExec) => {
    execFileCallback(file, args, { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      resolveExec({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: error === null ? 0 : error.code });
    });
  });
}

export async function collectOwnershipEvidence(listenerPid) {
  const snapshot = await execFilePromise("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", buildOwnershipSnapshotScript(listenerPid)]);
  if (snapshot.code !== 0) throw new Error("local_ownership_snapshot_failed");
  const parsed = JSON.parse(snapshot.stdout);
  const chain = Array.isArray(parsed.chain) ? parsed.chain : [];
  const childEntry = chain[0] ?? null;
  const ancestors = chain.slice(1).map((entry) => ({ pid: Number(entry.pid), parentPid: Number(entry.parentPid), commandLine: String(entry.commandLine ?? "") }));
  return {
    child: childEntry ? { pid: Number(childEntry.pid), parentPid: Number(childEntry.parentPid), name: String(childEntry.name ?? ""), commandLine: String(childEntry.commandLine ?? "") } : null,
    ancestors,
  };
}

async function runSafeStop(config) {
  const findListeners = config.findListeners ?? findLocalPortListeners;
  const collectEvidence = config.collectEvidence ?? collectOwnershipEvidence;
  const target = { host: config.host, port: config.port, repoRoot: config.projectRoot };
  const listeners = findListeners({ port: config.port })
    .map((row) => {
      const separator = String(row.address).lastIndexOf(":");
      return { pid: row.pid, address: String(row.address).slice(0, separator), port: Number(String(row.address).slice(separator + 1)) };
    });
  let evidence = { listeners, child: null, ancestors: [] };
  if (listeners.length === 1) {
    try { evidence = { listeners, ...(await collectEvidence(listeners[0].pid)) }; }
    catch { console.error(JSON.stringify({ action: "stop", ownershipVerified: false, reasons: ["ownership_query_failed"] })); process.exitCode = 1; return null; }
  }
  const state = describeRuntimeState(config.projectRoot, config.port, target);
  const decision = decideSafeStop({ target, state, evidence, dryRun: config.dryRun === true });
  const summaryOut = {
    action: decision.decision,
    host: decision.summary.host,
    port: decision.summary.port,
    listenerPid: decision.summary.listenerPid,
    launcherPid: decision.summary.launcherPid,
    ownershipVerified: decision.ownershipVerified,
    wouldSignalPid: decision.wouldSignalPid,
    signalSent: false,
    dryRun: config.dryRun === true,
  };
  if (decision.decision !== "proceed") {
    if (decision.decision === "reject") {
      console.error(JSON.stringify({ ...summaryOut, reasons: decision.reasons.slice(0, 8) }));
      process.exitCode = 1;
      return null;
    }
    console.log(JSON.stringify(summaryOut));
    return null;
  }
  const flow = await executeConfirmedStop(decision, {
    dryRun: config.dryRun === true,
    kill: (targetPid, signal) => { process.kill(targetPid, signal); },
    isListening: async () => findListeners({ port: config.port }).length > 0,
  });
  console.log(JSON.stringify({
    action: config.dryRun ? "dry-run" : "stop",
    host: summaryOut.host, port: summaryOut.port,
    listenerPid: summaryOut.listenerPid, launcherPid: summaryOut.launcherPid,
    ownershipVerified: true, wouldSignalPid: decision.wouldSignalPid,
    signalSent: flow.signalSent === true, stopped: flow.stopped === true, released: flow.released === true,
    error: flow.error === undefined ? undefined : flow.error,
  }));
  if (flow.stopped !== true && config.dryRun !== true) process.exitCode = 1;
  return flow;
}
export async function runLocalNext({
  cwd = process.cwd(),
  mode = "start",
  checkOnly = false,
  port = LOCAL_PORT,
  dryRun = false,
  databasePath,
  demoAccessStorePath,
  smokeParentRoot,
  parentEnv = process.env,
  spawnProcess = spawn,
  probe = probeWithPrisma,
  assertPortAvailable = assertLocalPortAvailable,
  findListeners = findLocalPortListeners,
  collectEvidence = collectOwnershipEvidence,
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
  if (mode === "stop") {
    return runSafeStop({
      projectRoot: resolve(cwd),
      host: LOCAL_HOST,
      port: Number(port),
      dryRun: dryRun === true,
      findListeners,
      collectEvidence,
    });
  }
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
  try {
    await writeRuntimeStateFileAtomically(resolve(cwd), config.args[config.args.length - 1], {
      schemaVersion: 1,
      repoRoot: resolve(cwd),
      host: LOCAL_HOST,
      port: Number(config.args[config.args.length - 1]),
      launcherPid: process.pid,
      childPid: child.pid,
      startedAt: new Date().toISOString(),
    });
  } catch { /* 状态文件失败不阻断启动 */ }
  return new Promise((resolveRun, rejectRun) => {
    child.once("exit", (code, signal) => {
      deleteRuntimeStateFileIfOwned(resolve(cwd), config.args[config.args.length - 1], { launcherPid: process.pid, childPid: child.pid }).catch(() => undefined);
      if (signal) rejectRun(new Error(`local_next_stopped_by_${signal}`));
      else if (code !== 0) rejectRun(new Error(`local_next_exit_${code ?? "unknown"}`));
      else resolveRun(database);
    });
  });
}

async function main() {
  await runLocalNext(parseLocalRuntimeArguments(process.argv.slice(2)));
}

if (isMainEntry(fileURLToPath(import.meta.url), process.argv[1])) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : "local_runtime_failed";
    console.error(`Local runtime refused to start: ${reason}`);
    process.exitCode = 1;
  });
}
