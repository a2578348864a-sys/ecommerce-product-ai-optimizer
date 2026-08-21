"use client";

import { useCallback, useEffect, useState } from "react";
import { listRuns, type RunSummary } from "./api";
import { RunListTable } from "./RunListTable";

type LoadState = "loading" | "ready" | "error";

/** Run 列表数据壳：拉取列表、管理加载/错误/空态。 */
export function RunListClient() {
  const [state, setState] = useState<LoadState>("loading");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const data = await listRuns();
      setRuns(data.runs ?? []);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") {
    return (
      <div data-testid="run-list-loading" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        加载中…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div data-testid="run-list-error" className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-800">无法加载运行列表</p>
        <p className="mt-1 text-sm text-slate-600">{error ?? "未知错误"}</p>
        <button
          type="button"
          data-testid="reload-button"
          onClick={() => void load()}
          className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
        >
          重试加载
        </button>
      </div>
    );
  }

  return <RunListTable runs={runs} />;
}
