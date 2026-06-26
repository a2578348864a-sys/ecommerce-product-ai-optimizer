"use client";

import Link from "next/link";
import { ConfidenceConfirmationCard } from "@/components/ConfidenceConfirmationCard";
import { useCallback, useEffect, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { useSharedProduct } from "@/hooks/useSharedProduct";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { WorkspaceLockedPrompt } from "@/components/WorkspaceLockedPrompt";

type SummaryData = {
  verdict: string;
  confidence: string;
  summary: string;
  reasons: string[];
  risks: string[];
  nextSteps: string[];
  beginnerTip: string;
  /** 硬规则是否触发了降级 */
  downgraded?: boolean;
  /** 降级原因 */
  downgradeReasons?: string[];
};

type AggregateResponse =
  | { ok: true; data: AggregateResult }
  | { ok: false; error: { code: string; message: string } };

type AggregateResult = {
  productName: string;
  found: boolean;
  sourcing: Record<string, unknown> | null;
  risk: Record<string, unknown> | null;
  product: Record<string, unknown> | null;
  viral: Record<string, unknown> | null;
  material: Record<string, unknown> | null;
};

type ApiResponse =
  | { ok: true; data: SummaryData }
  | { ok: false; error: { code: string; message: string } };

type SummaryDraft = {
  result: SummaryData | null;
  aggregate: AggregateResult | null;
};

const verdictClasses: Record<string, string> = {
  "新手可小单测试": "border-emerald-300 bg-emerald-50 text-emerald-800",
  "可做但需控制成本": "border-teal-200 bg-teal-50 text-teal-700",
  "有经验再做": "border-amber-300 bg-amber-50 text-amber-800",
  "新手不建议做": "border-orange-300 bg-orange-50 text-orange-800",
  "暂不建议做": "border-red-300 bg-red-50 text-red-800",
};

const confidenceLabels: Record<string, string> = {
  "高": "把握较高",
  "中": "有一定把握",
  "低": "信息不足",
};

function isApiResponse(value: unknown): value is ApiResponse {
  return typeof value === "object" && value !== null && "ok" in value;
}

function isAggregateResponse(value: unknown): value is AggregateResponse {
  return typeof value === "object" && value !== null && "ok" in value;
}

const typeLabels: Record<string, string> = {
  sourcing: "货源判断",
  risk: "风险排查",
  product: "选品体检",
  viral: "爆款拆解",
  material: "素材接收",
};

export function SummaryForm() {
  const [sharedProduct] = useSharedProduct();
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const unlocked = isAccessPasswordReady && accessPassword.trim().length > 0;
  const { draftValue, setDraftValue, clearDraft, restored } = useLocalDraft<SummaryDraft>({
    storageKey: "qx:draft:summary:v1",
    initialValue: {
      result: null,
      aggregate: null,
    },
  });
  const { result, aggregate } = draftValue;
  const setResult = useCallback((value: SummaryData | null) => {
    setDraftValue((current) => ({ ...current, result: value }));
  }, [setDraftValue]);
  const setAggregate = useCallback((value: AggregateResult | null) => {
    setDraftValue((current) => ({ ...current, aggregate: value }));
  }, [setDraftValue]);
  const [loading, setLoading] = useState(false);
  const [loadingAggregate, setLoadingAggregate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingToTasks, setSavingToTasks] = useState(false);
  const [tasksSaveMessage, setTasksSaveMessage] = useState<string | null>(null);

  // Auto-fetch aggregate data when product name is available
  useEffect(() => {
    if (!sharedProduct.productName) {
      setAggregate(null);
      return;
    }

    if (!isAccessPasswordReady) {
      setLoadingAggregate(true);
      setError(null);
      return;
    }

    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setAggregate(null);
      setLoadingAggregate(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoadingAggregate(true);
    setError(null);

    fetch(`/api/tasks/aggregate?productName=${encodeURIComponent(sharedProduct.productName)}`, {
      headers: { ...buildAccessHeaders() },
    })
      .then((res) => res.json())
      .then((payload: unknown) => {
        if (cancelled) return;
        if (isAggregateResponse(payload) && payload.ok) {
          setAggregate(payload.data);
        }
      })
      .catch(() => {
        if (!cancelled) setError("获取分析记录失败，请检查网络。");
      })
      .finally(() => {
        if (!cancelled) setLoadingAggregate(false);
      });

    return () => { cancelled = true; };
  }, [sharedProduct.productName, accessPassword, isAccessPasswordReady, setAggregate]);

  async function handleSubmit() {
    if (loading) return;

    if (!sharedProduct.productName) {
      setError("请先在任意工作流页面填写商品名称。");
      return;
    }

    if (!isAccessPasswordReady) {
      setError("正在读取访问状态，请稍后再试。");
      return;
    }

    if (!accessPassword.trim()) {
      setError("访问密码缺失或已过期，请先在首页输入访问密码。");
      return;
    }

    if (!aggregate?.found) {
      setError("未找到该商品的分析记录。请先完成至少一项分析（货源判断/风险排查/选品体检/爆款拆解）。");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Build findings text from aggregate
      const findings: string[] = [];
      for (const key of ["sourcing", "risk", "product", "viral"] as const) {
        const item = aggregate[key];
        if (item) {
          const label = typeLabels[key];
          const summary = typeof item.oneLineSummary === "string" ? item.oneLineSummary : "";
          const score = typeof item.score === "number" ? ` (评分: ${item.score})` : "";
          findings.push(`【${label}】${summary}${score}`);
        }
      }

      const response = await fetch("/api/agents/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          productName: sharedProduct.productName,
          sourcingFindings: aggregate.sourcing ? JSON.stringify(aggregate.sourcing) : "",
          riskFindings: aggregate.risk ? JSON.stringify(aggregate.risk) : "",
          productFindings: aggregate.product ? JSON.stringify(aggregate.product) : "",
          viralFindings: aggregate.viral ? JSON.stringify(aggregate.viral) : "",
          extraNotes: "",
          accessPassword: accessPassword.trim(),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!isApiResponse(payload)) {
        setError("服务端返回格式异常。");
        return;
      }

      if (payload.ok) {
        setResult(payload.data);
        return;
      }

      if (response.status === 401 || response.status === 403) {
        setError("访问密码不正确，请重新输入。");
        return;
      }

      setError(payload.error.message || "AI 请求失败，请稍后重试。");
    } catch {
      setError("AI 请求失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveToTaskCenter() {
    if (savingToTasks || !result) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setTasksSaveMessage("请先输入访问密码后保存到任务中心。");
      return;
    }

    setSavingToTasks(true);
    setTasksSaveMessage(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          accessPassword,
          type: "summary",
          title: sharedProduct.productName,
          platform: sharedProduct.targetPlatform || "manual",
          source: "ai",
          materialText: sharedProduct.description || sharedProduct.productName,
          result: {
            oneLineSummary: result.summary,
            level: result.verdict === "新手可小单测试" ? "high" : result.verdict === "可做但需控制成本" ? "high" : result.verdict === "有经验再做" ? "medium" : result.verdict === "新手不建议做" ? "low" : "low",
            score: result.verdict === "新手可小单测试" ? 85 : result.verdict === "可做但需控制成本" ? 70 : result.verdict === "有经验再做" ? 50 : result.verdict === "新手不建议做" ? 30 : 15,
            confidence: result.confidence,
            verdict: result.verdict,
            reasons: result.reasons,
            risks: result.risks,
            nextSteps: result.nextSteps,
            beginnerTip: result.beginnerTip,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (payload?.ok) {
        setTasksSaveMessage("已保存到任务中心。");
      } else {
        setTasksSaveMessage("保存失败，请稍后重试。");
      }
    } catch {
      setTasksSaveMessage("保存失败，请稍后重试。");
    } finally {
      setSavingToTasks(false);
    }
  }

  const hasResult = Boolean(result);
  const foundTypes = aggregate
    ? (["sourcing", "risk", "product", "viral", "material"] as const).filter((k) => aggregate[k])
    : [];

  function clearCurrentDraft() {
    clearDraft();
    setError(null);
    setTasksSaveMessage(null);
  }

  if (!unlocked) {
    return <WorkspaceLockedPrompt pageName="小白结论" returnUrl="/summary" />;
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-6">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">Qingxuan Workspace</p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">小白结论</h1>
              <p className="muted-text mt-1 text-sm">
                自动拉取前面各步骤的分析结果，AI 用大白话告诉你这个品能不能做。
              </p>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* Current product status */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-950">当前选品</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                系统自动从你已经完成的分析中拉取结果。
              </p>
              {restored ? (
                <p className="mt-2 text-xs font-semibold text-teal-700">已恢复上次未完成内容</p>
              ) : null}
            </div>

            {!sharedProduct.productName ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">尚未设置选品</p>
                <p className="mt-1 text-sm text-amber-700">
                  请先在工作流任意页面（货源判断 / 风险排查 / 选品体检）填写商品名称。填写后系统会自动记住，回到本页即可使用。
                </p>
                <Link
                  href="/sourcing"
                  className="glass-button-primary mt-3 inline-flex h-9 items-center justify-center px-4 text-sm font-semibold"
                >
                  去货源判断 →
                </Link>
              </div>
            ) : loadingAggregate ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-500">正在检查「{sharedProduct.productName}」的分析记录...</p>
              </div>
            ) : aggregate?.found ? (
              <div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-bold text-emerald-900">
                    已找到「{sharedProduct.productName}」的 {foundTypes.length} 项分析结果
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {foundTypes.map((k) => (
                      <span key={k} className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-700">
                        {typeLabels[k]}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Found items detail */}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {foundTypes.map((k) => {
                    const item = aggregate[k];
                    if (!item) return null;
                    const summary = typeof item.oneLineSummary === "string" ? item.oneLineSummary : "";
                    const score = typeof item.score === "number" ? item.score : null;
                    return (
                      <div key={k} className="surface-card-soft rounded-[18px] p-3">
                        <p className="text-xs font-semibold text-slate-500">{typeLabels[k]}</p>
                        <p className="mt-1 text-sm leading-5 text-slate-700 line-clamp-2">{summary}</p>
                        {score !== null ? (
                          <span className="mt-1 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-700">
                            {score}/100
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4">
                  {/* Access password — removed from this page, now only on home */}
                </div>

                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={loading}
                    className="glass-button-primary inline-flex h-11 items-center justify-center px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "AI 分析中..." : hasResult ? "重新生成" : "生成小白结论"}
                  </button>
                  <button
                    type="button"
                    onClick={clearCurrentDraft}
                    className="glass-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                  >
                    清空当前内容
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">尚未找到分析记录</p>
                <p className="mt-1 text-sm text-amber-700">
                  产品名「{sharedProduct.productName}」还没有保存的分析结果。请先在货源判断、风险排查、选品体检或爆款拆解页面完成分析并点击【保存到任务中心】。
                </p>
              </div>
            )}
          </section>

          {!result ? (
            <ConfidenceConfirmationCard
              confidence="低"
              assumptions={[
                "当前尚未生成小白汇总结论，可信度先按低处理。",
                "AI 基于当前输入信息判断，信息越少越保守。",
                "平台规则、认证要求、供应商报价和物流成本需要人工复查。",
              ]}
              confirmations={[
                "是否涉及认证、侵权、儿童用品、食品接触、带电、带磁。",
                "供应商资质、真实报价、起订量和发货稳定性。",
                "目标平台最新规则和 listing 可用表达。",
              ]}
            />
          ) : null}

          {/* Error */}
          {error ? (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </section>
          ) : null}

          {/* Loading */}
          {loading ? (
            <section className="surface-card rounded-[28px] p-5">
              <p className="text-sm text-slate-500">AI 正在汇总分析，请稍等...</p>
            </section>
          ) : null}

          {/* Results */}
          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">小白结论</h2>
                  <p className="mt-1 text-sm text-slate-500">AI 汇总分析，基于已有的 {foundTypes.length} 项结果。</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex shrink-0 rounded-full border px-4 py-1.5 text-sm font-bold ${verdictClasses[result.verdict] || verdictClasses["可做但需控制成本"]}`}>
                    {result.verdict}
                  </span>
                  <span className="text-xs text-slate-400">
                    {confidenceLabels[result.confidence] || result.confidence}
                  </span>
                </div>
              </div>

              <div className="mb-5">
                <ConfidenceConfirmationCard
                  confidence={result.confidence}
                  assumptions={[
                    `当前汇总基于已保存的 ${foundTypes.length} 项分析结果。`,
                    "AI 基于当前输入信息判断，信息越少越保守。",
                    "平台规则、认证要求、供应商报价和物流成本需要人工复查。",
                  ]}
                  confirmations={[
                    "是否涉及认证、侵权、儿童用品、食品接触、带电、带磁。",
                    "供应商资质、真实报价、起订量和发货稳定性。",
                    "目标平台最新规则和 listing 可用表达。",
                  ]}
                />
              </div>

              {/* 硬规则降级提示 */}
              {result.downgraded && result.downgradeReasons?.length ? (
                <div className="mb-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
                  <p className="text-sm font-bold text-orange-900">
                    ⚠️ 安全规则已介入：AI 原始结论被降级
                  </p>
                  <ul className="mt-2 space-y-1">
                    {result.downgradeReasons.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-orange-800">
                        <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-orange-500" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-orange-600">
                    以上结论基于安全规则自动调整，AI 原始分析原因已保留，但最终判断以安全规则为准。
                  </p>
                </div>
              ) : null}

              <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">一句话结论</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{result.summary}</p>
              </div>

              {result.reasons.length ? (
                <div className="mb-5">
                  <p className="text-sm font-bold text-slate-950">为什么</p>
                  <ul className="mt-2 space-y-2">
                    {result.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                        <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-teal-500" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.nextSteps.length ? (
                <div className="mb-5 rounded-xl border border-teal-200 bg-teal-50 p-4">
                  <p className="text-sm font-bold text-teal-900">下一步做什么</p>
                  <ul className="mt-2 space-y-1.5">
                    {result.nextSteps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-teal-800">
                        <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-teal-500" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.risks.length ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">别忘了人工复核</p>
                  <ul className="mt-2 space-y-1">
                    {result.risks.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-6 text-amber-800">
                        <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-amber-500" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                <p className="text-xs font-semibold text-indigo-500">给小白的一句话</p>
                <p className="mt-1 text-sm leading-6 text-indigo-800">{result.beginnerTip}</p>
              </div>
            </section>
          ) : null}

          {/* 工作流建议与人工确认 */}
          {result ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <WorkflowNextStepCard taskType="summary" />
              <ManualReviewChecklist />
            </div>
          ) : null}

          {/* Save */}
          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-600">保存分析结果</p>
                  <p className="mt-1 text-sm text-slate-500">将小白结论保存到任务中心。</p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveToTaskCenter}
                  disabled={savingToTasks}
                  className="glass-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingToTasks ? "保存中" : "保存到任务中心"}
                </button>
              </div>
              {tasksSaveMessage ? (
                <p className={`mt-3 rounded-lg border px-3 py-1.5 text-xs ${tasksSaveMessage.includes("失败") ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                  {tasksSaveMessage}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* 下一步 */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-600">分析完成 → 下一步</p>
                <p className="mt-1 text-sm text-slate-500">回顾所有分析记录，沉淀经验。</p>
              </div>
              <Link
                href="/tasks"
                className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
              >
                任务记录 → Step 5
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
