"use client";

import { useState } from "react";
import {
  FileText, Tag, ListChecks, Search, Image, ClipboardCheck,
  ShieldAlert, ChevronDown, ChevronRight, AlertTriangle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  types                                                              */
/* ------------------------------------------------------------------ */

export type ListingPrepInput = {
  title?: string;
  keywords?: string[];
  complianceNotes?: string[];
};

export type ListingPrepRiskInput = {
  overallLevel?: string;
  summary?: string;
  blacklistMatches?: string[];
  complianceWarnings?: string[];
};

export type ListingPrepFinalReport = {
  finalVerdict?: string;
  riskLevel?: string;
  beginnerFit?: string;
  mustCheckBeforeListing?: string[];
  nextSteps?: string[];
};

export type ListingPrepProps = {
  listing?: ListingPrepInput | null;
  riskReviewSnapshot?: ListingPrepRiskInput | Record<string, unknown> | null;
  finalReport?: ListingPrepFinalReport | Record<string, unknown> | null;
  productName?: string;
  /** hide the outer card border so it can be embedded inside another card */
  embedded?: boolean;
};

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function text(v: unknown, fallback: string): string {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return fallback;
}

function text2(a: string | undefined | null, b: string | undefined | null, fallback: string): string {
  const r = text(a, "");
  if (r) return r;
  const r2 = text(b, "");
  if (r2) return r2;
  return fallback;
}

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return [];
}

const MISSING = "待人工补充";
const PLACEHOLDER_IMG = "根据产品类型和平台要求准备";

/* ------------------------------------------------------------------ */
/*  collapsible section                                                */
/* ------------------------------------------------------------------ */

