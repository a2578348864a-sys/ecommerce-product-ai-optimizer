"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createBrowserUuid } from "@/lib/browserUuid";
import {
  HandoffApiRequestError,
  useCreativeHandoffApi,
} from "@/components/creative-handoff/useCreativeHandoffApi";
import type {
  ApiError,
  CreativeHandoffPreview,
} from "@/components/creative-handoff/types";
import {
  createImageSceneSelection,
  resolveImageScenePreset,
  type ImageScenePreset,
} from "@/lib/client/studioImageRequest";
import { ImageScenePresetPicker } from "@/components/image-studio/ImageScenePresetPicker";
import { useSessionDraft } from "@/lib/client/useSessionDraft";

type PreparationKind = "listing" | "image";

const FACT_LABELS: Record<string, string> = {
  brand: "品牌",
  category: "类目",
  price_usd: "参考价格 (USD)",
  rating: "评分",
  review_count: "评论数",
  product_type: "商品类型",
  color_or_variant: "颜色/款式",
  material: "材质",
};

export function buildPreparationFactOptions(preview: CreativeHandoffPreview | null) {
  const projected = preview?.candidateFactOptions ?? [];
  if (projected.length > 0) return projected;
  return (preview?.confirmableFactCandidates ?? []).map((candidate) => ({
    selectionId: candidate.selectionId,
    field: candidate.canonicalField,
    label: FACT_LABELS[candidate.canonicalField] ?? candidate.canonicalField,
    valueSummary: candidate.displayValue,
  }));
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
  if (error.code === "network_error") return "网络连接异常，请稍后重试。";
  return error.message || "创作资料读取失败，请稍后重试。";
}

export function TaskStudioPreparation({
  taskId,
  kind,
  children,
  onReadyChange,
}: {
  taskId: string;
  kind: PreparationKind;
  children: ReactNode;
  onReadyChange?: (ready: boolean) => void;
}) {
  const api = useCreativeHandoffApi(taskId);
  const loadPreparation = api.load;
  const [selectedFacts, setSelectedFacts] = useState<string[]>([]);
  const [selectedVisuals, setSelectedVisuals] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [sceneSelection, setSceneSelection] = useState(() => createImageSceneSelection("white_studio"));
  const restoredSceneRef = useRef(false);

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
    initial: createImageSceneSelection("white_studio"),
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
  const visualOptions = useMemo(
    () => preview?.visualReferenceCandidates ?? [],
    [preview?.visualReferenceCandidates],
  );

  useEffect(() => {
    if (!preview) return;
    setSelectedFacts((current) => current.length > 0
      ? current.filter((id) => factOptions.some((option) => option.selectionId === id))
      : factOptions.map((option) => option.selectionId));
  }, [preview, factOptions]);

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
          返回研究历史
        </Link>
      </section>
    );
  }

  if (isActive) {
    return (
      <div data-testid="task-studio-authoritative-mode">
        <section className="surface-card mb-4 border-teal-200 bg-teal-50/50 p-4">
          <p className="text-sm font-bold text-teal-800">创作资料已确认</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            生成时服务器会再次读取研究记录、核对最新版本与当前身份；浏览器预填内容不作为权威事实。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
            <span className="rounded-full bg-white px-2.5 py-1">已确认事实 {detail.confirmedFacts?.length ?? 0} 项</span>
            <span className="rounded-full bg-white px-2.5 py-1">禁止声明 {detail.prohibitedClaims?.length ?? 0} 项</span>
            <span className="rounded-full bg-white px-2.5 py-1">最终人工复核：必须</span>
          </div>
        </section>
        {children}
      </div>
    );
  }

  const canConfirm = Boolean(
    preview
    && preview.expectedResearchRevision
    && preview.storageVersion
    && preview.expectedCurrentHandoffRevision !== undefined
    && selectedFacts.length > 0
    && confirmed,
  );

  async function submitPreparation() {
    if (!preview || !canConfirm || submitting) return;
    setSubmitting(true);
    setNotice("");
    try {
      const scene = resolveImageScenePreset(sceneSelection.scenePreset);
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
            additionalRequirements: sceneSelection.customInstruction,
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

      {factOptions.length > 0 ? (
        <fieldset className="mt-5">
          <legend className="text-sm font-bold text-slate-900">已确认商品事实</legend>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {factOptions.map((option) => (
              <label key={option.selectionId} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedFacts.includes(option.selectionId)}
                  onChange={(event) => setSelectedFacts((current) => event.target.checked
                    ? [...new Set([...current, option.selectionId])]
                    : current.filter((id) => id !== option.selectionId))}
                />
                <span><strong>{option.label}</strong>：{option.valueSummary}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          当前没有可确认的商品事实，请先回到研究记录补充并完成人工决定。
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
        <fieldset className="mt-4">
          <legend className="text-sm font-bold text-slate-900">商品参考图</legend>
          <p className="mt-1 text-xs leading-5 text-slate-500">只有你在这里批准的当前研究参考图，才能用于具体商品视觉草稿。</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {visualOptions.map((option) => (
              <label key={option.selectionId} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedVisuals.includes(option.selectionId)}
                  onChange={(event) => setSelectedVisuals((current) => event.target.checked
                    ? [...new Set([...current, option.selectionId])]
                    : current.filter((id) => id !== option.selectionId))}
                />
                <span>{option.summary || "研究记录中的商品参考图"}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {kind === "image" ? (
        <div className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50/30 p-4" data-testid="task-image-scene-selection">
          <p className="mb-3 text-sm font-bold text-slate-900">图片场景</p>
          <ImageScenePresetPicker
            value={sceneSelection.scenePreset}
            name="taskScenePreset"
            onChange={(scenePreset: ImageScenePreset) => {
              setSceneSelection((current) => createImageSceneSelection(scenePreset, current.customInstruction));
              setConfirmed(false);
            }}
          />
          <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700" htmlFor="task-image-custom-instruction">
            自定义要求
            <textarea
              id="task-image-custom-instruction"
              maxLength={200}
              rows={3}
              value={sceneSelection.customInstruction}
              onChange={(event) => {
                setSceneSelection(createImageSceneSelection(sceneSelection.scenePreset, event.currentTarget.value));
                setConfirmed(false);
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-normal"
              placeholder="例如：右侧保留文案区域，使用温暖早晨光线"
            />
          </label>
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
