"use client";

import { useCallback, useRef, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import type {
  ApiError,
  CreateResponse,
  CreativeHandoffDetail,
  CreativeHandoffPreview,
  DetailResponse,
  PreviewResponse,
  RevokeReasonCode,
  RevokeResponse,
} from "@/components/creative-handoff/types";

const BASE = "/api/tasks";

export type HandoffApiState = "loading" | "preview" | "detail" | "error";

export type HandoffLoadResult =
  | { kind: "ok"; preview: CreativeHandoffPreview | null; detail: CreativeHandoffDetail | null; gateReason: string }
  | { kind: "error"; error: ApiError };

/**
 * Creative Handoff API client — 仅提交服务端允许的安全字段。
 * 浏览器永不构造事实对象/SourceReference/确认主体。
 */
export function useCreativeHandoffApi(taskId: string) {
  const [state, setState] = useState<HandoffApiState>("loading");
  const [result, setResult] = useState<HandoffLoadResult | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (): Promise<HandoffLoadResult> => {
    if (inFlight.current) return result ?? { kind: "error", error: { status: 0, code: "loading", message: "加载中" } };
    inFlight.current = true;
    setState("loading");
    try {
      const headers = buildAccessHeaders();
      const [previewRes, detailRes] = await Promise.all([
        fetch(`${BASE}/${encodeURIComponent(taskId)}/creative-handoff?mode=preview`, { headers }),
        fetch(`${BASE}/${encodeURIComponent(taskId)}/creative-handoff`, { headers }),
      ]);
      if (previewRes.status === 404 || detailRes.status === 404) {
        const out: HandoffLoadResult = { kind: "error", error: { status: 404, code: "task_not_found", message: "该任务不存在或你无权访问。" } };
        setResult(out);
        setState("error");
        return out;
      }
      if (!previewRes.ok || !detailRes.ok) {
        const err = await readError(previewRes.ok ? detailRes : previewRes);
        const out: HandoffLoadResult = { kind: "error", error: err };
        setResult(out);
        setState("error");
        return out;
      }
      const previewJson = (await previewRes.json()) as PreviewResponse;
      const detailJson = (await detailRes.json()) as DetailResponse;
      const out: HandoffLoadResult = { kind: "ok", preview: previewJson.preview, detail: detailJson.detail, gateReason: previewJson.gateReason };
      setResult(out);
      setState("detail");
      return out;
    } catch {
      const out: HandoffLoadResult = { kind: "error", error: { status: 0, code: "network_error", message: "网络异常，请重试。" } };
      setResult(out);
      setState("error");
      return out;
    } finally {
      inFlight.current = false;
    }
  }, [taskId, result]);

  const refresh = useCallback(() => load(), [load]);

  const create = useCallback(
    async (input: {
      requestId: string;
      selectedFactCandidateIds: string[];
      expectedStorageVersion: { resultJsonHash: string; updatedAt: string };
      expectedResearchRevision: number;
      expectedCurrentHandoffRevision: number;
      creativePreferences?: { targetMarket?: string; language?: string; tone?: string; imageStyle?: string };
      onConflict?: (error: ApiError) => void;
    }): Promise<CreateResponse> => {
      const headers = buildAccessHeaders();
      const body = {
        action: "create",
        requestId: input.requestId,
        selectedFactCandidateIds: input.selectedFactCandidateIds,
        expectedStorageVersion: input.expectedStorageVersion,
        expectedResearchRevision: input.expectedResearchRevision,
        expectedCurrentHandoffRevision: input.expectedCurrentHandoffRevision,
        ...(input.creativePreferences ? { creativePreferences: input.creativePreferences } : {}),
        confirmed: true,
      };
      const res = await fetch(`${BASE}/${encodeURIComponent(taskId)}/creative-handoff`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const err = await readError(res);
        input.onConflict?.(err);
        throw new HandoffApiRequestError(err);
      }
      if (!res.ok) {
        const err = await readError(res);
        throw new HandoffApiRequestError(err);
      }
      return (await res.json()) as CreateResponse;
    },
    [taskId],
  );

  const revoke = useCallback(
    async (input: {
      requestId: string;
      revokeReasonCode: RevokeReasonCode;
      expectedStorageVersion: { resultJsonHash: string; updatedAt: string };
      expectedCurrentHandoffRevision: number;
      onConflict?: (error: ApiError) => void;
    }): Promise<RevokeResponse> => {
      const headers = buildAccessHeaders();
      const body = {
        action: "revoke",
        requestId: input.requestId,
        revokeReasonCode: input.revokeReasonCode,
        expectedStorageVersion: input.expectedStorageVersion,
        expectedCurrentHandoffRevision: input.expectedCurrentHandoffRevision,
      };
      const res = await fetch(`${BASE}/${encodeURIComponent(taskId)}/creative-handoff`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const err = await readError(res);
        input.onConflict?.(err);
        throw new HandoffApiRequestError(err);
      }
      if (!res.ok) {
        const err = await readError(res);
        throw new HandoffApiRequestError(err);
      }
      return (await res.json()) as RevokeResponse;
    },
    [taskId],
  );

  return { state, result, load, refresh, create, revoke };
}

export class HandoffApiRequestError extends Error {
  constructor(public readonly error: ApiError) {
    super(error.message);
    this.name = "HandoffApiRequestError";
  }
}

async function readError(res: Response): Promise<ApiError> {
  try {
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    return { status: res.status, code: json.error?.code ?? "unknown", message: json.error?.message ?? "请求失败。" };
  } catch {
    return { status: res.status, code: "unknown", message: "请求失败。" };
  }
}