function Section({
  icon: Icon,
  title,
  defaultOpen = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 bg-white/80">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <Icon className="size-4 shrink-0 text-slate-500" />
        <span className="flex-1">{title}</span>
        {open ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
      </button>
      {open && <div className="border-t border-slate-100 px-3 py-3">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  main component                                                     */
/* ------------------------------------------------------------------ */

export function ListingPrepPackageCard({
  listing,
  riskReviewSnapshot,
  finalReport,
  productName,
  embedded = false,
}: ListingPrepProps) {
  const title = text(listing?.title, productName || "待分析商品");
  const keywords = arr(listing?.keywords);
  const notes = arr(listing?.complianceNotes);

  const riskLevel = text2(
    (riskReviewSnapshot as ListingPrepRiskInput | null)?.overallLevel,
    (finalReport as ListingPrepFinalReport | null)?.riskLevel,
    "unknown",
  );

  const riskWarnings = [
    ...arr((riskReviewSnapshot as ListingPrepRiskInput | null)?.complianceWarnings),
    ...notes,
  ];

  const hasListing = listing && (title !== MISSING || keywords.length > 0 || notes.length > 0);

  /* ---- derived data ---- */
  const coreWords = keywords.slice(0, 3);
  const longTailWords = keywords.slice(3, 8);
  const sceneWords: string[] = []; // could be derived from summary, but we keep it as placeholder
  const crowdWords: string[] = [];

  const content = (
    <div className="space-y-2">
      {/* ── summary bar ── */}
      <div className="grid gap-2 rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-xs font-semibold text-teal-600">推荐标题</span>
          <p className="mt-0.5 truncate font-semibold text-teal-900" title={hasListing ? title : undefined}>
            {hasListing ? title : MISSING}
          </p>
        </div>
        <div>
          <span className="text-xs font-semibold text-teal-600">核心关键词</span>
          <p className="mt-0.5 text-teal-900">
            {coreWords.length > 0 ? coreWords.join("、") : <span className="text-slate-400">{MISSING}</span>}
          </p>
        </div>
        <div>
          <span className="text-xs font-semibold text-teal-600">待补料项</span>
          <p className="mt-0.5 font-semibold text-teal-900">
            {hasListing ? "至少 5 项（尺寸/材质/认证/包装/合规）" : "全部待人工补充"}
          </p>
        </div>
        <div>
          <span className="text-xs font-semibold text-teal-600">合规提醒</span>
          <p className="mt-0.5 font-semibold text-teal-900">
            {riskLevel === "red" || riskLevel === "yellow" ? "有重点风险，需人工复核" : "低风险预筛，仍需人工确认"}
          </p>
        </div>
      </div>

      {/* ── 1. 关键词池 ── */}
      <Section icon={Tag} title="关键词池">
        <div className="space-y-3 text-sm leading-6 text-slate-700">
          <div>
            <p className="font-semibold text-slate-800">核心词</p>
            <p className={coreWords.length > 0 ? "text-slate-600" : "italic text-slate-400"}>
              {coreWords.length > 0 ? coreWords.join("、") : MISSING}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">长尾词</p>
            <p className={longTailWords.length > 0 ? "text-slate-600" : "italic text-slate-400"}>
              {longTailWords.length > 0 ? longTailWords.join("、") : "需要结合平台搜索建议和竞品词补充"}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">场景词</p>
            <p className="italic text-slate-400">{MISSING}（根据使用场景补充）</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">人群词</p>
            <p className="italic text-slate-400">{MISSING}（明确目标人群后补充）</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">属性词</p>
            <p className="italic text-slate-400">{MISSING}（尺寸、材质、颜色、规格等）</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-2">
            <p className="font-semibold text-amber-800">⚠️ 风险词 / 禁用词提醒</p>
            <p className="mt-0.5 text-amber-700">
              避免品牌词、竞品词和侵权词。不使用绝对化宣传词（&ldquo;最好&rdquo;&ldquo;第一&rdquo;&ldquo;100%&rdquo;）、医疗功效词、未经核实的认证词。
              {riskWarnings.length > 0 && (
                <span className="mt-1 block">预筛提示：{riskWarnings.slice(0, 3).join("；")}</span>
              )}
            </p>
          </div>
        </div>
      </Section>

      {/* ── 2. 标题结构 ── */}
      <Section icon={FileText} title="标题结构">
        <div className="space-y-2 text-sm leading-6 text-slate-700">
          <p className="text-slate-500">标题公式：核心词 + 属性词 + 场景词 / 人群词</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">{hasListing ? title : "【标题待生成】"}</p>
          </div>
          <p className="text-slate-500">拆解：</p>
          <ul className="ml-4 list-disc space-y-0.5 text-slate-600">
            <li>核心词：{coreWords.length > 0 ? coreWords.join("、") : MISSING}</li>
            <li>需要人工确认：品牌名是否允许出现在标题中、是否有平台标题字符限制、不得承诺平台合规或无侵权。</li>
          </ul>
        </div>
      </Section>

      {/* ── 3. 五点描述草稿 ── */}
      <Section icon={ListChecks} title="五点描述草稿">
        <div className="space-y-2 text-sm leading-6 text-slate-700">
          <p className="text-slate-500">以下为结构模板，需人工补充具体参数和卖点。不包含无法验证的夸张承诺。</p>
          <ol className="ml-4 list-decimal space-y-1.5">
            <li>
              <span className="font-semibold">核心使用场景</span>
              <span className="ml-1 italic text-slate-400">— {MISSING}（适用于什么场景、解决什么问题）</span>
            </li>
            <li>
              <span className="font-semibold">材质 / 尺寸 / 兼容性</span>
              <span className="ml-1 italic text-slate-400">— {MISSING}（精确的尺寸、材质、重量、适配型号）</span>
            </li>
            <li>
              <span className="font-semibold">安装 / 使用方式</span>
              <span className="ml-1 italic text-slate-400">— {MISSING}（是否需要安装、使用步骤、便利性）</span>
            </li>
            <li>
              <span className="font-semibold">包装 / 配件</span>
              <span className="ml-1 italic text-slate-400">— {MISSING}（包装清单、包含配件、赠品）</span>
            </li>
            <li>
              <span className="font-semibold">售后 / 注意事项</span>
              <span className="ml-1 italic text-slate-400">— {MISSING}（质保期、退换货政策、使用提醒、安全警告）</span>
            </li>
          </ol>
        </div>
      </Section>

      {/* ── 4. Search Terms 准备 ── */}
      <Section icon={Search} title="Search Terms 准备">
        <div className="space-y-2 text-sm leading-6 text-slate-700">
          <p className="text-slate-500">后台搜索词草稿（由关键词去重组合）：</p>
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-2">
            {keywords.length > 0 ? (
              <p className="text-slate-700">{keywords.join(" ")}</p>
            ) : (
              <p className="italic text-slate-400">{MISSING}</p>
            )}
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-amber-700">
            <li>需根据平台后台规则人工调整。</li>
            <li>不要重复标题中已有的核心词过多。</li>
            <li>避免品牌词、竞品词和侵权词。</li>
            <li>使用单数/复数、同义词、常见拼写错误变体。</li>
          </ul>
        </div>
      </Section>

      {/* ── 5. 图片与素材需求 ── */}
      <Section icon={Image} title="图片与素材需求">
        <div className="space-y-2 text-sm leading-6 text-slate-700">
          <p className="text-slate-500">建议准备以下图片（{PLACEHOLDER_IMG}）：</p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li><span className="font-semibold">主图</span>：白底产品图，展示产品全貌，至少 1000×1000px。</li>
            <li><span className="font-semibold">场景图</span>：产品在实际使用场景中的展示。</li>
            <li><span className="font-semibold">尺寸 / 参数图</span>：标注关键尺寸、重量、规格参数。</li>
            <li><span className="font-semibold">细节图</span>：材质纹理、接口、按键、Logo 等特写。</li>
            <li><span className="font-semibold">包装 / 配件图</span>：包装外观、内含配件全家福。</li>
            <li><span className="font-semibold">对比图 / 使用步骤图</span>：如有竞品对比或使用步骤展示。</li>
            <li><span className="font-semibold">证书 / 资质 / 警示图</span>：如产品涉及认证（CE/FCC/CPC 等），准备证书或警示标识图。</li>
          </ul>
        </div>
      </Section>

      {/* ── 6. 人工补料清单 ── */}
      <Section icon={ClipboardCheck} title="人工补料清单" defaultOpen>
        <div className="space-y-2 text-sm leading-6 text-slate-700">
          <p className="text-slate-500">以下信息需要从供应商或平台规则确认后手动补充：</p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>精确的产品尺寸（长 × 宽 × 高 / 直径）</li>
            <li>材质成分（如塑料类型、金属牌号、面料成分）</li>
            <li>产品净重和包装后毛重</li>
            <li>适配型号 / 兼容性信息</li>
            <li>包装清单（主件 ×1、配件 ×N、说明书等）</li>
            <li>认证文件（CE / FCC / CPC / RoHS / MSDS 等）</li>
            <li>供应商授权书 / 品牌授权书</li>
            <li>商标 / 专利 / 外观设计核查结果</li>
            <li>平台规则限制（如亚马逊类目要求、危险品审核）</li>
            <li>目标市场当地法规要求（如加州 Prop 65、欧盟 REACH）</li>
          </ul>
        </div>
      </Section>

      {/* ── 7. 合规表达提醒 ── */}
      <Section icon={ShieldAlert} title="合规表达提醒" defaultOpen>
        <div className="space-y-2 text-sm leading-6">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="text-amber-800">
              <p className="font-semibold">建议人工复核</p>
              <p className="mt-0.5">
                Listing 上架准备包不能替代平台规则、商标专利和当地法规核查。
                所有内容在发布前需由运营人员人工最终确认。
                系统只做预筛和建议，不构成合规、法律或商业决策依据。
              </p>
            </div>
          </div>
          {notes.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <p className="font-semibold text-slate-700">AI 生成的合规备注</p>
              <ul className="mt-1 ml-4 list-disc space-y-0.5 text-slate-600">
                {notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      </Section>
    </div>
  );

  if (embedded) return content;

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4" data-testid="listing-prep-package">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="size-5 text-teal-700" />
        <h3 className="text-base font-bold text-teal-900">Listing 上架准备包</h3>
      </div>
      <p className="mb-3 text-sm leading-6 text-teal-700">
        用于人工复核和上架前准备，不能替代平台规则、商标专利和当地法规核查。
      </p>
      {content}
    </div>
  );
}

export default ListingPrepPackageCard;
