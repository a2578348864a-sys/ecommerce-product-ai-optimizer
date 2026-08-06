"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
 *
 * P1 修复：load 不再依赖 result（用 ref 持有最新结果），且返回对象经 useMemo
 * 稳定——避免 CreativeHandoffPanel 的 loadAll effect 因 api 引用每次变化而无限重跑
 * （实测点击创作交接步骤后 creative-handoff 5 秒内被请求 98 次，页面主线程卡死）。
 */
export function useCreativeHandoffApi(taskId: string) {
  const [state, setState] = useState<HandoffApiState>("loading");
  const [result, setResult] = useState<HandoffLoadResult | null>(null);
  const resultRef = useRef<HandoffLoadResult | null>(null);
  const inFlight = useRef(false);
  const requestSeq = useRef(0);

  const commitResult = useCallback((next: HandoffLoadResult) => {
    resultRef.current = next;
    setResult(next);
  }, []);

  const load = useCallback(async (): Promise<HandoffLoadResult> => {
    // 同一时间只允许一次请求；已在途时直接返回当前结果（不重复发请求）
    if (inFlight.current) {
      return resultRef.current ?? { kind: "error", error: { status: 0, code: "loading", message: "加载中" } };
    }
    inFlight.current = true;
    const seq = ++requestSeq.current;
    setState("loading");
    try {
      const headers = buildAccessHeaders();
      const [previewRes, detailRes] = await Promise.all([
        fetch(`${BASE}/${encodeURIComponent(taskId)}/creative-handoff?mode=preview`, { headers }),
        fetch(`${BASE}/${encodeURIComponent(taskId)}/creative-handoff`, { headers }),
      ]);
      // 过期响应丢弃（新一轮请求已开始）
      if (seq !== requestSeq.current) {
        return resultRef.current ?? { kind: "error", error: { status: 0, code: "loading", message: "加载中" } };
      }
      if (previewRes.status === 404 || detailRes.status === 404) {
        const out: HandoffLoadResult = { kind: "error", error: { status: 404, code: "task_not_found", message: "该任务不存在或你无权访问。" } };
        commitResult(out);
        setState("error");
        return out;
      }
      if (!previewRes.ok || !detailRes.ok) {
        const err = await readError(previewRes.ok ? detailRes : previewRes);
        const out: HandoffLoadResult = { kind: "error", error: err };
        commitResult(out);
        setState("error");
        return out;
      }
      const previewJson = (await previewRes.json()) as PreviewResponse;
      const detailJson = (await detailRes.json()) as DetailResponse;
      const out: HandoffLoadResult = { kind: "ok", preview: previewJson.preview, detail: detailJson.detail, gateReason: previewJson.gateReason };
      commitResult(out);
      setState("detail");
      return out;
    } catch {
      if (seq !== requestSeq.current) {
        return resultRef.current ?? { kind: "error", error: { status: 0, code: "loading", message: "加载中" } };
      }
      const out: HandoffLoadResult = { kind: "error", error: { status: 0, code: "network_error", message: "网络异常，请重试。" } };
      commitResult(out);
      setState("error");
      return out;
    } finally {
      inFlight.current = false;
    }
  }, [taskId, commitResult]);

  const refresh = useCallback(() => load(), [load]);

  const create = useCallback(
    async (input: {
      requestId: string;
      selectedFactCandidateIds: string[];
      selectedVisualReferenceCandidateIds?: string[];
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
        // V2 Final Integration: 视觉参考批准只提交服务端确定的 selectionId；
        // 浏览器绝不提交图片 URL 或完整 visualReference 对象。
        ...(input.selectedVisualReferenceCandidateIds && input.selectedVisualReferenceCandidateIds.length > 0
          ? { selectedVisualReferenceCandidateIds: input.selectedVisualReferenceCandidateIds }
          : {}),
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

  return useMemo(
    () => ({ state, result, load, refresh, create, revoke }),
    // P1：state/result 变化时必须更新（供 UI 反映），但 load/refresh/create/revoke 引用稳定。
    // 返回对象引用仅在 state/result 变化时改变；loadAll effect 以 api.load 为依赖（稳定）。
    [state, result, load, refresh, create, revoke],
  );
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
