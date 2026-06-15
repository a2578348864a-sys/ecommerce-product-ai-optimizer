"use client";

import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Clipboard,
  ClipboardList,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { platformLabels, platformOptions } from "@/lib/types";
import type { Platform, ViralAgentResult, ViralLevel, ViralLevelReason } from "@/lib/types";

const positiveWords = ["痛点", "对比", "改造", "懒人", "宿舍", "租房", "收纳", "神器", "评论", "链接", "平替", "省钱", "免打孔", "前后"];
const riskWords = ["品牌", "授权", "功效", "治疗", "减肥", "医用", "儿童", "带电", "大件", "易碎"];

type ViralAiData = {
  score: number;
  level: ViralLevel;
  sellingPoints: string[];
  painPoints: string[];
  hooks: string[];
  titleSuggestions: string[];
  videoOpenings: string[];
  risks: string[];
  beginnerConclusion: string;
};

type DisplayResult = ViralAiData & {
  mode: "mock" | "ai";
  metrics?: ViralAgentResult;
};

type ApiResponse =
  | { ok: true; data: ViralAiData }
  | { ok: false; error: { code: string; message: string } };

function textLengthScore(text: string) {
  if (text.length > 220) return 22;
  if (text.length > 120) return 16;
  if (text.length > 60) return 10;
  return 4;
}

function countMatches(text: string, words: string[]) {
  return words.filter((word) => text.includes(word)).length;
}

function levelFromScore(score: number): ViralLevel {
  if (score >= 72) return "高";
  if (score >= 45) return "中";
  return "低";
}

function levelReason(level: ViralLevel, reason: string): ViralLevelReason {
  return { level, reason };
}

