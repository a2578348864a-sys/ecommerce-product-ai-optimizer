/**
 * V4 P6 — ReplayBundle 导出器（P6-A 所有权，D1-D3）。
 *
 * 从已完成的 run 的导出快照（data）生成 ReplayBundle：
 *   allowlist 提取（仅 REPLAY_DATA_ALLOWLIST 顶层键，Allowlist 外的键被移除）
 *   → 脱敏扫描（secret / PII / 联系人 / Owner 私密成本 / 本地路径 / EXIF / 未授权图片）
 *   → redactionReport（逐项记录）
 *   → manifest 逐文件 sha256 + bundleSha256（确定性；now 注入）。
 *
 * 规则：
 *   - 仅 runStatus === "completed" 可导出（fail-closed）。
 *   - 任一 "blocked"（未授权图片）→ redactionReport.scanOk = false → 不可发布。
 *   - 敏感叶子按 key 识别 → removed；文本中嵌入的泄漏 → redacted（掩码）。
 *
 * 本模块为纯函数，不触碰 prisma / 数据库；hash 用 node:crypto 的 sha256。
 * bundleSha256 = sha256(canonicalBundleWithoutHash(bundle))（Lead 冻结契约，P6-C），
 * 逐文件 sha256 对 data[key] 做确定性规范字符串化后计算。
 */
import { createHash } from "node:crypto";

import {
  canonicalBundleWithoutHash,
  REPLAY_BUNDLE_SCHEMA,
  REPLAY_DATA_ALLOWLIST,
  type RedactionEntry,
  type RedactionReport,
  type ReplayBundle,
  type ReplayManifestFile,
} from "./schema";

/** 当前 allowlist 版本标识（与 REPLAY_DATA_ALLOWLIST 变更联动）。 */
export const REPLAY_ALLOWLIST_VERSION = "replay-allowlist.v1" as const;

/** 允许进入导出 data 的顶层键。 */
export const ALLOWLIST_KEYS: readonly string[] = REPLAY_DATA_ALLOWLIST;

/** 导出输入：Lead 的接线层已从 run 行聚合出 data（可含多余键，导出器仅保留 Allowlist）。 */
export type ReplayExportInput = {
  sourceRunId: string;
  runStatus: string;
  capturedAt: string;
  data: Record<string, unknown>;
};

/** 导出失败码：非 completed / 无任何 Allowlist 键。 */
export type ReplayExportErrorCode = "NOT_COMPLETED" | "EMPTY_DATA";

export class ReplayExportError extends Error {
  readonly code: ReplayExportErrorCode;
  constructor(code: ReplayExportErrorCode, message: string) {
    super(message);
    this.name = "ReplayExportError";
    this.code = code;
  }
}

export type ReplayExportResult =
  | { ok: true; bundle: ReplayBundle; publishable: boolean }
  | { ok: false; code: ReplayExportErrorCode; reason: string };

// ---------------------------------------------------------------------------
// 确定性 hash / stableStringify（与 lib/v4/journal 同构，含剪枝避免依赖 prisma）。
// ---------------------------------------------------------------------------
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(record[k])).join(",") + "}";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 泄漏检测：key 指示器 + 值模式。
// ---------------------------------------------------------------------------
type Kind = RedactionEntry["kind"];

const KEY_SECRET = /^(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|credential|authorization|auth[_-]?token|private[_-]?key)$/i;
const KEY_PII = /^(?:email|e-?mail|phone|mobile|tel|telephone|id[_-]?card|idcard|id[_-]?number|ssn|social[_-]?security|身份证)$/i;
const KEY_CONTACT = /^(?:contact|supplier[_-]?contact|contact[_-]?name|contact[_-]?phone|contact[_-]?email|wechat|wx|qq|联系人|address)$/i;
const KEY_COST = /^(?:purchase[_-]?price|unit[_-]?price|unit[_-]?cost|cost|cost[_-]?price|item[_-]?cost|landed[_-]?cost|raw[_-]?cost|wholesale[_-]?price|采购价|成本|单价|毛利|margin|profit|profit[_-]?margin|min[_-]?price|moq)$/i;
const KEY_EXIF = /^(?:exif|gps|gpsLatitude|gpsLongitude|imageMetadata|jpegMetadata|EXIF)$/i;
const KEY_UNLICENSED = /^(?:license|licensed|unlicensed|unauthorized)$/i;

