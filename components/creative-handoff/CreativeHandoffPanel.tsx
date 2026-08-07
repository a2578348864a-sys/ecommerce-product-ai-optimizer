"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAccessHeaders, getAccessToken } from "@/lib/client/accessToken";
import { useSessionDraft } from "@/lib/client/useSessionDraft";
import { createBrowserUuid } from "@/lib/browserUuid";
import { useCreativeHandoffApi, HandoffApiRequestError } from "@/components/creative-handoff/useCreativeHandoffApi";
import {
  ELIGIBILITY_BLOCK_LABELS,
  REVOKE_REASON_OPTIONS,
  STALE_REASON_LABELS,
  type ApiError,
  type CreativeHandoffDetail,
  type CreativeHandoffPreview,
  type RevokeReasonCode,
} from "@/components/creative-handoff/types";

/**
 * V2 Visual Reference Preview: 安全缩略图。
 * 图片接口要求鉴权头（x-access-token），<img> 无法携带 → 按既有
 * AiImageDraftCard.PrivateImage 模式：fetch + 鉴权头 → blob → objectURL。
 * 失败时显示占位（不中断面板），绝不向浏览器暴露原始 URL / dataUrl。
 *
 * 缓存隔离：accessToken 读取自 sessionStorage 并加入依赖——身份切换（token 变化）
 * 时强制重新请求（no-store 响应绝不会命中旧缓存）；旧 objectURL 在切换/卸载时
 * revoke，旧图片绝不继续展示。
 */
function PrivateThumbnail({ thumbnailUrl, alt }: { thumbnailUrl: string; alt: string }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  // P1：身份绑定改用 effect 跟踪 token（不再 render-phase setState）。
  // token 变化 → 重新请求（no-store 响应绝不命中旧缓存）；旧 objectURL 在切换/卸载时 revoke。
  const [tokenSnapshot, setTokenSnapshot] = useState(() => getAccessToken());

  useEffect(() => {
    const currentToken = getAccessToken();
    if (currentToken !== tokenSnapshot) {
      setTokenSnapshot(currentToken);
    }
  }, [tokenSnapshot]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setFailed(false);
    setSource("");
    fetch(thumbnailUrl, {
      headers: buildAccessHeaders(),
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error("VISUAL_REFERENCE_LOAD_FAILED");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      // 卸载 / token 变化 / thumbnailUrl 变化：立即释放旧 objectURL，旧图片不再展示
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSource("");
    };
  }, [thumbnailUrl, tokenSnapshot]);

  if (failed) {
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-center text-[10px] leading-tight text-slate-400">
        图片不可用
      </div>
    );
  }
  if (!source) {
    return (
      <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-slate-100" aria-label="图片加载中" />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={alt}
      loading="lazy"
      className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
    />
  );
}

/**
 * 判断错误是否表示“页面依据已过期，必须清空旧选择并重新加载”。
 * 仅对真实表示旧 Preview 不可用的 409/422 返回 true。
 */
function shouldRefreshAfterCreativeHandoffError(status: number, code: string): boolean {
  if (status === 409) {
    return ["task_result_conflict", "research_revision_changed", "creative_handoff_conflict", "stale_preview", "idempotency_conflict"].includes(code);
  }
  if (status === 422) {
    // 研究状态已变化（决定变更/工作流不再完成/验证失效）→ 旧 Preview 不可用
    return ["research_gate_failed", "stale_preview", "research_revision_changed", "decision_not_creative_ready"].includes(code);
  }
  return false;
}

function formatDate(value?: string) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * 候选事实字段中文化：禁止向用户显示内部字段名（brand/category 等）。
 * 未知字段回退为原值仅作最后兜底（不应出现）；绝不显示 Schema 名 / Hash / 技术时间戳。
 */
const FACT_FIELD_LABELS: Record<string, string> = {
  brand: "品牌",
  category: "商品类目",
  price_usd: "参考价格（美元）",
  price: "参考价格",
  rating: "商品评分",
  review_count: "评论数量",
  reviews: "评论数量",
  asin: "ASIN",
  product_title: "商品标题",
  title: "商品标题",
  product_name: "商品名称",
  name: "商品名称",
  marketplace: "目标市场",
};

function factFieldLabel(field: string): string {
  const normalized = field.trim();
  return FACT_FIELD_LABELS[normalized] ?? normalized;
}

/**
 * 创作偏好选项化：用户不再手写，改为标签选择。
 * 默认推荐：Amazon 美国站 / 英语（美国）/ 专业可信 / 简洁棚拍。
 */
const MARKET_OPTIONS = [
  { value: "Amazon 美国站", label: "Amazon 美国站" },
  { value: "Amazon 英国站", label: "Amazon 英国站" },
  { value: "Amazon 德国站", label: "Amazon 德国站" },
  { value: "Amazon 日本站", label: "Amazon 日本站" },
  { value: "其他", label: "其他" },
] as const;

const LANGUAGE_OPTIONS = [
  { value: "英语（美国）", label: "英语（美国）" },
  { value: "英语（英国）", label: "英语（英国）" },
  { value: "德语", label: "德语" },
  { value: "法语", label: "法语" },
  { value: "意大利语", label: "意大利语" },
  { value: "西班牙语", label: "西班牙语" },
  { value: "日语", label: "日语" },
] as const;

