import React, { useState } from "react";
import { REQUIRED_FACT_KIND_SOURCES } from "@/lib/imageHandoff/purposeRequirements";

/** 已确认事实的展示投影：`field` = canonical 字段名（与服务端事实门禁同源；缺失时为空串）。 */
export type VisualGenerationBriefFact = {
  field?: string;
  label: string;
  value: string;
};

/** 商品身份可见性：`value === null` 表示未确认（UI 显示「未确认」，绝不猜测填充）。 */
export type VisualGenerationPreviewIdentity = {
  /** canonical 字段名：brand / series_or_model / color_or_variant / quantity_or_pack_size */
  key: string;
  label: string;
  value: string | null;
};

/** 尚缺资料与可执行下一步（全部来自已有 state 的门禁结果与配方要求）。 */
export type VisualGenerationPreviewGap = {
  label: string;
  nextStep: string;
};

/**
 * 生成前方案预览（任务链路）。
 * 数据全部来自 ImageHandoffSection 已有 state 与共享 Recipe 解析：不新增 API、不新增请求，
 * 也不展示 schema / factId / referenceOnly / fingerprint / provider / selectionId / 原始 Prompt 全文。
 */
export type VisualGenerationPreview = {
  /** 生成类型（二选一，由服务端状态决定） */
  generationType: "product_visual_draft" | "composition_concept" | null;
  productName: string;
  approvedReferenceCount: number;
  identity: VisualGenerationPreviewIdentity[];
  buyerQuestion: string;
  factsUsed: VisualGenerationBriefFact[];
  requiredFactKinds: readonly string[];
  composition: string;
  /** 中文构图方向摘要（来自视觉资产规划的中文说明）；主展示用中文，英文配方原文收进折叠区 */
  compositionLabel: string;
  backgroundPolicy: string;
  styleLabel: string;
  /** null = 配方尚未提供该字段（不猜测为 true/false） */
  textAllowed: boolean | null;
  textPolicy: string;
  negativeConstraints: string[];
  gaps: VisualGenerationPreviewGap[];
};

export interface VisualGenerationBriefCardProps {
  mode: "task" | "standalone";
  assetTitle: string;
  categoryLabel?: string;
  goal: string;
  confirmedFacts?: VisualGenerationBriefFact[];
  facts?: VisualGenerationBriefFact[];
  strategy: {
    purposeLabel: string;
    sceneLabel?: string;
    styleLabel: string;
    rationale?: string;
  };
  constraints: string[];
  referenceNotice: {
    title: string;
    description: string;
    isComposition: boolean;
  };
  customPromptSummary?: string;
  /** 任务链路生成前方案预览；独立创作模式不传（不显示研究事实驱动的预览）。 */
  preview?: VisualGenerationPreview | null;
}

/**
 * canonical 事实字段名 → 中文（仅 UI 文案；未收录时原样显示字段名，绝不显示 undefined）。
 * 字段名口径与 `lib/imageHandoff/purposeRequirements.ts` 的 canonical 白名单一致。
 */
export const FACT_KIND_LABELS: Record<string, string> = {
  brand: "品牌",
  series_or_model: "系列或型号",
  color_or_variant: "颜色或款式",
  quantity_or_pack_size: "数量或包装",
  product_type: "商品类型",
  material: "材质",
  materials: "材质",
  dimensions: "尺寸",
  product_dimensions: "商品尺寸",
  package_dimensions: "包装尺寸",
  width: "宽度",
  height: "高度",
  length: "长度",
  depth: "深度",
  diameter: "直径",
  size: "规格尺寸",
  capacity: "容量",
  weight: "重量",
  packaging: "包装",
  bundle: "套装",
  set: "套装",
  included_items: "内含物",
  package_contents: "包装清单",
  accessories: "配件",
  units_per_package: "每包数量",
  operation: "操作方式",
  usage: "使用方式",
  usage_steps: "使用步骤",
  usage_method: "使用方式",
  how_to_use: "使用方式",
  functional_feature: "功能特性",
  features: "功能特征",
  feature: "功能特征",
  // Recipe requiredFactKinds 的「证据类别」语义（purposeRequirements 的 RequiredFactKind）
  selling_point_fact: "卖点/功能特征",
  dimension_fact: "尺寸/规格",
  packaging_fact: "包装/套装",
  usage_fact: "使用方式",
};

export function factKindLabel(kind: string): string {
  return FACT_KIND_LABELS[kind] ?? kind;
}

