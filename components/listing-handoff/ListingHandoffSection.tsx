"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { createBrowserUuid } from "@/lib/browserUuid";

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
    // V2 Listing 稳定落库：AI 输出未通过事实校验时系统生成保守草稿
    safeFallbackApplied?: boolean;
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

export function ListingHandoffSection({
  taskId,
  imageMaterialNeeds = [],
  onCommitted,
}: {
  taskId: string;
  /** 图片创作建议：来自研究保存时的 listingPrepSnapshot.imageMaterialNeeds（无数据则为空数组） */
  imageMaterialNeeds?: string[];
  /** Listing 草稿生成成功后通知父级（父级重读服务端真实任务状态，进度摘要随之刷新） */
  onCommitted?: () => void;
}) {
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
    const nextRequestId = requestId ?? createBrowserUuid();
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
        } else if (json.ok && json.data.safeFallbackApplied) {
          // V2 Listing 稳定落库：AI 输出未通过事实校验 → 系统生成保守草稿（用户可编辑完善）
          setNotice({ tone: "info", text: "AI输出未通过事实校验，系统已生成保守草稿，请人工完善表达。" });
        } else {
          setNotice({ tone: "info", text: "Listing 草稿已生成，请人工审核。" });
        }
        setStatus(json.ok ? json.data.listingStatus : status);
        setRequestId(null);
        setRetryBody(null);
        await load();
        onCommitted?.();
      }
    } catch {
      if (mounted.current) {
        setNotice({ tone: "error", text: "网络异常，请重试。" });
        setRetryBody(body as unknown as Record<string, unknown>);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [submitting, handoffRevision, canGenerate, requestId, taskId, status, load, handleConflict, storageVersion, onCommitted]);

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
        onCommitted?.();
      } else {
        setNotice({ tone: "error", text: "重试仍失败，请稍后再试。" });
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [retryBody, requestId, submitting, taskId, load, handleConflict, onCommitted]);

  const copyWithFeedback = (text: string, successText: string) => {
    if (!text.trim()) {
      setNotice({ tone: "error", text: "当前没有可复制的内容。" });
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setNotice({ tone: "info", text: successText }),
      () => setNotice({ tone: "error", text: "复制失败，请手动选择后复制。" }),
    );
  };

  /** 完整 Listing = 仅 Listing 文本本体（Title / Bullet Points / Description / Keywords），不含图片创作建议 */
  const buildFullListingText = (): string => {
    if (!draft) return "";
    const parts: string[] = [];
    if (draft.titles.length) parts.push(`Title:\n${draft.titles.join("\n")}`);
    if (draft.bullets.length) {
      parts.push(`Bullet Points:\n${draft.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}`);
    }
    if (draft.description) parts.push(`Product Description:\n${draft.description}`);
    if (draft.keywords.length) parts.push(`Keywords:\n${draft.keywords.join(", ")}`);
    return parts.join("\n\n");
  };

  const renderDraftBody = () => {
    if (!draft) return null;
    return (
      <div className="mt-3 space-y-4 break-words text-sm text-slate-700">
        {/* 复制工具条 */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copyWithFeedback(draft.titles.join("\n"), "标题已复制。")}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            复制标题
          </button>
          <button
            type="button"
            onClick={() => copyWithFeedback(draft.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n"), "五点描述已复制。")}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            复制五点描述
          </button>
          <button
            type="button"
            onClick={() => copyWithFeedback(draft.description ?? "", "商品描述已复制。")}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            复制商品描述
          </button>
          <button
            type="button"
            onClick={() => copyWithFeedback(draft.keywords.join(", "), "关键词已复制。")}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            复制关键词
          </button>
          <button
            type="button"
            onClick={() => copyWithFeedback(buildFullListingText(), "完整 Listing 已复制。")}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-teal-600 px-2.5 text-xs font-bold text-white hover:bg-teal-700"
          >
            复制完整 Listing
          </button>
        </div>

        {/* 1. 标题 Title */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">商品标题 Title</p>
          {draft.titles.length > 0 ? (
            <div className="mt-1.5 space-y-1">
              {draft.titles.map((t, i) => (
                <p key={`t-${i}`} className="leading-6">{t}</p>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成标题。</p>
          )}
        </div>

        {/* 2. 五点描述 Bullet Points */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">五点描述 Bullet Points</p>
          {draft.bullets.length > 0 ? (
            <ol className="mt-1.5 space-y-1">
              {draft.bullets.map((b, i) => (
                <li key={`b-${i}`} className="flex gap-1.5 leading-6">
                  <span className="shrink-0 font-semibold text-teal-600">{i + 1}.</span>
                  <span>{b}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成五点描述。</p>
          )}
        </div>

        {/* 3. 商品描述 Product Description */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">商品描述 Product Description</p>
          {draft.description ? (
            <p className="mt-1.5 leading-6">{draft.description}</p>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成商品描述。</p>
          )}
        </div>

        {/* 4. 搜索关键词 Keywords */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">搜索关键词 Keywords</p>
          {draft.keywords.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {draft.keywords.map((k, i) => (
                <span key={`k-${i}`} className="rounded-full border border-teal-100 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">{k}</span>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成关键词。</p>
          )}
        </div>

        {/* 图片创作建议：独立区域，不属于 Listing 文本本体（Listing 后台字段不包含此内容） */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="image-creation-suggestions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">图片创作建议</p>
            {imageMaterialNeeds.length > 0 ? (
              <button
                type="button"
                onClick={() => copyWithFeedback(imageMaterialNeeds.map((n, i) => `${i + 1}. ${n}`).join("\n"), "图片创作建议已复制。")}
                className="inline-flex h-7 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                复制图片创作建议
              </button>
            ) : null}
          </div>
          {imageMaterialNeeds.length > 0 ? (
            <ol className="mt-1.5 space-y-1">
              {imageMaterialNeeds.map((n, i) => (
                <li key={`n-${i}`} className="flex gap-1.5 leading-6 text-slate-600">
                  <span className="shrink-0 font-semibold text-slate-400">{i + 1}.</span>
                  <span>{n}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1.5 text-slate-400">暂未生成图片创作建议。</p>
          )}
        </div>

        {draft.riskNotes.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">风险提示</p>
            <ul className="mt-1.5 list-disc pl-5">
              {draft.riskNotes.map((r, i) => (
                <li key={`r-${i}`} className="mt-0.5 leading-6">{r}</li>
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
        <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700">
          当前有效 Listing
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
            <p className="font-semibold text-slate-800">历史草稿未绑定已确认的创作资料</p>
            <p className="mt-1">该草稿只读展示，不能作为当前有效草稿。请先确认本次创作资料。</p>
          </div>
        ) : status === "ready" ? (
          <div>
            <p>
              创作资料已确认 · 可生成 Listing 草稿
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
            <p className="text-sm font-semibold text-slate-700">
              当前 Listing 草稿有效 · 生成于 {formatDate(draft?.generatedAt ?? null)} · 仍需人工审核，不得直接发布
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
            <p className="font-semibold text-amber-800">该草稿基于旧版创作资料</p>
            <p className="mt-1 text-amber-700">
              当前草稿只读，不能作为当前有效草稿。请基于最新资料重新生成。
            </p>
            {renderDraftBody()}
            <button
              type="button"
              disabled={!canGenerate || submitting}
              onClick={() => void generate()}
              className={BTN_CLASS}
            >
              {submitting ? "生成中…" : "基于最新资料重新生成"}
            </button>
          </div>
        ) : status === "revoked" ? (
          <div className="rounded-lg bg-red-50 px-3 py-2">
            <p className="font-semibold text-red-800">对应创作资料已撤回</p>
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