const TONE_OPTIONS = [
  { value: "专业可信", label: "专业可信" },
  { value: "简洁直接", label: "简洁直接" },
  { value: "轻松友好", label: "轻松友好" },
  { value: "功能导向", label: "功能导向" },
  { value: "场景导向", label: "场景导向" },
  { value: "高端质感", label: "高端质感" },
  { value: "年轻活力", label: "年轻活力" },
] as const;

const IMAGE_STYLE_OPTIONS = [
  { value: "白底电商主图", label: "白底电商主图" },
  { value: "简洁棚拍", label: "简洁棚拍" },
  { value: "生活方式场景", label: "生活方式场景" },
  { value: "功能卖点图", label: "功能卖点图" },
  { value: "对比信息图", label: "对比信息图" },
  { value: "高端质感", label: "高端质感" },
  { value: "社交媒体广告图", label: "社交媒体广告图" },
] as const;

/** 创作偏好（选项式，含可选补充要求） */
export type CreativePrefs = {
  targetMarket?: string;
  language?: string;
  tone?: string;
  imageStyle?: string;
  /** 用户补充要求：仅影响表达/视觉风格，不作为商品事实；最长 200 字 */
  additionalRequirements?: string;
};

/** 默认推荐 */
const DEFAULT_PREFS: CreativePrefs = {
  targetMarket: "Amazon 美国站",
  language: "英语（美国）",
  tone: "专业可信",
  imageStyle: "简洁棚拍",
};

function StaleReasonBadge({ reasonCode }: { reasonCode?: string }) {
  const label = reasonCode ? (STALE_REASON_LABELS[reasonCode] ?? STALE_REASON_LABELS.default) : STALE_REASON_LABELS.default;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800" title={label}>
      <span aria-hidden="true">⚠</span> 已过期
    </span>
  );
}

type PanelState =
  | { kind: "loading" }
  | { kind: "legacy" }
  | { kind: "gate_blocked"; reason: string; label: string }
  | { kind: "not_found" }
  | { kind: "recoverable_error"; message: string }
  | { kind: "preview"; preview: CreativeHandoffPreview; detail: CreativeHandoffDetail | null }
  | { kind: "active"; preview: CreativeHandoffPreview; detail: CreativeHandoffDetail }
  | { kind: "stale"; preview: CreativeHandoffPreview; detail: CreativeHandoffDetail }
  | { kind: "revoked"; preview: CreativeHandoffPreview | null; detail: CreativeHandoffDetail }
  | { kind: "conflict"; message: string };

