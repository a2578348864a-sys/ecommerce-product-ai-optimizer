"use client";

import { useState } from "react";
import {
  Search,
  FileText,
  CheckCircle2,
  FileCheck,
  GitMerge,
  ShieldCheck,
  ArrowRight,
  Database,
  Layers,
  Sparkles,
} from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";

interface ShowcaseWorkflowProps {
  workflow: ShowcaseContent["workflow"];
}

const STEP_ICONS = [Search, FileText, CheckCircle2, FileCheck];

interface StepInspectionDetail {
  phase: string;
  name: string;
  badge: string;
  isGate?: boolean;
  input: {
    label: string;
    items: string[];
  };
  rules: {
    label: string;
    items: string[];
  };
  output: {
    label: string;
    items: string[];
  };
}

const STEP_INSPECTIONS: StepInspectionDetail[] = [
  {
    phase: "第 1 步",
    name: "全网搜集真实资料",
    badge: "一键汇总",
    input: {
      label: "帮您找来的真实资料",
      items: [
        "亚马逊同行热搜词与大盘热度",
        "同行爆款竞品页面真实卖点",
        "买家真实原声差评与吐槽痛点",
        "1688 源头工厂出厂规格与阶梯底价",
      ],
    },
    rules: {
      label: "系统初筛过滤",
      items: [
        "自动过滤网页乱码与无效广告词",
        "统一度量衡（英寸/厘米）与汇率换算",
        "严格记录每一条资料的具体网址和出处",
      ],
    },
    output: {
      label: "这一步整理出的结果",
      items: [
        "一目了然的备选资料池",
        "每一句话都能追溯到原始出处，不乱抄",
      ],
    },
  },
  {
    phase: "第 2 步",
    name: "过滤吹牛假大空",
    badge: "去假存真",
    input: {
      label: "待核对的真实素材",
      items: [
        "同行竞品宣称与工厂实测数据对照",
        "买家吐槽最多的质量痛点",
      ],
    },
    rules: {
      label: "系统严格把关",
      items: [
        "无出厂质检凭据的夸大宣传直接标红隔离",
        "不同渠道数据冲突（如12oz与24oz）单独提醒",
        "杜绝不靠谱的自动猜测，不确定的绝不乱写",
      ],
    },
    output: {
      label: "这一步整理出的结果",
      items: [
        "过滤后的靠谱候选卖点清单",
        "虚标和吹牛的词汇已被自动清理",
      ],
    },
  },
  {
    phase: "第 3 步",
    name: "运营一眼核对",
    badge: "关键一步 · 杜绝瞎编",
    isGate: true,
    input: {
      label: "展示给您过目的内容",
      items: [
        "整理好的真实卖点备选清单",
        "1688 工厂出厂报告与参数凭据",
      ],
    },
    rules: {
      label: "核对放行原则",
      items: [
        "哪些是真卖点，您一眼过目点勾选确认",
        "吹牛宣称（如航天钛金、3秒结冰）一票否决",
        "只有您核对放行的内容，AI 才能拿去写文案",
      ],
    },
    output: {
      label: "这一步整理出的结果",
      items: [
        "权威可信的商品卖点库",
        "AI 创作的唯一依据，彻底堵死 AI 瞎编漏洞",
      ],
    },
  },
  {
    phase: "第 4 步",
    name: "自动出文案与图片",
    badge: "一键上架",
    input: {
      label: "AI 写作与出图依据",
      items: [
        "您亲自确认过的真实商品卖点",
        "亚马逊高转化标题与 5 点描述标准模板",
      ],
    },
    rules: {
      label: "成稿质量把关",
      items: [
        "文案每一句修饰都必须符合真实参数",
        "图片严格按照工厂真实材质和尺寸生成",
        "坚决不搞不可控的自动上架，运营满意再用",
      ],
    },
    output: {
      label: "这一步整理出的结果",
      items: [
        "合规地道的亚马逊英文 Listing 文案",
        "超清商品场景图与白底主图素材包",
      ],
    },
  },
];

