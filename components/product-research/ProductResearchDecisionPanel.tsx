"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import {
  PRODUCT_RESEARCH_DECISION_OPTIONS,
  getProductResearchDecisionLabel,
  type ProductResearchDecisionStatus as DecisionStatus,
} from "@/lib/productResearchDecisionContract";

type DecisionEvent = {
  revision: number;
  status: DecisionStatus;
  reason: string;
  nextAction: string | null;
  researchHashFingerprint: string | null;
  decidedAt: string;
  actorMode: "owner" | "visitor";
};

type DecisionRecord = {
  schema: "product-research-record.v1";
  revision: number;
  researchHashFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  latestDecision: DecisionEvent;
  decisionEvents: DecisionEvent[];
};

type DecisionState = {
  taskId: string;
  legacy: boolean;
  readOnly: boolean;
  record: DecisionRecord | null;
};

type DecisionResponse =
  | { ok: true; data: DecisionState; idempotent?: boolean }
  | { ok: false; error: { code: string; message: string; currentRevision?: number } };

function statusLabel(status: DecisionStatus) {
  return getProductResearchDecisionLabel(status);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type DecisionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchProductResearchDecisionState(
  taskId: string,
  fetcher: DecisionFetch = fetch,
): Promise<DecisionState> {
  const response = await fetcher(`/api/tasks/${encodeURIComponent(taskId)}/research-decision`, {
    cache: "no-store",
    headers: buildAccessHeaders(),
  });
  const data = await response.json() as DecisionResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.ok ? "研究决定读取失败。" : data.error.message);
  }
  return data.data;
}

export async function submitProductResearchDecision(input: {
  taskId: string;
  expectedRevision: number;
  decisionId: string;
  status: DecisionStatus;
  reason: string;
  nextAction: string | null;
  fetcher?: DecisionFetch;
}): Promise<
  | { kind: "saved"; state: DecisionState; idempotent: boolean }
  | { kind: "conflict"; state: DecisionState }
  | { kind: "rejected"; message: string }
> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`/api/tasks/${encodeURIComponent(input.taskId)}/research-decision`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
    body: JSON.stringify({
      expectedRevision: input.expectedRevision,
      decisionId: input.decisionId,
      status: input.status,
      reason: input.reason,
      nextAction: input.nextAction,
    }),
  });
  const data = await response.json() as DecisionResponse;
  if (response.ok && data.ok) {
    return { kind: "saved", state: data.data, idempotent: data.idempotent === true };
  }
  if (!data.ok && data.error.code === "research_record_conflict") {
    return {
      kind: "conflict",
      state: await fetchProductResearchDecisionState(input.taskId, fetcher),
    };
  }
  return { kind: "rejected", message: data.ok ? "研究决定保存失败。" : data.error.message };
}