export function CreativeHandoffPanel({ taskId, onCommitted }: {
  taskId: string;
  /** 创建成功后通知父级（父级重读服务端真实任务状态，进度摘要随之刷新；不维护第二套前端进度） */
  onCommitted?: () => void;
}) {
  const api = useCreativeHandoffApi(taskId);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // V2 Final Integration: 视觉参考批准（只存服务端 selectionId，绝不存图片 URL/对象）
  const [selectedVisualIds, setSelectedVisualIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [retryBody, setRetryBody] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<CreativePrefs>({ ...DEFAULT_PREFS });
  // 当前向导步骤（草稿持久化；提升自 PreviewSection）
  const [guideStep, setGuideStep] = useState(1);
  // 草稿 Revision（初始 null = 尚未从服务端获知；获知后 researchRevision:handoffRevision）
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  // 会话草稿：刷新防丢失（仅 sessionStorage；保存 selectionId 列表 / 偏好 / 步骤 / 确认状态）
  const handoffDraft = useSessionDraft<{
    guideStep: number;
    selectedIds: string[];
    selectedVisualIds: string[];
    confirmed: boolean;
    prefs: CreativePrefs;
  }>({
    pageKind: "creative-handoff",
    entityId: taskId,
    revision: draftRevision,
    initial: { guideStep: 1, selectedIds: [], selectedVisualIds: [], confirmed: false, prefs: { ...DEFAULT_PREFS } },
  });
  const mounted = useRef(true);
  // P1：loadAll 重入保护——effect 依赖稳定后仅挂载/刷新触发一次，绝不重复发起
  const loadAllRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const deriveState = useCallback(
    (preview: CreativeHandoffPreview | null, detail: CreativeHandoffDetail | null, gateReason: string): PanelState => {
      if (!preview) {
        if (gateReason === "legacy_not_supported") return { kind: "legacy" };
        if (gateReason === "no_confirmed_facts") return { kind: "gate_blocked", reason: gateReason, label: ELIGIBILITY_BLOCK_LABELS.no_confirmed_facts };
        if (ELIGIBILITY_BLOCK_LABELS[gateReason]) return { kind: "gate_blocked", reason: gateReason, label: ELIGIBILITY_BLOCK_LABELS[gateReason] };
        return { kind: "gate_blocked", reason: gateReason, label: ELIGIBILITY_BLOCK_LABELS.default };
      }
      if (detail?.controlState === "revoked") return { kind: "revoked", preview, detail };
      if (detail?.controlState === "active" && detail.effectiveStatus === "stale") return { kind: "stale", preview, detail };
      if (detail?.controlState === "active") return { kind: "active", preview, detail };
      return { kind: "preview", preview, detail };
    },
    [],
  );

  const { load: apiLoad } = api;

  const loadAll = useCallback(async () => {
    // P1：去重——已在途时不再发起（useCreativeHandoffApi 内部 inFlight 也已兜底）
    if (loadAllRef.current) return;
    loadAllRef.current = true;
    try {
      const res = await apiLoad();
      if (!mounted.current) return;
      if (res.kind === "error") {
        if (res.error.status === 404) setState({ kind: "not_found" });
        else setState({ kind: "recoverable_error", message: res.error.message });
        return;
      }
      // 刷新恢复：从 preview 返回的已保存偏好读回（含 additionalRequirements）
      if (res.kind === "ok" && res.preview?.creativePreferences) {
        const saved = res.preview.creativePreferences;
        setPrefs((current) => ({
          ...current,
          ...(saved.targetMarket ? { targetMarket: saved.targetMarket } : {}),
          ...(saved.language ? { language: saved.language } : {}),
          ...(saved.tone ? { tone: saved.tone } : {}),
          ...(saved.imageStyle ? { imageStyle: saved.imageStyle } : {}),
          ...(saved.additionalRequirements ? { additionalRequirements: saved.additionalRequirements } : {}),
        }));
      }
      // 草稿 Revision：researchRevision + currentHandoff revision（变化时旧草稿失效）
      if (res.kind === "ok" && res.preview) {
        const rev = `${res.preview.expectedResearchRevision ?? 1}:${res.preview.expectedCurrentHandoffRevision ?? 0}`;
        if (rev !== draftRevision) setDraftRevision(rev);
      }
      setState(deriveState(res.preview, res.detail, res.gateReason));
    } finally {
      loadAllRef.current = false;
    }
  }, [apiLoad, deriveState, draftRevision]);

  // 草稿恢复后应用到表单状态（draft 非 null 即已恢复；依赖 draft 对象引用确保触发）
  useEffect(() => {
    if (handoffDraft.draft) {
      const d = handoffDraft.draft;
      setGuideStep(d.guideStep >= 1 && d.guideStep <= 4 ? d.guideStep : 1);
      if (Array.isArray(d.selectedIds)) setSelectedIds(d.selectedIds);
      if (Array.isArray(d.selectedVisualIds)) setSelectedVisualIds(d.selectedVisualIds);
      setConfirmed(d.confirmed === true);
      if (d.prefs && typeof d.prefs === "object") {
        setPrefs((current) => ({ ...current, ...d.prefs }));
      }
    }
  }, [handoffDraft.draft]);

  // 表单变化 → 防抖保存草稿（300-500ms）
  useEffect(() => {
    if (state.kind !== "preview" && state.kind !== "active" && state.kind !== "stale") return;
    handoffDraft.save({
      guideStep,
      selectedIds,
      selectedVisualIds,
      confirmed,
      prefs,
    });
  }, [guideStep, selectedIds, selectedVisualIds, confirmed, prefs, state.kind, handoffDraft]);

  // 创建成功 → 清除草稿（不再恢复旧内容）
  const clearDraftAfterCommit = useCallback(() => {
    handoffDraft.clear();
  }, [handoffDraft]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const resetSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectedVisualIds([]);
    setConfirmed(false);
    setRequestId(null);
    setRetryBody(null);
    setNotice(null);
  }, []);

  const toggleVisualReference = useCallback((selectionId: string) => {
    setSelectedVisualIds((prev) => {
      const next = prev.includes(selectionId) ? prev.filter((id) => id !== selectionId) : [...prev, selectionId];
      setRequestId(null);
      setRetryBody(null);
      return next;
    });
  }, []);

  const handleConflict = useCallback(
    (error: ApiError) => {
      resetSelection();
      const message =
        error.code === "idempotency_conflict"
          ? "这次请求与之前使用同一请求标识的内容不一致，请重新操作。"
          : "数据已经更新，请重新确认。";
      setState({ kind: "conflict", message });
      void loadAll();
    },
    [resetSelection, loadAll],
  );

  const toggleSelection = useCallback((selectionId: string) => {
    setSelectedIds((prev) => {
      const next = prev.includes(selectionId) ? prev.filter((id) => id !== selectionId) : [...prev, selectionId];
      setRequestId(null);
      setRetryBody(null);
      return next;
    });
  }, []);

  const submitCreate = useCallback(async () => {
    if (submitting) return;
    const preview = state.kind === "preview" || state.kind === "active" || state.kind === "stale" ? state.preview : null;
    if (!preview?.storageVersion || selectedIds.length < 1 || !confirmed) return;
    const nextRequestId = requestId ?? createBrowserUuid();
    // 提交服务端白名单字段（含 additionalRequirements：真实保存到 Handoff，参与指纹/Revision）
    const serverPrefs = {
      ...(prefs.targetMarket ? { targetMarket: prefs.targetMarket } : {}),
      ...(prefs.language ? { language: prefs.language } : {}),
      ...(prefs.tone ? { tone: prefs.tone } : {}),
      ...(prefs.imageStyle ? { imageStyle: prefs.imageStyle } : {}),
      ...(prefs.additionalRequirements?.trim()
        ? { additionalRequirements: prefs.additionalRequirements.trim().slice(0, 200) }
        : {}),
    };
    const body = {
      action: "create",
      requestId: nextRequestId,
      selectedFactCandidateIds: selectedIds,
      selectedVisualReferenceCandidateIds: selectedVisualIds,
      expectedStorageVersion: preview.storageVersion,
      expectedResearchRevision: preview.expectedResearchRevision ?? 1,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      ...(Object.keys(serverPrefs).length ? { creativePreferences: serverPrefs } : {}),
      confirmed: true,
    };
    setSubmitting(true);
    try {
      const result = await api.create({
        requestId: nextRequestId,
        selectedFactCandidateIds: selectedIds,
        selectedVisualReferenceCandidateIds: selectedVisualIds,
        expectedStorageVersion: preview.storageVersion,
        expectedResearchRevision: preview.expectedResearchRevision ?? 1,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        creativePreferences: Object.keys(serverPrefs).length ? serverPrefs : undefined,
        onConflict: handleConflict,
      });
      if (!mounted.current) return;
      if (result.idempotentReplay) {
        setNotice("该请求已成功提交过，未重复创建。");
      } else {
        setNotice(result.isNewRevision ? `已创建交接（版本 ${result.currentRevision}）。` : `已追加版本 ${result.currentRevision}。`);
      }
      // 创建成功 → 清除草稿（提交后不恢复旧未提交内容）
      clearDraftAfterCommit();
      resetSelection();
      await loadAll();
      onCommitted?.();
    } catch (err) {
      if (err instanceof HandoffApiRequestError) {
        if (shouldRefreshAfterCreativeHandoffError(err.error.status, err.error.code)) {
          // 409/422 stale：由 handleConflict 清空选择+确认+requestId 并重新加载
          handleConflict(err.error);
        } else if (err.error.code === "idempotency_conflict") {
          handleConflict(err.error);
        } else {
          setNotice(`创建失败：${err.error.message}`);
        }
      } else {
        setNotice("网络异常，请重试。");
        setRetryBody(body as unknown as Record<string, unknown>);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [state, selectedIds, selectedVisualIds, confirmed, requestId, prefs, api, handleConflict, resetSelection, loadAll, submitting, clearDraftAfterCommit, onCommitted]);

  const retrySameRequest = useCallback(() => {
    if (!retryBody || !requestId) return;
    setSubmitting(true);
    void (async () => {
      try {
        const headers = (await import("@/lib/client/accessToken")).buildAccessHeaders();
        const res = await fetch(`${"/api/tasks"}/${encodeURIComponent(taskId)}/creative-handoff`, {
          method: "POST",
          headers,
          body: JSON.stringify(retryBody),
        });
        if (res.status === 409) {
          const json = (await res.json()) as { error?: { code?: string; message?: string } };
          handleConflict({ status: 409, code: json.error?.code ?? "conflict", message: json.error?.message ?? "冲突" });
          return;
        }
        if (res.ok) {
          setNotice("重试成功，未重复创建。");
          resetSelection();
          await loadAll();
          onCommitted?.();
        } else {
          setNotice("重试仍失败，请稍后再试。");
        }
      } finally {
        if (mounted.current) setSubmitting(false);
      }
    })();
  }, [retryBody, requestId, taskId, handleConflict, resetSelection, loadAll, onCommitted]);

  const submitRevoke = useCallback(
    async (reasonCode: RevokeReasonCode) => {
      const detail = state.kind === "active" || state.kind === "stale" ? state.detail : null;
      if (!detail?.storageVersion || submitting) return;
      const revokeRequestId = createBrowserUuid();
      setSubmitting(true);
      try {
        await api.revoke({
          requestId: revokeRequestId,
          revokeReasonCode: reasonCode,
          expectedStorageVersion: detail.storageVersion,
          expectedCurrentHandoffRevision: detail.currentRevision ?? 1,
          onConflict: handleConflict,
        });
        if (!mounted.current) return;
        setNotice("交接已撤回，历史版本仍会保留。");
        resetSelection();
        await loadAll();
      } catch (err) {
        if (err instanceof HandoffApiRequestError && err.error.status !== 409) {
          setNotice(`撤回失败：${err.error.message}`);
        }
      } finally {
        if (mounted.current) setSubmitting(false);
      }
    },
    [state, submitting, api, handleConflict, resetSelection, loadAll],
  );

  const canCreate =
    selectedIds.length >= 1 &&
    confirmed &&
    (state.kind === "preview" || state.kind === "active" || state.kind === "stale") &&
    !submitting;

  const createButtonLabel =
    state.kind === "active" || state.kind === "stale" ? "创建新版本" : "创建创作交接";

  return (
    <section className="mt-5 rounded-2xl border border-teal-200 bg-white p-4" aria-label="创作交接">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-800">创作交接</h2>
        <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700">
          仅用于市场研究和内容草稿准备 · 仍需人工审核 · 不得直接发布
        </span>
      </header>

      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {notice}
        </p>
      ) : null}

      {/* 会话草稿状态：恢复提示 / 自动保存 / 失效提示 / 清除入口 */}
      {handoffDraft.restored ? (
        <p role="status" className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          已恢复刷新前的未提交内容
          <button
            type="button"
            onClick={handoffDraft.clear}
            className="ml-2 rounded border border-teal-300 px-1.5 py-0.5 text-xs font-semibold text-teal-700 hover:bg-teal-100"
          >
            清除当前草稿
          </button>
        </p>
      ) : handoffDraft.invalidated ? (
        <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          任务内容已经更新，为避免使用过期信息，未恢复上次草稿。
        </p>
      ) : handoffDraft.saved ? (
        <p className="mt-3 text-xs text-slate-400">草稿已自动保存</p>
      ) : null}

      {state.kind === "loading" ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="加载中">
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
          <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
        </div>
      ) : null}

      {state.kind === "legacy" ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600">
          该记录没有可信商品研究合同，暂不支持创建创作交接。
          <br />
          请从商品研究池重新创建正式研究。
        </p>
      ) : null}

      {state.kind === "gate_blocked" ? (
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-3">
          <p className="text-sm font-semibold text-amber-800">{state.label}</p>
          <p className="mt-1 text-xs text-amber-700">暂不能创建创作交接，请先完成研究决定或处理阻塞项。</p>
        </div>
      ) : null}

      {state.kind === "not_found" ? (
        <p role="alert" className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
          该任务不存在或你无权访问。
        </p>
      ) : null}

      {state.kind === "recoverable_error" ? (
        <div role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-3">
          <p className="text-sm text-red-700">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            重试
          </button>
        </div>
      ) : null}

      {state.kind === "conflict" ? (
        <div role="alert" className="mt-4 rounded-lg bg-amber-50 px-3 py-3">
          <p className="text-sm font-semibold text-amber-800">{state.message}</p>
          <p className="mt-1 text-xs text-amber-700">已清空旧选择，请重新查看最新预览后再次确认。</p>
        </div>
      ) : null}

      {(state.kind === "preview" || state.kind === "active" || state.kind === "stale") && state.preview ? (
        <PreviewSection
          preview={state.preview}
          selectedIds={selectedIds}
          onToggle={toggleSelection}
          selectedVisualIds={selectedVisualIds}
          onToggleVisual={toggleVisualReference}
          prefs={prefs}
          onPrefsChange={setPrefs}
          guideStep={guideStep}
          onGuideStepChange={setGuideStep}
        />
      ) : null}

      {state.kind === "active" || state.kind === "stale" || state.kind === "revoked" ? (
        <DetailSection detail={state.detail} stale={state.kind === "stale"} />
      ) : null}

      {(state.kind === "preview" || state.kind === "active" || state.kind === "stale") && state.preview ? (
        <ConfirmationSection
          selectedCount={selectedIds.length}
          selectedVisualCount={selectedVisualIds.length}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
          canCreate={canCreate}
          buttonLabel={createButtonLabel}
          submitting={submitting}
          onCreate={() => void submitCreate()}
          hasRetry={Boolean(retryBody) && Boolean(requestId)}
          onRetry={() => retrySameRequest()}
        />
      ) : null}

      {(state.kind === "active" || state.kind === "stale") && state.detail ? (
        <RevokeSection
          detail={state.detail}
          submitting={submitting}
          onRevoke={submitRevoke}
        />
      ) : null}
    </section>
  );
}

