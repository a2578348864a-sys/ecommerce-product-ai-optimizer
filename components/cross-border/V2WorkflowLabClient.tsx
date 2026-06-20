"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  useAccessPassword,
  canRequestWithAccessPassword,
} from "@/lib/client/accessPassword";

/* ── Types ──────────────────────────────────────── */

type StoredCandidate = {
  name: string;
  score: number;
  level?: string;
  levelLabel?: string;
  displayRiskLevel?: string;
  reasons?: string[];
  risks?: string[];
  nextAction?: string;
  sourcingSummary?: string;
  riskSummary?: string;
  summaryVerdict?: string;
  status?: string;
};

type LoadState =
  | { type: "loading" }
  | { type: "no_password" }
  | { type: "password_expired" }
  | { type: "unauthorized" }
  | { type: "error"; message: string }
  | { type: "empty" }
  | {
      type: "ready";
      candidates: StoredCandidate[];
      taskTitle: string;
    };

type WorkflowStep = {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
  summary: string;
  riskNote: string;
};

/* ── Helpers ────────────────────────────────────── */

function safeString(v: unknown, fallback = "暂无该项数据"): string {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return fallback;
}

function safeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return [];
}

function buildSteps(c: StoredCandidate | null): WorkflowStep[] {
  if (!c) {
    return [
      { id: "sourcing", label: "货源确认", status: "pending", summary: "请选择一个候选品。", riskNote: "" },
      { id: "risk", label: "风险排查", status: "pending", summary: "", riskNote: "" },
      { id: "profitCompliance", label: "利润与合规粗判", status: "pending", summary: "", riskNote: "" },
      { id: "conclusion", label: "小白结论与下一步", status: "pending", summary: "", riskNote: "" },
    ];
  }

  const sourcingOk = safeString(c.sourcingSummary, "") !== "暂无该项数据" && safeString(c.sourcingSummary, "").length > 0;
  const riskOk = safeString(c.riskSummary, "") !== "暂无该项数据" && safeString(c.riskSummary, "").length > 0;
  const verdictOk = safeString(c.summaryVerdict, "") !== "暂无该项数据" && safeString(c.summaryVerdict, "").length > 0;

  const allOk = sourcingOk && riskOk && verdictOk;

  return [
    {
      id: "sourcing",
      label: "货源确认",
      status: sourcingOk ? "done" : "active",
      summary: sourcingOk
        ? safeString(c.sourcingSummary)
        : "暂无货源分析数据。此数据来自已有的机会雷达分析结果。（当前为 mock 从已有 tasks 读取）",
      riskNote: "",
    },
    {
      id: "risk",
      label: "风险排查",
      status: riskOk ? "done" : sourcingOk ? "active" : "pending",
      summary: riskOk
        ? safeString(c.riskSummary)
        : "暂无风险分析数据。",
      riskNote: c.displayRiskLevel
        ? `展示风险等级：${c.displayRiskLevel}（来自已有机会雷达记录）`
        : "",
    },
    {
      id: "profitCompliance",
      label: "利润与合规粗判",
      status: allOk ? "done" : verdictOk ? "active" : "pending",
      summary: `推荐等级：${safeString(c.levelLabel, safeString(c.level, "未评级"))}，综合评分 ${typeof c.score === "number" ? c.score : "?"}/100。`,
      riskNote: "利润为参考估算，真实选品需人工复核采购成本、运费和平台费率。合规结论基于品类通用判断。",
    },
    {
      id: "conclusion",
      label: "小白结论与下一步",
      status: verdictOk ? "done" : "pending",
      summary: verdictOk
        ? `${safeString(c.summaryVerdict)}。${safeString(c.nextAction, "")}`
        : "暂无综合结论。（当前为 mock 从已有 tasks 读取）",
      riskNote: "本结论基于 AI 分析 + 已有机会雷达数据，不是最终采购建议。所有关键动作必须人工确认。系统不会自动采购、自动上架或自动投广告。",
    },
  ];
}

/* ── Sub-components ─────────────────────────────── */

function StepBadge({ status }: { status: WorkflowStep["status"] }) {
  const map = {
    done: "bg-green-50 text-green-700 border-green-200",
    active: "bg-blue-50 text-blue-700 border-blue-200",
    pending: "bg-gray-50 text-gray-400 border-gray-200",
  };
  const label = { done: "已完成", active: "分析中", pending: "待分析" };
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}

function StepIcon({ status }: { status: WorkflowStep["status"] }) {
  if (status === "done") {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
        ✓
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
        →
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs text-gray-400">
      ○
    </span>
  );
}

