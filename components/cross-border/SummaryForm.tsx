"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useSharedProduct } from "@/hooks/useSharedProduct";

type SummaryData = {
  verdict: string;
  confidence: string;
  summary: string;
  reasons: string[];
  risks: string[];
  nextSteps: string[];
  beginnerTip: string;
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

const verdictClasses: Record<string, string> = {
  "可以做": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "谨慎做": "border-amber-200 bg-amber-50 text-amber-700",
  "不建议做": "border-red-200 bg-red-50 text-red-700",
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
  const [accessPassword, setAccessPassword] = useState("");
  const [result, setResult] = useState<SummaryData | null>(null);
  const [aggregate, setAggregate] = useState<AggregateResult | null>(null);
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

    let cancelled = false;
    setLoadingAggregate(true);
    setError(null);

    fetch(`/api/tasks/aggregate?productName=${encodeURIComponent(sharedProduct.productName)}`)
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
  }, [sharedProduct.productName]);

  async function handleSubmit() {
    if (loading) return;

    if (!sharedProduct.productName) {
      setError("请先在任意工作流页面填写商品名称。");
      return;
    }

    if (!accessPassword.trim()) {
      setError("请输入访问密码。");
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
        headers: { "Content-Type": "application/json" },
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

      setError(payload.error.message || "小白结论生成失败，请稍后重试。");
    } catch {
      setError("网络异常，请检查本地服务或网络。");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveToTaskCenter() {
    if (savingToTasks || !result) return;
    setSavingToTasks(true);
    setTasksSaveMessage(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "summary",
          title: sharedProduct.productName,
          platform: sharedProduct.targetPlatform || "manual",
          source: "ai",
          materialText: sharedProduct.description || sharedProduct.productName,
          result: {
            oneLineSummary: result.summary,
            level: result.verdict === "可以做" ? "高" : result.verdict === "谨慎做" ? "中" : "低",
            score: result.confidence === "高" ? 80 : result.confidence === "中" ? 50 : 20,
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

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">访问密码</span>
                  <input
                    type="password"
                    value={accessPassword}
                    onChange={(e) => setAccessPassword(e.target.value)}
                    placeholder="输入服务端配置的访问密码"
                    className="h-11 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={loading}
                    className="glass-button-primary inline-flex h-11 items-center justify-center px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? "AI 分析中..." : hasResult ? "重新生成" : "生成小白结论"}
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
                  <span className={`inline-flex shrink-0 rounded-full border px-4 py-1.5 text-sm font-bold ${verdictClasses[result.verdict] || verdictClasses["谨慎做"]}`}>
                    {result.verdict}
                  </span>
                  <span className="text-xs text-slate-400">
                    {confidenceLabels[result.confidence] || result.confidence}
                  </span>
                </div>
              </div>

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
