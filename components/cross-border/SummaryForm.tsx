"use client";

import Link from "next/link";
import { useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";

type SummaryData = {
  verdict: string;
  confidence: string;
  summary: string;
  reasons: string[];
  risks: string[];
  nextSteps: string[];
  beginnerTip: string;
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

export function SummaryForm() {
  const [productName, setProductName] = useState("");
  const [sourcingFindings, setSourcingFindings] = useState("");
  const [riskFindings, setRiskFindings] = useState("");
  const [productFindings, setProductFindings] = useState("");
  const [viralFindings, setViralFindings] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [result, setResult] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingToTasks, setSavingToTasks] = useState(false);
  const [tasksSaveMessage, setTasksSaveMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (loading) return;

    if (!productName.trim()) {
      setError("请先填写商品名称。");
      return;
    }

    if (!accessPassword.trim()) {
      setError("请输入访问密码。");
      return;
    }

    if (!sourcingFindings.trim() && !riskFindings.trim() && !productFindings.trim() && !viralFindings.trim()) {
      setError("请至少填写一项分析结果。");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/agents/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: productName.trim(),
          sourcingFindings: sourcingFindings.trim(),
          riskFindings: riskFindings.trim(),
          productFindings: productFindings.trim(),
          viralFindings: viralFindings.trim(),
          extraNotes: extraNotes.trim(),
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

  const hasResult = Boolean(result);

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
          title: productName.trim(),
          platform: "manual",
          source: "ai",
          materialText: [
            sourcingFindings.trim(),
            riskFindings.trim(),
            productFindings.trim(),
            viralFindings.trim(),
            extraNotes.trim(),
          ].filter(Boolean).join("\n\n") || productName.trim(),
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
                把前面几步的分析结果汇总，AI 用大白话告诉你这个品能不能做、为什么、下一步怎么试。
              </p>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* Form */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-950">汇总分析</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                把货源判断、风险排查、选品体检、爆款拆解的结果粘贴进来，AI 帮你做最终判断。
              </p>
            </div>

            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">商品名称 *</span>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="例如：硅胶折叠水杯"
                  className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Step 1 货源判断结果
                  </span>
                  <textarea
                    value={sourcingFindings}
                    onChange={(e) => setSourcingFindings(e.target.value)}
                    rows={4}
                    placeholder="粘贴货源判断页面的关键结论：能不能找到货、价格带、MOQ..."
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Step 2 风险排查结果
                  </span>
                  <textarea
                    value={riskFindings}
                    onChange={(e) => setRiskFindings(e.target.value)}
                    rows={4}
                    placeholder="粘贴风险排查页面的关键结论：有没有侵权风险、哪些坑要注意..."
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Step 3 选品体检结果
                  </span>
                  <textarea
                    value={productFindings}
                    onChange={(e) => setProductFindings(e.target.value)}
                    rows={4}
                    placeholder="粘贴选品体检页面的关键结论：利润空间、AI 分析评分、关键词..."
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Step 4 爆款拆解结果
                  </span>
                  <textarea
                    value={viralFindings}
                    onChange={(e) => setViralFindings(e.target.value)}
                    rows={4}
                    placeholder="粘贴爆款拆解页面的关键结论：卖点吸引力、内容可拍性、优化建议..."
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">补充说明</span>
                <textarea
                  value={extraNotes}
                  onChange={(e) => setExtraNotes(e.target.value)}
                  rows={2}
                  placeholder="其他你想告诉 AI 的信息..."
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">访问密码</span>
                <input
                  type="password"
                  value={accessPassword}
                  onChange={(e) => setAccessPassword(e.target.value)}
                  placeholder="输入服务端配置的访问密码"
                  className="h-11 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="glass-button-primary inline-flex h-11 items-center justify-center px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "分析中..." : hasResult ? "重新分析" : "生成小白结论"}
              </button>
            </div>
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

          {/* No result yet */}
          {!hasResult && !loading ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="max-w-2xl">
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  待汇总
                </span>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  填写商品名称，然后粘贴前面几步的分析结果。AI 会汇总成一句大白话结论。
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  如果你是按工作流 Step 1→5 走下来的，每步的结果页面都有一段总结文字，复制粘贴过来即可。
                </p>
              </div>
            </section>
          ) : null}

          {/* Results */}
          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">小白结论</h2>
                  <p className="mt-1 text-sm text-slate-500">AI 汇总分析，最终决策需人工复核。</p>
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

              {/* Summary */}
              <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">一句话结论</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{result.summary}</p>
              </div>

              {/* Reasons */}
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

              {/* Next steps */}
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

              {/* Risks */}
              {result.risks.length ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">⚠️ 别忘了人工复核</p>
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

              {/* Beginner tip */}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                <p className="text-xs font-semibold text-indigo-500">💡 小白提示</p>
                <p className="mt-1 text-sm leading-6 text-indigo-800">{result.beginnerTip}</p>
              </div>
            </section>
          ) : null}

          {/* Save to task center */}
          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-600">保存分析结果</p>
                  <p className="mt-1 text-sm text-slate-500">将小白结论保存到任务中心，方便后续回顾决策依据。</p>
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
