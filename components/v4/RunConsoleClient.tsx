"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { confirmFact, getCommercial, getFacts, getReport, getRun, resumeRun, revokeFact, type FactView } from "./api";
import { postContentReview } from "./api";
import { RunConsoleView } from "./RunConsoleView";
import type { ReportViewLike } from "./api";
import type { FactGateItem, FactGateCallbacks } from "./FactGatePanel";

type LoadState = "loading" | "ready" | "error";

/** Run Console 数据壳：拉取详情、管理加载/错误态，并驱动交互刷新。 */
export function RunConsoleClient({ runId }: { runId: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [run, setRun] = useState<ResearchRunState | null>(null);
  const [events, setEvents] = useState<ResearchRunEvent[]>([]);
  const [report, setReport] = useState<ReportViewLike | null>(null);
  const [facts, setFacts] = useState<FactView[]>([]);
  const [commercial, setCommercial] = useState<unknown | null>(null);
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
        if (data.run.currentNode === "commercial_check" || data.run.currentNode === "gate_b") {
          const commercialData = await getCommercial(runId).catch(() => null);
          setCommercial(commercialData);
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
          await postContentReview(runId, choice, note).catch(() => undefined);
          await resumeRun(runId, run.revision, { kind: "human_decision", decision: choice as never, note }).catch(() => undefined);
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

  return <RunConsoleView run={run} events={events} report={report} facts={facts as unknown as FactGateItem[]} factCallbacks={factCallbacks} commercial={{ output: commercial }} gateB={gateB as never} contentReview={contentReview} onRefresh={() => void refresh(false)} onRetry={() => void retry()} />;
}
