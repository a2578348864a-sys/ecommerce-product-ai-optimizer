"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

type ListingStatus = "ready" | "active" | "stale" | "revoked" | "legacy_unbound" | "invalid";

type ListingDraftSafeSummary = {
  generatedAt: string | null;
  source: string | null;
  version: number | null;
  titles: string[];
  bullets: string[];
  description: string | null;
  keywords: string[];
  sellingPoints: string[];
  riskNotes: string[];
  reviewChecklist: string[];
  blockedClaims: string[];
  complianceWarnings: string[];
};

type ListingStateResponse = {
  ok: true;
  data: {
    canGenerate: boolean;
    listingStatus: ListingStatus;
    currentHandoffRevision: number | null;
    sourceHandoffRevision: number | null;
    staleReasonCode: string | null;
    staleDraftPresent: boolean;
    handoffEffectiveStatus: string | null;
    humanReviewRequired: boolean;
    researchRevision: number | null;
    storageVersion: { resultJsonHash: string; updatedAt: string } | null;
    draft: ListingDraftSafeSummary | null;
    history: { sourceHandoffRevision: number; sourceResearchRevision: number; generatedAt: string; humanReviewRequired: boolean }[];
  };
};

type GenerateResponse = {
  ok: true;
  data: {
    listingStatus: ListingStatus;
    currentHandoffRevision: number | null;
    sourceHandoffRevision: number | null;
    idempotentReplay: boolean;
    humanReviewRequired: boolean;
    draft: ListingDraftSafeSummary | null;
  };
};

type ApiError = { status: number; code: string; message: string };

const BTN_CLASS =
  "mt-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:focus-visible:ring-0";