type RequiredFactEvidenceSource = {
  evidence: (facts: readonly { field: string; label: string; value: string }[]) => boolean;
};

const REQUIRED_FACT_EVIDENCE_BY_KIND = REQUIRED_FACT_KIND_SOURCES as unknown as
  Readonly<Record<string, RequiredFactEvidenceSource | undefined>>;

/**
 * 判断一条已确认事实是否属于 Recipe 要求的事实种类（`requiredFactKinds`）。
 * 兼容该字段已冻结名称下的两种语义，避免与并行实现进度互相阻塞：
 * 1. canonical 字段名（`dimensions` / `material`）：直接比较 `fact.field`；
 * 2. 证据类别（`dimension_fact` 等）：复用 `purposeRequirements` 既有 evidence 判定，
 *    与服务端事实门禁 100% 同源（不复制字段白名单，也不放宽门禁）。
 */
export function factSatisfiesRequiredKind(fact: VisualGenerationBriefFact, kind: string): boolean {
  if (fact.field && fact.field === kind) return true;
  const evidence = REQUIRED_FACT_EVIDENCE_BY_KIND[kind]?.evidence;
  if (typeof evidence !== "function") return false;
  return evidence([{ field: fact.field ?? "", label: fact.label, value: fact.value }]);
}

/**
 * 按 `requiredFactKinds` 选择本次生成实际会使用的已确认事实。
 * kinds 为空时返回全部事实（不猜测、也不额外收紧）；只做「事实是否属于该种类」的判定。
 */
export function selectPreviewFacts(
  facts: readonly VisualGenerationBriefFact[],
  requiredFactKinds: readonly string[],
): VisualGenerationBriefFact[] {
  if (requiredFactKinds.length === 0) return [...facts];
  return facts.filter((fact) => requiredFactKinds.some((kind) => factSatisfiesRequiredKind(fact, kind)));
}

/** Recipe backgroundPolicy → 中文（未提供时显示占位说明，不显示 undefined）。 */
export function backgroundPolicyLabel(policy: string): string {
  if (policy === "pure_white") return "纯白背景（平台主图合规）";
  if (policy === "neutral") return "中性简洁背景（突出商品主体）";
  if (policy === "scene") return "真实生活场景背景";
  return "配方未标注背景策略";
}

/** 生成类型文案（二选一，必须明确区分）。 */
export const GENERATION_TYPE_LABELS = {
  product_visual_draft: "基于已批准的商品参考图生成",
  composition_concept: "构图概念稿，不用于证明商品外观",
} as const;

/**
 * 按词边界截断长商品名：不在英文/型号词中间断开，也不产生无意义断词。
 * - 优先在最近的空白/斜杠/中点处断词；
 * - 中文长标题无空白可依时按字符断句（相邻字符仍是完整表意单位），
 *   但会退到最后一个 ASCII 字母数字串边界，避免把 `Stainless` 截成 `Stainl`。
 */
export function truncateAtWordBoundary(value: string, maxLength = 48): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const max = Math.max(1, maxLength);
  const cut = text.slice(0, max);
  const boundaryChars = [" ", "\u3000", "/", "·", "|", ","];
  const lastBoundary = Math.max(...boundaryChars.map((char) => cut.lastIndexOf(char)));
  if (lastBoundary >= Math.floor(max * 0.6)) {
    const head = cut.slice(0, lastBoundary).replace(/[\s/\u3000·|,]+$/u, "");
    if (head) return `${head}…`;
  }
  let safeCut = cut;
  while (
    safeCut.length > 0
    && /[A-Za-z0-9]$/u.test(safeCut)
    && /[A-Za-z0-9]/u.test(text.charAt(safeCut.length))
  ) {
    safeCut = safeCut.slice(0, -1);
  }
  const tail = safeCut.replace(/[\s/\u3000·|,]+$/u, "");
  return `${tail || cut}…`;
}

function generationTypeLabel(generationType: VisualGenerationPreview["generationType"]) {
  if (generationType === "product_visual_draft") return GENERATION_TYPE_LABELS.product_visual_draft;
  if (generationType === "composition_concept") return GENERATION_TYPE_LABELS.composition_concept;
  return "尚未确定（当前不可生成）";
}

