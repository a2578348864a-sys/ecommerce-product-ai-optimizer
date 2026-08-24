"use client";

/**
 * Phase 5 — AI 证据总结区（ai-evidence-summary.v1 展示 + 生成）
 * 新手解释层（Novice Comprehension 五问）优先，专业条目随后。
 *
 * R2：四模块（businessModules）由服务端唯一生成（projectEvidenceSummaryBusiness），
 * 本组件只消费服务器返回的 businessModules prop，不实现任何模块归类逻辑；
 * 「查看依据」为真实按钮：定位到对应资料区（hash + scroll + focus），目标缺失时 fail-closed。
 */
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

export type AiSummaryItemView = {
  id: string;
  type: string;
  text: string;
  evidenceRefs: string[];
};

export type AiEvidenceSummaryView = {
  runId: string;
  model: string;
  gateResult: "pass" | "fail";
  evidenceRefCoverage: { total: number; withRefs: number };
  startedAt: string;
  finishedAt: string;
  summary: {
    facts: AiSummaryItemView[];
    estimates: AiSummaryItemView[];
    signals: AiSummaryItemView[];
    risks: AiSummaryItemView[];
    conflicts: AiSummaryItemView[];
    missing: AiSummaryItemView[];
    nextSteps: AiSummaryItemView[];
  };
  noviceExplanation: {
    whatWeKnow: string;
    whatWeDontKnow: string;
    biggestRisk: string;
    why: string;
    nextToResearch: string;
  };
  unverified: AiSummaryItemView[];
  updatedAt: string;
};

/** R4：服务端历史分类安全投影（仅 label + text） */
export type LegacyCategoryView = {
  key: string;
  label: string;
  items: Array<{ text: string }>;
};

/** R2：服务端投影视图（与服务端 SummaryModuleView 安全字段对齐；evidenceTarget 仅安全枚举） */
export type BusinessModuleView = {
  key: "market" | "buyers" | "sourcing" | "costRisk";
  title: string;
  conclusion: Array<{ text: string; refCount: number; evidenceTarget: "market" | "buyer" | "sourcing" | "costRisk" }>;
  missing: Array<{ text: string }>;
  next: Array<{ text: string }>;
};

/** R2：evidenceTarget → 资料区 DOM id（安全枚举，无自由字符串） */
const EVIDENCE_TARGET_IDS: Record<"market" | "buyer" | "sourcing" | "costRisk", string> = {
  market: "formal-v2-market-evidence",
  buyer: "formal-v2-buyer-evidence",
  sourcing: "formal-v2-sourcing-evidence",
  costRisk: "formal-v2-cost-risk-evidence",
};

function buildFetchHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...buildAccessHeaders(), ...extra });
}


