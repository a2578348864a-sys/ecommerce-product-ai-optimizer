"use client";

import {
  AlertCircle,
  Brain,
  ClipboardList,
  Lightbulb,
  RefreshCcw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import type { ViralAgentResult, ViralLevel, ViralLevelReason } from "@/lib/types";

const sampleMaterial = [
  "标题：宿舍桌面洞洞板收纳架，桌面乱的人真的需要",
  "商品：桌面洞洞板收纳架",
  "价格：29.9 元",
  "卖点：免打孔、可挂小物件、桌面更整齐、拍照也好看",
  "场景：学生宿舍、租房桌面、女生房间改造",
  "评论：有人问链接，也有人说桌面线太乱、不知道怎么收纳",
].join("\n");

const positiveWords = ["痛点", "对比", "改造", "懒人", "宿舍", "租房", "收纳", "神器", "评论", "链接", "平替", "省钱", "免打孔", "前后"];
const riskWords = ["品牌", "授权", "功效", "治疗", "减肥", "医用", "儿童", "带电", "大件", "易碎"];

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

function createMockViralResult(rawText: string): ViralAgentResult & { score: number; riskHits: string[] } {
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
  const viralPotential = levelFromScore(score);
  const titleAttractionLevel = levelFromScore((hasTitle ? 56 : 30) + positiveHits * 5 + (hasPain ? 12 : 0));
  const clarityLevel = levelFromScore((hasPrice ? 20 : 8) + (hasScene ? 20 : 8) + textLengthScore(text) + positiveHits * 4);
  const sceneLevel = levelFromScore((hasScene ? 62 : 28) + (hasVisual ? 12 : 0));
  const commentLevel = levelFromScore((hasComment ? 68 : 26) + positiveHits * 3);
  const painLevel = levelFromScore((hasPain ? 68 : 30) + (hasComment ? 8 : 0));
  const shootLevel = levelFromScore((hasVisual ? 66 : 34) + (hasScene ? 12 : 0));

  return {
    score,
    riskHits,
    viralPotential,
    titleAttraction: levelReason(
      titleAttractionLevel,
      hasTitle ? "素材里已经有标题或开头信息，可以继续强化反差、痛点或结果感。" : "暂时没看到明确标题钩子，建议补一句能让用户停下来的开头。",
    ),
    sellingPointClarity: levelReason(
      clarityLevel,
      hasPrice || positiveHits >= 2 ? "卖点和价格信息较清楚，适合先做内容测试。" : "卖点还偏散，建议补充价格、核心功能和为什么比同类更值得买。",
    ),
    sceneSense: levelReason(
      sceneLevel,
      hasScene ? "已经出现具体使用场景，用户更容易代入。" : "场景感不足，建议写清楚谁在什么地方、什么时候会用它。",
    ),
    commentDemand: levelReason(
      commentLevel,
      hasComment ? "素材提到评论或求链接信号，说明有一定需求反馈。" : "还没看到评论区需求，建议补充用户问了什么、为什么想买。",
    ),
    painPointStrength: levelReason(
      painLevel,
      hasPain ? "痛点较明确，适合做前后对比或问题解决型内容。" : "痛点不够尖锐，建议补一句用户现在最烦的问题。",
    ),
    contentShootability: levelReason(
      shootLevel,
      hasVisual ? "有图片/视频/对比线索，比较容易拍成短内容。" : "可拍性一般，建议补充前后对比、使用过程或细节特写。",
    ),
    bonusPoints: [
      hasScene ? "有具体使用场景，内容不容易空。" : "可以补一个强场景，比如宿舍、租房、厨房或桌面。",
      hasComment ? "有评论需求信号，适合做“评论区问爆了”的角度。" : "可以补充评论区问题，判断用户是否真的想买。",
      positiveHits >= 3 ? "关键词里有多个小红书常见种草信号。" : "可以加入痛点、对比、改造、懒人等更容易传播的表达。",
    ],
    weakPoints: [
      hasPrice ? "价格已出现，但还要看同款是否很卷。" : "缺少价格信息，无法判断低价吸引力。",
      riskHits.length ? "出现风险词：" + riskHits.join("、") + "，后续要谨慎核对。" : "暂未发现明显高风险词，但仍需人工复核。",
      hasVisual ? "可拍性不错，但要避免只拍产品不拍场景。" : "缺少可视化素材，内容可能不够直观。",
    ],
    optimizationSuggestions: [
      "标题先写“人群 + 痛点 + 结果”，例如：桌面乱的人试试这个收纳架。",
      "正文补充价格、使用前后对比和适合人群，减少泛泛描述。",
      "评论区重点观察是否有人问链接、问尺寸、问同款或问使用效果。",
    ],
    suggestedAngles: [
      "前后对比：改造前桌面乱，改造后清爽好拍。",
      "人群场景：宿舍党、租房党、小桌面用户怎么收纳。",
      "避坑角度：哪些收纳架看着好看但不好用。",
    ],
    summary: "Mock 判断：当前爆款潜力为「" + viralPotential + "」，分数 " + score + "/100。这个结果只用于前端演示和初筛，不代表真实 AI 结论。",
  };
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
    </div>
  );
}