function StepCard({
  step,
  isLast,
  confirmed,
  onToggle,
}: {
  step: WorkflowStep;
  isLast: boolean;
  confirmed: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="relative flex gap-3">
      {!isLast && (
        <div
          className={`absolute left-[9px] top-5 h-full w-0.5 ${
            step.status === "done" ? "bg-green-200" : "bg-gray-200"
          }`}
        />
      )}
      <div className="mt-1 shrink-0">
        <StepIcon status={step.status} />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className={`text-sm font-semibold ${step.status === "pending" ? "text-gray-400" : "text-gray-800"}`}>
            {step.label}
          </span>
          <StepBadge status={step.status} />
        </div>

        <p className={`mb-2 text-xs leading-relaxed ${step.status === "pending" ? "text-gray-300" : "text-gray-600"}`}>
          {step.summary}
        </p>

        {step.riskNote && (
          <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-700">
            ⚠ {step.riskNote}
          </p>
        )}

        <label
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition ${
            confirmed
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-gray-200 bg-white text-gray-600 cursor-pointer hover:border-blue-300"
          }`}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={onToggle}
            className="h-3.5 w-3.5 rounded"
          />
          {confirmed ? "已确认" : "人工确认"}
        </label>
      </div>
    </li>
  );
}

/* ── Main component ──────────────────────────────── */

export default function V2WorkflowLabClient() {
  const [accessPassword, , isAccessPasswordReady] = useAccessPassword();
  const [loadState, setLoadState] = useState<LoadState>({ type: "loading" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmedSet, setConfirmedSet] = useState<Set<string>>(new Set());

  // Fetch latest opportunities task
  const fetchData = useCallback(async () => {
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      if (!isAccessPasswordReady) {
        setLoadState({ type: "loading" });
      } else if (!accessPassword.trim()) {
        setLoadState({ type: "no_password" });
      } else {
        setLoadState({ type: "password_expired" });
      }
      return;
    }

    setLoadState({ type: "loading" });

    try {
      const params = new URLSearchParams({ type: "opportunities", limit: "1" });
      const resp = await fetch(`/api/tasks?${params.toString()}`, {
        headers: { "x-access-password": accessPassword },
      });

      if (resp.status === 401) {
        setLoadState({ type: "unauthorized" });
        return;
      }

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setLoadState({ type: "error", message: (body as { error?: { message?: string } }).error?.message || `请求失败 (${resp.status})` });
        return;
      }

      const json = await resp.json();
      const items: Array<Record<string, unknown>> =
        json?.data?.items ?? json?.records ?? [];

      if (!Array.isArray(items) || items.length === 0) {
        setLoadState({ type: "empty" });
        return;
      }

      const latest = items[0];
      const result = latest.result as Record<string, unknown> | undefined;
      const rawCandidates = result?.candidates;

      if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
        setLoadState({ type: "empty" });
        return;
      }

      const candidates: StoredCandidate[] = rawCandidates.map((c: unknown) => {
        const item = c as Record<string, unknown>;
        return {
          name: safeString(item.name, "未命名商品"),
          score: typeof item.score === "number" ? item.score : 0,
          level: safeString(item.level, ""),
          levelLabel: safeString(item.levelLabel, ""),
          displayRiskLevel: safeString(item.displayRiskLevel, ""),
          reasons: safeArray(item.reasons),
          risks: safeArray(item.risks),
          nextAction: safeString(item.nextAction, ""),
          sourcingSummary: safeString(item.sourcingSummary, ""),
          riskSummary: safeString(item.riskSummary, ""),
          summaryVerdict: safeString(item.summaryVerdict, ""),
          status: safeString(item.status, ""),
        };
      });

      setLoadState({
        type: "ready",
        candidates,
        taskTitle: safeString(latest.title, `机会雷达 · ${candidates.length} 个候选品`),
      });
    } catch {
      setLoadState({ type: "error", message: "网络请求失败，请检查连接后重试。" });
    }
  }, [accessPassword, isAccessPasswordReady]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset confirmations when candidate selection changes
  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
    setConfirmedSet(new Set());
  }, []);

  const toggleConfirm = useCallback((stepId: string) => {
    setConfirmedSet((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }, []);

  // Derived data
  const selectedCandidate =
    loadState.type === "ready" ? loadState.candidates[selectedIndex] ?? null : null;
  const steps = useMemo(() => buildSteps(selectedCandidate), [selectedCandidate]);
  const stepIds = useMemo(() => steps.map((s) => s.id), [steps]);
  const confirmedCount = useMemo(
    () => stepIds.filter((id) => confirmedSet.has(id)).length,
    [stepIds, confirmedSet],
  );
  const allConfirmed = confirmedCount === stepIds.length;

  /* ── Render ──────────────────────────────────── */

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* ⚠️ Sandbox banner */}
      <div className="mb-6 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-800">
          ⚠️ V2 工作流沙盒 — Phase 1B 只读已有机会雷达记录
        </p>
        <p className="mt-1 text-xs text-amber-700">
          当前只读已有 opportunities 任务记录，不调用新 AI，不保存任务。
          所有数据来自已完成的 AI 分析。<strong> 不会自动采购、自动发布、自动投广告。</strong>
        </p>
      </div>

      {/* Loading */}
      {loadState.type === "loading" && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-gray-400">正在读取访问状态…</p>
        </div>
      )}

      {/* No password */}
      {loadState.type === "no_password" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-10 text-center">
          <p className="text-sm font-medium text-amber-800">请先回首页输入访问密码</p>
          <p className="mt-1 text-xs text-amber-600">
            访问密码用于读取已有机会雷达任务记录。请返回首页输入密码后再访问此页面。
          </p>
        </div>
      )}

      {/* Password expired */}
      {loadState.type === "password_expired" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-10 text-center">
          <p className="text-sm font-medium text-amber-800">访问密码已过期</p>
          <p className="mt-1 text-xs text-amber-600">请返回首页重新输入访问密码。</p>
        </div>
      )}

      {/* Unauthorized */}
      {loadState.type === "unauthorized" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center">
          <p className="text-sm font-medium text-red-800">访问密码无效或已过期</p>
          <p className="mt-1 text-xs text-red-600">请返回首页重新输入正确的访问密码。</p>
        </div>
      )}

      {/* API error */}
      {loadState.type === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center">
          <p className="text-sm font-medium text-red-800">数据加载失败</p>
          <p className="mt-1 text-xs text-red-600">{loadState.message}</p>
        </div>
      )}

      {/* Empty */}
      {loadState.type === "empty" && (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-600">暂无机会雷达记录</p>
          <p className="mt-1 text-xs text-gray-400">
            请先在{" "}
            <a href="/opportunities" className="text-blue-600 underline">
              /opportunities
            </a>{" "}
            完成一次分析，再回到此页面查看。
          </p>
        </div>
      )}

      {/* Ready — two-column layout */}
      {loadState.type === "ready" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: candidates */}
          <aside className="lg:col-span-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-1 text-sm font-semibold text-gray-700">
                候选商品
              </h2>
              <p className="mb-3 text-[11px] text-gray-400">
                来自已有机会雷达记录 · {loadState.taskTitle}
              </p>
              <ul className="space-y-2">
                {loadState.candidates.map((c, i) => {
                  const isSelected = i === selectedIndex;
                  const riskColor =
                    c.displayRiskLevel === "red"
                      ? "text-red-600"
                      : c.displayRiskLevel === "yellow"
                        ? "text-amber-600"
                        : "text-green-600";

                  return (
                    <li key={`${c.name}-${i}`}>
                      <button
                        type="button"
                        onClick={() => handleSelect(i)}
                        className={`w-full rounded-md border px-3 py-2.5 text-left text-sm transition ${
                          isSelected
                            ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-800">
                            {c.name}
                          </span>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">
                            {c.score}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {c.levelLabel || c.level || "未评级"}
                        </div>
                        {c.displayRiskLevel && (
                          <div className={`mt-0.5 text-[11px] ${riskColor}`}>
                            风险：{c.displayRiskLevel}
                          </div>
                        )}
                        {isSelected && (
                          <div className="mt-1.5 text-[11px] font-medium text-blue-600">
                            ← 当前选中
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          {/* Right: workflow steps */}
          <section className="lg:col-span-8">
            <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">
                  工作流 · {selectedCandidate?.name ?? "—"}
                </h2>
                <span className="text-xs text-gray-500">
                  已确认 {confirmedCount}/{stepIds.length} 步
                </span>
              </div>

              <ol className="space-y-0">
                {steps.map((step, i) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    isLast={i === steps.length - 1}
                    confirmed={confirmedSet.has(step.id)}
                    onToggle={() => toggleConfirm(step.id)}
                  />
                ))}
              </ol>

              {/* Bottom action */}
              <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    💡 确认状态仅为本地演示
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {allConfirmed
                      ? "全部确认完成（本阶段不保存到任务中心）。"
                      : `请完成剩余 ${stepIds.length - confirmedCount} 步的人工确认。当前不会保存。`}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-gray-100 px-3 py-1.5 text-xs text-gray-400">
                  Phase 1D 才上线保存
                </span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
