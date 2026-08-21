/**
 * V4 P2 — Tool 通用信封（Lead 冻结，06_TOOL_CONTRACTS）。
 * 所有 Tool adapter（Amazon/SellerSprite/Keyword/VOC/…）必须遵守本信封。
 */
import "server-only";

import type { ResearchRunErrorCode } from "@/lib/v4/contracts";

export type ToolCallEnvelope = {
  toolCallId: string;
  runId: string;
  questionId: string;
  toolName: string;
  toolVersion: string;
  targetEntity: string;
  marketplace: string;
  allowedDomains: string[];
  requestedFields: string[];
  maxSteps: number;
  timeoutMs: number;
  budget: { maxCost: number; currency: string; maxBrowserSteps: number };
  inputHash: string;
  idempotencyKey: string;
};

export type ToolStatus = "ok" | "no_results" | "waiting_auth" | "stopped_error" | "budget_exceeded" | "cancelled";

export type RawArtifactRef = {
  kind: "html" | "json" | "xlsx" | "screenshot" | "page_snapshot" | "recorded";
  ref: string; // 相对路径或记录 id；不得含 secret
  capturedAt: string;
};

export type ToolWarning = { code: string; message: string };

export type ToolResultEnvelope = {
  status: ToolStatus;
  observedEntity: string | null; // 与 targetEntity 校验用
  data: unknown;
  rawArtifactRefs: RawArtifactRef[];
  capturedAt: string;
  cost: { usedCost: number; currency: string; usedBrowserSteps: number };
  warnings: ToolWarning[];
  errors: { code: ResearchRunErrorCode; safeMessage?: string }[];
  nextAction: "continue" | "wait_human" | "retry" | "stop" | "revise_plan";
};

export const TOOL_ENVELOPE_VERSION = "tool-envelope.v1";

/** 信封校验：adapter 输出必须先过本校验再合并 Evidence。 */
export function validateToolResult(input: unknown): { ok: true; result: ToolResultEnvelope } | { ok: false; reason: string } {
  if (typeof input !== "object" || input === null) return { ok: false, reason: "not_object" };
  const r = input as Record<string, unknown>;
  if (typeof r.status !== "string") return { ok: false, reason: "status_missing" };
  if (typeof r.observedEntity !== "string" && r.observedEntity !== null) return { ok: false, reason: "observedEntity_invalid" };
  if (typeof r.capturedAt !== "string" || !r.capturedAt) return { ok: false, reason: "capturedAt_missing" };
  if (!Array.isArray(r.errors)) return { ok: false, reason: "errors_missing" };
  if (!Array.isArray(r.rawArtifactRefs)) return { ok: false, reason: "rawArtifactRefs_missing" };
  return { ok: true, result: r as unknown as ToolResultEnvelope };
}