export function ShowcaseWorkflow({ workflow }: ShowcaseWorkflowProps) {
  // 默认高亮检视第 3 阶段（核心事实门禁）
  const [activeStep, setActiveStep] = useState<number>(2);
  const activeDetail = STEP_INSPECTIONS[activeStep] || STEP_INSPECTIONS[2];

  return (
    <section className="w-full py-12 sm:py-20 bg-white border-b border-slate-200/60" aria-labelledby="workflow-heading">
      <div className="mx-auto max-w-5xl px-3.5 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-grass-200 bg-grass-50 px-3 py-1 text-xs font-semibold tracking-wide text-grass-700 shadow-xs">
            <GitMerge className="size-3.5" aria-hidden="true" />
            <span>工作流全景图</span>
          </div>
          <h2
            id="workflow-heading"
            className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-4xl"
          >
            {workflow.sectionTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            {workflow.sectionSubtitle}
          </p>
        </div>

        {/* 工业流水线卡片导轨 */}
        <div className="relative mt-8 sm:mt-12">
          {/* 背景横向贯通虚线与流动光子脉冲（大屏可见） */}
          <div
            className="pointer-events-none absolute top-1/2 left-6 right-6 -translate-y-1/2 hidden lg:block h-0.5 border-t-2 border-dashed border-grass-200 overflow-hidden"
            aria-hidden="true"
          >
            {/* 循环流动的青草绿发光脉冲光束 1 */}
            <div className="absolute top-0 h-2 w-28 -translate-y-1/2 bg-gradient-to-r from-transparent via-grass-500 to-transparent blur-2xs animate-pulse-flow" />
            {/* 伴随光子数据包微粒 2（错开延迟） */}
            <div
              className="absolute top-0 h-2 w-16 -translate-y-1/2 bg-gradient-to-r from-transparent via-emerald-400 to-transparent blur-2xs animate-pulse-flow"
              style={{ animationDelay: "1.6s" }}
            />
          </div>

          {/* 四大阶段可交互卡片 */}
          <div className="relative grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {workflow.steps.map((item, index) => {
              const Icon = STEP_ICONS[index] || FileText;
              const isGate = index === 2; // Human Confirmed Facts 门禁核心
              const isSelected = activeStep === index;

              return (
                <button
                  type="button"
                  key={item.step}
                  onClick={() => setActiveStep(index)}
                  className={`relative flex flex-col justify-between rounded-2xl p-4 sm:p-5 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-grass-500 ${
                    isSelected
                      ? isGate
                        ? "border-2 border-amber-400 bg-amber-50/70 shadow-grass-sm -translate-y-1"
                        : "border-2 border-grass-500 bg-grass-50/40 shadow-grass-sm -translate-y-1"
                      : isGate
                      ? "border-2 border-amber-300/80 bg-amber-50/30 hover:border-amber-400 hover:-translate-y-0.5"
                      : "border border-slate-200/90 bg-white hover:border-grass-300 hover:bg-slate-50/50 hover:-translate-y-0.5"
                  }`}
                  aria-pressed={isSelected}
                  aria-label={`查看第 ${item.step} 阶段：${item.title} 的工程检视详情`}
                >
                  {/* 核心把关标志 */}
                  {isGate && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-[9px] sm:text-[10px] font-extrabold tracking-wide text-white shadow-xs whitespace-nowrap">
                      <span className="relative flex size-1.5">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                      </span>
                      <span>核心把关 · 杜绝瞎编</span>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between">
                      <span
                        className={`flex size-9 sm:size-10 items-center justify-center rounded-xl ${
                          isGate ? "bg-amber-100 text-amber-800" : "bg-grass-50 text-grass-700"
                        }`}
                      >
                        <Icon className="size-4 sm:size-5" aria-hidden="true" />
                      </span>
                      <span className="font-mono text-xs font-extrabold text-slate-400">
                        {item.step}
                      </span>
                    </div>

                    <h3 className="mt-3 text-sm sm:text-base font-bold tracking-tight text-slate-900">
                      {item.title}
                    </h3>

                    <p
                      className={`mt-0.5 text-xs font-bold ${
                        isGate ? "text-amber-800" : "text-grass-700"
                      }`}
                    >
                      {item.summary}
                    </p>

                    <p className="mt-1.5 text-[11px] sm:text-xs leading-relaxed text-slate-600">
                      {item.desc}
                    </p>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100/90 flex items-center justify-between text-[10px] sm:text-[11px]">
                    <span className="text-slate-400 font-medium">第 0{index + 1} 步</span>
                    <span
                      className={`font-bold transition-colors ${
                        isSelected
                          ? isGate
                            ? "text-amber-900"
                            : "text-grass-800 font-extrabold"
                          : "text-slate-500"
                      }`}
                    >
                      {isSelected ? "查看中 ↓" : "点击看详情"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 步进式流程检视器（Step Inspector Panel） */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6 shadow-soft transition-all">
            {/* 检视器标题栏 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div
                  className={`flex size-6 items-center justify-center rounded-lg font-mono text-xs font-black ${
                    activeDetail.isGate
                      ? "bg-amber-500 text-white"
                      : "bg-grass-600 text-white"
                  }`}
                >
                  {activeStep + 1}
                </div>
                <h4 className="text-sm sm:text-base font-extrabold text-slate-950">
                  {activeDetail.phase} · {activeDetail.name}
                </h4>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                    activeDetail.isGate
                      ? "bg-amber-50 border-amber-200 text-amber-900"
                      : "bg-grass-50 border-grass-200 text-grass-800"
                  }`}
                >
                  {activeDetail.badge}
                </span>
              </div>

              <div className="text-[11px] text-slate-400">
                💡 点击上方任一卡片，看看这一步是怎么帮您把关的
              </div>
            </div>

            {/* 3 栏明细：输入证据包 → 怎么把关 → 得到的结果 */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
              {/* 栏 1：找来的素材 */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 pb-2 border-b border-slate-200/60">
                    <Layers className="size-3.5 text-slate-500" />
                    <span>{activeDetail.input.label}</span>
                  </div>
                  <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600">
                    {activeDetail.input.items.map((it, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-slate-400 font-bold shrink-0">•</span>
                        <span className="leading-snug">{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-3 text-[10px] font-semibold text-slate-400 text-right">
                  全网真实资料汇总
                </div>
              </div>

              {/* 栏 2：怎么把关 */}
              <div
                className={`rounded-xl border p-3.5 flex flex-col justify-between ${
                  activeDetail.isGate
                    ? "border-amber-300 bg-amber-50/60"
                    : "border-slate-200/80 bg-slate-50/70"
                }`}
              >
                <div>
                  <div
                    className={`flex items-center gap-1.5 text-xs font-bold pb-2 border-b ${
                      activeDetail.isGate
                        ? "text-amber-950 border-amber-200/80"
                        : "text-slate-800 border-slate-200/60"
                    }`}
                  >
                    <ShieldCheck
                      className={`size-3.5 ${
                        activeDetail.isGate ? "text-amber-600" : "text-grass-600"
                      }`}
                    />
                    <span>{activeDetail.rules.label}</span>
                  </div>
                  <ul
                    className={`mt-2.5 space-y-1.5 text-xs ${
                      activeDetail.isGate ? "text-amber-900" : "text-slate-600"
                    }`}
                  >
                    {activeDetail.rules.items.map((it, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span
                          className={`font-bold shrink-0 ${
                            activeDetail.isGate ? "text-amber-500" : "text-grass-500"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="leading-snug font-medium">{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div
                  className={`mt-3 text-[10px] font-bold text-right ${
                    activeDetail.isGate ? "text-amber-800" : "text-slate-400"
                  }`}
                >
                  {activeDetail.isGate ? "运营亲手把关，绝不放行吹牛词" : "系统自动规则初筛"}
                </div>
              </div>

              {/* 栏 3：得到的结果 */}
              <div className="rounded-xl border border-grass-200/90 bg-grass-50/40 p-3.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-grass-950 pb-2 border-b border-grass-200/70">
                    <Sparkles className="size-3.5 text-grass-600" />
                    <span>{activeDetail.output.label}</span>
                  </div>
                  <ul className="mt-2.5 space-y-1.5 text-xs text-grass-950">
                    {activeDetail.output.items.map((it, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-grass-600 font-bold shrink-0">→</span>
                        <span className="leading-snug font-semibold">{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-3 text-[10px] font-bold text-grass-800 text-right">
                  放心拿去用 · 随时可上架
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