export function AiEvidenceSummarySection({
  taskId,
  summary,
  businessModules,
  legacyCategories,
  storageVersion,
  onChanged,
}: {
  taskId: string;
  /** R5：安全状态：是否已生成摘要（由服务端 hasSummary 驱动；不再读取原始 summary 对象） */
  summary: boolean;
  /** R2：服务端投影结果（唯一来源）；null 时按无结论处理 */
  businessModules: BusinessModuleView[] | null;
  /** R4：历史分类安全投影（默认关闭折叠区） */
  legacyCategories: LegacyCategoryView[] | null;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // R2：查看依据 fail-closed 提示（点击目标不存在时）
  const [openEvError, setOpenEvError] = useState<{ target: string; message: string } | null>(null);
  // R2：aria-expanded 语义（已成功定位的资料区）
  const [revealedTargets, setRevealedTargets] = useState<Set<string>>(new Set());

  async function handleGenerate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/ai-evidence-summary`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expectedStorageVersion: storageVersion }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = await res.json() as
        | { ok: true }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        const code = (json as { error?: { code?: string } }).error?.code ?? "";
        if (code === "task_result_conflict") {
          setError("任务内容刚在其他位置更新，已自动刷新最新版本，请再次点击生成。");
          onChanged();
          return;
        }
        setError((json as { error?: { message?: string } }).error?.message ?? "生成失败。");
        return;
      }
      onChanged();
    } catch {
      setError("生成失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  /** R2：查看依据——真实定位（hash + scroll + focus + 展开祖先 details），失败则 fail-closed */
  function handleOpenEvidence(evidenceTarget: "market" | "buyer" | "sourcing" | "costRisk") {
    const targetId = EVIDENCE_TARGET_IDS[evidenceTarget];
    if (!targetId || typeof document === "undefined") {
      setOpenEvError({ target: targetId ?? evidenceTarget, message: "对应资料区暂时无法打开" });
      return;
    }
    const target = document.getElementById(targetId);
    if (!target) {
      // fail-closed：不报成功、不跳转、不误定位
      setOpenEvError({ target: targetId, message: "对应资料区暂时无法打开" });
      return;
    }
    setOpenEvError(null);
    // 展开必要祖先 details（避免目标被折叠容器挡住）
    let cursor: Element | null = (target as unknown as Element).parentElement ?? null;
    while (cursor) {
      const tag = String((cursor as unknown as { tagName?: string }).tagName ?? "");
      if (tag.toUpperCase() === "DETAILS") {
        (cursor as unknown as { open?: boolean }).open = true;
      }
      cursor = (cursor as unknown as Element).parentElement ?? null;
    }
    setRevealedTargets((current) => {
      const next = new Set(current);
      next.add(targetId);
      return next;
    });
    // 更新 hash（history 不产生额外导航）
    try {
      if (typeof window !== "undefined" && window.location) {
        window.location.hash = "#" + targetId;
      }
    } catch {
      // hash 设置失败不阻断定位
    }
    // 滚动 + 聚焦（优先级：目标内首个可填写控件 → 目标自身；tabindex 兜底）
    try {
      const focusable = target as unknown as {
        scrollIntoView: () => void;
        focus: (opts?: { preventScroll?: boolean }) => void;
        getAttribute: (name: string) => string | null;
        setAttribute: (name: string, value: string) => void;
        querySelector?: (selector: string) => unknown;
      };
      focusable.scrollIntoView();
      // 目标内首个可聚焦交互控件（input/select/textarea/button）
      let focusTarget: unknown = target;
      if (typeof focusable.querySelector === "function") {
        const firstControl = focusable.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])") as
          | { focus: (opts?: { preventScroll?: boolean }) => void; getAttribute: (n: string) => string | null; setAttribute: (n: string, v: string) => void }
          | null;
        if (firstControl) focusTarget = firstControl;
      }
      const ft = focusTarget as { focus: (opts?: { preventScroll?: boolean }) => void; getAttribute: (n: string) => string | null; setAttribute: (n: string, v: string) => void };
      if (ft.getAttribute("tabindex") === null && focusTarget !== target) {
        // 交互控件本身可聚焦，无需额外 tabindex
      } else if (ft.getAttribute("tabindex") === null) {
        (target as unknown as { setAttribute: (n: string, v: string) => void }).setAttribute("tabindex", "-1");
      }
      ft.focus({ preventScroll: true });
    } catch {
      // 滚动/聚焦失败不报错（页面仍可用）
    }
  }

  const modules = businessModules;
  const hasContent = summary || (modules ?? []).length > 0;
  return (
    <div className="mt-3 space-y-3" data-testid="ai-evidence-summary">
      {summary ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-xs text-slate-600">
          已基于采集证据生成研究摘要；未取得信息已如实标注。
        </p>
      ) : null}
      {hasContent ? (
        <>
          {/* R2：四模块研究结论（服务端 businessModules；无依据→缺口；独立于新手层展示） */}
          {(modules ?? []).map((module) => (
            <div key={module.key} data-testid={"summary-module-" + module.key} className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-sm font-bold text-slate-900">{module.title}</p>
              {module.conclusion.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {module.conclusion.map((item, index) => (
                    <li key={index} className="flex items-start justify-between gap-2 text-sm text-slate-700">
                      <span>{item.text}</span>
                      <button
                        type="button"
                        aria-controls={EVIDENCE_TARGET_IDS[item.evidenceTarget] ?? ""}
                        aria-expanded={revealedTargets.has(EVIDENCE_TARGET_IDS[item.evidenceTarget] ?? "")}
                        onClick={() => handleOpenEvidence(item.evidenceTarget)}
                        className="shrink-0 text-[11px] font-semibold text-teal-700 hover:underline"
                        data-testid={"view-evidence-" + module.key + "-" + index}
                      >
                        查看依据（{item.refCount} 条）
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-slate-500">AI 结论尚未生成。</p>
              )}
              {module.missing.length > 0 ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2">
                  <p className="text-xs font-semibold text-amber-800">还缺什么</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-amber-800">
                    {module.missing.map((item, index) => <li key={index}>{item.text}</li>)}
                  </ul>
                </div>
              ) : null}
              {module.next.length > 0 ? (
                <p className="mt-2 text-xs font-semibold text-slate-500">下一步：{module.next.map((x) => x.text).join("；")}</p>
              ) : null}
            </div>
          ))}

          {openEvError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert" data-testid="view-evidence-fail-closed">
              {openEvError.message}
            </p>
          ) : null}

          {/* R2：历史扁平分类默认关闭（默认阅读流同一条内容只出现一次） */}
          <details className="rounded-xl border border-slate-200 bg-white p-3" data-testid="legacy-category-details">
            <summary className="cursor-pointer text-xs font-bold text-slate-600 hover:text-slate-900">查看历史分类详情</summary>
            <div className="mt-2 space-y-2">
              {(legacyCategories ?? []).map((category) => (
                <div key={category.key}>
                  <p className="text-xs font-bold text-slate-600">{category.label}（{category.items.length}）</p>
                  <ul className="mt-1 space-y-1">
                    {category.items.map((item, index) => (
                      <li key={index} className="text-sm text-slate-700"><span>{item.text}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>

          {/* 安全说明（仅摘要存在时；不恢复原始 gateResult/内部字段） */}
          {summary ? (
            <p className="text-[11px] text-slate-400">
              结论基于已采集证据整理；未取得信息已如实标注。
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGenerate()}
            className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            <Sparkles className="size-4" />重新生成
          </button>
          {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
          <p className="text-sm text-slate-600">
            尚未生成 AI 研究摘要。基于当前已有资料生成（非最终结论），收集更多资料后可重新生成。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGenerate()}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? "生成中…" : "生成 AI 研究摘要"}
          </button>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
