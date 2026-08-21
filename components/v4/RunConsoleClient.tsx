"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchRunEvent, ResearchRunState } from "@/lib/v4/contracts";
import { getRun, resumeRun } from "./api";
import { RunConsoleView } from "./RunConsoleView";

type LoadState = "loading" | "ready" | "error";

/** Run Console 数据壳：拉取详情、管理加载/错误态，并驱动交互刷新。 */
export function RunConsoleClient({ runId }: { runId: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [run, setRun] = useState<ResearchRunState | null>(null);
  const [events, setEvents] = useState<ResearchRunEvent[]>([]);
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

  return <RunConsoleView run={run} events={events} onRefresh={() => void refresh(false)} onRetry={() => void retry()} />;
}