export function ViralMockAgent() {
  const [material, setMaterial] = useState("");
  const [result, setResult] = useState<ReturnType<typeof createMockViralResult> | null>(null);
  const [notice, setNotice] = useState("这是 mock 版爆款拆解，不调用 AI，也不会保存数据。");

  const lengthText = useMemo(() => material.trim().length + "/1200", [material]);

  function runMockAnalysis() {
    const text = material.trim();
    if (text.length < 12) {
      setResult(null);
      setNotice("请先粘贴至少 12 个字的标题、卖点、评论或商品信息。");
      return;
    }
    setResult(createMockViralResult(text.slice(0, 1200)));
    setNotice("Mock 拆解完成：结果只基于前端规则，不调用真实 AI。");
  }

  function fillSample() {
    setMaterial(sampleMaterial);
    setResult(null);
    setNotice("示例素材已填入，可以点击“生成 mock 拆解”。");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.14),transparent_32rem),linear-gradient(180deg,#f8fcfb_0%,#f4f8fb_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1540px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-5">
          <header className="rounded-[28px] border border-white/80 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600">Mock Agent</p>
                <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">爆款拆解</h1>
                <p className="mt-1 text-sm text-slate-500">先用本地规则快速看标题、卖点、场景和评论需求。</p>
              </div>
              <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
                不调用 AI
              </span>
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
                    <p className="text-sm font-semibold text-teal-700">爆款拆解 mock 版</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">输入素材，生成一份模拟爆款判断</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      适合先做页面流程演示和人工初筛。它不会请求后端、不会消耗 AI 次数、不会保存任何内容。
                    </p>
                  </div>
                </div>

                <label className="mt-6 block">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">素材内容</span>
                    <span className="text-xs text-slate-400">{lengthText}</span>
                  </div>
                  <textarea
                    value={material}
                    onChange={(event) => {
                      setMaterial(event.target.value.slice(0, 1200));
                      setResult(null);
                    }}
                    rows={10}
                    placeholder="粘贴标题、卖点、评论区反馈、商品价格、使用场景。例如：宿舍桌面收纳架，29.9 元，评论区很多人问链接..."
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20"
                  />
                </label>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={runMockAnalysis}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-teal-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-teal-700"
                  >
                    <Wand2 className="h-4 w-4" />
                    生成 mock 拆解
                  </button>
                  <button
                    type="button"
                    onClick={fillSample}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-teal-200 bg-white px-5 text-sm font-semibold text-teal-700 transition hover:border-teal-300 hover:bg-teal-50"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    填入示例
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMaterial("");
                      setResult(null);
                      setNotice("已清空。这个页面只在浏览器内模拟，不保存数据。");
                    }}
                    className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:border-slate-300"
                  >
                    清空
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
                        <p className="text-sm font-semibold text-teal-700">Mock 结论</p>
                        <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
                          爆款潜力：{result.viralPotential}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{result.summary}</p>
                      </div>
                      <div className={"rounded-3xl border px-5 py-4 text-center " + getLevelClass(result.viralPotential)}>
                        <p className="text-xs font-semibold">模拟分数</p>
                        <p className="mt-1 text-3xl font-bold text-slate-950">{result.score}</p>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-3 md:grid-cols-2">
                    <ResultMetric label="标题吸引力" value={result.titleAttraction} />
                    <ResultMetric label="卖点清晰度" value={result.sellingPointClarity} />
                    <ResultMetric label="场景代入感" value={result.sceneSense} />
                    <ResultMetric label="评论需求强度" value={result.commentDemand} />
                    <ResultMetric label="痛点强度" value={result.painPointStrength} />
                    <ResultMetric label="内容可拍性" value={result.contentShootability} />
                  </section>

                  <section className="grid gap-3 lg:grid-cols-2">
                    <SimpleList title="主要加分点" items={result.bonusPoints} />
                    <SimpleList title="主要短板" items={result.weakPoints} />
                    <SimpleList title="优化建议" items={result.optimizationSuggestions} />
                    <SimpleList title="可尝试的内容角度" items={result.suggestedAngles} />
                  </section>
                </div>
              ) : null}
            </div>

            <aside className="space-y-4">
              <section className="sticky top-4 rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                <p className="text-sm font-semibold text-teal-700">怎么用</p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">只做初筛，不做最终决定</h2>
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <p className="flex gap-2">
                    <ClipboardList className="mt-1 h-4 w-4 shrink-0 text-teal-600" />
                    先粘贴一个商品或一段笔记素材。
                  </p>
                  <p className="flex gap-2">
                    <Brain className="mt-1 h-4 w-4 shrink-0 text-teal-600" />
                    看标题、卖点、场景、评论需求和可拍性。
                  </p>
                  <p className="flex gap-2">
                    <Lightbulb className="mt-1 h-4 w-4 shrink-0 text-teal-600" />
                    根据建议补充素材，再去真实选品体检。
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