function getLevelClass(level: ViralLevel) {
  switch (level) {
    case "高":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "中":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function joinMaterial(title: string, link: string, platform: Platform, materialText: string) {
  return [
    title ? `标题：${title}` : "",
    `平台：${platformLabels[platform]}`,
    link ? `链接：${link}` : "",
    materialText ? `素材：${materialText}` : "",
  ].filter(Boolean).join("\n");
}

function createMockResult(rawText: string): DisplayResult {
  const text = rawText.trim();
  const positiveHits = countMatches(text, positiveWords);
  const riskHits = riskWords.filter((word) => text.includes(word));
  const hasTitle = /标题|题目|开头|钩子/.test(text);
  const hasPrice = /价格|售价|¥|元|\d+\.\d+/.test(text);
  const hasScene = /场景|宿舍|租房|厨房|桌面|通勤|办公室|卧室/.test(text);
  const hasComment = /评论|问链接|求链接|种草|反馈|需求/.test(text);
  const hasPain = /痛点|太乱|麻烦|懒|不会|烦|难/.test(text);
  const hasVisual = /截图|图片|视频|拍|对比|改造|前后/.test(text);
  const score = Math.max(
    18,
    Math.min(
      96,
      textLengthScore(text)
        + positiveHits * 6
        + (hasTitle ? 10 : 0)
        + (hasPrice ? 8 : 0)
        + (hasScene ? 12 : 0)
        + (hasComment ? 12 : 0)
        + (hasPain ? 10 : 0)
        + (hasVisual ? 10 : 0)
        - riskHits.length * 8,
    ),
  );
  const level = levelFromScore(score);
  const titleAttractionLevel = levelFromScore((hasTitle ? 56 : 30) + positiveHits * 5 + (hasPain ? 12 : 0));
  const clarityLevel = levelFromScore((hasPrice ? 20 : 8) + (hasScene ? 20 : 8) + textLengthScore(text) + positiveHits * 4);
  const sceneLevel = levelFromScore((hasScene ? 62 : 28) + (hasVisual ? 12 : 0));
  const commentLevel = levelFromScore((hasComment ? 68 : 26) + positiveHits * 3);
  const painLevel = levelFromScore((hasPain ? 68 : 30) + (hasComment ? 8 : 0));
  const shootLevel = levelFromScore((hasVisual ? 66 : 34) + (hasScene ? 12 : 0));
  const risks = [
    riskHits.length ? "出现风险词：" + riskHits.join("、") + "，后续要谨慎核对。" : "暂未发现明显高风险词，但仍需人工复核。",
    hasPrice ? "价格已出现，但还要看同款是否很卷。" : "缺少价格信息，无法判断低价吸引力。",
  ];

  return {
    mode: "mock",
    score,
    level,
    sellingPoints: [
      hasScene ? "有具体使用场景，内容不容易空。" : "可以补一个强场景，比如宿舍、租房、厨房或桌面。",
      hasComment ? "有评论需求信号，适合做“评论区问爆了”的角度。" : "可以补充评论区问题，判断用户是否真的想买。",
      positiveHits >= 3 ? "关键词里有多个小红书常见种草信号。" : "可以加入痛点、对比、改造、懒人等更容易传播的表达。",
    ],
    painPoints: [
      hasPain ? "痛点较明确，适合做前后对比或问题解决型内容。" : "痛点不够尖锐，建议补一句用户现在最烦的问题。",
      hasComment ? "素材提到评论反馈，可以继续挖真实需求。" : "还没看到评论区需求，建议补充用户问了什么。",
    ],
    hooks: [
      "人群 + 痛点 + 结果：桌面乱的人试试这个收纳架。",
      "前后对比：改造前桌面乱，改造后清爽好拍。",
      "避坑角度：哪些同类产品看着好看但不好用。",
    ],
    titleSuggestions: [
      "把标题改成“人群 + 痛点 + 结果”，不要只写商品名。",
      "标题里加入具体场景，比如宿舍、租房、桌面改造。",
      "如果有评论需求，可以写“评论区问爆了”。",
    ],
    videoOpenings: [
      "先展示混乱场景，再拿出产品解决问题。",
      "用 3 秒前后对比抓注意力。",
      "开头直接说：桌面乱的人，这个小东西真能救一下。",
    ],
    risks,
    beginnerConclusion: `模拟拆解：当前爆款潜力为「${level}」，分数 ${score}/100。这个结果只基于前端规则，用于演示和初筛，不代表真实 AI 结论。`,
    metrics: {
      titleAttraction: levelReason(titleAttractionLevel, hasTitle ? "素材里已有标题或开头信息，可以继续强化反差、痛点或结果感。" : "暂时没看到明确标题钩子，建议补一句能让用户停下来的开头。"),
      sellingPointClarity: levelReason(clarityLevel, hasPrice || positiveHits >= 2 ? "卖点和价格信息较清楚，适合先做内容测试。" : "卖点还偏散，建议补充价格、核心功能和为什么比同类更值得买。"),
      sceneSense: levelReason(sceneLevel, hasScene ? "已经出现具体使用场景，用户更容易代入。" : "场景感不足，建议写清楚谁在什么地方、什么时候会用它。"),
      commentDemand: levelReason(commentLevel, hasComment ? "素材提到评论或求链接信号，说明有一定需求反馈。" : "还没看到评论区需求，建议补充用户问了什么、为什么想买。"),
      painPointStrength: levelReason(painLevel, hasPain ? "痛点较明确，适合做前后对比或问题解决型内容。" : "痛点不够尖锐，建议补一句用户现在最烦的问题。"),
      contentShootability: levelReason(shootLevel, hasVisual ? "有图片/视频/对比线索，比较容易拍成短内容。" : "可拍性一般，建议补充前后对比、使用过程或细节特写。"),
      viralPotential: level,
      bonusPoints: [],
      weakPoints: risks,
      optimizationSuggestions: [],
      suggestedAngles: [],
      summary: "",
    },
  };
}

function mapApiError(code: string, message: string) {
  if (code === "missing_api_key" || code === "missing_model" || code === "missing_base_url") {
    return "AI 服务未配置：请先检查服务端 AI 环境变量。";
  }
  if (code === "timeout") return "请求超时：AI 服务响应太慢，请稍后重试。";
  if (code === "json_parse_error") return "返回格式异常：AI 没有按 JSON 格式返回，请稍后重试。";
  if (code === "missing_content") return "请先填写素材文案，再点击 AI 深度拆解。";
  return message || "AI 返回失败，请稍后重试。";
}

function formatResultForCopy(result: DisplayResult) {
  return [
    `${result.mode === "mock" ? "模拟拆解" : "AI 深度拆解"}`,
    `爆款潜力评分：${result.score}/100`,
    `潜力等级：${result.level}`,
    "",
    "核心卖点：",
    ...result.sellingPoints.map((item) => `- ${item}`),
    "",
    "用户痛点：",
    ...result.painPoints.map((item) => `- ${item}`),
    "",
    "内容钩子：",
    ...result.hooks.map((item) => `- ${item}`),
    "",
    "标题优化建议：",
    ...result.titleSuggestions.map((item) => `- ${item}`),
    "",
    "短视频开头建议：",
    ...result.videoOpenings.map((item) => `- ${item}`),
    "",
    "风险提醒：",
    ...result.risks.map((item) => `- ${item}`),
    "",
    "小白结论：",
    result.beginnerConclusion,
  ].join("\n");
}

function ResultMetric({ label, value }: { label: string; value: ViralLevelReason }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">{label}</p>
        <span className={"rounded-full border px-2 py-0.5 text-xs font-semibold " + getLevelClass(value.level)}>
          {value.level}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{value.reason}</p>
    </div>
  );
}

function SimpleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-slate-900">{title}</p>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          {items.map((item, index) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                {index + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-500">暂无明确内容，建议补充更多素材后再分析。</p>
      )}
    </div>
  );
}