const VALUE_SECRET = /(?:sk-[A-Za-z0-9_-]{12,}|(?:password|passwd|pwd|token|secret|api[_-]?key|authorization|bearer)\s*[:=]\s*\S+|gh[pous]_[A-Za-z0-9]{20,})/gi;
const VALUE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const VALUE_PHONE = /(?:\+?86\s*)?1[3-9]\d{9}|\+?\d{10,13}(?!\d)/g;
const VALUE_ID = /\b\d{17}[\dXx]\b|\b\d{15}\b/g;
const VALUE_PATH = /\b(?:[A-Za-z]:\\[^\s"'<>|?*]+|\/home\/[^\\s]+|\/Users\/[^\\s]+|\\\\[^\s]+)\b/g;
const VALUE_UNLICENSED = /\b(?:unlicensed|unauthorized|未授权|无版权)\s+(?:image|photo|asset|content|picture|图片|内容)\b|\b(?:image|photo|asset|图片|内容)\s+(?:unlicensed|unauthorized|未授权|无版权)\b/gi;

/** base64 图片 data-URL 中 EXIF 魔数 "Exif\0\0" → base64 前缀 "RXhpZg"。 */
const EXIF_DATA_URL = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i;
const EXIF_BASE64_MARKER = /RXhpZg/;

/** 值级泄漏收集：返回每个 kind 的匹配区间（已被掩码的区间最后统一改写）。 */
function collectValueLeaks(text: string): { kind: Kind; indices: [number, number][] }[] {
  const out: { kind: Kind; indices: [number, number][] }[] = [];
  const collect = (regex: RegExp, kind: Kind) => {
    const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    const indices: [number, number][] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0]) indices.push([m.index, m.index + m[0].length]);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (indices.length) out.push({ kind, indices });
  };
  collect(VALUE_SECRET, "secret");
  collect(VALUE_EMAIL, "pii");
  collect(VALUE_PHONE, "pii");
  collect(VALUE_ID, "pii");
  collect(VALUE_PATH, "path");
  collect(VALUE_UNLICENSED, "unlicensed");
  return out;
}

/** 合并重叠区间并去重，便于一次性掩码。 */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      if (e > last[1]) last[1] = e;
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

function isUnlicensedMark(key: string, value: unknown): boolean {
  const v = typeof value === "string" ? value.toLowerCase() : value;
  if (key === "unlicensed" || key === "unauthorized") {
    return v === true || v === "true" || v === "unlicensed" || v === "unauthorized" || v === "yes";
  }
  if (key === "license" || key === "licensed") {
    return v === false || v === "false" || v === "unlicensed" || v === "unauthorized" || v === "no" || v === "";
  }
  return false;
}

interface Sanitized {
  value: unknown;
  removed: boolean;
  blocked: boolean;
  entries: RedactionEntry[];
}

function pushEntry(entries: RedactionEntry[], field: string, kind: Kind, action: RedactionEntry["action"]): void {
  entries.push({ field, kind, action });
}

// ---------------------------------------------------------------------------
// 递归脱敏。
// ---------------------------------------------------------------------------
function sanitizeNode(node: unknown, path: string, entries: RedactionEntry[]): Sanitized {
  if (node === null || node === undefined || typeof node === "boolean") {
    return { value: node, removed: false, blocked: false, entries };
  }
  if (typeof node === "number") {
    return { value: node, removed: false, blocked: false, entries };
  }
  if (typeof node === "string") {
    return sanitizeString(node, path, entries);
  }
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    let blocked = false;
    node.forEach((el, i) => {
      const child = sanitizeNode(el, `${path}[${i}]`, entries);
      if (child.blocked) blocked = true;
      if (!child.removed) out.push(child.value);
    });
    return { value: out, removed: false, blocked, entries };
  }
  return sanitizeObject(node as Record<string, unknown>, path, entries);
}

