"use client";

import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Clipboard,
  ClipboardList,
  Download,
  Loader2,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { platformLabels, platformOptions } from "@/lib/types";
import type { Platform, ViralAgentResult, ViralLevel, ViralLevelReason } from "@/lib/types";
import { WorkflowNextStepCard } from "@/components/WorkflowNextStepCard";
import { ManualReviewChecklist } from "@/components/ManualReviewChecklist";
import { useSharedProduct } from "@/hooks/useSharedProduct";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import { EXAMPLE_VIRAL } from "@/lib/examples";

const positiveWords = ["viral", "review", "comment", "tiktok", "amazon", "pain point", "hack", "comparison", "before after", "link in bio", "kitchen gadget", "storage", "organization", "cleaning", "portable", "must have"];
const riskWords = ["brand", "trademark", "patent", "medical", "FDA", "children", "electronics", "fragile", "liquid", "IP infringement", "licensed", "copyright"];
const extendedPlatformLabels = {
  ...platformLabels,
} as const;
const extendedPlatformOptions = [
  ...platformOptions,
] as const;

type AgentPlatform = keyof typeof extendedPlatformLabels;
type ViralPotentialLevel = "高潜力" | "可优化" | "一般" | "不建议主推";

type ViralAiData = {
  score: number;
  level: ViralPotentialLevel;
  oneLineSummary: string;
  sellingPoints: string[];
  painPoints: string[];
  hooks: string[];
  titleSuggestions: string[];
  videoOpenings: string[];
  commentTriggers: string[];
  conversionSuggestions: string[];
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

type SaveResponse =
  | { ok: true; data: { id: string } }
  | { ok: false; error: { code: string; message: string } };

type ViralDraft = {
  title: string;
  productUrl: string;
  platform: AgentPlatform;
  materialText: string;
  result: DisplayResult | null;
  savedRecordId: string;
};

function textLengthScore(text: string) {
  if (text.length > 220) return 22;
  if (text.length > 120) return 16;
  if (text.length > 60) return 10;
  return 4;
}

function countMatches(text: string, words: string[]) {
  return words.filter((word) => text.includes(word)).length;
}

function levelFromScore(score: number): ViralPotentialLevel {
  if (score >= 80) return "高潜力";
  if (score >= 65) return "可优化";
  if (score >= 50) return "一般";
  return "不建议主推";
}

function legacyLevelFromScore(score: number): ViralLevel {
  if (score >= 80) return "高";
  if (score >= 50) return "中";
  return "低";
}

function levelReason(level: ViralLevel, reason: string): ViralLevelReason {
  return { level, reason };
}

function getLevelClass(level: ViralPotentialLevel | ViralLevel) {
  switch (level) {
    case "高潜力":
    case "高":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "可优化":
    case "中":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "一般":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function joinMaterial(title: string, link: string, platform: AgentPlatform, materialText: string) {
  return [
    title ? `Title: ${title}` : "",
    `Platform: ${extendedPlatformLabels[platform]}`,
    link ? `Link: ${link}` : "",
    materialText ? `Material: ${materialText}` : "",
  ].filter(Boolean).join("\n");
}

function createMockResult(rawText: string, platform: AgentPlatform): DisplayResult {
  const text = rawText.trim();
  const positiveHits = countMatches(text, positiveWords);
  const riskHits = riskWords.filter((word) => text.includes(word));
  const hasTitle = /title|hook|headline|caption|标题|开头/.test(text);
  const hasPrice = /price|\$|USD|EUR|£|价格|售价|\d+\.\d+/.test(text);
  const hasScene = /kitchen|camping|office|desk|bedroom|bathroom|outdoor|travel|home|car|gym|场景|宿舍|租房|厨房|桌面|通勤|办公室/.test(text);
  const hasComment = /comment|review|feedback|Q&A|question|ask|link in bio|评论|问链接|求链接|反馈|需求/.test(text);
  const hasPain = /pain point|problem|struggle|annoying|hard|difficult|hate|痛点|太乱|麻烦|不方便/.test(text);
  const hasVisual = /video|photo|image|screenshot|before after|对比|改造|前后|画面|展示|截图|图片/.test(text);
  const platformBonus = platform === "tiktok" || platform === "youtube_shorts" ? (hasVisual ? 8 : 0) : platform === "amazon" ? (hasComment ? 6 : 0) : platform === "etsy" ? (hasVisual ? 5 : 0) : platform === "shopify" ? (hasPrice ? 5 : 0) : 0;
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
        + platformBonus
        - riskHits.length * 8,
    ),
  );
  const level = levelFromScore(score);
  const legacyLevel = legacyLevelFromScore(score);
  const oneLineSummary = hasPain || hasScene
    ? "素材有可拆解的痛点或使用场景，适合进一步做短视频脚本或商品角度拆解。"
    : "素材仍偏泛泛的商品介绍，建议补充具体目标人群、痛点和使用场景。";
  const risks = [
    riskHits.length ? "发现风险提示词：" + riskHits.join("、") + "，需人工核对是否符合平台政策与合规要求。" : "暂未发现明显高风险词，但仍需人工复核各海外平台规则。",
    hasPrice ? "价格信息已出现，建议补充同类竞品对比，避免单纯依赖低价吸引。" : "缺少价格或成本信息，转化理由不够完整，建议补充定价参考。",
    "如果内容像广告硬推，建议改成真实使用体验、前后对比或评论问答形式。",
  ];

  return {
    mode: "mock",
    score,
    level,
    oneLineSummary,
    sellingPoints: [
      hasScene ? "已识别出具体使用场景，可围绕该场景制作首图或前 3 秒钩子。" : "先补充一个具体场景，例如厨房台面、露营装备、家庭办公桌等。",
      hasPrice ? "价格信息有助于判断购买门槛，但还需说明为什么值得这个价格。" : "补充价格、规格或成本优势，让购买理由更完整。",
      positiveHits >= 3 ? "素材中有痛点、评论或对比等传播信号，可继续放大这些角度。" : "加入痛点、对比、改造技巧或解决问题型表达，提升传播性。",
    ],
    painPoints: [
      hasPain ? "用户痛点已出现，可进一步明确'谁在什么场景下遇到了什么困扰'。" : "痛点还不够尖锐，建议补充用户当前最烦恼的具体问题。",
      hasComment ? "评论需求能证明用户关心点，可以整理成内容钩子和评论互动话题。" : "缺少评论反馈，建议补充用户关于尺寸、效果、耐用性等典型问题。",
      hasScene ? "场景清楚，用户更容易代入自己的使用情境。" : "场景不清楚，观众可能无法将产品与自己的生活关联起来。",
    ],
    hooks: [
      "前 3 秒展示使用前的混乱状态（桌面、厨房、背包），再切到整理后的对比画面。",
      "不要只展示好看的产品，展示真正好用的 3 个细节。",
      platform === "tiktok" || platform === "youtube_shorts" ? "开场文字叠加：'别再买 [品类] 了，先看这个再说。'" : "首图直接放前后对比，标题写清目标人群和痛点。",
    ],
    titleSuggestions: [
      "使用'目标人群 + 痛点 + 结果'公式写标题，例如：'露营党终于找到不占地方的折叠杯了'。",
      "标题里加入场景关键词：camping、small kitchen、apartment、office desk、travel。",
      "避免只写商品名，改成观众一眼就能代入的问题句或结果句。",
    ],
    videoOpenings: [
      "前 3 秒展示使用前的混乱状态，字幕写出具体痛点。",
      "接着用一个动作展示产品如何解决问题，不要先念参数规格。",
      "结尾补充价格/尺寸/适用人群，消除下单前的犹豫。",
    ],
    commentTriggers: [
      "你最想先整理哪里：桌面、厨房还是衣柜？",
      "要不要我整理一版不同尺寸和价格的对比？",
      "评论区留言：你会在什么场景下用这个？还想看什么细节测试？",
    ],
    conversionSuggestions: [
      "补充价格、尺寸、承重或材质信息，解决购买前核心顾虑。",
      "加一个同类竞品对比：为什么这个更省空间、更好收纳、更适合小空间。",
      "把'质量好'这类模糊说法改成可验证细节：免工具安装、2 分钟搞定、适配标准尺寸。",
    ],
    risks,
    beginnerConclusion: `模拟拆解结果：潜力等级「${level}」，评分 ${score}/100。建议先将素材补到"具体人群 + 真实痛点 + 场景画面 + 购买理由"四个要素齐全，再决定是否用 AI 深度拆解。`,
    metrics: {
      titleAttraction: levelReason(legacyLevel, hasTitle ? "素材已有标题/开头信息，继续强化反差、痛点或结果感。" : "暂未看到明确的标题钩子，建议补一句能让用户停下来的开头。"),
      sellingPointClarity: levelReason(legacyLevel, hasPrice || positiveHits >= 2 ? "卖点和价格信息较清楚，可继续做内容测试。" : "卖点还偏散，建议补充价格、核心功能和差异化亮点。"),
      sceneSense: levelReason(legacyLevel, hasScene ? "已出现具体使用场景，用户更容易代入。" : "场景感不足，建议写清楚谁在什么地方、什么时候会用。"),
      commentDemand: levelReason(legacyLevel, hasComment ? "素材提到评论或互动信号，需求反馈已验证。" : "还没看到评论区需求，建议补充用户提问和反馈内容。"),
      painPointStrength: levelReason(legacyLevel, hasPain ? "痛点较明确，适合做前后对比或问题解决型内容。" : "痛点不够尖锐，建议补充用户当前最烦恼的具体问题。"),
      contentShootability: levelReason(legacyLevel, hasVisual ? "有图片/视频/对比线索，比较容易拍成短内容。" : "可拍性一般，建议补充前后对比、使用过程或细节特写。"),
      viralPotential: legacyLevel,
      bonusPoints: [],
      weakPoints: risks,
      optimizationSuggestions: [],
      suggestedAngles: [],
      summary: "",
    },
  };
}

function normalizeResponseData(data: ViralAiData): ViralAiData {
  return {
    ...data,
    oneLineSummary: data.oneLineSummary || "AI 已完成拆解，但一句话判断为空，建议人工复核。",
    commentTriggers: Array.isArray(data.commentTriggers) ? data.commentTriggers : [],
    conversionSuggestions: Array.isArray(data.conversionSuggestions) ? data.conversionSuggestions : [],
  };
}

function mapApiError(code: string, message: string) {
  if (code === "unauthorized") return "访问密码不正确，请重新输入。";
  if (code === "missing_access_password") return "服务端访问密码未配置，请先检查服务端设置。";
  if (code === "missing_api_key" || code === "missing_model" || code === "missing_base_url") {
    return "AI 服务未配置：请先检查服务端 AI 环境变量。";
  }
  if (code === "timeout") return "请求超时：AI 服务响应太慢，请稍后重试。";
  if (code === "json_parse_error") return "返回格式异常：AI 没有按 JSON 格式返回，请稍后重试。";
  if (code === "missing_content") return "请先填写素材文案，再点击 AI 深度拆解。";
  return message || "AI 返回失败，请稍后重试。";
}

function copySection(title: string, items: string[]) {
  return [title + "：", ...(items.length ? items.map((item) => `- ${item}`) : ["- 暂无"])];
}

function formatResultForMarkdown(result: DisplayResult) {
  return [
    `# ${result.mode === "mock" ? "模拟拆解" : "AI 深度拆解"} — 海外爆款趋势报告`,
    "",
    `- 商品机会评分：**${result.score} / 100**`,
    `- 潜力等级：**${result.level}**`,
    `- 一句话判断：${result.oneLineSummary}`,
    "",
    "## 核心卖点",
    ...result.sellingPoints.length ? result.sellingPoints.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 用户痛点",
    ...result.painPoints.length ? result.painPoints.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 内容钩子",
    ...result.hooks.length ? result.hooks.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 标题建议",
    ...result.titleSuggestions.length ? result.titleSuggestions.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 短视频开头",
    ...result.videoOpenings.length ? result.videoOpenings.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 评论互动话题",
    ...result.commentTriggers.length ? result.commentTriggers.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 转化优化建议",
    ...result.conversionSuggestions.length ? result.conversionSuggestions.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 风险提醒",
    ...result.risks.length ? result.risks.map((s) => `- ${s}`) : ["- 暂无"],
    "",
    "## 新手结论",
    result.beginnerConclusion,
  ].join("\n");
}

function exportMarkdown(result: DisplayResult, title: string) {
  const fileName = (title.trim().slice(0, 40) || "海外爆款趋势报告").replace(/[\\/:*?"<>|]+/g, "-") + ".md";
  const blob = new Blob([formatResultForMarkdown(result)], { type: "text/markdown;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function formatResultForCopy(result: DisplayResult) {
  return [
    `${result.mode === "mock" ? "模拟拆解" : "AI 深度拆解"} — 海外爆款趋势报告`,
    `商品机会评分：${result.score}/100`,
    `潜力等级：${result.level}`,
    `一句话判断：${result.oneLineSummary}`,
    "",
    ...copySection("核心卖点", result.sellingPoints),
    "",
    ...copySection("用户痛点", result.painPoints),
    "",
    ...copySection("内容钩子", result.hooks),
    "",
    ...copySection("标题建议", result.titleSuggestions),
    "",
    ...copySection("短视频开头", result.videoOpenings),
    "",
    ...copySection("评论互动话题", result.commentTriggers),
    "",
    ...copySection("转化优化建议", result.conversionSuggestions),
    "",
    ...copySection("风险提醒", result.risks),
    "",
    "新手结论：",
    result.beginnerConclusion,
  ].join("\n");
}

function ResultMetric({ label, value }: { label: string; value: ViralLevelReason }) {
  return (
    <div className="surface-card-soft rounded-[22px] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">{label}</p>
        <span className={"status-pill px-2 py-0.5 text-xs font-semibold " + getLevelClass(value.level)}>
          {value.level}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 muted-text">{value.reason}</p>
    </div>
  );
}

function SimpleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="surface-card-soft rounded-[22px] p-4">
      <p className="text-sm font-bold text-slate-900">{title}</p>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 muted-text">
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
        <p className="mt-3 text-sm leading-6 muted-text">暂无明确内容，建议补充更多素材后再分析。</p>
      )}
    </div>
  );
}

export function ViralMockAgent() {
  const [sharedProduct, updateShared] = useSharedProduct();
  const initialDraft: ViralDraft = {
    title: sharedProduct.productName,
    productUrl: "",
    platform: (sharedProduct.targetPlatform && sharedProduct.targetPlatform !== "shopify")
      ? sharedProduct.targetPlatform as AgentPlatform
      : "tiktok",
    materialText: sharedProduct.description,
    result: null,
    savedRecordId: "",
  };
  const { draftValue, setDraftValue, clearDraft, restored } = useLocalDraft<ViralDraft>({
    storageKey: "qx:draft:viral:v1",
    initialValue: initialDraft,
  });
  const { title, productUrl, platform, materialText, result, savedRecordId } = draftValue;
  const setTitle = (value: string) => setDraftValue((current) => ({ ...current, title: value }));
  const setProductUrl = (value: string) => setDraftValue((current) => ({ ...current, productUrl: value }));
  const setPlatform = (value: AgentPlatform) => setDraftValue((current) => ({ ...current, platform: value }));
  const setMaterialText = (value: string) => setDraftValue((current) => ({ ...current, materialText: value }));
  const setResult = (value: DisplayResult | null) => setDraftValue((current) => ({ ...current, result: value }));
  const setSavedRecordId = (value: string) => setDraftValue((current) => ({ ...current, savedRecordId: value }));
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const [notice, setNotice] = useState("模拟拆解不消耗额度；AI 深度拆解会请求后端并消耗 AI 额度。");
  const [fieldError, setFieldError] = useState("");
  const [accessPasswordError, setAccessPasswordError] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  // Sync shared fields back
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncToShared = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      updateShared({ productName: title, description: materialText, targetPlatform: platform });
    }, 500);
  }, [title, materialText, platform, updateShared]);

  useEffect(() => {
    syncToShared();
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [syncToShared]);

  function fillExample() {
    setTitle(EXAMPLE_VIRAL.title);
    setProductUrl(EXAMPLE_VIRAL.productUrl);
    setPlatform(EXAMPLE_VIRAL.platform as AgentPlatform);
    setMaterialText(EXAMPLE_VIRAL.materialText);
    setNotice("示例已填入，访问密码仍沿用全站保存的密码。");
  }

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
    setResult(createMockResult(combined.slice(0, 8000), platform));
    setNotice("模拟拆解完成：这是本地规则演示，不调用接口、不消耗 AI 额度。");
    setCopyState("idle");
    setSavedRecordId("");
  }

  async function runAiAnalysis() {
    if (!validateMaterial()) return;
    if (!isAccessPasswordReady) {
      setAccessPasswordError("正在读取访问状态，请稍后再试。");
      setNotice("访问状态读取完成前不会请求后端。");
      return;
    }
    if (!accessPassword.trim()) {
      setAccessPasswordError("访问密码缺失或已过期，请先在首页输入访问密码。");
      setNotice("AI 深度拆解需要访问密码，缺失或过期时不会请求后端。");
      return;
    }

    setAccessPasswordError("");
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
          accessPassword,
        }),
        signal: controller.signal,
      });
      const data = await response.json() as ApiResponse;

      if (!response.ok || !data.ok) {
        const error = data.ok ? { code: "provider_error", message: "AI 返回失败。" } : data.error;
        const message = mapApiError(error.code, error.message);
        setNotice(response.status === 401 || response.status === 403 ? "访问密码不正确，请重新输入。" : message);
        setResult(null);
        return;
      }

      if (!data.data || typeof data.data.score !== "number" || !data.data.beginnerConclusion) {
        setNotice("返回格式异常：后端没有返回完整拆解结果。");
        setResult(null);
        return;
      }

      setResult({ ...normalizeResponseData(data.data), mode: "ai" });
      setNotice("AI 深度拆解完成。请人工复核后再做选品决定。");
      setSavedRecordId("");
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      setNotice(isAbort ? "请求超时：AI 服务响应太慢，请稍后重试。" : "AI 请求失败，请稍后重试。");
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

  async function saveResult() {
    if (!result || isSaving) return;
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setNotice("保存失败：请先输入访问密码。");
      return;
    }
    if (!materialText.trim()) {
      setNotice("保存失败：素材文案不能为空。");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessPassword,
          title,
          platform,
          productUrl,
          materialText,
          source: result.mode,
          result,
        }),
      });
      const data = await response.json() as SaveResponse;

      if (!response.ok || !data.ok) {
        const message = data.ok ? "保存失败，请稍后重试。" : data.error.message;
        setNotice(message || "保存失败，请稍后重试。");
        return;
      }

      setSavedRecordId(data.data.id);
      setNotice("已保存到任务记录。可以去 /tasks 查看历史拆解。");
    } catch {
      setNotice("保存失败：本地任务记录接口暂时没有响应。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-5">
          <header className="workspace-header">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Overseas Trend Agent</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">海外爆款趋势拆解 Agent</h1>
                <p className="mt-1 text-sm muted-text">爆款趋势拆解能力 Alpha MVP：先用本地规则模拟，再按需接入 AI 做海外平台运营报告，服务于跨境电商运营 Agent 工作台的选品决策链路。AI 结论仅供辅助参考，关键动作人工确认。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="linear-pill px-3 py-1 text-sm font-semibold">
                  模拟拆解：不消耗额度
                </span>
                <span className="status-pill border-amber-200 bg-amber-50 text-amber-700 px-3 py-1 text-sm font-semibold">
                  AI 深度拆解：会消耗 AI 额度
                </span>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <div className="surface-card-strong p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                    <Sparkles className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-teal-700">海外市场运营报告</p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">输入海外素材，拆解跨境商品机会</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      先用模拟拆解验证结构；正式复核时，再让 AI 按平台差异拆标题、开头、评论互动和转化建议。
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {["素材拆解", "平台判断", "卖点提取", "风险提示"].map((item) => (
                    <div key={item} className="linear-panel bg-white/80 px-3 py-2 text-sm font-semibold text-slate-800">
                      {item}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  V2 预留：未来可联动关键词、找货、发布 Agent；当前仍需人工确认，不自动调用外部平台 API。
                </p>

                <button
                  type="button"
                  onClick={fillExample}
                  className="mt-4 inline-flex h-9 items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-4 text-xs font-semibold text-teal-700 transition hover:bg-teal-100"
                >
                  填入示例
                </button>
                {restored ? (
                  <p className="mt-3 rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-700">
                    已恢复上次未完成内容
                  </p>
                ) : null}

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">素材标题，可选</span>
                    <input
                    value={title}
                      onChange={(event) => {
                        setTitle(event.target.value.slice(0, 160));
                        setSavedRecordId("");
                      }}
                      placeholder="e.g. Portable USB-C mini blender"
                    className="input-soft h-11 w-full px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">商品/素材链接，可选</span>
                    <input
                      value={productUrl}
                      onChange={(event) => {
                        setProductUrl(event.target.value.slice(0, 400));
                        setSavedRecordId("");
                      }}
                      placeholder="可粘贴 TikTok、Amazon、Etsy、Shopify 等链接"
                      className="input-soft h-11 w-full px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    />
                  </label>
                </div>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">平台选择</span>
                  <select
                    value={platform}
                    onChange={(event) => {
                      setPlatform(event.target.value as AgentPlatform);
                      setSavedRecordId("");
                    }}
                    className="input-soft h-11 w-full px-4 text-sm text-slate-900 outline-none md:w-64"
                  >
                    {extendedPlatformOptions.map((item) => (
                      <option key={item} value={item}>{extendedPlatformLabels[item]}</option>
                    ))}
                  </select>
                </label>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">访问密码</span>
                  <input
                    value={accessPassword}
                    type="password"
                    onChange={(event) => {
                      setAccessPassword(event.target.value);
                      setAccessPasswordError("");
                    }}
                    placeholder="AI 深度拆解前需要填写"
                    className="input-soft h-11 w-full px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 md:w-80"
                  />
                  {accessPasswordError ? <p className="mt-2 text-sm font-semibold text-rose-600">{accessPasswordError}</p> : null}
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
                      setSavedRecordId("");
                    }}
                    rows={10}
                    placeholder="Paste title, selling points, comment feedback, price, use scenario. e.g. Portable blender, $19.99, comments asking about battery life..."
                    className="input-soft w-full px-4 py-3 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
                  />
                  {fieldError ? <p className="mt-2 text-sm font-semibold text-rose-600">{fieldError}</p> : null}
                </label>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={runMockAnalysis}
                    disabled={isAiLoading}
                    className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Wand2 className="h-4 w-4" />
                    生成模拟拆解
                  </button>
                  <button
                    type="button"
                    onClick={runAiAnalysis}
                    disabled={isAiLoading}
                    className="linear-button-soft inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                    AI 深度拆解
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearDraft();
                    setAccessPasswordError("");
                    setFieldError("");
                    setNotice("当前爆款拆解内容已清空，访问密码仍保留。");
                    setCopyState("idle");
                  }}
                  className="linear-button mt-3 inline-flex h-10 items-center justify-center px-4 text-sm font-semibold hover:text-red-700"
                >
                  清空当前内容
                </button>

                <div className="mt-4 flex gap-2 surface-card-soft rounded-[22px] px-4 py-3 text-sm leading-6 text-teal-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{notice}</span>
                </div>
              </div>

              {result ? (
                <div className="space-y-5">
                  <section className="surface-card p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-teal-700">
                          {result.mode === "mock" ? "模拟拆解：规则演示" : "AI 深度拆解：运营报告"}
                        </p>
                        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                          爆款潜力：{result.level}
                        </h2>
                        <div className="mt-3 surface-card-soft rounded-[22px] p-4">
                          <p className="text-xs font-semibold text-teal-700">一句话判断</p>
                          <p className="mt-2 text-sm leading-6 text-slate-700">{result.oneLineSummary}</p>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-600">{result.beginnerConclusion}</p>
                      </div>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className={"linear-pill px-5 py-4 text-center " + getLevelClass(result.level)}>
                          <p className="text-xs font-semibold">爆款潜力评分</p>
                          <p className="mt-1 text-2xl font-semibold text-slate-950">{result.score}</p>
                        </div>
                        <button
                          type="button"
                          onClick={copyResult}
                          className="linear-button inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold"
                        >
                          {copyState === "copied" ? <CheckCircle2 className="h-4 w-4 text-teal-600" /> : <Clipboard className="h-4 w-4" />}
                          {copyState === "copied" ? "已复制" : "复制结果"}
                        </button>
                        <button
                          type="button"
                          onClick={() => result && exportMarkdown(result, title)}
                          className="linear-button inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold"
                        >
                          <Download className="h-4 w-4" />
                          导出 Markdown
                        </button>
                        <button
                          type="button"
                          onClick={saveResult}
                          disabled={isSaving}
                          className="linear-button-soft inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          {savedRecordId ? "已保存" : "保存到任务记录"}
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
                    <SimpleList title="开头钩子" items={result.hooks} />
                    <SimpleList title="标题建议" items={result.titleSuggestions} />
                    <SimpleList title="短视频开头" items={result.videoOpenings} />
                    <SimpleList title="评论区话题" items={result.commentTriggers} />
                    <SimpleList title="转化优化" items={result.conversionSuggestions} />
                    <SimpleList title="风险提醒" items={result.risks} />
                  </section>
                </div>
              ) : null}
            </div>

            <aside className="space-y-4">
              <section className="sticky top-4 surface-card p-4">
                <p className="text-sm font-semibold text-teal-700">怎么用</p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">先模拟，再决定要不要消耗 AI</h2>
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <p className="flex gap-2">
                    <ClipboardList className="mt-1 h-4 w-4 shrink-0 text-teal-600" />
                    填写海外平台素材文案，标题和链接可以先不填。
                  </p>
                  <p className="flex gap-2">
                    <Wand2 className="mt-1 h-4 w-4 shrink-0 text-teal-600" />
                    模拟拆解只跑本地规则，不请求后端、不消耗额度。
                  </p>
                  <p className="flex gap-2">
                    <Brain className="mt-1 h-4 w-4 shrink-0 text-amber-600" />
                    AI 深度拆解会请求后端接口并消耗 AI 额度，适合正式复核。
                  </p>
                </div>
              </section>
            </aside>
          </section>

          {/* 工作流建议与人工确认 */}
          {result ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <WorkflowNextStepCard taskType="viral" />
              <ManualReviewChecklist />
            </div>
          ) : null}

          {/* 下一步 */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-600">分析完成 → 下一步</p>
                <p className="mt-1 text-sm text-slate-500">拆解完了，去任务中心查看所有海外爆款分析记录。</p>
              </div>
              <Link href="/tasks" className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold">
                任务记录 →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
