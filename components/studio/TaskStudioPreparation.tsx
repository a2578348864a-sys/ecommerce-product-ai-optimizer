"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createBrowserUuid } from "@/lib/browserUuid";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import {
  HandoffApiRequestError,
  useCreativeHandoffApi,
} from "@/components/creative-handoff/useCreativeHandoffApi";import type {
  ApiError,
  CreativeHandoffPreview,
} from "@/components/creative-handoff/types";
import { ImageScenePresetPicker } from "@/components/image-studio/ImageScenePresetPicker";
import { ListingFactSupplementPanel } from "@/components/studio/ListingFactSupplementPanel";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import { authorityCounts } from "@/lib/productCreativeHandoffFactAuthority";
import {
  DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  resolveStudioImageCreativeIntent,
} from "@/lib/studioImageCreativeIntent";

export type PreparationKind = "listing" | "image";

export function canConfirmPreparation(params: {
  preview: CreativeHandoffPreview | null;
  kind: PreparationKind;
  confirmed: boolean;
  selectedFacts: string[];
  selectedVisuals?: string[];
}): boolean {
  const { preview, kind, confirmed, selectedFacts, selectedVisuals = [] } = params;
  const hasResearchConfirmedFacts = (preview?.currentConfirmedFacts?.length ?? 0) > 0;
  const hasSelectableConfirmedFacts = selectedFacts.length > 0;
  const hasListingFactBasis = hasResearchConfirmedFacts || hasSelectableConfirmedFacts;

  return Boolean(
    preview
    && preview.expectedResearchRevision
    && preview.storageVersion
    && preview.expectedCurrentHandoffRevision !== undefined
    && confirmed
    && (
      kind === "listing"
        ? hasListingFactBasis
        : (
            hasResearchConfirmedFacts
            || selectedFacts.length > 0
            || selectedVisuals.length > 0
          )
    )
  );
}

const FACT_LABELS: Record<string, string> = {
  brand: "品牌",
  category: "类目",
  price_usd: "参考价格 (USD)",
  rating: "评分",
  review_count: "评论数",
  product_type: "商品类型",
  series_or_model: "系列/型号",
  capacity: "容量",
  quantity_or_pack_size: "数量/包装",
  color_or_variant: "颜色/款式",
  material: "材质",
};

export function buildPreparationFactOptions(preview: CreativeHandoffPreview | null) {
  const projected = preview?.candidateFactOptions ?? [];
  if (projected.length > 0) return projected.map((option) => ({
    selectionId: option.selectionId,
    field: option.field,
    label: FACT_LABELS[option.field] ?? option.field,
    valueSummary: option.valueSummary,
    listingEligible: true,
  }));
  return (preview?.confirmableFactCandidates ?? []).map((candidate) => ({
    selectionId: candidate.selectionId,
    field: candidate.canonicalField,
    label: FACT_LABELS[candidate.canonicalField] ?? candidate.canonicalField,
    valueSummary: candidate.displayValue,
    listingEligible: (candidate.allowedUsageScopes ?? []).includes("listing"),
  }));
}

/**
 * 默认选中集：仅可进入创作的商品事实（排除 market_signal：allowedUsageScopes 不含 listing），
 * 且同 canonical field 只取首个候选（用户可在 UI 内切换选择不同来源候选）。
 * 返回选中 selectionId 列表。
 */
export function defaultPreparationSelection(options: Array<{ selectionId: string; field: string; listingEligible?: boolean }>): string[] {
  const seenFields = new Set<string>();
  const selected: string[] = [];
  for (const option of options) {
    if (option.listingEligible === false) continue;
    if (seenFields.has(option.field)) continue;
    seenFields.add(option.field);
    selected.push(option.selectionId);
  }
  return selected;
}

type PreparationPreferences = NonNullable<CreativeHandoffPreview["creativePreferences"]>;