function PreviewSection({
  preview,
  selectedIds,
  onToggle,
  selectedVisualIds,
  onToggleVisual,
  prefs,
  onPrefsChange,
  guideStep,
  onGuideStepChange,
}: {
  preview: CreativeHandoffPreview;
  selectedIds: string[];
  onToggle: (selectionId: string) => void;
  selectedVisualIds: string[];
  onToggleVisual: (selectionId: string) => void;
  prefs: CreativePrefs;
  onPrefsChange: (prefs: CreativePrefs) => void;
  guideStep: number;
  onGuideStepChange: (step: number) => void;
}) {
  const confirmables = preview.confirmableFactCandidates ?? [];
  const stables = preview.stableSourceFacts ?? [];
  const ais = preview.aiReferences ?? [];
  const issues = preview.issues ?? [];
  const claims = preview.prohibitedClaims ?? [];
  const visuals = preview.visualReferenceCandidates ?? [];
  const blockingIssues = issues.filter((issue) => issue.risk === "blocking");

  // F：4 步向导（确认事实 → 确认视觉 → 创作偏好 → 创建交接）——step 由父组件持有（草稿持久化）
  const setGuideStep = onGuideStepChange;
  const stepCount = 4;
  const factsDone = selectedIds.length >= 1;
  const canGoNext = (step: number) => {
    if (step === 1) return factsDone;
    return true; // 步骤 2/3 均可跳过（视觉参考/创作偏好非必填）
  };
  const stepLabels = ["确认可用事实", "确认视觉参考", "填写创作偏好", "创建交接"] as const;
  // 创建后会开放什么（供步骤 4 展示）
  const opensAfterCreate = "Listing 草稿 · 产品图片";

  return (
    <div className="mt-4 space-y-4">
      {/* F：步骤指示条 */}
      <nav className="flex flex-wrap items-center gap-1.5" aria-label="创作交接步骤">
        {stepLabels.map((label, index) => {
          const step = index + 1;
          const active = guideStep === step;
          const done = step < guideStep || (step === 1 && factsDone);
          return (
            <button
              key={label}
              type="button"
              aria-current={active ? "step" : undefined}
              onClick={() => { if (step < guideStep || canGoNext(guideStep) || guideStep === step) setGuideStep(step); }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                active ? "border-teal-300 bg-teal-50 text-teal-800"
                  : done ? "border-teal-200 bg-teal-50/40 text-teal-700"
                    : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              <span className={`flex size-4 items-center justify-center rounded-full text-[10px] ${
                active || done ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-500"
              }`}>
                {done && step < guideStep ? "✓" : step}
              </span>
              {label}
              {active ? <span className="text-[10px] text-teal-500">第 {step} 步</span> : null}
            </button>
          );
        })}
      </nav>
      {!factsDone && guideStep === 1 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          还差：至少勾选 1 项可用事实，才能继续下一步。
        </p>
      ) : null}
      {guideStep === 4 ? (
        <p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          创建后将开放：{opensAfterCreate}。确认后即可开始准备文案与图片草稿。
        </p>
      ) : null}

      {blockingIssues.length > 0 ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
          <p className="text-sm font-semibold text-red-800">存在阻塞问题，暂不能创建创作交接。</p>
          {blockingIssues.map((issue) => (
            <p key={issue.selectionId} className="mt-1 text-xs text-red-700">
              {issue.field}：{issue.summary}
            </p>
          ))}
        </div>
      ) : null}

      {/* 步骤 1：确认可用事实 */}
      {guideStep === 1 ? (
        <>
          {/* 1. 来源数据快照 / 3. 可确认事实 */}
          <section className="rounded-xl border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-700">
              可确认事实
              <span className="ml-2 text-xs font-normal text-slate-400">已选 {selectedIds.length} 项</span>
            </h3>
            {confirmables.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">当前没有可人工确认的商品事实。</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {confirmables.map((item) => (
                  <li key={item.selectionId} className="flex items-start gap-2 rounded-lg bg-teal-50/50 px-2 py-1.5">
                    <input
                      id={`confirm-${item.selectionId}`}
                      type="checkbox"
                      checked={selectedIds.includes(item.selectionId)}
                      onChange={() => onToggle(item.selectionId)}
                      className="mt-0.5 h-4 w-4 accent-teal-600"
                    />
                    <label htmlFor={`confirm-${item.selectionId}`} className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800">{factFieldLabel(item.canonicalField)}</span>
                      <span className="block break-words text-sm text-slate-600">{item.displayValue}</span>
                      <span className="mt-0.5 block text-xs text-slate-400">来自候选商品快照，需人工确认</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Listing 卖点提示：缺失卖点 / bullets 不阻塞交接 */}
          {issues.some((issue) => issue.field === "listing_input") ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
              当前没有现成商品卖点，不影响继续。系统会根据已确认事实生成保守 Listing 草稿。
            </p>
          ) : null}

          {/* 参考信息（默认折叠）：稳定来源 / AI 参考 / 风险，改用用户语言 */}
          {(stables.length > 0 || ais.length > 0 || issues.length > 0 || claims.length > 0) ? (
            <details className="mt-4 rounded-xl border border-slate-200 bg-white/80 p-3">
              <summary className="cursor-pointer text-sm font-bold text-slate-700 select-none">
                参考信息
                <span className="ml-2 text-xs font-medium text-slate-400">默认折叠，不影响确认</span>
              </summary>
              <div className="mt-3 space-y-3">
                {/* 稳定来源事实（只读） */}
                {stables.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-700">稳定来源信息</h3>
                    <ul className="mt-1 space-y-1">
                      {stables.map((item) => (
                        <li key={item.selectionId} className="flex items-center gap-2 text-sm text-slate-600">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden="true" />
                          {factFieldLabel(item.label)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {/* AI 创意参考（只读） */}
                {ais.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-700">
                      AI 参考建议
                      <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">不能作为商品事实</span>
                    </h3>
                    <ul className="mt-1 space-y-1">
                      {ais.map((item) => (
                        <li key={item.selectionId} className="flex items-start gap-2 text-sm text-slate-600">
                          <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-violet-300" aria-hidden="true" />
                          <span className="min-w-0 break-words">{item.summary}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {/* 未知／冲突与风险（中文风险文案，不显示内部字段名） */}
                {issues.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-700">风险提示</h3>
                    <ul className="mt-1 space-y-1">
                      {issues.map((issue) => (
                        <li key={issue.selectionId} className="flex items-start gap-2 text-sm text-slate-600">
                          <span
                            className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                              issue.risk === "blocking" ? "bg-red-400" : issue.risk === "high" ? "bg-amber-400" : "bg-slate-300"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 break-words">
                            {issue.summary}
                            {issue.risk === "blocking" ? <span className="ml-1 font-semibold text-red-700">（阻塞）</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {/* 禁止声明 */}
                {claims.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-700">禁止声明</h3>
                    <ul className="mt-1 space-y-1">
                      {claims.map((claim) => (
                        <li key={claim.selectionId} className="text-sm text-slate-600">
                          {claim.summary}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </details>
          ) : null}
        </>
      ) : null}

      {/* 步骤 2：确认视觉参考 */}
      {guideStep === 2 ? (
        <>
          {visuals.length > 0 ? (
            <section className="rounded-xl border border-teal-200 p-3">
              <h3 className="text-sm font-semibold text-slate-700">
                视觉参考
                <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">可批准用于真实产品视觉</span>
                <span className="ml-2 text-xs font-normal text-slate-400">已选 {selectedVisualIds.length} 项</span>
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                勾选后，后续图片生成将以该参考图作为商品外观依据；图片经安全接口读取，不会向浏览器暴露原始来源。
              </p>
              <ul className="mt-2 space-y-2">
                {visuals.map((item) => {
                  const checked = selectedVisualIds.includes(item.selectionId);
                  return (
                    <li key={item.selectionId} className="flex items-start gap-3 rounded-lg bg-teal-50/50 px-2 py-1.5">
                      <input
                        id={`visual-${item.selectionId}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleVisual(item.selectionId)}
                        className="mt-0.5 h-4 w-4 accent-teal-600"
                      />
                      <label htmlFor={`visual-${item.selectionId}`} className="flex min-w-0 flex-1 items-start gap-3">
                        {/* V2 Visual Preview: 安全缩略图（fetch+鉴权头→blob→objectURL；失败占位不报错） */}
                        {item.thumbnailUrl ? (
                          <PrivateThumbnail thumbnailUrl={item.thumbnailUrl} alt="" />
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800">
                            {item.summary || "商品图片参考"}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-400">
                            {item.sourceTier === "candidate_snapshot" ? "来自商品候选快照" : item.sourceTier}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              当前没有可批准的视觉参考；可直接进入下一步（不会用真实商品图）。
            </p>
          )}
        </>
      ) : null}

      {/* 步骤 3：填写创作偏好（选项式标签，非手写输入） */}
      {guideStep === 3 ? (
        <section className="rounded-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-700">创作偏好</h3>
          <p className="mt-1 text-xs text-slate-400">选择偏好，随创作交接保存，供 Listing / 图片草稿参考。</p>
          <div className="mt-3 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-600">目标市场</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {MARKET_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={prefs.targetMarket === option.value}
                    onClick={() => {
                      const next = { ...prefs, targetMarket: option.value };
                      // 市场变化时语言跟随市场默认
                      if (option.value === "Amazon 英国站") next.language = "英语（英国）";
                      else if (option.value === "Amazon 德国站") next.language = "德语";
                      else if (option.value === "Amazon 日本站") next.language = "日语";
                      else next.language = "英语（美国）";
                      onPrefsChange(next);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      prefs.targetMarket === option.value
                        ? "border-teal-300 bg-teal-50 text-teal-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">语言</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={prefs.language === option.value}
                    onClick={() => onPrefsChange({ ...prefs, language: option.value })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      prefs.language === option.value
                        ? "border-teal-300 bg-teal-50 text-teal-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">文案语气</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TONE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={prefs.tone === option.value}
                    onClick={() => onPrefsChange({ ...prefs, tone: option.value })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      prefs.tone === option.value
                        ? "border-teal-300 bg-teal-50 text-teal-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">图片风格</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {IMAGE_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={prefs.imageStyle === option.value}
                    onClick={() => onPrefsChange({ ...prefs, imageStyle: option.value })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      prefs.imageStyle === option.value
                        ? "border-teal-300 bg-teal-50 text-teal-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">补充要求（可选）</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">
                可填写特殊的表达或视觉偏好，最多 200 字；不会被视为商品事实。
              </span>
              <textarea
                value={prefs.additionalRequirements ?? ""}
                maxLength={200}
                rows={2}
                onChange={(e) => onPrefsChange({ ...prefs, additionalRequirements: e.target.value.slice(0, 200) })}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </label>
          </div>
        </section>
      ) : null}

      {/* F：底部导航（上一步 / 下一步） */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div>
          {guideStep > 1 ? (
            <button
              type="button"
              onClick={() => setGuideStep(Math.max(1, guideStep - 1))}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              上一步
            </button>
          ) : null}
        </div>
        <div>
          {guideStep < stepCount ? (
            <button
              type="button"
              disabled={!canGoNext(guideStep)}
              onClick={() => setGuideStep(guideStep + 1)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              下一步
            </button>
          ) : null}
          {!canGoNext(guideStep) ? (
            <span className="ml-2 text-xs text-slate-400">请先勾选至少 1 项可用事实</span>
          ) : null}
          {guideStep === stepCount ? (
            <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3 text-sm leading-6 text-teal-900">
              <p className="font-semibold">准备就绪，可创建创作交接</p>
              <p className="mt-1">创建后将开放：{opensAfterCreate}。请回到下方「创建创作交接」区域，勾选人工确认后提交。</p>
              <p className="mt-1 text-xs text-teal-700">
                {factsDone ? "已确认可用事实 ✓" : ""} · {selectedVisualIds.length > 0 ? `已批准 ${selectedVisualIds.length} 项视觉参考 ✓` : "未选择视觉参考（可选）"}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailSection({ detail, stale }: { detail: CreativeHandoffDetail | null; stale: boolean }) {
  if (!detail) return null;
  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">当前交接</h3>
        {detail.controlState === "revoked" ? (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">已撤回</span>
        ) : stale ? (
          <StaleReasonBadge reasonCode={detail.staleReasonCode} />
        ) : (
          <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">生效中</span>
        )}
        <span className="text-xs text-slate-400">Revision {detail.currentRevision}</span>
      </div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-400">创建时间</dt>
          <dd className="text-slate-700">{formatDate(detail.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">来源研究版本</dt>
          <dd className="text-slate-700">{detail.sourceResearchRevision ?? "未知"}</dd>
        </div>
      </dl>
      {detail.confirmedFacts && detail.confirmedFacts.length > 0 ? (
        <div className="mt-2">
          <h4 className="text-xs font-semibold text-slate-500">已确认事实</h4>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {detail.confirmedFacts.map((fact) => (
              <li key={fact.field} className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-800">
                {fact.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {detail.versions && detail.versions.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-500">历史版本（{detail.versions.length}）</summary>
          <ul className="mt-1 space-y-0.5">
            {[...detail.versions].reverse().map((version) => (
              <li key={version.revision} className="text-xs text-slate-500">
                Revision {version.revision} · {formatDate(version.createdAt)} · 已确认 {version.confirmedFactFields.length} 项
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {stale ? (
        <p className="mt-2 text-xs text-amber-700">
          旧版本内容仅作查看，不能用于新的内容生成。创建新版本前请重新确认最新事实。
        </p>
      ) : null}
      {detail.controlState === "revoked" ? (
        <p className="mt-2 text-xs text-slate-500">
          该交接已撤回。撤回原因与时间见上方；历史版本仍会保留。
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-400">
        交接准备已完成。下方区域可继续准备文案与图片草稿。
      </p>
    </div>
  );
}

function ConfirmationSection({
  selectedCount,
  selectedVisualCount,
  confirmed,
  onConfirmedChange,
  canCreate,
  buttonLabel,
  submitting,
  onCreate,
  hasRetry,
  onRetry,
}: {
  selectedCount: number;
  selectedVisualCount: number;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  canCreate: boolean;
  buttonLabel: string;
  submitting: boolean;
  onCreate: () => void;
  hasRetry: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/40 p-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-teal-600"
        />
        <span className="text-sm text-slate-700">
          我已核对以上选中事实，确认它们可用于后续内容草稿。
          <br />
          我理解内容仍需人工审核，不能直接发布。
        </span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canCreate}
          onClick={onCreate}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? "提交中…" : buttonLabel}
        </button>
        {hasRetry ? (
          <button
            type="button"
            disabled={submitting}
            onClick={onRetry}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            重试同一请求
          </button>
        ) : null}
        {selectedCount < 1 ? <span className="text-xs text-slate-400">请至少选择一项事实</span> : null}
        {selectedCount >= 1 && !confirmed ? <span className="text-xs text-slate-400">请先勾选人工确认</span> : null}
        {selectedVisualCount > 0 && !confirmed ? <span className="text-xs text-teal-600">已批准 {selectedVisualCount} 项视觉参考，确认后生效</span> : null}
      </div>
    </div>
  );
}

function RevokeSection({
  detail,
  submitting,
  onRevoke,
}: {
  detail: CreativeHandoffDetail;
  submitting: boolean;
  onRevoke: (reasonCode: RevokeReasonCode) => void;
}) {
  const [reason, setReason] = useState<RevokeReasonCode>("explicit_user_revoke");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (detail.controlState === "revoked") return null;
  if (!detail.canCreateNewRevision && detail.controlState !== "active") return null;

  return (
    <div className="mt-4 rounded-xl border border-red-100 p-3">
      <h3 className="text-sm font-semibold text-slate-700">撤回交接</h3>
      <p className="mt-1 text-xs text-slate-500">撤回后，当前交接不能再用于新的内容生成。历史版本仍会保留。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-600">撤回原因</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as RevokeReasonCode)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
          {REVOKE_REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={submitting}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          撤回交接
        </button>
      </div>
      {confirmOpen ? (
        <div role="dialog" aria-modal="true" aria-label="确认撤回" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">确认撤回当前创作交接？历史版本仍会保留。</p>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-red-600"
            />
            <span className="text-sm text-red-800">我确认撤回</span>
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!confirmed || submitting}
              onClick={() => {
                onRevoke(reason);
                setConfirmOpen(false);
                setConfirmed(false);
              }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:bg-slate-300"
            >
              确认撤回
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmed(false);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
