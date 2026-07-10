"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronUp, ImageIcon, Loader2, ShieldAlert } from "lucide-react";
import {
  AI_IMAGE_DRAFT_DISCLAIMER,
  getAiImageTypeLabel,
  type AiImageAccessMode,
  type AiImageDraftItem,
  type AiImageDraftSnapshot,
  type AiImageDraftType,
} from "@/lib/aiImageDraft";
import { buildAccessHeaders, updateDemoAccessInfo } from "@/lib/client/accessToken";

type VisitorAccess = {
  maxAiCalls: number;
  usedAiCalls: number;
  remainingAiCalls: number;
};

type Metadata = {
  enabled: boolean;
  accessMode: AiImageAccessMode;
  maxCount: 1 | 2;
  snapshot: AiImageDraftSnapshot | null;
  visitorAccess: VisitorAccess | null;
};

const IMAGE_TYPES: AiImageDraftType[] = [
  "white_background_concept",
  "lifestyle_scene",
  "feature_infographic",
];

const IMAGE_TYPE_DESCRIPTIONS: Record<AiImageDraftType, string> = {
  white_background_concept: "用于查看干净背景与主体占比方向。",
  lifestyle_scene: "用于查看商品在通用使用环境中的构图方向。",
  feature_infographic: "用于查看信息层级与留白区域，不填入未经验证的数据。",
};

const TERMINAL_IMAGE_REQUEST_ERROR_CODES = new Set([
  "image_provider_timeout",
  "image_provider_rate_limited",
  "image_provider_unavailable",
  "image_content_blocked",
  "image_provider_error",
  "image_response_invalid",
  "image_storage_failed",
  "image_snapshot_save_failed",
  "image_request_already_failed",
]);

export function shouldRenewAiImageRequestKey(errorCode: unknown): boolean {
  return typeof errorCode === "string" && TERMINAL_IMAGE_REQUEST_ERROR_CODES.has(errorCode);
}

