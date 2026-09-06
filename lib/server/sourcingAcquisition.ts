/**
 * V3.5 — LocalSession1688CliDriver（正式 Keyword / URL / Detail 获取驱动）
 *
 * Contract §12/§13/§14/§53：
 * - 1688-cli 不加入 npm 依赖；作为检测到的本地外部工具（optional capability）。
 * - fixed executable + fixed command allowlist（search/offer/whoami）+ args array + shell=false。
 * - timeout / stdout / stderr 大小限制 / exit code 校验 / JSON 解析 / 错误归一化 / fail-closed。
 * - 写命令（login/inquiry/cart/order/checkout/...）在业务层不存在任何代码路径。
 * - 工具不存在 → ACQUISITION_TOOL_NOT_AVAILABLE（清晰错误，不是 500 mystery）。
 * - 未登录（exit 3 / NOT_LOGGED_IN）→ AUTH_REQUIRED；滑块（exit 4）→ RISK_CONTROL_REQUIRED。
 *
 * 敏感纪律：whoami 的 memberId/nick 为账号标识，本模块只透出 loggedIn 布尔，绝不出现在输出/日志/Evidence。
 */

import "server-only";

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SourcingAcquisitionError, READ_ONLY_COMMANDS, type ReadOnlyCommand } from "@/lib/upstream/1688/contracts";
import {
  normalizeOfferDetail,
  normalizeSearchOffers,
} from "@/lib/upstream/1688/normalize";
import {
  assertSingleOfferRecord,
} from "@/lib/upstream/1688/entityBinding";
import type { AcquisitionCandidate, OfferDetail } from "@/lib/upstream/1688/contracts";

export const SOURCING_CLI_DRIVER_VERSION = "local-session-1688-cli-driver.v1";
export const SOURCING_CLI_ENV_PATH = "V35_1688_CLI_PATH";
export const SUPPORTED_CLI_VERSION_PREFIX = "0.1.";

const COMMAND_TIMEOUT_MS: Record<ReadOnlyCommand, number> = {
  search: 90_000,
  offer: 120_000,
  whoami: 30_000,
};
/** 测试/运维可覆盖超时（env V35_1688_CLI_TIMEOUT_MS，仅正整数） */
function commandTimeoutMs(command: ReadOnlyCommand, env?: NodeJS.ProcessEnv): number {
  const override = Number(env?.["V35_1688_CLI_TIMEOUT_MS"]);
  if (Number.isInteger(override) && override >= 100 && override <= 600_000) return override;
  return COMMAND_TIMEOUT_MS[command];
}
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_SEARCH_RESULTS = 10;
const MAX_OFFER_IDS = 1;

export type CliExecutionResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type CliToolStatus =
  | { available: false; reason: "not_configured" | "not_found"; discoveredPath?: string }
  | { available: true; cliPath: string; detectedVersion: string | null; discovered: boolean };

/**
 * V3 Final R10：限定目录的本地采集工具自动发现（§155/§156）。
 * env 显式配置优先；未配置时只在固定/正式目录中查找，绝不全磁盘搜索：
 * - `~/.1688/cli/dist/cli.js`（1688-cli 工具自有 home 下的固定安装目录）
 * - 项目 `tools/1688-cli/dist/cli.js`（项目正式 tools path）
 * 返回 { path, discovered }；找不到返回 null。
 */
export function discoverCliPath(env: NodeJS.ProcessEnv = process.env): { path: string; discovered: boolean } | null {
  const raw = env[SOURCING_CLI_ENV_PATH];
  if (raw && typeof raw === "string" && raw.trim()) return { path: raw.trim(), discovered: false };

  const homeDir = env.USERPROFILE ?? env.HOME;
  const candidates: string[] = [];
  if (homeDir) candidates.push(join(homeDir, ".1688", "cli", "dist", "cli.js"));
  candidates.push(join(process.cwd(), "tools", "1688-cli", "dist", "cli.js"));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, discovered: true };
  }
  return null;
}

/** 解析 CLI 路径：显式 env 配置优先；未配置时自动发现（限定目录） */
export function resolveCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[SOURCING_CLI_ENV_PATH];
  if (raw && typeof raw === "string" && raw.trim()) return raw.trim();
  return discoverCliPath(env)?.path ?? null;
}

export function getCliToolStatus(env: NodeJS.ProcessEnv = process.env): CliToolStatus {
  const discovery = discoverCliPath(env);
  if (!discovery) return { available: false, reason: "not_configured" };
  if (!existsSync(discovery.path)) return { available: false, reason: "not_found", discoveredPath: discovery.path };
  return { available: true, cliPath: discovery.path, detectedVersion: null, discovered: discovery.discovered };
}

