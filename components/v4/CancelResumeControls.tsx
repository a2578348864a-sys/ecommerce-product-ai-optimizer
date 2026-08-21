"use client";

import { useState } from "react";
import type { ResearchRunStatus } from "@/lib/v4/contracts";
import { cancelRun, resumeRun, startRun, V4ApiError } from "./api";
import { isTerminalStatus } from "./labels";

type CancelResumeControlsProps = {
  runId: string;
  status: ResearchRunStatus;
  revision: number;
  onAction?: () => void;
};

type PrimaryAction =
  | { label: string; kind: "start" }
  | { label: string; kind: "retry" }
  | null;

function primaryActionFor(status: ResearchRunStatus): PrimaryAction {
  if (status === "draft") return { label: "开始研究", kind: "start" };
  if (status === "failed_recoverable") return { label: "重试", kind: "retry" };
  if (status === "paused_budget") return { label: "恢复", kind: "retry" };
  return null;
}

/** 取消 / 恢复（开始）控件：终态禁用继续操作。 */
export function CancelResumeControls({ runId, status, revision, onAction }: CancelResumeControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminal = isTerminalStatus(status);
  const primary = primaryActionFor(status);

  async function runAction(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
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

  function handleCancel() {
    void runAction(() => cancelRun(runId, revision));
  }

  function handlePrimary() {
    if (!primary) return;
    if (primary.kind === "start") {
      void runAction(() => startRun(runId, revision));
    } else {
      void runAction(() => resumeRun(runId, revision, { kind: "retry" }));
    }
  }

  if (terminal) {
    return (
      <section data-testid="cancel-resume-controls" data-terminal="true" className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-500">该运行已结束，不能继续操作。</p>
      </section>
    );
  }

  const buttonClass = "inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition disabled:opacity-50";

  return (
    <section data-testid="cancel-resume-controls" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {primary ? (
          <button type="button" disabled={busy} onClick={handlePrimary} data-testid="primary-action"
            className={buttonClass + " border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100"}>
            {primary.label}
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={handleCancel} data-testid="cancel-run-button"
          className={buttonClass + " border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}>
          取消运行
        </button>
      </div>
      {error ? <p data-testid="cancel-resume-error" className="mt-2 text-xs font-semibold text-rose-700" role="alert">{error}</p> : null}
    </section>
  );
}