function PreviewItem({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-2.5"
      data-testid={`brief-preview-item-${index}`}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-200/80 px-1 font-mono text-[11px] text-slate-700">
          {index}
        </span>
        <span>{title}</span>
      </p>
      <div className="mt-1.5 space-y-1 text-xs leading-relaxed text-slate-800">{children}</div>
    </li>
  );
}

export function VisualGenerationBriefCard({
  mode,
  assetTitle,
  categoryLabel,
  goal,
  confirmedFacts,
  facts,
  strategy,
  constraints,
  referenceNotice,
  customPromptSummary,
  preview,
}: VisualGenerationBriefCardProps) {
  const isTask = mode === "task";
  const displayFacts = facts ?? confirmedFacts ?? [];
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const previewData = isTask ? preview ?? null : null;
  const productNameText = truncateAtWordBoundary(previewData?.productName ?? "", 48) || "未命名商品";

  return (
    <div
      className="overflow-hidden rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50/40 via-white to-slate-50/60 p-4 shadow-sm"
      data-testid="visual-generation-brief-card"
    >
      {/* 顶部标题栏 (H2 Level) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-600 text-xs font-black text-white shadow-xs">
            AI
          </span>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">
            AI 视觉方案
          </h3>
          <span className="rounded-full bg-teal-100/80 px-2 py-0.5 text-[11px] font-semibold text-teal-800">
            {isTask ? "研究事实驱动" : "自由创意模式"}
          </span>
        </div>
        {categoryLabel ? (
          <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
            {categoryLabel}
          </span>
        ) : null}
      </div>

      {/* 五要素内容 */}
      <div className="mt-3.5 space-y-3.5 text-xs">
        {/* 01: 资产定位与生成目标 (始终直观展示) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              01 视觉资产定位与目标
            </h4>
            <span className="rounded bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">
              {assetTitle}
            </span>
          </div>
          <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-800">
            {goal}
          </p>
        </div>

        {/* 生成前方案预览（任务链路）：8 项全部来自已有 state，始终可见（移动端也不折叠），
            因为用户必须在点击生成之前确认这些内容。 */}
        {previewData ? (
          <section
            className="rounded-xl border border-teal-300/70 bg-white p-3 shadow-2xs"
            data-testid="visual-generation-brief-preview"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                00 生成前方案预览
              </h4>
              <span className="rounded bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">
                生成前请逐项确认 · 共 8 项
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              以下内容来自本次研究记录与当前选择，点击下方「生成图片」后按此执行。
            </p>

            <ol className="mt-2.5 space-y-2.5">
              <PreviewItem index={1} title="当前商品与批准参考图">
                <p className="truncate font-semibold text-slate-900" title={previewData.productName || undefined}>
                  {productNameText}
                </p>
                <p className="text-[11px] text-slate-500">
                  已批准商品参考图：{previewData.approvedReferenceCount} 张
                </p>
              </PreviewItem>

              <PreviewItem index={2} title="图片用途">
                <p className="font-semibold text-slate-900">
                  {strategy.purposeLabel}
                  {strategy.sceneLabel ? <span className="font-normal text-slate-600"> · 场景：{strategy.sceneLabel}</span> : null}
                </p>
              </PreviewItem>

              <PreviewItem index={3} title="要回答的购买疑问">
                <p>{previewData.buyerQuestion || "配方未提供购买疑问"}</p>
              </PreviewItem>

              <PreviewItem index={4} title="本次使用的已确认事实">
                {previewData.factsUsed.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {previewData.factsUsed.slice(0, 8).map((fact, idx) => (
                      <span
                        key={`${fact.field ?? ""}-${fact.label}-${idx}`}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50/60 px-2 py-1 text-[11px] font-medium text-emerald-900"
                      >
                        <strong>{fact.label}:</strong> {fact.value}
                      </span>
                    ))}
                    {previewData.factsUsed.length > 8 ? (
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                        +{previewData.factsUsed.length - 8} 更多事实
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    当前槽位未绑定已确认事实，生成只使用商品基础信息。
                  </p>
                )}
                {previewData.requiredFactKinds.length > 0 ? (
                  <p className="text-[11px] text-slate-500">
                    本次槽位所需事实字段：{previewData.requiredFactKinds.map((kind) => factKindLabel(kind)).join("、")}
                  </p>
                ) : null}
              </PreviewItem>

              <PreviewItem index={5} title="构图、背景与风格方向">
                <p>
                  <span className="text-slate-500">构图：</span>
                  <span className="break-words">{previewData.compositionLabel || "配方未标注构图方向"}</span>
                </p>
                {previewData.composition ? (
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer">查看配方原文（英文，仅供核对）</summary>
                    <p className="mt-0.5 break-words">{previewData.composition}</p>
                  </details>
                ) : null}
                <p>
                  <span className="text-slate-500">背景：</span>
                  {backgroundPolicyLabel(previewData.backgroundPolicy)}
                </p>
                <p>
                  <span className="text-slate-500">风格方向：</span>
                  {previewData.styleLabel}
                </p>
              </PreviewItem>

              <PreviewItem index={6} title="允许文字与禁止内容">
                <p>
                  <span className="text-slate-500">允许文字：</span>
                  {previewData.textAllowed === true
                    ? "允许画面内出现必要文字，文字内容仍须人工核对"
                    : previewData.textAllowed === false
                      ? "不允许画面内出现文字、标签、角标或说明排版"
                      : "配方未标注文字策略，按默认不允许画面内文字处理"}
                </p>
                {previewData.textPolicy ? (
                  <details className="text-[11px] text-slate-500">
                    <summary className="cursor-pointer">查看配方文字策略原文（英文，仅供核对）</summary>
                    <p className="mt-0.5 break-words">{previewData.textPolicy}</p>
                  </details>
                ) : null}
                {previewData.negativeConstraints.length > 0 ? (
                  <div>
                    <span className="text-slate-500">禁止内容：</span>
                    <ul className="mt-0.5 space-y-0.5 pl-4 text-[11px] text-slate-600">
                      {previewData.negativeConstraints.map((constraint, idx) => (
                        <li key={idx} className="list-disc">{constraint}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </PreviewItem>

              <PreviewItem index={7} title="生成类型（二选一）">
                <div
                  className="grid gap-1.5 sm:grid-cols-2"
                  data-testid="brief-preview-generation-type"
                  data-active={previewData.generationType ?? "none"}
                >
                  {(["product_visual_draft", "composition_concept"] as const).map((option) => {
                    const active = previewData.generationType === option;
                    return (
                      <span
                        key={option}
                        data-option={option}
                        data-active={active ? "true" : "false"}
                        className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
                          active
                            ? "border-teal-500 bg-teal-50 text-teal-900 ring-1 ring-teal-500"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        <span aria-hidden="true">{active ? "● " : "○ "}</span>
                        {GENERATION_TYPE_LABELS[option]}
                      </span>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-600">
                  本次实际使用：<strong className="text-slate-800">{generationTypeLabel(previewData.generationType)}</strong>
                </p>
              </PreviewItem>

              <PreviewItem index={8} title="尚缺资料与下一步">
                {previewData.gaps.length > 0 ? (
                  <ul className="space-y-1">
                    {previewData.gaps.map((gap, idx) => (
                      <li key={idx} className="rounded-md border border-amber-200/70 bg-amber-50/70 px-2 py-1 text-[11px] text-amber-900">
                        <strong>{gap.label}</strong>
                        <span className="mx-1" aria-hidden="true">→</span>
                        <span>{gap.nextStep}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-emerald-700">
                    当前用途所需事实与商品参考图均已确认，可以直接生成。
                  </p>
                )}
              </PreviewItem>
            </ol>

            {/* 商品身份可见性：只说「要求保持这些特征」，不做任何一致性承诺。 */}
            <div
              className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5"
              data-testid="brief-preview-product-identity"
            >
              <p className="text-xs font-bold text-slate-800">本次生成要求保持这些商品特征。</p>
              <p className="mt-1 text-[11px] text-slate-600">
                <span className="text-slate-500">商品：</span>
                <span className="font-semibold text-slate-800">{productNameText}</span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {previewData.identity.map((item) => (
                  <span
                    key={item.key}
                    data-identity={item.key}
                    data-confirmed={item.value ? "true" : "false"}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                      item.value
                        ? "border-slate-200 bg-white text-slate-800"
                        : "border-amber-200 bg-amber-50/70 text-amber-900"
                    }`}
                  >
                    <span className="text-slate-500">{item.label}：</span>
                    <strong>{item.value ?? "未确认"}</strong>
                  </span>
                ))}
              </div>
              <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-teal-700">允许变化：</span>
                  <span className="text-slate-600">背景、光影、构图与画面氛围</span>
                </p>
                <p>
                  <span className="font-semibold text-amber-700">禁止变化：</span>
                  <span className="text-slate-600">未授权颜色、结构、数量与配件</span>
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* 移动端折叠/展开按钮 */}
        <button
          type="button"
          onClick={() => setMobileExpanded(!mobileExpanded)}
          className="md:hidden flex w-full items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/70 px-3 py-2 text-xs font-bold text-teal-800 transition hover:bg-teal-100/80"
        >
          <span>{mobileExpanded ? "收起详细依据与策略 ↑" : "展开商品事实与视觉策略 (02 ~ 04) ↓"}</span>
          <span className="text-[11px] font-normal text-teal-700">
            {isTask ? `${displayFacts.length} 项事实` : "免责说明"} · 策略与约束
          </span>
        </button>

        {/* 02 ~ 04 详细内容（桌面端始终展开，移动端受折叠状态控制） */}
        <div className={`space-y-3.5 ${mobileExpanded ? "block" : "hidden md:block"}`}>

        {/* 3: 事实依据（主链展示 Confirmed Facts，独立模式展示诚实免责） */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              02 商品事实依据
            </h4>
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                isTask
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {isTask ? `已绑定 ${displayFacts.length} 项事实` : "无研究事实"}
            </span>
          </div>

          {isTask ? (
            displayFacts.length > 0 ? (
              <div className="mt-2">
                <div className="flex flex-wrap gap-1.5">
                  {displayFacts.slice(0, 6).map((fact, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50/60 px-2 py-1 text-[11px] font-medium text-emerald-900"
                    >
                      <svg
                        className="h-3 w-3 text-emerald-600 shrink-0"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <strong>{fact.label}:</strong> {fact.value}
                    </span>
                  ))}
                  {displayFacts.length > 6 ? (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                      +{displayFacts.length - 6} 更多事实
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  ✓ 生成指令严格锚定上述已确认商品事实，杜绝虚构未证实参数或篡改商品外观。
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                暂无已确认事实，生成将基于商品基础信息。
              </p>
            )
          ) : (
            <div className="mt-2 rounded-lg border border-amber-200/80 bg-amber-50/60 p-2.5 text-[11px] text-amber-900">
              <p className="font-bold">
                ⚠ 独立创作未绑定商品研究任务
              </p>
              <p className="mt-0.5">
                用户提供内容由你自行输入，未经商品研究验证，不属于商品事实。生成结果仅供概念与构图参考。
              </p>
            </div>
          )}
        </div>

        {/* 4: 视觉策略 (Visual Strategy) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            03 视觉策略组合
          </h4>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2">
              <span className="text-[10px] text-slate-500">素材用途</span>
              <p className="mt-0.5 font-bold text-slate-800">
                {strategy.purposeLabel}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2">
              <span className="text-[10px] text-slate-500">场景设定</span>
              <p className="mt-0.5 font-bold text-slate-800">
                {strategy.sceneLabel || "无背景干扰 (纯色)"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2">
              <span className="text-[10px] text-slate-500">视觉风格</span>
              <p className="mt-0.5 font-bold text-slate-800">
                {strategy.styleLabel}
              </p>
            </div>
          </div>
          {strategy.rationale ? (
            <p className="mt-2 text-[11px] text-slate-600">
              <strong className="text-slate-700">策略考量：</strong>
              {strategy.rationale}
            </p>
          ) : null}
        </div>

        {/* 5: 生成约束与安全红线 (Constraints & Safety Guardrails) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              04 生成约束与安全底线
            </h4>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                referenceNotice.isComposition
                  ? "bg-amber-100 text-amber-800"
                  : "bg-teal-100 text-teal-800"
              }`}
            >
              {referenceNotice.title}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
            {constraints.map((constraint, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <span className="text-teal-600 font-bold shrink-0">•</span>
                <span>{constraint}</span>
              </li>
            ))}
            <li className="flex items-start gap-1.5">
              <span className="text-slate-400 font-bold shrink-0">•</span>
              <span className="text-slate-500">{referenceNotice.description}</span>
            </li>
          </ul>
        </div>
        </div>

        {customPromptSummary ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-2.5 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">用户自定义意图：</span>
            <span className="italic">{customPromptSummary}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/70 px-3.5 py-2 text-xs font-medium text-teal-900">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
            <span>视觉方案已锁定 · 下方确认规格后即可生成候选图</span>
          </div>
          <span className="font-bold text-teal-700">前往生成 ↓</span>
        </div>
      </div>
    </div>
  );
}
