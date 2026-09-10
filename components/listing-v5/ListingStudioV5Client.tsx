"use client";

import { useCallback, useEffect, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

type V5Data = { context: { researchRevision: number; handoffRevision: number; factCount: number; referenceCounts: { voc: number; keywords: number; competitors: number; sourcing: number } }; snapshot: any };

export function ListingStudioV5Client({ taskId }: { taskId: string }) {
  const [data, setData] = useState<V5Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [confirmRealAi, setConfirmRealAi] = useState(false);
  const load = useCallback(async () => {
    if (!taskId) return;
    setError("");
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/listing-v5`, { cache: "no-store", headers: buildAccessHeaders() });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) { setError(json?.error?.message || "无法读取 Listing V5。"); return; }
    setData(json.data);
  }, [taskId]);
  useEffect(() => { void load(); }, [load]);
  const run = async (action: "analyze_strategy" | "generate") => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/listing-v5`, { method: "POST", headers: { "Content-Type": "application/json", ...buildAccessHeaders() }, body: JSON.stringify({ action, ...(confirmRealAi ? { confirmRealAi: true } : {}) }) });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) { setError(json?.error?.message || "操作失败，请刷新后重试。"); return; }
      await load();
    } catch { setError("网络异常，请稍后重试。"); } finally { setLoading(false); }
  };
  if (!taskId) return <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">请从研究任务进入 Listing Studio V5。</div>;
  const snapshot = data?.snapshot;
  const strategy = snapshot?.strategy;
  const listing = snapshot?.listing;
  const validation = snapshot?.validation;
  const provider = snapshot?.provider;
  const copyListing = async () => {
    if (!listing) return;
    const text = [listing.title?.text, ...(listing.bullets ?? []).map((item: any) => item.text), listing.description?.text, (listing.backendSearchTerms ?? []).join(", ")].filter(Boolean).join("\n\n");
    try {
      if (!navigator.clipboard) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(text);
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败，请手动选择文案");
    }
  };
  return <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 pb-12 pt-6 sm:px-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Research Ready Summary</p><h2 className="mt-1 text-xl font-semibold text-slate-900">已确认事实与研究资料</h2></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">V5 Preview · 待人工复核</span></div>{data ? <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-700 sm:grid-cols-5"><span>{data.context.factCount} confirmed facts</span><span>{data.context.referenceCounts.voc} VOC</span><span>{data.context.referenceCounts.keywords} keywords</span><span>{data.context.referenceCounts.competitors} competitors</span><span>{data.context.referenceCounts.sourcing} sourcing</span></div> : null}</section>
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">Marketing Strategy</p><h2 className="mt-1 text-xl font-semibold text-slate-900">营销文案策略</h2><p className="mt-1 text-sm text-slate-600">先确定对谁说、强调什么</p></div><button type="button" onClick={() => void run("analyze_strategy")} disabled={loading} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? "处理中…" : "重新分析"}</button></div><p className="mt-3 text-sm text-indigo-900">来自 VOC / 关键词 / 竞品研究，仅用于表达策略，不属于商品事实。</p><label className="mt-3 flex items-start gap-2 text-xs text-indigo-950"><input type="checkbox" checked={confirmRealAi} onChange={(event) => setConfirmRealAi(event.target.checked)} className="mt-0.5 size-4 rounded border-indigo-300" />确认本次可以调用已配置的真实 AI；未勾选时只使用安全回退。</label>{strategy ? <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><b>目标买家</b><p>{strategy.targetAudience?.join("、")}</p></div><div><b>核心需求</b><p>{strategy.purchaseMotivations?.join("、")}</p></div><div><b>主表达角度</b><p>{strategy.primaryAngle}</p></div><div><b>使用场景</b><p>{strategy.useCases?.join("、")}</p></div><div><b>文案语气</b><p>{strategy.tone?.join("、")}</p></div><div><b>避免表达</b><p>{strategy.avoidClaims?.join("、")}</p></div><details className="sm:col-span-2"><summary className="cursor-pointer font-semibold text-indigo-800">查看详细策略</summary><div className="mt-3 space-y-2 rounded-xl bg-white/70 p-3"><p><b>Bullet 表达结构：</b>Feature → Benefit → Scenario；每条承担不同购物价值。</p><p><b>标题方法：</b>先说清产品类型和已确认主属性，再自然带出使用场景。</p><p><b>描述方法：</b>产品是什么 → 对用户有什么意义 → 合理使用场景。</p></div></details></div> : <p className="mt-4 text-sm text-slate-600">尚未分析策略。点击“重新分析”生成参考策略。</p>}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Listing Result</p><h2 className="mt-1 text-xl font-semibold text-slate-900">V5 Listing 草稿</h2></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void copyListing()} disabled={!listing} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">复制完整 Listing</button><button type="button" onClick={() => void run("generate")} disabled={loading} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? "生成中…" : listing ? "重新生成" : "生成 Listing"}</button>{copyStatus ? <span role="status" className="text-xs text-slate-500">{copyStatus}</span> : null}</div></div>{listing ? <div className="mt-5 space-y-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">✓ 已应用到本次 Listing</span>{provider?.fallbackUsed ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Safe Fallback · 基础安全稿</span> : null}</div><div><h3 className="font-semibold text-slate-900">Title</h3><p className="mt-1 text-slate-800">{listing.title.text}</p></div><div><h3 className="font-semibold text-slate-900">Bullet Points</h3><ul className="mt-1 list-disc space-y-2 pl-5 text-slate-800">{listing.bullets.map((item: any, index: number) => <li key={`${index}-${item.text}`}>{item.text}</li>)}</ul></div><div><h3 className="font-semibold text-slate-900">Description</h3><p className="mt-1 whitespace-pre-wrap text-slate-800">{listing.description.text}</p></div><div><h3 className="font-semibold text-slate-900">Search Terms</h3><p className="mt-1 text-slate-700">{listing.backendSearchTerms?.join(", ") || "由已确认关键词方案提供"}</p></div></div> : <p className="mt-5 text-sm text-slate-600">生成后将在此展示标题、卖点、描述与搜索词。</p>}</section>
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Safety Summary</p><h2 className="mt-1 text-xl font-semibold text-slate-900">事实安全与人工复核</h2><div className="mt-3 grid gap-2 text-sm text-emerald-900 sm:grid-cols-3"><span>✓ 仅使用已确认事实</span><span>✓ Claim / Runtime / Copy 校验</span><span>⚠ 需要人工复核后使用</span></div>{validation ? <details className="mt-4 rounded-xl bg-white/70 p-3 text-sm text-slate-700"><summary className="cursor-pointer font-semibold">查看审核与依据</summary><div className="mt-3 space-y-1"><p>校验状态：{validation.status === "PASS" ? "通过" : validation.status === "REPAIRABLE" ? "已修复，仍需复核" : "需要人工处理"}</p><p>人工复核提示：{(validation.bulletIssueCount ?? 0) + (validation.unsupportedClaimCount ?? 0) + (validation.prohibitedClaimCount ?? 0) + (validation.competitorOverlapCount ?? 0)} 项</p><p>生成方式：{provider?.fallbackUsed ? "基础安全稿" : "AI 草稿"}；所有事实仍以已确认资料为准。</p></div></details> : null}{snapshot?.stale ? <p className="mt-3 text-sm font-medium text-amber-800">研究资料已更新，需要重新生成。</p> : null}</section>
    {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
  </div>;
}