export function buildPreparationPreferences(
  input: CreativeHandoffPreview["creativePreferences"],
  imageScene?: {
    imageStyle: string;
    backgroundPreference: string;
    compositionPreference: string;
    additionalRequirements: string;
  },
): PreparationPreferences | undefined {
  const safe: PreparationPreferences = {};
  for (const key of ["targetMarket", "language", "tone", "imageStyle", "backgroundPreference", "compositionPreference", "additionalRequirements"] as const) {
    const sceneValue = (imageScene as Partial<Record<typeof key, string>> | undefined)?.[key];
    const value = sceneValue?.trim() || input?.[key]?.trim();
    if (value) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** 商品参考图来源的产品化展示（不暴露内部 tier / xlsx_embedded / sha256 / selectionId） */
export function visualReferenceSourceLabel(sourceTier: string | undefined): string {
  if (sourceTier === "candidate_fallback") return "当前商品数据";
  if (sourceTier === "xlsx_embedded") return "SellerSprite 商品数据";
  return "当前商品数据";
}

/**
 * 安全缩略图：visual-reference-preview 端点要求 header 鉴权（<img> 无法携带），
 * 因此用 fetch + blob + objectURL 渲染；失败时显示占位，不泄漏任何内部标识。
 */
function VisualReferenceThumbnail({ taskId, thumbnailUrl, alt }: {
  taskId: string;
  thumbnailUrl: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const response = await fetch(thumbnailUrl, { headers: buildAccessHeaders() });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [thumbnailUrl]);
  void taskId;
  if (failed) {
    return <div className="h-20 w-20 shrink-0 rounded-lg border border-dashed border-rose-200 bg-rose-50" aria-label="商品参考图加载失败" />;
  }
  if (!src) {
    return <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg border border-slate-200 bg-slate-100" aria-busy="true" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- objectURL 来自本服务鉴权端点，非外部资源
  return <img src={src} alt={alt ?? "商品参考图候选"} className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 object-cover" />;
}

function friendlyError(error: ApiError) {
  if (error.code === "task_not_found" || error.status === 404) {
    return "该研究记录不存在，或你没有访问权限。";
  }
  if (["task_result_conflict", "handoff_revision_conflict", "research_revision_conflict"].includes(error.code)) {
    return "研究资料已更新，请重新查看并确认。";
  }
  if (["handoff_stale", "research_gate_failed", "invalid_handoff_candidate"].includes(error.code)) {
    return "当前研究资料已失效或尚未达到创作条件，请回到研究记录补充后重试。";
  }
  if (error.code === "manual_fact_research_authority") {
    // 研究侧已人工确认的字段，创作侧不允许覆盖（规则见 V4 Fact Authority）
    return error.message || "该商品事实已被研究人工确认，创作侧不修改已确认事实；如需修改请返回商品研究查看并修改。";
  }
  if (error.code === "confirmed_fact_conflict") {
    return "同一商品事实存在多个值。请保留研究已确认值；如需修改该事实请返回商品研究，修改并重新人工确认后回来继续。";
  }
  if (error.code === "network_error") return "网络连接异常，请稍后重试。";
  return error.message || "创作资料读取失败，请稍后重试。";
}

export function TaskStudioPreparation({
  taskId,
  kind,
  children,
  onReadyChange,
  onCommitted,
}: {
  taskId: string;
  kind: PreparationKind;
  children: ReactNode;
  onReadyChange?: (ready: boolean) => void;
  /** 创作资料确认成功（含原地事实补充）后通知父级刷新下游状态 */
  onCommitted?: () => void;
}) {
  const api = useCreativeHandoffApi(taskId);
  const loadPreparation = api.load;
  const [selectedFacts, setSelectedFacts] = useState<string[]>([]);
  const [selectedVisuals, setSelectedVisuals] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [sceneSelection, setSceneSelection] = useState(DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT);
  const restoredSceneRef = useRef(false);
  const [visualNotice, setVisualNotice] = useState("");

  useEffect(() => {
    void loadPreparation();
  }, [loadPreparation]);

  const successful = api.result?.kind === "ok" ? api.result : null;
  const preview = successful?.preview ?? null;
  const detail = successful?.detail ?? null;
  const isActive = detail?.effectiveStatus === "active" && detail.controlState === "active";
  const sceneDraft = useSessionDraft({
    pageKind: "image-studio-task-scene",
    entityId: taskId,
    revision: kind === "image" && preview?.expectedResearchRevision
      ? String(preview.expectedResearchRevision)
      : null,
    initial: DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT,
  });

  useEffect(() => {
    if (kind !== "image" || !sceneDraft.draft || restoredSceneRef.current) return;
    restoredSceneRef.current = true;
    setSceneSelection(sceneDraft.draft);
  }, [kind, sceneDraft.draft]);

  useEffect(() => {
    if (kind === "image") sceneDraft.save(sceneSelection);
  }, [kind, sceneDraft, sceneSelection]);

  useEffect(() => {
    onReadyChange?.(isActive);
  }, [isActive, onReadyChange]);
  const factOptions = useMemo(
    () => buildPreparationFactOptions(preview),
    [preview],
  );
  // V4 Fact Authority：研究侧人工确认事实（Human Confirmed Facts 唯一权威；只读展示，不进入选择集）
  const currentAuthority = useMemo(
    () => preview?.currentConfirmedFacts ?? [],
    [preview?.currentConfirmedFacts],
  );
  const authorityFieldSet = useMemo(
    () => new Set(currentAuthority.map((fact) => fact.field)),
    [currentAuthority],
  );
  // Image Studio 可勾选的仅为研究未覆盖的来源快照候选：研究已确认字段直接以权威值呈现，不重复确认
  const selectableFactOptions = useMemo(
    () => (kind === "image" ? factOptions.filter((option) => !authorityFieldSet.has(option.field)) : factOptions),
    [factOptions, kind, authorityFieldSet],
  );
  // 参考资料层与权威事实差异（软提示；不阻断参考图使用）
  const referenceConflicts = useMemo(() => preview?.referenceConflicts ?? [], [preview?.referenceConflicts]);
  // V4R 唯一权威统计口径：全页「已确认商品事实 / 待确认候选」只出自同一权威 DTO
  const authoritySummary = useMemo(
    () => authorityCounts({
      currentConfirmedFacts: preview?.currentConfirmedFacts,
      confirmableFactCandidates: preview?.confirmableFactCandidates,
    }),
    [preview?.currentConfirmedFacts, preview?.confirmableFactCandidates],
  );
  const visualOptions = useMemo(
    () => preview?.visualReferenceCandidates ?? [],
    [preview?.visualReferenceCandidates],
  );
  const externalUrlCandidate = preview?.externalUrlCandidate;
  const [importingVisual, setImportingVisual] = useState(false);
  const [visualImportError, setVisualImportError] = useState("");

  async function importSellerSpriteVisual() {
    if (!preview || !externalUrlCandidate || importingVisual) return;
    setImportingVisual(true);
    setVisualImportError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/visual-reference-import`, {
        method: "POST",
        headers: buildAccessHeaders(),
        body: JSON.stringify({
          expectedStorageVersion: preview.storageVersion,
          asin: externalUrlCandidate.asin,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setVisualImportError(body?.error?.message || "商品参考图无法安全导入，可手动上传参考图。");
        return;
      }
      await api.refresh();
    } catch {
      setVisualImportError("商品参考图无法安全导入，可手动上传参考图。");
    } finally {
      setImportingVisual(false);
    }
  }

  useEffect(() => {
    if (!preview) return;
    setSelectedFacts((current) => current.length > 0
      ? current.filter((id) => selectableFactOptions.some((option) => option.selectionId === id))
      : // 默认仅选可进入创作的商品事实（排除 market_signal），且同 canonical field 只取首个候选，
        // 避免同 field 多候选全选导致后端 field 唯一性冲突（422）
        defaultPreparationSelection(selectableFactOptions));
  }, [preview, selectableFactOptions]);

  // 视觉参考候选默认勾选尚未批准者（已批准的保持展示态，不重复提交）
  useEffect(() => {
    if (kind !== "image" || !preview) return;
    setSelectedVisuals((current) => {
      if (current.length > 0) return current;
      return (preview.visualReferenceCandidates ?? [])
        .filter((candidate) => candidate.approvedForReference !== true)
        .map((candidate) => candidate.selectionId);
    });
  }, [kind, preview]);

  if (api.state === "loading" && !api.result) {
    return (
      <section className="surface-card p-5" aria-busy="true" data-testid="task-studio-preparation-loading">
        <p className="text-sm font-semibold text-slate-600">正在核验研究记录与创作资料…</p>
      </section>
    );
  }

  if (api.result?.kind === "error") {
    return (
      <section className="surface-card border-rose-200 p-5" role="alert" data-testid="task-studio-preparation-error">
        <h2 className="text-lg font-bold text-slate-950">无法读取研究记录</h2>
        <p className="mt-2 text-sm leading-6 text-rose-700">{friendlyError(api.result.error)}</p>
        <Link href="/tasks" className="mt-4 inline-flex h-10 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
          返回研究记录
        </Link>
      </section>
    );
  }

  // R4/R6：同一 actor 可访问但创作业务未就绪 → 显示准确状态（不伪装"不存在/无权限"）
  if (api.result?.kind === "ok" && !api.result.detail && !api.result.preview && api.result.gateReason) {
    const gateReason = api.result.gateReason;
    // V3 Legacy Removal：Studio 只处理正式 Current Research Context；
    // legacy_not_supported 不再作为独立用户状态（详情页已不再展示创作工具区），统一为通用未就绪提示。
    const isDecisionNotReady = gateReason === "decision_not_creative_ready";
    const isResearchNotCompleted = gateReason === "research_not_completed";
    const isResearchStale = gateReason === "research_stale_requires_reconfirmation";
    const isBlocked = gateReason === "blocking_issue_present" || gateReason === "research_hash_invalid" || gateReason === "verification_invalid" || gateReason === "research_mode_invalid";
    return (
      <section className="surface-card border-amber-200 p-5" role="alert" data-testid={`task-studio-gate-${gateReason}`}>
        <h2 className="text-lg font-bold text-slate-950">
          {isResearchStale ? "研究资料需要重新确认" : "创作资料尚未准备完成"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {isResearchStale
            ? "研究完成后又新增或变更了研究证据，当前研究结论基于旧版本资料。新的 Listing / Image 生成已暂停（历史结果保留）；请返回研究记录执行「重新确认研究」，确认后创作工具恢复可用。"
            : isDecisionNotReady
              ? "研究决定尚未进入可创作状态，请先返回商品研究完成人工决定。"
              : isResearchNotCompleted
                ? "研究已准备好，但尚未完成研究。请先返回研究记录执行「完成研究」，之后即可进入创作。"
                : isBlocked
                  ? "当前研究资料状态暂不支持创作，请先返回商品研究核对资料。"
                  : "创作资料尚未准备完成，请先返回商品研究确认资料。"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/tasks/${encodeURIComponent(taskId)}`}
            className={`inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ${
              isResearchStale
                ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {isResearchStale ? "返回研究记录重新确认" : "返回商品研究"}
          </Link>
        </div>
      </section>
    );
  }

  if (isActive) {
    const listingFactSummary = detail.listingFactSummary ?? {
      confirmedFacts: detail.confirmedFacts?.length ?? 0,
      listingEligibleFacts: detail.confirmedFacts?.filter((fact) => fact.usageScopes.includes("listing")).length ?? 0,
      prohibitedClaims: detail.prohibitedClaims?.length ?? 0,
    };
    const listingFactsMissing = kind === "listing" && listingFactSummary.listingEligibleFacts === 0;
    // V4R：创作侧人工补充事实 = 当前快照中研究权威未覆盖、具人为确认来源的字段（独立展示，不与研究事实混淆）
    const authorityFieldNames = new Set((preview?.currentConfirmedFacts ?? []).map((f) => f.field));
    const supplementalFacts = (detail?.confirmedFacts ?? []).filter((fact) => !authorityFieldNames.has(fact.field));
    return (
      <div data-testid="task-studio-authoritative-mode">
        <section className="surface-card mb-4 border-teal-200 bg-teal-50/50 p-4">
          <p className="text-sm font-bold text-teal-800">创作资料已确认</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            生成时服务器会再次读取研究记录、核对最新版本与当前身份；浏览器预填内容不作为权威事实。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
            <span className="rounded-full bg-white px-2.5 py-1">已确认事实：{listingFactSummary.confirmedFacts}</span>
            {kind === "listing" ? (
              <span className="rounded-full bg-white px-2.5 py-1">可用于 Listing：{listingFactSummary.listingEligibleFacts}</span>
            ) : null}
            <span className="rounded-full bg-white px-2.5 py-1">禁止声明：{listingFactSummary.prohibitedClaims}</span>
            <span className="rounded-full bg-white px-2.5 py-1">最终人工复核：必须</span>
          </div>
        </section>
        {/* V4R：创作侧人工补充事实（独立面板；有则显示，无则不显示空面板） */}
        {supplementalFacts.length > 0 ? (
          <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50/60 p-3" data-testid="studio-supplemental-facts">
            <p className="text-sm font-bold text-sky-900">创作侧人工补充事实</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              Studio-confirmed supplemental facts：创作侧人工补充并确认、研究侧当前无同字段的事实。若研究后续确认同字段，将自动以研究值替代，此处旧值仅留在历史快照。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {supplementalFacts.map((fact) => (
                <span key={fact.field} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {FACT_LABELS[fact.field] ?? fact.label}：{String(fact.value)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {/* V3 Evidence → Creative Context Bridge：创作参考资料摘要（§51，authoritative 模式也展示） */}
        {preview?.creativeContextSummary ? (
          <div className="mb-4 rounded-xl border border-teal-100 bg-teal-50/50 p-3" data-testid="creative-context-summary">
            <p className="text-sm font-bold text-teal-900">创作参考资料（研究证据已载入）</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              以下均来自商品研究阶段保存的证据；除「已确认商品事实」外，其余只作参考，不自动成为事实声明。
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
              <span className="rounded-full bg-white px-2.5 py-1">VOC 洞察：{preview.creativeContextSummary.counts.vocInsights}</span>
              <span className="rounded-full bg-white px-2.5 py-1">关键词候选：{preview.creativeContextSummary.counts.keywordCandidates}</span>
              <span className="rounded-full bg-white px-2.5 py-1">竞品参考：{preview.creativeContextSummary.counts.competitiveInsights}</span>
              <span className="rounded-full bg-white px-2.5 py-1">供应线索：{preview.creativeContextSummary.counts.sourcingEntries}</span>
              <span className="rounded-full bg-white px-2.5 py-1">AI 研究摘要：{preview.creativeContextSummary.counts.aiReferences > 0 ? "已载入" : "无"}</span>
              {preview.creativeContextSummary.counts.missingConflicts > 0 ? (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">缺失/冲突：{preview.creativeContextSummary.counts.missingConflicts}</span>
              ) : null}
            </div>
            {preview.creativeContextSummary.vocInsights && preview.creativeContextSummary.vocInsights.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-bold text-teal-800">查看 VOC 洞察（客户语言/场景参考，非事实）</summary>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                  {preview.creativeContextSummary.vocInsights.map((v) => (
                    <li key={v.insightId}>- {v.theme}{v.reviewCount > 0 ? `（${v.reviewCount} 条评论）` : ""}：{v.summary}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        {kind === "listing" ? (
          <section className="surface-card mb-4 border-amber-200 bg-amber-50/70 p-4" data-testid="task-listing-facts-missing">
            <p className="text-sm font-bold text-amber-900">
              {listingFactsMissing
                ? "当前研究记录缺少可用于 Listing 的商品事实。"
                : "你可以继续补充已经核实的商品事实。"}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              系统已有事实不会阻止你继续补充尺寸、重量、使用、兼容性等真实信息。
            </p>
            <ListingFactSupplementPanel
              taskId={taskId}
              preview={preview}
              create={api.create}
              refresh={api.refresh}
              onCommitted={onCommitted}
              existingFacts={detail.confirmedFacts ?? []}
              workbenchConfirmedFacts={detail.workbenchConfirmedFacts ?? []}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/tasks/${encodeURIComponent(taskId)}`}
                className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                返回研究记录查看来源
              </Link>
              <Link
                href="/listing-studio"
                className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                转为独立创作
              </Link>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              转为独立创作后将解除本页的 Task 权威绑定，并按独立 Listing 的人工输入与确认流程重新开始。
            </p>
          </section>
        ) : null}

        {/* V3 Visual Reference Confirmation（权威模式）：已确认态也必须能看到并批准商品参考图 */}
        {kind === "image" ? (
          <section className="surface-card mb-4 border-slate-200 p-4" id="task-visual-reference-fieldset" data-testid="task-visual-reference-panel">
            <p className="text-sm font-bold text-slate-900">商品参考图</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              只有你在这里批准的当前研究参考图，才能用于具体商品视觉草稿。
            </p>
            {visualOptions.length > 0 ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {visualOptions.map((option) => {
                  const approved = option.approvedForReference === true;
                  const checked = selectedVisuals.includes(option.selectionId);
                  return (
                    <label key={option.selectionId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                      {option.thumbnailUrl ? (
                        <VisualReferenceThumbnail taskId={taskId} thumbnailUrl={option.thumbnailUrl} />
                      ) : (
                        <div className="h-20 w-20 shrink-0 rounded-lg border border-dashed border-slate-300 bg-slate-50" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">{option.summary || "研究记录中的商品参考图"}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">来源：{visualReferenceSourceLabel(option.sourceTier)}</span>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${approved ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}>
                          {approved ? "✓ 已确认" : "待确认"}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={approved || submitting}
                        onChange={(event) => setSelectedVisuals((current) => event.target.checked
                          ? [...new Set([...current, option.selectionId])]
                          : current.filter((id) => id !== option.selectionId))}
                        className="shrink-0"
                      />
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                当前没有可确认的商品参考图。可在下方「构图概念」模式生成非正式视觉草稿，或返回研究记录补充商品图片。
              </p>
            )}
            {visualOptions.some((option) => option.approvedForReference !== true) ? (
              <button
                type="button"
                disabled={submitting || selectedVisuals.length === 0}
                onClick={() => void confirmVisualReference()}
                className="mt-3 inline-flex h-10 items-center rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "正在确认…" : "确认作为商品参考图"}
              </button>
            ) : null}
            {visualNotice ? (
              <p className="mt-2 text-sm font-semibold text-rose-700" role="alert">{visualNotice}</p>
            ) : null}
          </section>
        ) : null}
        {children}
      </div>
    );
  }

  const hasResearchConfirmedFacts = (preview?.currentConfirmedFacts?.length ?? 0) > 0;
  const hasSelectableConfirmedFacts = selectedFacts.length > 0;
  const hasListingFactBasis = hasResearchConfirmedFacts || hasSelectableConfirmedFacts;

  const canConfirm = canConfirmPreparation({
    preview,
    kind,
    confirmed,
    selectedFacts,
    selectedVisuals,
  });

  /** V4 Fact Authority：冲突面板「仍作为视觉参考使用」——确保已勾选待批准参考图并提示事实采用权威值 */
  function stillUseVisualAsReference() {
    if (!preview) return;
    setSelectedVisuals((current) => current.length > 0
      ? current
      : (preview.visualReferenceCandidates ?? [])
          .filter((candidate) => candidate.approvedForReference !== true)
          .map((candidate) => candidate.selectionId));
    setVisualNotice("参考资料与已确认事实不一致不会阻止参考图使用：生成时将采用研究已确认事实值，参考资料值不进入 Prompt 事实层。");
  }

  /** 权威模式：单独批准商品参考图（复用 createOrAppendCreativeHandoff 写入链，不绕过服务端） */
  async function confirmVisualReference() {
    if (!preview || submitting || selectedVisuals.length === 0) return;
    setSubmitting(true);
    setVisualNotice("");
    try {
      await api.create({
        requestId: createBrowserUuid(),
        selectedFactCandidateIds: selectedFacts,
        selectedVisualReferenceCandidateIds: selectedVisuals,
        expectedStorageVersion: preview.storageVersion!,
        expectedResearchRevision: preview.expectedResearchRevision!,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision!,
      });
      await api.refresh();
      setVisualNotice("已确认作为商品参考图。");
      onCommitted?.();
    } catch (error) {
      setVisualNotice(error instanceof HandoffApiRequestError
        ? friendlyError(error.error)
        : "商品参考图确认失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPreparation() {
    if (!preview || !canConfirm || submitting) return;
    setSubmitting(true);
    setNotice("");
    try {
      const scene = resolveStudioImageCreativeIntent(sceneSelection);
      await api.create({
        requestId: createBrowserUuid(),
        selectedFactCandidateIds: selectedFacts,
        ...(kind === "image" && selectedVisuals.length > 0
          ? { selectedVisualReferenceCandidateIds: selectedVisuals }
          : {}),
        expectedStorageVersion: preview.storageVersion!,
        expectedResearchRevision: preview.expectedResearchRevision!,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision!,
        creativePreferences: buildPreparationPreferences(
          preview.creativePreferences,
          kind === "image" ? {
            imageStyle: scene.visualStyle,
            backgroundPreference: scene.background,
            compositionPreference: scene.composition,
            additionalRequirements: `图片用途：${scene.label}。${scene.direction}。`,
          } : undefined,
        ),
      });
      setConfirmed(false);
      if (kind === "image") sceneDraft.clear();
      await api.refresh();
    } catch (error) {
      setNotice(error instanceof HandoffApiRequestError
        ? friendlyError(error.error)
        : "创作资料确认失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="surface-card border-amber-200 p-5" data-testid="task-studio-preparation">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Before creating</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">创作前资料确认</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            请确认哪些研究事实可用于创作。尚未确认的信息不会进入权威创作输入。
          </p>
        </div>
        <Link href={`/tasks/${encodeURIComponent(taskId)}`} className="text-sm font-semibold text-teal-700 hover:underline">
          返回研究记录
        </Link>
      </div>

      {/* V3 Evidence → Creative Context Bridge：创作参考资料摘要（§51 Context Visibility） */}
      {preview?.creativeContextSummary ? (
        <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/50 p-3" data-testid="creative-context-summary">
          <p className="text-sm font-bold text-teal-900">创作参考资料（研究证据已载入）</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            以下均来自商品研究阶段保存的证据；除「已确认商品事实」外，其余只作参考，不自动成为事实声明。
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
            <span className="rounded-full bg-white px-2.5 py-1">已确认商品事实：{authoritySummary.confirmedFacts}</span>
            <span className="rounded-full bg-white px-2.5 py-1">待确认候选：{authoritySummary.confirmableCandidates}</span>
            <span className="rounded-full bg-white px-2.5 py-1">VOC 洞察：{preview.creativeContextSummary.counts.vocInsights}</span>
            <span className="rounded-full bg-white px-2.5 py-1">关键词候选：{preview.creativeContextSummary.counts.keywordCandidates}</span>
            <span className="rounded-full bg-white px-2.5 py-1">竞品参考：{preview.creativeContextSummary.counts.competitiveInsights}</span>
            <span className="rounded-full bg-white px-2.5 py-1">供应线索：{preview.creativeContextSummary.counts.sourcingEntries}</span>
            <span className="rounded-full bg-white px-2.5 py-1">AI 研究摘要：{preview.creativeContextSummary.counts.aiReferences > 0 ? "已载入" : "无"}</span>
            {preview.creativeContextSummary.counts.missingConflicts > 0 ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">缺失/冲突：{preview.creativeContextSummary.counts.missingConflicts}</span>
            ) : null}
          </div>
          {preview.creativeContextSummary.vocInsights && preview.creativeContextSummary.vocInsights.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-bold text-teal-800">查看 VOC 洞察（客户语言/场景参考，非事实）</summary>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                {preview.creativeContextSummary.vocInsights.map((v) => (
                  <li key={v.insightId}>- {v.theme}{v.reviewCount > 0 ? `（${v.reviewCount} 条评论）` : ""}：{v.summary}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* V4 Fact Authority：研究侧人工确认事实（唯一权威，只读；自动用于创作，不需再次确认） */}
      {currentAuthority.length > 0 ? (
        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-3" data-testid="authority-confirmed-facts">
          <p className="text-sm font-bold text-teal-900">当前已确认商品事实（Human Confirmed Facts · 研究人工确认）</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">以下为商品研究阶段人工确认的当前事实，将自动用于创作；不再要求你在创作页重复确认。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {currentAuthority.map((fact) => (
              <span key={`${fact.field}:${String(fact.value)}`} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                {FACT_LABELS[fact.field] ?? fact.label}：{String(fact.value)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* V4 Fact Authority：参考资料层与已确认事实不一致 —— 软提示，不阻断视觉参考使用 */}
      {referenceConflicts.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3" data-testid="fact-reference-conflicts" role="note">
          <p className="text-sm font-bold text-amber-900">参考资料与当前已确认商品事实不一致</p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            生成时继续使用研究已确认事实值；参考资料中的其他值仅作参考保留，不会进入 Prompt 事实层，也不会覆盖商品事实。
          </p>
          <ul className="mt-2 space-y-1.5">
            {referenceConflicts.map((conflict) => (
              <li key={`${conflict.field}:${String(conflict.referenceValue)}`} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700">
                <span className="font-bold text-slate-900">{FACT_LABELS[conflict.field] ?? conflict.label}</span>
                <span className="ml-2">已确认事实值：<strong className="text-teal-700">{String(conflict.confirmedValue)}</strong></span>
                <span className="ml-2">参考资料记录值：<span className="text-amber-700">{String(conflict.referenceValue)}</span></span>
                <span className="mt-0.5 block text-slate-500">处理：使用已确认事实值 {String(conflict.confirmedValue)}；参考资料值不进入 Prompt 事实层。</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {kind === "image" ? (
              <button
                type="button"
                onClick={() => stillUseVisualAsReference()}
                className="inline-flex h-9 items-center rounded-xl bg-teal-600 px-3.5 text-sm font-semibold text-white hover:bg-teal-700"
              >
                仍作为视觉参考使用
              </button>
            ) : null}
            <Link
              href={`/tasks/${encodeURIComponent(taskId)}`}
              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700"
            >
              返回商品研究查看事实
            </Link>
          </div>
        </div>
      ) : null}

      {selectableFactOptions.length > 0 ? (
        <fieldset className="mt-5">
          <legend className="text-sm font-bold text-slate-900">
            {authorityFieldSet.size > 0 ? "可确认的来源快照事实（研究未确认项）" : "已确认商品事实"}
          </legend>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {selectableFactOptions.map((option) => (
              <label key={option.selectionId} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedFacts.includes(option.selectionId)}
                  onChange={(event) => {
                    const field = option.field;
                    setSelectedFacts((current) => {
                      // 同 canonical field 单选：选择时取消同 field 其它候选（防后端 field 唯一性冲突 422）
                      const sameFieldIds = selectableFactOptions
                        .filter((o) => o.field === field && o.selectionId !== option.selectionId)
                        .map((o) => o.selectionId);
                      const withoutSameField = current.filter((id) => !sameFieldIds.includes(id));
                      return event.target.checked
                        ? [...new Set([...withoutSameField, option.selectionId])]
                        : withoutSameField.filter((id) => id !== option.selectionId);
                    });
                  }}
                />
                <span><strong>{option.label}</strong>：{option.valueSummary}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800" data-testid="task-studio-no-selectable-facts">
          {hasResearchConfirmedFacts
            ? "当前没有可确认的来源快照事实；研究已确认事实会自动用于创作，无需再次勾选。如需补充新事实或修改已确认事实，请先回到商品研究处理。"
            : "当前没有可用于 Listing 的已确认商品事实，请先返回商品研究确认商品事实。"}
        </p>
      )}

      {preview?.issues?.length ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-bold text-slate-900">尚缺信息</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
            {preview.issues.map((issue) => <li key={issue.selectionId}>- {issue.summary}</li>)}
          </ul>
        </div>
      ) : null}

      {preview?.prohibitedClaims?.length ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50/60 p-3">
          <p className="text-sm font-bold text-rose-800">禁止声明</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-rose-700">
            {preview.prohibitedClaims.map((claim) => <li key={claim.selectionId}>- {claim.summary}</li>)}
          </ul>
        </div>
      ) : null}

      {kind === "image" && visualOptions.length > 0 ? (
        <fieldset className="mt-4" id="task-visual-reference-fieldset">
          <legend className="text-sm font-bold text-slate-900">商品参考图</legend>
          <p className="mt-1 text-xs leading-5 text-slate-500">只有你在这里批准的当前研究参考图，才能用于具体商品视觉草稿。</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {visualOptions.map((option) => {
              const approved = option.approvedForReference === true;
              return (
                <label key={option.selectionId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  {option.thumbnailUrl ? (
                    <VisualReferenceThumbnail taskId={taskId} thumbnailUrl={option.thumbnailUrl} />
                  ) : (
                    <div className="h-20 w-20 shrink-0 rounded-lg border border-dashed border-slate-300 bg-slate-50" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{option.summary || "研究记录中的商品参考图"}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">来源：{visualReferenceSourceLabel(option.sourceTier)}</span>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${approved ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}>
                      {approved ? "✓ 已确认" : "待确认"}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={selectedVisuals.includes(option.selectionId)}
                    disabled={approved}
                    onChange={(event) => setSelectedVisuals((current) => event.target.checked
                      ? [...new Set([...current, option.selectionId])]
                      : current.filter((id) => id !== option.selectionId))}
                    className="shrink-0"
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {kind === "image" && externalUrlCandidate?.present ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4" data-testid="task-sellersprite-visual-candidate">
          <p className="text-sm font-bold text-slate-900">来自 SellerSprite 的商品参考图</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {externalUrlCandidate.alreadyImported
              ? "商品主图已安全导入，可在上方「商品参考图」中勾选使用。"
              : "商品主图仅以外部链接保存，未自动下载。点击下方按钮后，服务器才会受控获取这一张图片。"}
          </p>
          {externalUrlCandidate.alreadyImported ? null : (
            <button
              type="button"
              disabled={importingVisual}
              onClick={() => void importSellerSpriteVisual()}
              className="mt-3 inline-flex h-9 items-center rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importingVisual ? "正在获取…" : "使用此图作为商品参考图"}
            </button>
          )}
          {visualImportError ? (
            <p className="mt-2 text-sm font-semibold text-amber-800" role="alert">{visualImportError}</p>
          ) : null}
        </div>
      ) : null}

      {kind === "image" ? (
        <div className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50/30 p-4" data-testid="task-image-scene-selection">
          <p className="mb-3 text-sm font-bold text-slate-900">图片用途与场景</p>
          <ImageScenePresetPicker
            value={sceneSelection}
            name="task-image-preparation"
            onChange={(nextSelection) => {
              setSceneSelection(nextSelection);
              setConfirmed(false);
            }}
          />
          {sceneDraft.restored ? (
            <p className="mt-2 text-xs font-semibold text-cyan-800">已恢复刷新前未提交的场景选择。</p>
          ) : null}
        </div>
      ) : null}

      {preview?.creativePreferences ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
          <p className="font-bold text-slate-900">创作偏好</p>
          <p className="mt-1">
            目标市场：{preview.creativePreferences.targetMarket || "未设置"}；
            语言：{preview.creativePreferences.language || "未设置"}；
            语气：{preview.creativePreferences.tone || "未设置"}；
            图片风格：{preview.creativePreferences.imageStyle || "未设置"}
          </p>
        </div>
      ) : null}

      <label className="mt-5 flex gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-sm leading-6 text-teal-900">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>我已核对以上商品事实、禁止声明与创作偏好；生成结果仅作为草稿，最终仍需人工复核。</span>
      </label>

      {kind === "listing" && !hasListingFactBasis ? (
        <p className="mt-3 text-sm font-semibold text-amber-700" role="alert" data-testid="task-studio-missing-fact-basis-notice">
          当前没有可用于 Listing 的已确认商品事实，请先返回商品研究确认商品事实。
        </p>
      ) : null}

      {notice ? <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">{notice}</p> : null}

      <button
        type="button"
        disabled={!canConfirm || submitting}
        onClick={() => void submitPreparation()}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-teal-600 px-5 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "正在确认…" : "确认资料并继续"}
      </button>
    </section>
  );
}