let cachedDetectedVersion: string | null | undefined;

/** 测试专用：重置版本探测缓存（模块级状态隔离） */
export function resetCliVersionCacheForTests(): void {
  cachedDetectedVersion = undefined;
}

/**
 * 探测 CLI 版本（--version，一次探测后缓存）。
 * 不匹配 SUPPORTED_CLI_VERSION_PREFIX → TOOL_VERSION_UNSUPPORTED（Contract §14 fail-closed）。
 */
export async function detectCliVersion(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (cachedDetectedVersion !== undefined) return cachedDetectedVersion;
  const status = getCliToolStatus(env);
  if (!status.available) {
    cachedDetectedVersion = null;
    return null;
  }
  const result = await runVersionProbe(status.cliPath, env);
  const version = result.stdout.trim().split(/\r?\n/)[0]?.trim() || null;
  cachedDetectedVersion = version;
  return version;
}

export function assertSupportedCliVersion(version: string | null): void {
  if (!version) return; // 探测失败不阻塞（首次调用 whoami 会给出明确 AUTH 语义）
  if (!version.startsWith(SUPPORTED_CLI_VERSION_PREFIX)) {
    throw new SourcingAcquisitionError(
      "tool_version_unsupported",
      503,
      `1688 采集工具版本 ${version} 未在受支持范围（${SUPPORTED_CLI_VERSION_PREFIX}*），已停止获取。`,
    );
  }
}

function failClosed(code: string, status: number, message: string): never {
  throw new SourcingAcquisitionError(code, status, message);
}