function sanitizeString(text: string, path: string, entries: RedactionEntry[]): Sanitized {
  // 未授权内容 → 阻断（不可发布）。
  const leaks = collectValueLeaks(text);
  const unlicensed = leaks.find((l) => l.kind === "unlicensed");
  if (unlicensed) {
    pushEntry(entries, path, "unlicensed", "blocked");
    return { value: text, removed: false, blocked: true, entries };
  }
  // 内嵌 base64 图片含 EXIF → 移除该字段。
  const exifMatch = EXIF_DATA_URL.exec(text);
  if (exifMatch && EXIF_BASE64_MARKER.test(exifMatch[1])) {
    pushEntry(entries, path, "exif", "removed");
    return { value: text, removed: true, blocked: false, entries };
  }
  const ranges = mergeRanges(leaks.flatMap((l) => l.indices));
  if (ranges.length === 0) {
    return { value: text, removed: false, blocked: false, entries };
  }
  const kinds = new Set(leaks.map((l) => l.kind));
  let kind: Kind = "pii";
  if (kinds.has("secret")) kind = "secret";
  else if (kinds.has("contact")) kind = "contact";
  else if (kinds.has("path")) kind = "path";
  let masked = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [s, e] = ranges[i];
    masked = masked.slice(0, s) + "***" + masked.slice(e);
  }
  pushEntry(entries, path, kind, "redacted");
  return { value: masked, removed: false, blocked: false, entries };
}

function sanitizeObject(obj: Record<string, unknown>, path: string, entries: RedactionEntry[]): Sanitized {
  const keys = Object.keys(obj);
  // 「未授权图片」资产（含 license/unlicensed/unauthorized 标记）→ 阻断（优先级更高）。
  for (const k of keys) {
    if (KEY_UNLICENSED.test(k) && isUnlicensedMark(k, obj[k])) {
      pushEntry(entries, path.length ? `${path}.${k}` : k, "unlicensed", "blocked");
      return { value: obj, removed: false, blocked: true, entries };
    }
  }
  // 该对象被识别为 EXIF 元数据容器（exif/gps/imageMetadata/...）→ 整个对象移除。
  const exifKey = keys.find((k) => KEY_EXIF.test(k));
  if (exifKey) {
    pushEntry(entries, path, "exif", "removed");
    return { value: obj, removed: true, blocked: false, entries };
  }

  const out: Record<string, unknown> = {};
  let blocked = false;
  for (const key of keys) {
    const childPath = path ? `${path}.${key}` : key;
    if (KEY_SECRET.test(key)) {
      pushEntry(entries, childPath, "secret", "removed");
      continue;
    }
    if (KEY_PII.test(key)) {
      pushEntry(entries, childPath, "pii", "removed");
      continue;
    }
    if (KEY_CONTACT.test(key)) {
      pushEntry(entries, childPath, "contact", "removed");
      continue;
    }
    if (KEY_COST.test(key)) {
      pushEntry(entries, childPath, "cost", "removed");
      continue;
    }
    if (KEY_EXIF.test(key)) {
      pushEntry(entries, childPath, "exif", "removed");
      continue;
    }
    if (KEY_UNLICENSED.test(key)) {
      if (isUnlicensedMark(key, obj[key])) {
        pushEntry(entries, childPath, "unlicensed", "blocked");
        blocked = true;
        continue;
      }
      // unlicensed:false / licensed:true → 保留该叶子。
    }
    const child = sanitizeNode(obj[key], childPath, entries);
    if (child.blocked) blocked = true;
    if (child.removed) continue;
    out[key] = child.value;
  }
  // 对象经脱敏后若所有子字段都被移除（例如 EXIF 图片元素只剩被删的 ref），则整个对象移除。
  if (keys.length > 0 && Object.keys(out).length === 0) {
    return { value: out, removed: true, blocked, entries };
  }
  return { value: out, removed: false, blocked, entries };
}