export function ViralMockAgent() {
  const [title, setTitle] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [platform, setPlatform] = useState<Platform>("xhs");
  const [materialText, setMaterialText] = useState("");
  const [result, setResult] = useState<DisplayResult | null>(null);
  const [notice, setNotice] = useState("模拟拆解是规则演示；AI 深度拆解会请求后端并消耗 AI 额度。");
  const [fieldError, setFieldError] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const lengthText = useMemo(() => materialText.trim().length + "/8000", [materialText]);

  function validateMaterial() {
    if (!materialText.trim()) {
      setFieldError("请先填写素材文案。");
      setNotice("素材文案是必填项，标题和链接可以不填。");
      return false;
    }
    setFieldError("");
    return true;
  }

  function runMockAnalysis() {
    if (!validateMaterial()) return;
    const combined = joinMaterial(title, productUrl, platform, materialText);
    setResult(createMockResult(combined.slice(0, 8000)));
    setNotice("模拟拆解完成：这是本地规则演示，不调用接口、不消耗 AI 额度。");
    setCopyState("idle");
  }

  async function runAiAnalysis() {
    if (!validateMaterial()) return;
    setIsAiLoading(true);
    setNotice("AI 深度拆解准备请求后端。注意：真实点击会消耗 AI 额度。");
    setCopyState("idle");

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 50_000);

    try {
      const response = await fetch("/api/agents/viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          productUrl,
          materialText,
          platform,
        }),
        signal: controller.signal,
      });
      const data = await response.json() as ApiResponse;

      if (!response.ok || !data.ok) {
        const error = data.ok ? { code: "provider_error", message: "AI 返回失败。" } : data.error;
        const message = mapApiError(error.code, error.message);
        setNotice(message);
        setResult(null);
        return;
      }

      if (!data.data || typeof data.data.score !== "number" || !data.data.beginnerConclusion) {
        setNotice("返回格式异常：后端没有返回完整拆解结果。");
        setResult(null);
        return;
      }

      setResult({ ...data.data, mode: "ai" });
      setNotice("AI 深度拆解完成。请人工复核后再做选品决定。");
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      setNotice(isAbort ? "请求超时：AI 服务响应太慢，请稍后重试。" : "AI 返回失败：请稍后重试。");
      setResult(null);
    } finally {
      window.clearTimeout(timer);
      setIsAiLoading(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatResultForCopy(result));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.14),transparent_32rem),linear-gradient(180deg,#f8fcfb_0%,#f4f8fb_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-5">
          <header className="rounded-[28px] border border-white/80 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600">Viral Agent</p>
                <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">爆款拆解</h1>
                <p className="mt-1 text-sm text-slate-500">先用规则模拟，再按需接入真实 AI 做深度拆解。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-600">
                  模拟拆解：规则演示
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
                  AI 深度拆解：会消耗 AI 额度
                </span>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <div className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.07)]">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                    <Sparkles className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-teal-700">真实 AI 可接入版</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">输入素材，拆出爆款角度和风险</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      你可以先用模拟拆解快速演示流程；确认素材值得细看后，再点击 AI 深度拆解。
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">素材标题，可选</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value.slice(0, 160))}
                      placeholder="例如：宿舍桌面洞洞板收纳架"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">商品/素材链接，可选</span>
                    <input
                      value={productUrl}
                      onChange={(event) => setProductUrl(event.target.value.slice(0, 400))}
                      placeholder="可粘贴小红书、抖音、淘宝等链接"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </label>
                </div>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">平台选择</span>
                  <select
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value as Platform)}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20 md:w-64"
                  >
                    {platformOptions.map((item) => (
                      <option key={item} value={item}>{platformLabels[item]}</option>
                    ))}
                  </select>
                </label>

                <label className="mt-4 block">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">素材文案，必填</span>
                    <span className="text-xs text-slate-400">{lengthText}</span>
                  </div>
                  <textarea
                    value={materialText}
                    onChange={(event) => {
                      setMaterialText(event.target.value.slice(0, 8000));
                      setFieldError("");
                      setResult(null);
                    }}
                    rows={10}
                    placeholder="粘贴标题、卖点、评论区反馈、商品价格、使用场景。例如：宿舍桌面收纳架，29.9 元，评论区很多人问链接..."
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20"
                  />
                  {fieldError ? <p className="mt-2 text-sm font-semibold text-rose-600">{fieldError}</p> : null}
                </label>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={runMockAnalysis}
                    disabled={isAiLoading}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-teal-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Wand2 className="h-4 w-4" />
                    生成模拟拆解
                  </button>
                  <button
                    type="button"
                    onClick={runAiAnalysis}
                    disabled={isAiLoading}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-5 text-sm font-semibold text-amber-800 transition hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                    AI 深度拆解
                  </button>
                </div>

                <div className="mt-4 flex gap-2 rounded-2xl border border-teal-100 bg-teal-50/70 px-4 py-3 text-sm leading-6 text-teal-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{notice}</span>
                </div>
              </div>

              {result ? (
                <div className="space-y-5">
                  <section className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.07)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-teal-700">
                          {result.mode === "mock" ? "模拟拆解：规则演示" : "AI 深度拆解：真实 AI 结果"}
                        </p>
                        <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
                          爆款潜力：{result.level}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{result.beginnerConclusion}</p>
                      </div>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className={"rounded-3xl border px-5 py-4 text-center " + getLevelClass(result.level)}>
                          <p className="text-xs font-semibold">爆款潜力评分</p>
                          <p className="mt-1 text-3xl font-bold text-slate-950">{result.score}</p>
                        </div>
                        <button
                          type="button"
                          onClick={copyResult}
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-teal-200 hover:text-teal-700"
                        >
                          {copyState === "copied" ? <CheckCircle2 className="h-4 w-4 text-teal-600" /> : <Clipboard className="h-4 w-4" />}
                          {copyState === "copied" ? "已复制" : "复制结果"}
                        </button>
                      </div>
                    </div>
                    {copyState === "failed" ? <p className="mt-3 text-sm text-rose-600">复制失败，请手动选择结果文本复制。</p> : null}
                  </section>

                  {result.metrics ? (
                    <section className="grid gap-3 md:grid-cols-2">
                      <ResultMetric label="标题吸引力" value={result.metrics.titleAttraction} />
                      <ResultMetric label="卖点清晰度" value={result.metrics.sellingPointClarity} />
                      <ResultMetric label="场景代入感" value={result.metrics.sceneSense} />
                      <ResultMetric label="评论需求强度" value={result.metrics.commentDemand} />
                      <ResultMetric label="痛点强度" value={result.metrics.painPointStrength} />
                      <ResultMetric label="内容可拍性" value={result.metrics.contentShootability} />
                    </section>
                  ) : null}

                  <section className="grid gap-3 lg:grid-cols-2">
                    <SimpleList title="核心卖点" items={result.sellingPoints} />
                    <SimpleList title="用户痛点" items={result.painPoints} />
                    <SimpleList title="内容钩子" items={result.hooks} />
                    <SimpleList title="标题优化建议" items={result.titleSuggestions} />
                    <SimpleList title="短视频开头建议" items={result.videoOpenings} />
                    <SimpleList title="风险提醒" items={result.risks} />
                  </section>
                </div>
              ) : null}
            </div>

            <aside className="space-y-4">
              <section className="sticky top-4 rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                <p className="text-sm font-semibold text-teal-700">怎么用</p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">先模拟，再决定要不要消耗 AI</h2>
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <p className="flex gap-2">
                    <ClipboardList className="mt-1 h-4 w-4 shrink-0 text-teal-600" />
                    先填素材文案，标题和链接可以先不填。
                  </p>
                  <p className="flex gap-2">
                    <Wand2 className="mt-1 h-4 w-4 shrink-0 text-teal-600" />
                    模拟拆解只跑本地规则，不请求后端。
                  </p>
                  <p className="flex gap-2">
                    <Brain className="mt-1 h-4 w-4 shrink-0 text-amber-600" />
                    AI 深度拆解会请求后端接口并消耗 AI 额度，适合正式复核。
                  </p>
                </div>
              </section>
            </aside>
          </section>
        </div>
      </div>
    </main>
  );
}