const BTN_SECONDARY_CLASS =
  "mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:focus-visible:ring-0";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ListingHandoffSection({ taskId }: { taskId: string }) {
  const [status, setStatus] = useState<ListingStatus | null>(null);
  const [handoffRevision, setHandoffRevision] = useState<number | null>(null);
  const [handoffEffectiveStatus, setHandoffEffectiveStatus] = useState<string | null>(null);
  const [storageVersion, setStorageVersion] = useState<{ resultJsonHash: string; updatedAt: string } | null>(null);
  const [draft, setDraft] = useState<ListingDraftSafeSummary | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [retryBody, setRetryBody] = useState<Record<string, unknown> | null>(null);
  const [confirmedFactCount, setConfirmedFactCount] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
        headers: buildAccessHeaders(),
      });
      if (!res.ok) {
        if (mounted.current) setNotice({ tone: "error", text: "状态加载失败，请刷新重试。" });
        return;
      }
      const json = (await res.json()) as ListingStateResponse;
      if (mounted.current && json.ok) {
        setStatus(json.data.listingStatus);
        setHandoffRevision(json.data.currentHandoffRevision);
        setHandoffEffectiveStatus(json.data.handoffEffectiveStatus);
        setStorageVersion(json.data.storageVersion);
        setDraft(json.data.draft);
        setCanGenerate(json.data.canGenerate);
        setConfirmedFactCount(null);
      }
    } catch {
      if (mounted.current) setNotice({ tone: "error", text: "网络异常，请重试。" });
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConflict = useCallback(() => {
    setRequestId(null);
    setRetryBody(null);
    setNotice({ tone: "error", text: "交接内容已经更新，请重新生成。" });
    void load();
  }, [load]);

  const generate = useCallback(async () => {
    if (submitting || handoffRevision === null || !canGenerate) return;
    const nextRequestId = requestId ?? crypto.randomUUID();
    let effectiveSv = storageVersion;
    if (!effectiveSv) {
      // storageVersion 直取（首次加载或 409 后）— 从本 Route 自己的 GET 获取，不依赖其他 API
      try {
        const svRes = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
          headers: buildAccessHeaders(),
        });
        const svJson = (await svRes.json()) as ListingStateResponse;
        if (svRes.ok && svJson.ok && svJson.data.storageVersion) {
          effectiveSv = svJson.data.storageVersion;
          setStorageVersion(effectiveSv);
        }
      } catch {
        effectiveSv = null;
      }
    }
    if (!effectiveSv) {
      setNotice({ tone: "error", text: "无法获取最新存储版本，请刷新后重试。" });
      return;
    }
    const body = {
      requestId: nextRequestId,
      expectedStorageVersion: effectiveSv,
      expectedHandoffRevision: handoffRevision,
      confirmed: true,
    };
    setSubmitting(true);
    try {
      const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
        method: "POST",
        headers: buildAccessHeaders(),
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const json = (await res.json()) as { error?: { code?: string; message?: string } };
        handleConflict();
        void json;
        return;
      }
      if (!res.ok) {
        const json = (await res.json()) as { error?: { code?: string; message?: string } };
        if (json.error?.code === "handoff_stale" || json.error?.code === "handoff_revision_conflict") {
          handleConflict();
          return;
        }
        setNotice({ tone: "error", text: `生成失败：${json.error?.message ?? "请重试。"}` });
        setRetryBody(body as unknown as Record<string, unknown>);
        return;
      }
      const json = (await res.json()) as GenerateResponse;
      if (mounted.current) {
        if (json.ok && json.data.idempotentReplay) {
          setNotice({ tone: "info", text: "该请求已成功生成过，未重复调用。" });
        } else {
          setNotice({ tone: "info", text: "Listing 草稿已生成，请人工审核。" });
        }
        setStatus(json.ok ? json.data.listingStatus : status);
        setRequestId(null);
        setRetryBody(null);
        await load();
      }
    } catch {
      if (mounted.current) {
        setNotice({ tone: "error", text: "网络异常，请重试。" });
        setRetryBody(body as unknown as Record<string, unknown>);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [submitting, handoffRevision, canGenerate, requestId, taskId, status, load, handleConflict, storageVersion]);

  const retrySameRequest = useCallback(async () => {
    if (!retryBody || !requestId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/listing-handoff`, {
        method: "POST",
        headers: buildAccessHeaders(),
        body: JSON.stringify(retryBody),
      });
      if (res.status === 409) {
        handleConflict();
        return;
      }
      if (res.ok) {
        setNotice({ tone: "info", text: "重试成功，未重复生成。" });
        setRequestId(null);
        setRetryBody(null);
        await load();
      } else {
        setNotice({ tone: "error", text: "重试仍失败，请稍后再试。" });
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [retryBody, requestId, submitting, taskId, load, handleConflict]);

  const renderDraftBody = () => {
    if (!draft) return null;
    return (
      <div className="mt-3 space-y-3 break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        {draft.titles.length > 0 ? (
          <div>
            <p className="font-semibold text-slate-800">标题</p>
            {draft.titles.map((t, i) => (
              <p key={`t-${i}`} className="mt-0.5">{t}</p>
            ))}
          </div>
        ) : null}
        {draft.bullets.length > 0 ? (
          <div>
            <p className="font-semibold text-slate-800">卖点</p>
            <ul className="mt-0.5 list-disc pl-5">
              {draft.bullets.map((b, i) => (
                <li key={`b-${i}`} className="mt-0.5">{b}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {draft.description ? (
          <div>
            <p className="font-semibold text-slate-800">描述</p>
            <p className="mt-0.5">{draft.description}</p>
          </div>
        ) : null}
        {draft.keywords.length > 0 ? (
          <div>
            <p className="font-semibold text-slate-800">搜索词</p>
            <p className="mt-0.5">{draft.keywords.join(" · ")}</p>
          </div>
        ) : null}
        {draft.riskNotes.length > 0 ? (
          <div>
            <p className="font-semibold text-slate-800">风险提示</p>
            <ul className="mt-0.5 list-disc pl-5">
              {draft.riskNotes.map((r, i) => (
                <li key={`r-${i}`} className="mt-0.5">{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="mt-5 min-w-0 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Listing 草稿">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-800">Listing 草稿</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          AI 生成草稿 · 仍需人工审核 · 不得直接发布
        </span>
      </header>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-800"}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="mt-3 space-y-2 text-sm text-slate-600">
        {status === null ? (
          <p aria-busy="true">加载中…</p>
        ) : status === "legacy_unbound" ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="font-semibold text-slate-800">历史草稿未绑定可信创作交接</p>
            <p className="mt-1">该草稿只读展示，不能作为当前有效草稿。请先完成创作交接并进行人工确认。</p>
          </div>
        ) : status === "ready" ? (
          <div>
            <p>
              当前交接 Revision：<strong>{handoffRevision ?? "—"}</strong> · 可生成 Listing 草稿
            </p>
            <button
              type="button"
              disabled={!canGenerate || submitting}
              onClick={() => void generate()}
              className={BTN_CLASS}
            >
              {submitting ? "生成中…" : "生成 Listing 草稿"}
            </button>
          </div>
        ) : status === "active" ? (
          <div>
            <p>
              当前草稿有效 · 来源交接 Revision <strong>{handoffRevision ?? "—"}</strong> · 生成于 {formatDate(draft?.generatedAt ?? null)}
            </p>
            {renderDraftBody()}
            <button
              type="button"
              disabled={!canGenerate || submitting}
              onClick={() => void generate()}
              className={BTN_SECONDARY_CLASS}
            >
              {submitting ? "生成中…" : "重新生成草稿"}
            </button>
          </div>
        ) : status === "stale" ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <p className="font-semibold text-amber-800">该草稿基于旧交接版本</p>
            <p className="mt-1 text-amber-700">
              当前草稿只读，不能作为当前有效草稿。请基于最新交接重新生成。
            </p>
            {renderDraftBody()}
            <button
              type="button"
              disabled={!canGenerate || submitting}
              onClick={() => void generate()}
              className={BTN_CLASS}
            >
              {submitting ? "生成中…" : "基于最新交接重新生成"}
            </button>
          </div>
        ) : status === "revoked" ? (
          <div className="rounded-lg bg-red-50 px-3 py-2">
            <p className="font-semibold text-red-800">对应创作交接已撤回</p>
            <p className="mt-1 text-red-700">草稿历史可查看，生成功能已禁用。</p>
            {renderDraftBody()}
          </div>
        ) : (
          <div className="rounded-lg bg-red-50 px-3 py-2">
            <p className="font-semibold text-red-800">草稿状态异常</p>
            <p className="mt-1 text-red-700">请刷新页面后重试。</p>
          </div>
        )}
      </div>

      {retryBody && requestId ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void retrySameRequest()}
          className={BTN_SECONDARY_CLASS}
        >
          重试同一请求
        </button>
      ) : null}
    </section>
  );
}