function PrivateImage({ taskId, item }: { taskId: string; item: AiImageDraftItem }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setFailed(false);
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-draft/${encodeURIComponent(item.id)}`, {
      headers: buildAccessHeaders(),
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error("IMAGE_LOAD_FAILED");
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
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, taskId]);

  if (failed) {
    return <div className="flex aspect-square items-center justify-center bg-slate-100 px-3 text-center text-xs text-slate-500">图片读取失败</div>;
  }
  if (!source) {
    return <div className="flex aspect-square items-center justify-center bg-slate-100"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="图片读取中" /></div>;
  }
  return (
    <Image
      src={source}
      alt={`${getAiImageTypeLabel(item.imageType)}，待人工复核`}
      width={item.width || 1024}
      height={item.height || 1024}
      unoptimized
      className="aspect-square w-full object-cover"
    />
  );
}

export function AiImageDraftCard({
  taskId,
  initialSnapshot = null,
}: {
  taskId: string;
  initialSnapshot?: AiImageDraftSnapshot | null;
}) {
  const [open, setOpen] = useState(false);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [imageType, setImageType] = useState<AiImageDraftType>("white_background_concept");
  const [count, setCount] = useState<1 | 2>(1);
  const [additionalDirection, setAdditionalDirection] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadMetadata = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-draft`, {
        headers: buildAccessHeaders(),
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "图片草稿状态读取失败。");
      setMetadata(body.data as Metadata);
      if (body.data.snapshot) setSnapshot(body.data.snapshot as AiImageDraftSnapshot);
      if (body.data.accessMode === "visitor") setCount(1);
    } catch (metadataError) {
      setError(metadataError instanceof Error ? metadataError.message : "图片草稿状态读取失败。");
    }
  }, [taskId]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  function resetRequestKey() {
    setIdempotencyKey("");
    setMessage("");
    setError("");
  }

  async function handleGenerate() {
    if (!metadata?.enabled || !confirmed || loading) return;
    setLoading(true);
    setError("");
    setMessage("");
    const requestKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/image-draft`, {
        method: "POST",
        headers: { "content-type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          imageType,
          count: metadata.accessMode === "visitor" ? 1 : count,
          additionalDirection: additionalDirection.trim() || undefined,
          confirmed: true,
          idempotencyKey: requestKey,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        if (shouldRenewAiImageRequestKey(body.error?.code)) setIdempotencyKey("");
        throw new Error(body.error?.message || "图片草稿生成失败。");
      }
      setSnapshot(body.data.snapshot as AiImageDraftSnapshot);
      if (body.data.visitorAccess) {
        setMetadata((current) => current ? { ...current, visitorAccess: body.data.visitorAccess } : current);
        updateDemoAccessInfo(body.data.visitorAccess);
      }
      setMessage(body.data.duplicate ? "已恢复同一请求的已保存结果。" : "图片草稿已保存到当前任务，需人工复核后使用。");
      setConfirmed(false);
      setIdempotencyKey("");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "图片草稿生成失败。");
    } finally {
      setLoading(false);
    }
  }

  const remaining = metadata?.visitorAccess?.remainingAiCalls;
  const exhausted = metadata?.accessMode === "visitor" && typeof remaining === "number" && remaining <= 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="ai-image-draft-card">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700"><ImageIcon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">AI 图片素材草稿</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">从当前任务已确认的信息生成构图方向草稿，不会自动上架。</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          aria-expanded={open}
          aria-label={open ? "收起图片草稿设置" : "展开图片草稿设置"}
          title={open ? "收起" : "展开"}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900" data-testid="ai-image-draft-disclaimer">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p>{AI_IMAGE_DRAFT_DISCLAIMER}</p>
          <p className="mt-1">功能信息图不得使用未经验证的尺寸、性能、认证或效果数据，真实参数需要人工补充和复核。</p>
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-4" data-testid="ai-image-draft-settings">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              图片类型
              <select
                value={imageType}
                onChange={(event) => { setImageType(event.target.value as AiImageDraftType); resetRequestKey(); }}
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
              >
                {IMAGE_TYPES.map((type) => <option key={type} value={type}>{getAiImageTypeLabel(type)}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{IMAGE_TYPE_DESCRIPTIONS[imageType]}</span>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              生成数量
              {metadata?.accessMode === "owner" ? (
                <select
                  value={count}
                  onChange={(event) => { setCount(Number(event.target.value) as 1 | 2); resetRequestKey(); }}
                  className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-400"
                >
                  <option value={1}>1 张</option>
                  <option value={2}>2 张</option>
                </select>
              ) : (
                <div className="mt-2 flex h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-600">1 张</div>
              )}
            </label>
          </div>

          <label className="block text-sm font-semibold text-slate-700">
            构图补充（可选）
            <textarea
              value={additionalDirection}
              maxLength={300}
              rows={3}
              onChange={(event) => { setAdditionalDirection(event.target.value); resetRequestKey(); }}
              placeholder="只补充背景、视角或构图偏好；不要填写品牌、认证或未经确认的商品事实。"
              className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 outline-none focus:border-cyan-400"
            />
            <span className="mt-1 block text-right text-xs font-normal text-slate-400">{additionalDirection.length}/300</span>
          </label>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4" />
            <span>本次将调用真实 AI 图片生成服务。生成结果可能与真实商品的结构、材质、尺寸或颜色存在差异，必须人工复核后使用。</span>
          </label>

          {metadata?.accessMode === "visitor" ? (
            <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-3 text-sm leading-6 text-cyan-900">
              <p className="font-bold">访客体验模式</p>
              <p>你正在使用临时访问权限，文本和图片真实 AI 功能共享有限体验次数。</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={!metadata?.enabled || !confirmed || loading || exhausted}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="ai-image-draft-generate"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              {loading ? "正在生成并保存..." : "生成图片草稿"}
            </button>
            {metadata?.accessMode === "visitor" && typeof remaining === "number" ? <span className="text-xs font-semibold text-slate-500">共享真实 AI 体验剩余 {remaining} 次</span> : null}
          </div>
          {metadata && !metadata.enabled ? <p className="text-sm font-semibold text-amber-700">当前未开启真实图片生成，本次不会消耗额度。</p> : null}
          {message ? <p className="text-sm font-semibold text-emerald-700">{message}</p> : null}
          {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}

          {snapshot?.items.length ? (
            <div>
              <p className="text-sm font-bold text-slate-800">已保存草稿</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[...snapshot.items].reverse().map((item) => (
                  <article key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <PrivateImage taskId={taskId} item={item} />
                    <div className="p-3">
                      <p className="text-sm font-bold text-slate-800">{getAiImageTypeLabel(item.imageType)}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">需人工复核 · {new Date(item.createdAt).toLocaleString("zh-CN")}</p>
                      {item.safetyWarnings.map((warning) => <p key={warning} className="mt-1 text-xs leading-5 text-amber-700">{warning}</p>)}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">当前任务还没有已保存的图片草稿。</p>}
        </div>
      ) : null}
    </section>
  );
}
