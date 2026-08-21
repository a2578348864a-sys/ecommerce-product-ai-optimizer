/**
 * V4 P1 — Research Run 类型化 fetch 客户端（Run Console UI）。
 *
 * 只依赖公共契约类型（lib/v4/contracts.ts）与冻结 API 契约（P1_CONTRACT D9）。
 * 本模块由客户端组件使用；用 "import type" 引用契约类型，避免把服务端
 * "server-only" 依赖带进客户端 bundle。
 *
 * 契约（响应体以 API 实现为准）：
 *   POST /api/v4/runs                          {candidateId}              -> 201 {run}
 *   GET  /api/v4/runs                          -> {runs: RunSummary[]}（flag off -> 404）
 *   GET  /api/v4/runs/[runId]                  -> {run, events}（404/403）
 *   POST /api/v4/runs/[runId]/start            {expectedRevision}          -> 200 {run}
 *   POST /api/v4/runs/[runId]/resume           {expectedRevision, payload} -> 200 {run}；409 {code,latestRevision}
 *   POST /api/v4/runs/[runId]/cancel           {expectedRevision}          -> 200 {run}
 *   GET  /api/v4/runs/[runId]/events           -> {events}
 */
import { buildAccessHeaders } from "@/lib/client/accessToken";
import type {
  ResearchRunEvent,
  ResearchRunNode,
  ResearchRunState,
  ResearchRunStatus,
  ResearchRunWait,
  ResumePayload,
} from "@/lib/v4/contracts";

/** 列表投影（契约 RunSummary = id/candidateId/status/currentNode/revision/budget.usedCost/updatedAt）。 */
export type RunSummary = {
  id: string;
  candidateId: string;
  status: ResearchRunStatus;
  currentNode: ResearchRunNode;
  revision: number;
  budget: { usedCost: number };
  updatedAt: string;
};

export type RunListResponse = { runs: RunSummary[] };
export type RunDetailResponse = { run: ResearchRunState; events: ResearchRunEvent[] };
export type RunActionResponse = { run: ResearchRunState };
export type EventListResponse = { events: ResearchRunEvent[] };

export type RevisionConflictBody = {
  code: "REVISION_CONFLICT";
  latestRevision: number;
  message?: string;
};

const RUNS_BASE = "/api/v4/runs";

/** API 调用错误：携带 HTTP 状态、业务码与（可选）最新 revision。 */
export type ReportViewLike = { reportId: string; summary: string; sections: { title: string; sentences: { text: string; evidenceRefs: string[]; kind: string }[] }[]; gaps: { question: string; reason: string }[]; conflicts: { evidenceA: string; evidenceB: string; field: string }[]; unknowns: string[]; planRevision: number };

export class V4ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly latestRevision?: number;

  constructor(status: number, code: string, message: string, latestRevision?: number) {
    super(message);
    this.name = "V4ApiError";
    this.status = status;
    this.code = code;
    this.latestRevision = latestRevision;
  }
}

function encodeRunId(runId: string): string {
  return encodeURIComponent(runId);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const access = buildAccessHeaders();
  for (const [key, value] of Object.entries(access)) headers.set(key, value);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (response.ok) {
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // 非 2xx：尽量解析业务错误体，rev conflict 提供最新 revision。
  let code = "HTTP_ERROR";
  let message = "请求失败（" + response.status + "）";
  let latestRevision: number | undefined;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.code === "string") code = body.code;
    if (typeof body.message === "string") message = body.message;
    if (typeof body.latestRevision === "number") latestRevision = body.latestRevision;
  } catch {
    // ignore parse error
  }
  throw new V4ApiError(response.status, code, message, latestRevision);
}

export async function createRun(candidateId: string): Promise<RunActionResponse> {
  return request<RunActionResponse>(RUNS_BASE, {
    method: "POST",
    body: JSON.stringify({ candidateId }),
  });
}

export async function listRuns(): Promise<RunListResponse> {
  return request<RunListResponse>(RUNS_BASE);
}

export async function getRun(runId: string): Promise<RunDetailResponse> {
  return request<RunDetailResponse>(RUNS_BASE + "/" + encodeRunId(runId));
}

export async function startRun(runId: string, expectedRevision: number): Promise<RunActionResponse> {
  return request<RunActionResponse>(RUNS_BASE + "/" + encodeRunId(runId) + "/start", {
    method: "POST",
    body: JSON.stringify({ expectedRevision }),
  });
}

export async function resumeRun(
  runId: string,
  expectedRevision: number,
  payload: ResumePayload,
): Promise<RunActionResponse> {
  return request<RunActionResponse>(RUNS_BASE + "/" + encodeRunId(runId) + "/resume", {
    method: "POST",
    body: JSON.stringify({ expectedRevision, payload }),
  });
}

export async function cancelRun(runId: string, expectedRevision: number): Promise<RunActionResponse> {
  return request<RunActionResponse>(RUNS_BASE + "/" + encodeRunId(runId) + "/cancel", {
    method: "POST",
    body: JSON.stringify({ expectedRevision }),
  });
}

export async function getEvents(runId: string): Promise<EventListResponse> {
  return request<EventListResponse>(RUNS_BASE + "/" + encodeRunId(runId) + "/events");
}

/** GET /api/v4/runs/[runId]/report → 市场报告（404 = 未生成，返回 null）。 */
export async function getReport(runId: string): Promise<{ report: ReportViewLike } | null> {
  const res = await fetch(RUNS_BASE + "/" + encodeRunId(runId) + "/report", { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const errBody = await res.json().catch(() => null) as { code?: string; message?: string } | null;
    throw new V4ApiError(res.status, errBody?.code ?? "http_error", errBody?.message ?? "报告加载失败");
  }
  const body = await res.json();
  return body as { report: ReportViewLike };
}

// 导出以便 UI 复用 wait/error 判别（类型投影，不依赖 server-only）。
export type { ResearchRunState, ResearchRunEvent, ResearchRunStatus, ResearchRunNode, ResearchRunWait, ResumePayload };