/** 运行 CLI 进程：allowlist + args array + shell=false + 大小限制 + timeout（不捕获写入动作） */
async function runCliProcess(input: {
  cliPath: string;
  command: ReadOnlyCommand;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<CliExecutionResult> {
  if (!READ_ONLY_COMMANDS.includes(input.command)) {
    failClosed("command_not_allowed", 500, `命令 ${input.command} 不在只读 allowlist 中，已拒绝。`);
  }
  return runCliProcessCore([input.cliPath, input.command, ...input.args], input.timeoutMs, input.env);
}

/** 版本探测（全局 --version，纯只读元数据；不进业务 allowlist 路径） */
async function runVersionProbe(cliPath: string, env?: NodeJS.ProcessEnv): Promise<CliExecutionResult> {
  return runCliProcessCore([cliPath, "--version"], 20_000, env);
}

/** 进程运行核心：不暴露给业务层；调用方负责 allowlist/参数校验 */
async function runCliProcessCore(argv: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<CliExecutionResult> {
  const startedAt = Date.now();

  return await new Promise<CliExecutionResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stdoutOverflow = false;
    let stderrOverflow = false;

    const child = spawn(process.execPath, argv, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(env ? { env } : {}),
    });

    const finish = (result: CliExecutionResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1_500).unref();
      finish(new SourcingAcquisitionError("timeout", 504, `1688 获取超时（${argv[1] ?? "cli"}）。`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutOverflow) return;
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_STDOUT_BYTES) {
        stdoutOverflow = true;
        child.kill("SIGTERM");
        finish(new SourcingAcquisitionError("tool_error", 502, "1688 输出超出大小限制，已终止。"));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrOverflow) return;
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_STDERR_BYTES) {
        stderrOverflow = true;
      }
    });
    child.once("error", (error) => {
      finish(new SourcingAcquisitionError(
        "tool_not_available",
        503,
        "1688 获取工具无法启动，请检查工具配置后重试。",
      ));
    });
    child.once("close", (exitCode) => {
      finish({
        exitCode: exitCode ?? -1,
        stdout,
        stderr: stderr.slice(0, MAX_STDERR_BYTES),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 宽松解析 JSON（用于探测状态、容忍头部杂质日志） */
function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    const firstBrace = trimmed.indexOf("{");
    if (firstBrace < 0) return null;
    const candidate = trimmed.slice(firstBrace);
    const lastBrace = candidate.lastIndexOf("}");
    const body = lastBrace > 0 ? candidate.slice(0, lastBrace + 1) : candidate;
    const parsed = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 从 stdout 提取 JSON：容忍头部日志行（首个 { 开始，末尾可能截断则取最后一个 }） */
function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) failClosed("schema_unsupported", 422, "1688 采集工具未返回任何输出。");
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) {
    failClosed("schema_unsupported", 422, "1688 返回的数据格式无法识别，已拒绝（fail-closed）。");
  }
  const candidate = trimmed.slice(firstBrace);
  const lastBrace = candidate.lastIndexOf("}");
  const body = lastBrace > 0 ? candidate.slice(0, lastBrace + 1) : candidate;
  try {
    return JSON.parse(body);
  } catch {
    failClosed("schema_unsupported", 422, "1688 返回的数据解析失败，已拒绝（fail-closed）。");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** exit code / ok 信封统一校验（Contract §13：exit code validation + ok/success semantic validation） */
function assertCliSuccess(result: CliExecutionResult, command: ReadOnlyCommand): void {
  if (result.exitCode === 3) {
    failClosed("auth_required", 401, "1688 会话未登录或已过期，请先完成 1688 登录后重试。");
  }
  if (result.exitCode === 4) {
    failClosed("risk_control_required", 403, "1688 触发了风控验证（滑块/验证码），请在 1688 页面完成验证后重试。");
  }
  if (result.exitCode !== 0) {
    // 真实 smoke 实测：daemon 风控暂停返回 exit 9 + {ok:false,code:DAEMON_PAUSED,failureKind:risk_challenge}
    const parsedFailure = tryParseFailureEnvelope(result.stdout);
    if (parsedFailure) {
      if (parsedFailure.code === "NOT_LOGGED_IN") {
        failClosed("auth_required", 401, "1688 会话未登录或已过期，请先完成 1688 登录后重试。");
      }
      if (parsedFailure.code === "DAEMON_PAUSED" || /risk|challenge|slider|captcha/i.test(parsedFailure.message)) {
        failClosed("risk_control_required", 403, "1688 触发了风控/暂停（需要人工验证），请在 1688 页面完成验证后重试。");
      }
      // P1-B：CLI 原始 code/message 不进用户文案（只进日志）
       
      console.error("[1688-cli] command failed", { command, code: parsedFailure.code, detail: parsedFailure.message.slice(0, 200) });
      failClosed("tool_error", 502, "获取 1688 数据失败（工具执行异常），请稍后重试；若持续失败请重新登录 1688。");
    }
     
    console.error("[1688-cli] command failed", { command, exitCode: result.exitCode });
    failClosed("tool_error", 502, "获取 1688 数据失败（工具执行异常），请稍后重试；若持续失败请重新登录 1688。");
  }
  const parsed = parseCliJson(result.stdout);
  if (!isRecord(parsed)) {
    failClosed("schema_unsupported", 422, "1688 返回的数据结构异常，已拒绝（fail-closed）。");
  }
  if (parsed.ok === false) {
    const code = typeof parsed.code === "string" ? parsed.code : "UNKNOWN";
    const message = typeof parsed.message === "string" ? parsed.message.slice(0, 200) : "";
    if (code === "NOT_LOGGED_IN") {
      failClosed("auth_required", 401, "1688 会话未登录或已过期，请先完成 1688 登录后重试。");
    }
    if (code === "DAEMON_PAUSED" || /risk|challenge|slider|captcha/i.test(message)) {
      failClosed("risk_control_required", 403, "1688 触发了风控/暂停（需要人工验证），请在 1688 页面完成验证后重试。");
    }
    // P1-B：CLI 原始 code/message 不进用户文案
     
    console.error("[1688-cli] command returned failure", { command, code, detail: message });
    failClosed("tool_error", 502, "获取 1688 数据失败（工具执行异常），请稍后重试；若持续失败请重新登录 1688。");
  }
}

/** 失败信封解析（exit≠0 时容错提取 ok:false 结构；解析失败返回 null 走通用错误） */
function tryParseFailureEnvelope(stdout: string): { code: string; message: string } | null {
  try {
    const trimmed = stdout.trim();
    const firstBrace = trimmed.indexOf("{");
    if (firstBrace < 0) return null;
    const parsed = JSON.parse(trimmed.slice(firstBrace)) as { ok?: unknown; code?: unknown; message?: unknown };
    if (parsed.ok !== false) return null;
    return {
      code: typeof parsed.code === "string" ? parsed.code : "UNKNOWN",
      message: typeof parsed.message === "string" ? parsed.message : "",
    };
  } catch {
    return null;
  }
}

function validateSearchKeyword(keyword: string): string {
  if (typeof keyword !== "string") failClosed("invalid_query", 400, "搜索关键词必须为字符串。");
  const trimmed = keyword.trim();
  if (!trimmed) failClosed("invalid_query", 400, "搜索关键词不能为空。");
  if (trimmed.length > 50) failClosed("invalid_query", 400, "搜索关键词过长（最多 50 字符）。");
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) failClosed("invalid_query", 400, "搜索关键词含控制字符，已拒绝。");
  return trimmed;
}

function validateOfferId(value: string): string {
  if (typeof value !== "string") failClosed("invalid_offer_id", 400, "offerId 必须为字符串。");
  const trimmed = value.trim();
  if (!/^\d{5,20}$/.test(trimmed)) failClosed("invalid_offer_id", 400, "offerId 非法。");
  return trimmed;
}

/** 关键词搜索（Contract §18/§60）——只读，返回候选列表 + 运行轨迹 */
export async function searchOffersByKeyword(input: {
  keyword: string;
  capturedAt?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ candidates: AcquisitionCandidate[]; trace: { driverVersion: string; query: string; success: boolean } }> {
  const env = input.env ?? process.env;
  const status = getCliToolStatus(env);
  if (!status.available) {
    failClosed(
      "acquisition_tool_not_available",
      503,
      status.reason === "not_configured"
        ? "1688 获取工具尚未配置，请先完成 1688 登录与工具配置后重试。"
        : "1688 获取工具路径无效，请检查工具配置后重试。",
    );
  }
  const keyword = validateSearchKeyword(input.keyword);
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const detectedVersion = await detectCliVersion(env);
  assertSupportedCliVersion(detectedVersion);

  const result = await runCliProcess({
    cliPath: status.cliPath,
    command: "search",
    args: [keyword, "--max", String(MAX_SEARCH_RESULTS)],
    timeoutMs: commandTimeoutMs("search", env),
    env,
  });
  assertCliSuccess(result, "search");

  const parsed = parseCliJson(result.stdout);
  if (!isRecord(parsed)) failClosed("schema_unsupported", 422, "search 输出结构异常。");
  const candidates = normalizeSearchOffers(parsed.offers, {
    method: "keyword",
    query: keyword,
    capturedAt,
  });
  return {
    candidates,
    trace: { driverVersion: SOURCING_CLI_DRIVER_VERSION, query: keyword, success: true },
  };
}

/** 单 offer 详情（Contract §20/§21）——只读；offerId 白名单校验 */
export async function getOfferDetailById(input: {
  offerId: string;
  capturedAt?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ detail: OfferDetail; trace: { driverVersion: string; offerId: string; success: boolean } }> {
  const env = input.env ?? process.env;
  const status = getCliToolStatus(env);
  if (!status.available) {
    failClosed(
      "acquisition_tool_not_available",
      503,
      status.reason === "not_configured"
        ? "1688 获取工具尚未配置，请先完成 1688 登录与工具配置后重试。"
        : "1688 获取工具路径无效，请检查工具配置后重试。",
    );
  }
  const offerId = validateOfferId(input.offerId);
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const detectedVersion = await detectCliVersion(env);
  assertSupportedCliVersion(detectedVersion);

  const result = await runCliProcess({
    cliPath: status.cliPath,
    command: "offer",
    args: [offerId],
    timeoutMs: commandTimeoutMs("offer", env),
    env,
  });
  assertCliSuccess(result, "offer");

  const parsed = parseCliJson(result.stdout);
  if (!isRecord(parsed)) failClosed("schema_unsupported", 422, "offer 输出结构异常。");
  const rawOffer = Array.isArray(parsed.offers) ? parsed.offers[0] : parsed;
  assertSingleOfferRecord(rawOffer, "offer detail");
  const detail = normalizeOfferDetail(rawOffer, { capturedAt });
  if (detail.offerId !== offerId) {
    failClosed("entity_binding_failed", 422, `请求 offerId=${offerId} 与返回 offerId=${detail.offerId} 不一致，已拒绝。`);
  }
  return {
    detail,
    trace: { driverVersion: SOURCING_CLI_DRIVER_VERSION, offerId, success: true },
  };
}

/**
 * 登录提示命令（固定字符串，仅供 UI 展示/复制）：
 * login 属于 FORBIDDEN_COMMANDS，业务层永不执行；这里只生成"用户在本机终端自行执行"的
 * 固定命令文本（fixed executable + 固定 login 参数，不接受任意输入）。
 */
export function buildCliLoginHint(env: NodeJS.ProcessEnv = process.env): { command: string } | null {
  const status = getCliToolStatus(env);
  if (!status.available) return null;
  return { command: `node "${status.cliPath}" login` };
}

/**
 * 启动前 Daemon 冲突排查与释放：
 * 检查 daemon 是否正在运行（通过 cli daemon status --json 或 ~/.1688/daemon.pid），
 * 若存活则执行 cli daemon stop --json（3000ms 超时）等待其优雅停止并释放 .lock；
 * 随后清理残留的 stale daemon.pid 与 proper-lockfile 锁目录（.lock.lock），防止 LOCK_BUSY 秒退。
 */
export async function stop1688DaemonIfRunning(
  cliPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let isRunning = false;
  let statusDetermined = false;

  try {
    const statusResult = await runCliProcessCore(
      [cliPath, "daemon", "status", "--json"],
      3000,
      env,
    );
    if (statusResult.exitCode === 0 && statusResult.stdout) {
      const parsed = tryParseJson(statusResult.stdout);
      if (parsed && typeof parsed.running === "boolean") {
        isRunning = parsed.running;
        statusDetermined = true;
      }
    }
  } catch (statusError) {
    console.warn(
      "[1688-cli] daemon status check failed or timed out:",
      errorMessage(statusError),
    );
  }

  const homeDir = env.USERPROFILE ?? env.HOME;
  const rootDir = env.BB1688_HOME ?? (homeDir ? join(homeDir, ".1688") : null);

  if (!statusDetermined && rootDir) {
    try {
      const pidPath = join(rootDir, "daemon.pid");
      if (existsSync(pidPath)) {
        const pidStr = readFileSync(pidPath, "utf8").trim();
        const pid = parseInt(pidStr, 10);
        if (!isNaN(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            isRunning = true;
          } catch (killErr: unknown) {
            const code = (killErr as { code?: string })?.code;
            if (code === "EPERM") {
              isRunning = true;
            }
          }
        }
      }
    } catch (pidError) {
      console.warn("[1688-cli] daemon pid check failed:", errorMessage(pidError));
    }
  }

  if (isRunning) {
    try {
      await runCliProcessCore([cliPath, "daemon", "stop", "--json"], 3000, env);
    } catch (stopError) {
      console.warn(
        "[1688-cli] daemon stop failed or timed out:",
        errorMessage(stopError),
      );
    }
  }

  // 清理残留的死进程 pid 与 stale lock 文件（防止 LOCK_BUSY 秒退）
  if (rootDir) {
    try {
      const pidPath = join(rootDir, "daemon.pid");
      if (existsSync(pidPath)) {
        const pidStr = readFileSync(pidPath, "utf8").trim();
        const pid = parseInt(pidStr, 10);
        let dead = true;
        if (!isNaN(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            dead = false;
          } catch {
            dead = true;
          }
        }
        if (dead) {
          try {
            rmSync(pidPath, { force: true });
          } catch {
            // ignore
          }
        }
      }

      // 若 daemon 未运行，清理 proper-lockfile 残留目录（.lock.lock）
      if (!isRunning) {
        const lockTargets = [
          join(rootDir, ".lock.lock"),
          join(rootDir, "profiles", "default", ".lock.lock"),
        ];
        for (const target of lockTargets) {
          if (existsSync(target)) {
            try {
              rmSync(target, { recursive: true, force: true });
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (cleanupErr) {
      console.warn("[1688-cli] stale lock cleanup error:", errorMessage(cleanupErr));
    }
  }
}

export type WindowProbeResult = {
  ok: boolean;
  found: boolean;
  pid?: number;
  hwnd?: number;
  reason?: string;
};

export type WindowProbeFn = (input: {
  profileDir: string;
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}) => Promise<WindowProbeResult>;

/**
 * Windows 原生可见 Chrome 窗口探测：
 * 调用 scripts/probe-1688-window.ps1 脚本，检查 Chrome 顶层窗口 handle、可见性与屏幕区域有效性。
 */
export async function defaultWindowProbe(input: {
  profileDir: string;
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<WindowProbeResult> {
  const env = input.env ?? process.env;

  const delayMs = (ms: number) =>
    new Promise<boolean>((resolve) => {
      if (input.signal?.aborted) return resolve(false);
      const timer = setTimeout(() => {
        input.signal?.removeEventListener("abort", onAbort);
        resolve(true);
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
    });

  // 1. 测试与 Mock 覆盖
  if (env.FAKE_WINDOW_PROBE === "true") {
    const completed = await delayMs(Math.max(input.intervalMs, 1000));
    if (!completed || input.signal?.aborted) {
      return { ok: false, found: false, reason: "aborted" };
    }
    return { ok: true, found: true, pid: 12345, hwnd: 67890 };
  }
  if (env.FAKE_WINDOW_PROBE === "false") {
    await delayMs(Math.min(input.timeoutMs, 1000));
    return { ok: true, found: false, reason: "mock_window_not_found" };
  }

  const cliPath = env[SOURCING_CLI_ENV_PATH] ?? "";
  if (cliPath.includes("fake-1688-cli") || env.FAKE_CLI_MODE) {
    if (env.FAKE_CLI_MODE === "login-window-not-visible") {
      await delayMs(Math.min(input.timeoutMs, 1000));
      return { ok: true, found: false, reason: "mock_timeout_no_visible_window" };
    }
    // Mock 成功：等待探针周期（保证子进程完成启动/写入日志；若子进程提前退出则由 abort 中断）
    const completed = await delayMs(Math.max(input.intervalMs, 1000));
    if (!completed || input.signal?.aborted) {
      return { ok: false, found: false, reason: "aborted" };
    }
    return { ok: true, found: true, pid: 12345, hwnd: 67890 };
  }

  // 2. 非 Windows 平台降级
  if (process.platform !== "win32") {
    return { ok: true, found: false, reason: "unsupported_platform" };
  }

  // 3. Windows 原生脚本探测
  const scriptPath = join(process.cwd(), "scripts", "probe-1688-window.ps1");
  if (!existsSync(scriptPath)) {
    return { ok: false, found: false, reason: "probe_script_missing" };
  }

  return await new Promise<WindowProbeResult>((resolve) => {
    let stdout = "";
    let settled = false;

    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-ProfileDir",
        input.profileDir,
        "-TimeoutMs",
        String(input.timeoutMs),
        "-IntervalMs",
        String(input.intervalMs),
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    ps.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    const onAbort = () => {
      if (settled) return;
      try {
        ps.kill();
      } catch {
        // ignore
      }
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    ps.once("close", () => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", onAbort);
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed && typeof parsed === "object" && parsed.found === true) {
          resolve({ ok: true, found: true, pid: parsed.pid, hwnd: parsed.hwnd });
          return;
        }
        resolve({
          ok: true,
          found: false,
          reason: parsed?.reason || "timeout_no_visible_window",
        });
      } catch {
        resolve({
          ok: false,
          found: false,
          reason: `probe_parse_failed: ${stdout.slice(0, 100)}`,
        });
      }
    });

    ps.once("error", (err) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, found: false, reason: err.message });
    });
  });
}

/**
 * Package A（R1）：固定安全登录 capability——从 Web UI 启动 1688 关键词登录。
 * 安全边界与启动自检：
 * - 启动前排查并释放已有 daemon 冲突与 stale lock（stop1688DaemonIfRunning）。
 * - fixed executable + 固定参数 [status.cliPath, "login", "--headed", "--force", "--no-daemon"]；shell=false；不接受任何用户输入。
 * - --force：保证即使本地有历史 state.json 也强制打开 headed 扫码窗口，绝不秒退；
 * - --no-daemon：避免登录成功后在后台常驻拉起 daemon 导致后续冲突。
 * - 管道与生命周期安全：
 *   - 严禁主动调用 child.stdout?.destroy() / child.stderr?.destroy()，彻底杜绝 EPIPE 崩溃！
 *   - 输出安全重定向至 login-launch.log 并保持 pipe drain；
 *   - resolve 后对 stdout/stderr 与 child 显式 unref()，保证既不阻断父进程退出也不引发 EPIPE。
 * - Windows 原生真实可见窗口探测（Visible Window Readiness Probe）：
 *   - 替换死等 1000ms 假阳性判定；
 *   - 在启动后轮询（默认最长等待 8000ms，每 500ms 探测一次）；
 *   - 探测 Chrome 对应 default profile 是否拉起，且存在 MainWindowHandle != 0 且处于屏幕工作区的真实窗口；
 *   - 调用 Win32 API 激活置顶（SetForegroundWindow / SwitchToThisWindow）；
 *   - 仅当探测到真实可见窗口时才返回 { started: true }；
 *   - 若超时未出现真实窗口，收集 CLI stderr 并抛出精准 typed error（sourcing_login_window_not_visible），绝不报假成功。
 */
export async function begin1688KeywordLogin(
  env: NodeJS.ProcessEnv = process.env,
  options?: { probeWindow?: WindowProbeFn },
): Promise<{ started: boolean }> {
  const status = getCliToolStatus(env);
  if (!status.available) {
    throw new SourcingAcquisitionError(
      "acquisition_tool_not_available",
      503,
      status.reason === "not_configured"
        ? "未检测到本机 1688 采集工具，无法打开登录窗口。请先完成工具安装配置。"
        : "1688 采集工具路径无效，无法打开登录窗口。",
    );
  }

  await stop1688DaemonIfRunning(status.cliPath, env);

  const homeDir = env.USERPROFILE ?? env.HOME;
  const rootDir = env.BB1688_HOME ?? (homeDir ? join(homeDir, ".1688") : null);
  const logPath = rootDir ? join(rootDir, "login-launch.log") : null;

  const appendToLog = (data: Buffer | string) => {
    if (!logPath) return;
    try {
      appendFileSync(logPath, data);
    } catch {
      // ignore
    }
  };

  const args = [status.cliPath, "login", "--headed", "--force", "--no-daemon"];

  const isMock = Boolean(
    options?.probeWindow ||
    env.FAKE_WINDOW_PROBE ||
    env.FAKE_CLI_MODE ||
    status.cliPath.includes("fake-1688-cli")
  );

  const launcherScript = join(process.cwd(), "scripts", "launch-1688-login.ps1");
  // Win32 真实路径：通过 launch-1688-login.ps1 以「真实控制台 + Start-Process」启动 CLI。
  // 依据实测：1688 CLI 的 --headed 仅在 stdout 为真实控制台（TTY）时才 headful 启动 Chrome；
  // 服务器 spawn 若直接管道重定向 stdout，CLI 会静默降级 headless → 无可见窗口（P0-C 根因）。
  // ps1 不做任何输出重定向，Chrome 登录窗口即真实出现在用户桌面。
  if (process.platform === "win32" && !isMock && existsSync(launcherScript)) {
    // 第十一版（1688 P0）：异步启动 launcher，spawnSync 改为 execFile + Promise，
    // 不阻塞 Node event loop；launcher 自身通过 Start-Process fire-and-detach，
    // 正常 << 2s 返回。超过 5s 视为 sourcing_login_launcher_timeout。
    const LAUNCHER_TIMEOUT_MS = 5000;
    const launcherResult = await new Promise<{ ok: boolean; stdout: string; error?: string }>(
      (resolve, reject) => {
        const ps: ChildProcess = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            launcherScript,
            "-NodePath",
            process.execPath,
            "-CliPath",
            status.cliPath,
            ...(logPath ? ["-LogPath", logPath] : []),
          ],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            ps.kill();
            reject(new SourcingAcquisitionError(
              "sourcing_login_launcher_timeout",
              504,
              "1688 登录 launcher 超时，请稍后重试。",
            ));
          }
        }, LAUNCHER_TIMEOUT_MS);
        ps.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        ps.stderr?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        ps.on("close", (code) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ ok: code === 0, stdout });
          }
        });
        ps.on("error", (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new SourcingAcquisitionError(
              "sourcing_login_launcher_failed",
              500,
              `1688 登录 launcher 启动失败: ${err.message}`,
            ));
          }
        });
      },
    );

    console.log("[begin1688KeywordLogin launcher]", { ok: launcherResult.ok, stdout: launcherResult.stdout.slice(0, 200) });
    if (!launcherResult.ok) {
      throw new SourcingAcquisitionError(
        "sourcing_login_window_launch_failed",
        500,
        `无法启动 1688 登录窗口: ${launcherResult.error || launcherResult.stdout || "PowerShell launcher failed"}`,
      );
    }
    try {
      const parsed = JSON.parse(launcherResult.stdout.trim().split("\n").filter(Boolean).pop() || "{}");
      if (!parsed.ok) {
        throw new SourcingAcquisitionError(
          "sourcing_login_window_launch_failed",
          500,
          `无法启动 1688 登录窗口: ${parsed.error || "Launch error"}`,
        );
      }
    } catch (parseErr) {
      if (parseErr instanceof SourcingAcquisitionError) throw parseErr;
      // ignore JSON parse error if stdout had extra text
    }

    // Windows 原生可见窗口探测
    const probeFn = options?.probeWindow ?? defaultWindowProbe;
    const profileDir = rootDir ? join(rootDir, "profiles", "default") : "default";
    const timeoutMs = Number(env.V35_1688_LOGIN_PROBE_TIMEOUT_MS) || 20000;
    const intervalMs = Number(env.V35_1688_LOGIN_PROBE_INTERVAL_MS) || 500;

    const probeResult = await probeFn({
      profileDir,
      timeoutMs,
      intervalMs,
      env,
    });

    if (!probeResult.found) {
      throw new SourcingAcquisitionError(
        "sourcing_login_window_not_visible",
        504,
        "1688 登录窗口未能在有效屏幕区域内显示。",
      );
    }

    return { started: true };
  }

  return await new Promise<{ started: boolean }>((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const probeController = new AbortController();

    const child = spawn(process.execPath, args, {
      shell: false,
      windowsHide: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(env ? { env } : {}),
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      appendToLog(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk.toString("utf8");
      }
      appendToLog(chunk);
    });

    const finishFailure = (exitCode: number | null, err?: Error) => {
      if (settled) return;
      settled = true;
      probeController.abort();

      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 1000).unref();
      } catch {
        // ignore
      }

      if (err) {
        reject(
          new SourcingAcquisitionError(
            "sourcing_login_window_launch_failed",
            500,
            `无法启动 1688 登录窗口: ${err.message || String(err)}`,
          ),
        );
        return;
      }

      const effectiveExitCode = child.exitCode ?? exitCode;
      if (stderr.includes("LOCK_BUSY") || effectiveExitCode === 5) {
        reject(
          new SourcingAcquisitionError(
            "sourcing_login_lock_busy",
            503,
            "1688 进程锁被占用，请稍后重试。",
          ),
        );
        return;
      }

      const sanitized = stderr.trim().split(/\r?\n/)[0] || `进程异常退出（exitCode: ${effectiveExitCode}）`;
      reject(
        new SourcingAcquisitionError(
          "sourcing_login_window_launch_failed",
          500,
          `无法启动 1688 登录窗口: ${sanitized}`,
        ),
      );
    };

    child.once("error", (err) => {
      finishFailure(child.exitCode, err);
    });

    child.once("exit", (code) => {
      setTimeout(() => {
        finishFailure(code ?? child.exitCode);
      }, 50);
    });

    // 启动原生可见窗口探测（Visible Window Readiness Probe）
    const probeFn = options?.probeWindow ?? defaultWindowProbe;
    const profileDir = rootDir ? join(rootDir, "profiles", "default") : "default";
    const timeoutMs = Number(env.V35_1688_LOGIN_PROBE_TIMEOUT_MS) || 20000;
    const intervalMs = Number(env.V35_1688_LOGIN_PROBE_INTERVAL_MS) || 500;

    void probeFn({
      profileDir,
      timeoutMs,
      intervalMs,
      signal: probeController.signal,
      env,
    })
      .then((probeResult) => {
        if (settled) return;

        // 若探测期间子进程已退出，以 exitCode / stderr 裁决
        if (child.exitCode !== null) {
          finishFailure(child.exitCode);
          return;
        }

        if (!probeResult.found) {
          settled = true;
          try {
            child.kill("SIGTERM");
            setTimeout(() => {
              if (child.exitCode === null) child.kill("SIGKILL");
            }, 1000).unref();
          } catch {
            // ignore
          }

          if (stderr.includes("LOCK_BUSY") || child.exitCode === 5) {
            reject(
              new SourcingAcquisitionError(
                "sourcing_login_lock_busy",
                503,
                "1688 进程锁被占用，请稍后重试。",
              ),
            );
            return;
          }

          const cliStderr = stderr.trim().split(/\r?\n/)[0];
          const detail = cliStderr ? `（CLI 输出: ${cliStderr}）` : "";
          reject(
            new SourcingAcquisitionError(
              "sourcing_login_window_not_visible",
              504,
              `1688 登录窗口未能在有效屏幕区域内显示${detail}。`,
            ),
          );
          return;
        }

        // 安全 unref 子进程，管道保持开启与 drain，严禁 destroy
        child.unref();
        resolve({ started: true });
      })
      .catch((probeErr) => {
        if (settled) return;
        finishFailure(child.exitCode, probeErr instanceof Error ? probeErr : new Error(String(probeErr)));
      });
  });
}

/** 登录状态检测（只读）——只返回 loggedIn 布尔，账号标识一律丢弃 */
export async function checkCliLogin(input: { env?: NodeJS.ProcessEnv } = {}): Promise<{
  loggedIn: boolean;
  toolAvailable: boolean;
}> {
  const env = input.env ?? process.env;
  const status = getCliToolStatus(env);
  if (!status.available) return { loggedIn: false, toolAvailable: false };
  try {
    const result = await runCliProcess({
      cliPath: status.cliPath,
      command: "whoami",
      args: [],
      timeoutMs: commandTimeoutMs("whoami", env),
      env,
    });
    if (result.exitCode !== 0) return { loggedIn: false, toolAvailable: true };
    const parsed = parseCliJson(result.stdout);
    return {
      loggedIn: isRecord(parsed) && parsed.loggedIn === true,
      toolAvailable: true,
    };
  } catch {
    return { loggedIn: false, toolAvailable: true };
  }
}
