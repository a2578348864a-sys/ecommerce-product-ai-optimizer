"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { confirmFact, getCommercial, getFacts, getReport, getRun, resumeRun, revokeFact, type FactView } from "./api";
import { postContentReview } from "./api";
import { RunConsoleView, type ContentView } from "./RunConsoleView";
import type { ReportViewLike } from "./api";
import type { ConfirmationMethod, FactGateItem, FactGateCallbacks } from "./FactGatePanel";
import type { DisplayFactStatus } from "./FactStatusBadge";

type LoadState = "loading" | "ready" | "error";

function toDisplayFactStatus(status: string | null | undefined): DisplayFactStatus {
  if (status === "confirmed" || status === "rejected" || status === "unknown" || status === "conflict" || status === "revoked") return status;
  return "unconfirmed";
}

/** 把 API 的 FactView 映射为 FactGatePanel 的 FactGateItem（仅展示投影，不伪造字段）。 */
function mapFactViews(facts: FactView[]): FactGateItem[] {
  return facts.map((f) => ({
    key: f.id || f.offerIdentity + "|" + f.variantKey + "|" + f.field,
    variantKey: f.variantKey,
    field: f.field,
    value: f.value,
    status: toDisplayFactStatus(f.status),
    revision: f.revision,
    actor: f.actor,
    updatedAt: f.createdAt,
    confirmationMethod: f.confirmationMethod as ConfirmationMethod | null | undefined,
    claimRefs: f.claimRefs,
    documentRefs: f.documentRefs,
    revokedByRevision: f.revokedByRevision,
    revocationReason: (f.detail as Record<string, unknown> | undefined)?.reason as string | undefined,
  }));
}

/** 已到达内容阶段的节点（在此抓取 Listing/图片数据；未达 → null）。 */
const CONTENT_READY_NODES = new Set(["content_handoff", "content_skills", "content_review", "complete"]);

/** API 内容包 → C 端 ContentView 适配（images.checks 在 API 是 VisualFactCheckResult 对象，C 端用数组+状态）。 */
function toContentView(raw: unknown): ContentView {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const images = (r.images ?? null) as Record<string, unknown> | null;
  const checkRaw = images?.checks as Record<string, unknown> | null | undefined;
  const checks = Array.isArray(checkRaw?.checks)
    ? (checkRaw.checks as { check?: string; pass?: boolean; evidence?: string; issues?: unknown[] }[]).map((c) => ({
        check: String(c.check ?? ""),
        pass: c.pass === true,
        evidence: String(c.evidence ?? ""),
        issues: Array.isArray(c.issues) ? c.issues.map((x) => String(x)) : [],
      }))
    : undefined;
  return {
    listing: (r.listing ?? null) as ContentView extends { listing?: infer L } ? L : never,
    images: images
      ? {
          overallStatus: (checkRaw?.overallStatus as "ok" | "needs_human" | "blocked" | undefined) ?? undefined,
          summary: typeof checkRaw?.summary === "string" ? checkRaw.summary : undefined,
          checks,
        }
      : null,
    review: (r.review ?? null) as ContentView extends { review?: infer R } ? R : never,
  };
}