// ---------------------------------------------------------------------------
// Allowlist 提取 + 脱敏 + redactionReport。
// ---------------------------------------------------------------------------
function buildRedactedData(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  entries: RedactionEntry[];
  blocked: boolean;
} {
  const result: Record<string, unknown> = {};
  const entries: RedactionEntry[] = [];
  let blocked = false;
  for (const key of ALLOWLIST_KEYS) {
    if (!(key in data)) continue;
    const child = sanitizeNode(data[key], key, entries);
    if (child.blocked) blocked = true;
    if (child.removed) continue;
    result[key] = child.value;
  }
  return { data: result, entries, blocked };
}

// ---------------------------------------------------------------------------
// manifest 逐文件 hash + bundle sha256（确定性）。
// ---------------------------------------------------------------------------
function buildFileHashes(data: Record<string, unknown>): ReplayManifestFile[] {
  const files: ReplayManifestFile[] = [];
  for (const key of ALLOWLIST_KEYS) {
    if (!(key in data)) continue;
    files.push({ path: key, sha256: sha256(stableStringify(data[key])) });
  }
  return files;
}


/**
 * 导出 ReplayBundle。
 * - runStatus !== "completed" → NOT_COMPLETED。
 * - data 不含任何 Allowlist 键 → EMPTY_DATA。
 * - 结果携带 publishable（= scanOk），供 Lead 的审批/落盘门禁使用。
 */
export function exportReplayBundle(input: ReplayExportInput, now: string = new Date().toISOString()): ReplayExportResult {
  if (input.runStatus !== "completed") {
    return { ok: false, code: "NOT_COMPLETED", reason: `runStatus '${input.runStatus}' is not 'completed'` };
  }
  const presentKeys = ALLOWLIST_KEYS.filter((k) => k in input.data);
  if (presentKeys.length === 0) {
    return { ok: false, code: "EMPTY_DATA", reason: "no allowlist keys present in data" };
  }

  const { data, entries, blocked } = buildRedactedData(input.data);
  const redactionReport: RedactionReport = { entries, scannedAt: now, scanOk: !blocked };
  const exportedAt = now;
  const bundleId = "replay-" + sha256(`${input.sourceRunId}|${exportedAt}`).slice(0, 20);

  const files = buildFileHashes(data);
  const bundleWithoutSha = {
    schemaVersion: REPLAY_BUNDLE_SCHEMA,
    bundleId,
    sourceRunId: input.sourceRunId,
    exportedAt,
    capturedAt: input.capturedAt,
    mode: "replay" as const,
    allowlistVersion: REPLAY_ALLOWLIST_VERSION,
    manifest: { files, bundleSha256: "" as const },
    redactionReport,
    data,
  };
  const bundleSha256 = sha256(canonicalBundleWithoutHash(bundleWithoutSha as ReplayBundle));
  const bundle: ReplayBundle = {
    ...bundleWithoutSha,
    manifest: { files, bundleSha256 },
  };
  return { ok: true, bundle, publishable: redactionReport.scanOk };
}

/**
 * 重算完整性校验（recompute + compare）：
 * 1. 逐文件重算 data[key].sha256 与 manifest 比对；
 * 2. 对不含 bundleSha256 的整包重算与 manifest.bundleSha256 比对。
 * 数据被篡改（或 hash 被改）时返回 false。
 * 注意：schema.verifyBundleHash 仅做格式校验；真正的数据篡改检测依靠本函数。
 */
export function verifyBundleIntegrity(bundle: ReplayBundle): boolean {
  const recomputedFiles = buildFileHashes(bundle.data);
  if (recomputedFiles.length !== bundle.manifest.files.length) return false;
  for (let i = 0; i < recomputedFiles.length; i++) {
    if (
      recomputedFiles[i].path !== bundle.manifest.files[i].path ||
      recomputedFiles[i].sha256 !== bundle.manifest.files[i].sha256
    ) {
      return false;
    }
  }
  return sha256(canonicalBundleWithoutHash(bundle)) === bundle.manifest.bundleSha256;
}
