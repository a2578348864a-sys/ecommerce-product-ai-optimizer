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

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  | { available: false; reason: "not_configured" | "not_found" }
  | { available: true; cliPath: string; detectedVersion: string | null };

/** 解析 CLI 路径：仅信任显式 env 配置的绝对路径（fixed executable） */
export function resolveCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[SOURCING_CLI_ENV_PATH];
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function getCliToolStatus(env: NodeJS.ProcessEnv = process.env): CliToolStatus {
  const cliPath = resolveCliPath(env);
  if (!cliPath) return { available: false, reason: "not_configured" };
  if (!existsSync(cliPath)) return { available: false, reason: "not_found" };
  return { available: true, cliPath, detectedVersion: null };
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
      `1688-cli 版本 ${version} 未在受支持范围（${SUPPORTED_CLI_VERSION_PREFIX}*），已停止获取。`,
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
        `无法启动 1688-cli（${errorMessage(error)}）。请确认 V35_1688_CLI_PATH 配置正确。`,
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

/** 从 stdout 提取 JSON：容忍头部日志行（首个 { 开始，末尾可能截断则取最后一个 }） */
function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) failClosed("schema_unsupported", 422, "1688-cli 未返回任何输出。");
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) {
    failClosed("schema_unsupported", 422, "1688-cli 输出不是 JSON，已拒绝（fail-closed）。");
  }
  const candidate = trimmed.slice(firstBrace);
  const lastBrace = candidate.lastIndexOf("}");
  const body = lastBrace > 0 ? candidate.slice(0, lastBrace + 1) : candidate;
  try {
    return JSON.parse(body);
  } catch {
    failClosed("schema_unsupported", 422, "1688-cli 输出 JSON 解析失败，已拒绝（fail-closed）。");
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
    failClosed("tool_error", 502, `1688-cli ${command} 失败（exit ${result.exitCode}）。`);
  }
  const parsed = parseCliJson(result.stdout);
  if (!isRecord(parsed)) {
    failClosed("schema_unsupported", 422, "1688-cli 输出结构异常，已拒绝（fail-closed）。");
  }
  if (parsed.ok === false) {
    const code = typeof parsed.code === "string" ? parsed.code : "UNKNOWN";
    const message = typeof parsed.message === "string" ? parsed.message.slice(0, 200) : "";
    if (code === "NOT_LOGGED_IN") {
      failClosed("auth_required", 401, "1688 会话未登录或已过期，请先完成 1688 登录后重试。");
    }
    failClosed("tool_error", 502, `1688-cli 返回失败（${code}${message ? `：${message}` : ""}）。`);
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
        ? "未配置 1688 获取工具（V35_1688_CLI_PATH），请先完成 1688 登录与工具配置。"
        : "配置的 1688-cli 路径不存在，请检查 V35_1688_CLI_PATH。",
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
        ? "未配置 1688 获取工具（V35_1688_CLI_PATH），请先完成 1688 登录与工具配置。"
        : "配置的 1688-cli 路径不存在，请检查 V35_1688_CLI_PATH。",
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