export function ProductResearchDecisionPanel({
  taskId,
  onUpdated,
}: {
  taskId: string;
  onUpdated?: () => void;
}) {
  const [state, setState] = useState<DecisionState | null>(null);
  const [status, setStatus] = useState<DecisionStatus>("needs_information");
  const [reason, setReason] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const decisionIdRef = useRef("");

  const loadState = useCallback(async () => {
    const data = await fetchProductResearchDecisionState(taskId);
    setState(data);
    if (data.record) {
      setStatus(data.record.latestDecision.status);
      setReason(data.record.latestDecision.reason);
      setNextAction(data.record.latestDecision.nextAction ?? "");
    }
    return data;
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadState()
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "研究决定读取失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  const formValid = reason.trim().length > 0
    && (status !== "needs_information" || nextAction.trim().length > 0);

  async function saveDecision() {
    if (!state?.record || state.readOnly || saving || !formValid) return;
    if (!decisionIdRef.current) decisionIdRef.current = crypto.randomUUID();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const outcome = await submitProductResearchDecision({
        taskId,
        expectedRevision: state.record.revision,
        decisionId: decisionIdRef.current,
        status,
        reason,
        nextAction: nextAction || null,
      });
      if (outcome.kind === "conflict") {
        setState(outcome.state);
        if (outcome.state.record) {
          setStatus(outcome.state.record.latestDecision.status);
          setReason(outcome.state.record.latestDecision.reason);
          setNextAction(outcome.state.record.latestDecision.nextAction ?? "");
        }
        decisionIdRef.current = "";
        setError("该记录已在其他页面更新，已加载最新版本，请重新确认后保存。");
        return;
      }
      if (outcome.kind === "rejected") {
        setError(outcome.message);
        return;
      }
      setState(outcome.state);
      decisionIdRef.current = "";
      setMessage(outcome.idempotent ? "该决定已保存，无需重复写入。" : "研究决定已保存并追加到历史。");
      onUpdated?.();
    } catch {
      setError("网络异常，研究决定尚未确认保存。可直接重试，本次重试会复用同一决定编号。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">正在读取正式研究决定…</section>;
  }

  if (error && !state) {
    return <section className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</section>;
  }

  if (!state || state.legacy || !state.record) {
    return (
      <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="legacy-research-decision">
        <p className="text-sm font-bold text-slate-800">旧版研究记录</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          旧版研究记录仅供查看，部分内容可能基于 AI 假设；系统不会为它补造新版决定、版本或历史。
        </p>
      </section>
    );
  }

  const record = state.record;
  const latest = record.latestDecision;
  const selected = PRODUCT_RESEARCH_DECISION_OPTIONS.find((option) => option.value === status)!;

  return (
    <section className="mt-5 rounded-2xl border border-teal-200 bg-teal-50/40 p-4" data-testid="product-research-decision-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-teal-900">正式研究决定</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            运营生命周期与研究决定是不同概念。决定变化不会改写本次研究依据。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-teal-200 bg-white px-3 py-1 text-teal-800">版本 {state.record.revision}</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
            研究指纹 {record.researchHashFingerprint ?? "不可用"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white bg-white p-3">
          <p className="text-xs font-bold text-slate-400">当前决定</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{statusLabel(latest.status)}</p>
        </div>
        <div className="rounded-xl border border-white bg-white p-3 sm:col-span-2">
          <p className="text-xs font-bold text-slate-400">原因与下一步</p>
          <p className="mt-1 text-sm leading-6 text-slate-800">{latest.reason}</p>
          <p className="mt-1 text-xs leading-5 text-teal-700">下一步：{latest.nextAction || "无"}</p>
        </div>
        <div className="rounded-xl border border-white bg-white p-3">
          <p className="text-xs font-bold text-slate-400">决定时间 / 身份</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">{formatDate(latest.decidedAt)}</p>
          <p className="mt-1 text-xs text-slate-500">{latest.actorMode === "owner" ? "Owner" : "Visitor"}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white bg-white p-3">
        <p className="text-sm font-bold text-slate-900">更新决定</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <label className="text-xs font-bold text-slate-600" htmlFor="research-decision-status">正式决定</label>
            <select
              id="research-decision-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as DecisionStatus)}
              className="input-soft mt-1 h-11 w-full px-3 text-sm font-semibold text-slate-800"
            >
              {PRODUCT_RESEARCH_DECISION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <p className="mt-2 text-xs leading-5 text-slate-500">{selected.description}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">
              决定原因
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value.slice(0, 1000))}
                rows={3}
                className="input-soft mt-1 w-full resize-none px-3 py-2 text-sm leading-6 text-slate-800"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              下一步动作{status === "needs_information" ? "（必填）" : "（可选）"}
              <textarea
                value={nextAction}
                onChange={(event) => setNextAction(event.target.value.slice(0, 1000))}
                rows={3}
                className="input-soft mt-1 w-full resize-none px-3 py-2 text-sm leading-6 text-slate-800"
              />
            </label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void saveDecision()}
            disabled={saving || !formValid}
            className="linear-button-primary h-10 px-4 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存新决定"}
          </button>
          <p className="text-xs leading-5 text-slate-500">
            已保存正式决定；尚未生成结构化创作交接卡。Listing / Image 自动交接将在 PR-3 完成，当前不会自动生成 Listing、图片或发布任务。
          </p>
        </div>
        {message ? <p className="mt-2 text-xs font-semibold text-teal-700">{message}</p> : null}
        {error ? <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p> : null}
      </div>

      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-800">决定历史（{record.decisionEvents.length}）</summary>
        <ol className="mt-3 space-y-3">
          {[...record.decisionEvents].reverse().map((event) => (
            <li key={event.revision} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">版本 {event.revision} · {statusLabel(event.status)}</p>
                <p className="text-xs text-slate-500">{formatDate(event.decidedAt)} · {event.actorMode === "owner" ? "Owner" : "Visitor"}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{event.reason}</p>
              <p className="mt-1 text-xs leading-5 text-teal-700">下一步：{event.nextAction || "无"}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
