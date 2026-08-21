"use client";

import { useState } from "react";
import type { ResearchRunWait, ResumePayload } from "@/lib/v4/contracts";
import { resumeRun, V4ApiError } from "./api";

type InterruptActionsProps = {
  runId: string;
  wait: ResearchRunWait;
  revision: number;
  onAction?: () => void;
};

/** 等待人工中断面板的决策按钮（continue/stop、input、retry）。 */
export function InterruptActions({ runId, wait, revision, onAction }: InterruptActionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");

  async function dispatch(payload: ResumePayload) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await resumeRun(runId, revision, payload);
      onAction?.();
    } catch (err) {
      if (err instanceof V4ApiError && err.code === "REVISION_CONFLICT") {
        setError("Revision 冲突：当前版本 " + revision + "，最新版本 " + (err.latestRevision ?? "?") + "，已刷新最新状态。");
        onAction?.();
      } else {
        setError(err instanceof Error ? err.message : "操作失败，请稍后重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleDecision(decision: "continue" | "stop") {
    void dispatch({ kind: "human_decision", decision });
  }

  function handleSubmitInput() {
    const value = inputValue.trim();
    if (!value) {
      setError("请输入内容后再提交。");
      return;
    }
    void dispatch({ kind: "input", value });
  }

  const buttonClass = "inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold transition disabled:opacity-50";

  let body;
  if (wait.kind === "human_decision") {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => handleDecision("continue")} data-testid="interrupt-continue"
          className={buttonClass + " border-teal-300 bg-white text-teal-700 hover:bg-teal-50"}>
          继续
        </button>
        <button type="button" disabled={busy} onClick={() => handleDecision("stop")} data-testid="interrupt-stop"
          className={buttonClass + " border-rose-300 bg-white text-rose-700 hover:bg-rose-50"}>
          停止
        </button>
      </div>
    );
  } else if (wait.kind === "input") {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="输入补充内容…"
          data-testid="interrupt-input"
          className="h-9 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-300 focus:outline-none"
        />
        <button type="button" disabled={busy} onClick={handleSubmitInput} data-testid="interrupt-submit"
          className={buttonClass + " border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"}>
          提交
        </button>
      </div>
    );
  } else if (wait.kind === "authentication") {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">请登录或完成平台认证后继续。</p>
        <button type="button" disabled={busy} onClick={() => onAction?.()} data-testid="interrupt-refresh"
          className={buttonClass + " border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}>
          刷新
        </button>
      </div>
    );
  } else {
    // budget
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">预算已用尽，需补充预算后恢复。</p>
        <button type="button" disabled={busy} onClick={() => void dispatch({ kind: "retry" })} data-testid="interrupt-resume-budget"
          className={buttonClass + " border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"}>
          恢复
        </button>
      </div>
    );
  }

  return (
    <div data-testid="interrupt-actions" className="mt-3">
      {body}
      {error ? <p data-testid="interrupt-error" className="mt-2 text-xs font-semibold text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