/** GET /api/v4/runs/[runId]/content → 内容包（404 = 尚未生成，返回 null）。 */
async function getContent(runId: string): Promise<ContentView> {
  const res = await fetch("/api/v4/runs/" + encodeURIComponent(runId) + "/content", { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { content?: unknown };
  return toContentView(body.content);
}

/** Run Console 数据壳：拉取详情、管理加载/错误态，并驱动交互刷新。 */
export function RunConsoleClient({ runId }: { runId: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [run, setRun] = useState<ResearchRunState | null>(null);
  const [events, setEvents] = useState<ResearchRunEvent[]>([]);
  const [report, setReport] = useState<ReportViewLike | null>(null);
  const [facts, setFacts] = useState<FactView[] | null>(null);
  const [commercial, setCommercial] = useState<unknown | null>(null);
  const [content, setContent] = useState<ContentView>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(
    async (silent = false) => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (!silent) {
        setState("loading");
        setError(null);
      }
      try {
        const data = await getRun(runId);
        setRun(data.run);
        setEvents(data.events ?? []);
        const reportData = (await getReport(runId).catch(() => null))?.report ?? null;
        setReport(reportData);
        // facts 仅在 product_fact_gate 抓取：null = 尚未生成/无法加载（诚实空态，不显示“0 项”）。
        if (data.run.currentNode === "product_fact_gate") {
          const identity = supplierIdentityFromReport(reportData);
          const fetched = identity
            ? await getFacts(runId, identity.offerIdentity, identity.variantKey).catch(() => null)
            : null;
          setFacts(fetched);
        } else {
          setFacts(null);
        }
        if (data.run.currentNode === "commercial_check" || data.run.currentNode === "gate_b") {
          const commercialData = await getCommercial(runId).catch(() => null);
          setCommercial(commercialData);
        }
        // content：到达内容阶段或已完成时才抓取；否则 null（尚未生成，诚实空态）。
        if (CONTENT_READY_NODES.has(data.run.currentNode) || data.run.status === "completed") {
          const contentData = await getContent(runId).catch(() => null);
          setContent(contentData);
        } else {
          setContent(null);
        }
        setState("ready");
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "加载失败");
          setState("error");
        }
      } finally {
        busyRef.current = false;
      }
    },
    [runId],
  );

  const supplierIdentityFromReport = (report: ReportViewLike | null) => {
    if (!report) return null;
    const supplier = report.evidence.find((e) => e.type === "sellersprite" || (e.entity && e.entity.includes("1688")));
    if (!supplier) return null;
    const f = supplier.fields as Record<string, unknown> | undefined;
    return { offerIdentity: String(f?.offerIdentity ?? supplier.entity).slice(0, 128), variantKey: String(f?.variantKey ?? "default").slice(0, 128) };
  };

  const factCallbacks: FactGateCallbacks = useMemo(() => ({
    onConfirm: (item, payload) => {
      void (async () => {
        const identity = supplierIdentityFromReport(report);
        if (!identity) return;
        await confirmFact(runId, { offerIdentity: identity.offerIdentity, variantKey: item.variantKey, field: item.field, value: item.value, status: "confirmed", confirmationMethod: payload.confirmationMethod, claimRefs: payload.claimRefs, documentRefs: payload.documentRefs }).catch(() => undefined);
        void refresh(true);
      })();
    },
    onReject: (item) => { void (async () => { const identity = supplierIdentityFromReport(report); if (!identity) return; await confirmFact(runId, { offerIdentity: identity.offerIdentity, variantKey: item.variantKey, field: item.field, value: item.value, status: "rejected" }).catch(() => undefined); void refresh(true); })(); },
    onUnknown: (item) => { void (async () => { const identity = supplierIdentityFromReport(report); if (!identity) return; await confirmFact(runId, { offerIdentity: identity.offerIdentity, variantKey: item.variantKey, field: item.field, value: item.value, status: "unknown" }).catch(() => undefined); void refresh(true); })(); },
    onConflict: (item, payload) => { void (async () => { const identity = supplierIdentityFromReport(report); if (!identity) return; await confirmFact(runId, { offerIdentity: identity.offerIdentity, variantKey: item.variantKey, field: item.field, value: item.value, status: "conflict", detail: { otherValue: payload.otherValue } }).catch(() => undefined); void refresh(true); })(); },
    onRevoke: (item, payload) => { void (async () => { const identity = supplierIdentityFromReport(report); if (!identity) return; await revokeFact(runId, identity.offerIdentity + "|" + item.variantKey + "|" + item.field, payload.reason).catch(() => undefined); void refresh(true); })(); },
  }), [runId, report, refresh]);

  const contentReview = useMemo(() => {
    if (!run || run.currentNode !== "content_review") return null;
    return {
      review: null as { choice?: string; note?: string; actor?: string; at?: string } | null,
      onChoice: (choice: "approve_export" | "request_revision" | "reject_asset", note?: string) => {
        void (async () => {
          try {
            await postContentReview(runId, choice, note);
            // 审核保存使 revision +1；用最新 revision 恢复，避免两步竞态 409（门禁 7 复验）。
            const latest = await getRun(runId).catch(() => null);
            const rev = latest?.run?.revision ?? run.revision;
            await resumeRun(runId, rev, { kind: "human_decision", decision: choice as never, note });
          } catch {
            // 服务端拒绝（如 content_blocked）或网络异常：刷新带回真实状态与原因。
          }
          void refresh(true);
        })();
      },
    };
  }, [run, runId, refresh]);

  const gateB = useMemo(() => {
    if (!run || run.currentNode !== "gate_b") return null;
    return {
      revision: run.revision,
      actor: "owner",
      rulesStale: false,
      onSubmit: (payload: { option: string; reason?: string }) => {
        void (async () => {
          await resumeRun(runId, run.revision, { kind: "human_decision", decision: payload.option as never, note: payload.reason }).catch(() => undefined);
          void refresh(true);
        })();
      },
    };
  }, [run, runId, refresh]);

  const retry = useCallback(async () => {
    if (!run) return;
    try {
      await resumeRun(runId, run.revision, { kind: "retry" });
    } catch {
      // 忽略；刷新会带回最新状态
    }
    void refresh(false);
  }, [run, runId, refresh]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  // 非终态时轻量轮询，保持控制台接近实时（P1 状态演示）。
  useEffect(() => {
    if (!run || state !== "ready") return;
    const terminal = run.status === "completed" || run.status === "cancelled" || run.status === "failed_terminal";
    if (terminal) return;
    const id = setInterval(() => {
      void refresh(true);
    }, 8000);
    return () => clearInterval(id);
  }, [run, state, refresh]);

  if (state === "loading") {
    return (
      <div data-testid="run-console-loading" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        加载中…
      </div>
    );
  }

  if (state === "error" || !run) {
    return (
      <div data-testid="run-console-error" className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-800">无法加载运行</p>
        <p className="mt-1 text-sm text-slate-600">{error ?? "未知错误"}</p>
        <button
          type="button"
          data-testid="reload-button"
          onClick={() => void refresh(false)}
          className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
        >
          重试加载
        </button>
      </div>
    );
  }

  return (
    <RunConsoleView
      run={run}
      events={events}
      report={report}
      facts={facts ? mapFactViews(facts) : null}
      factCallbacks={factCallbacks}
      commercial={{ output: commercial }}
      gateB={gateB as never}
      contentReview={contentReview}
      content={content}
      onRefresh={() => void refresh(false)}
      onRetry={() => void retry()}
    />
  );
}
