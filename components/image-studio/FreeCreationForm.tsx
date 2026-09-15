"use client";

import { useRef, type ChangeEvent } from "react";
import { Loader2, Upload, X, Sparkles } from "lucide-react";
import { STUDIO_IMAGE_PROMPT_TEMPLATES } from "@/lib/client/studioImageRequest";
import {
  STUDIO_IMAGE_ASPECT_RATIOS,
  STUDIO_IMAGE_CREATIVE_PROMPT_MAX_LENGTH,
  type StudioImageAspectRatio,
} from "@/lib/studioImageInput";

export const STUDIO_ASPECT_RATIO_LABELS: Record<StudioImageAspectRatio, string> = {
  square_1_1: "1:1 方图",
  portrait_4_5: "4:5 竖图",
  landscape_16_9: "16:9 横图",
};

export type FreeCreationValues = {
  creativePrompt: string;
  aspectRatio: StudioImageAspectRatio;
  count: 1 | 2;
  referenceImageDataUrl?: string;
};

export interface FreeCreationFormProps {
  values: FreeCreationValues;
  onChange: (next: FreeCreationValues) => void;
  onSubmit: (values: FreeCreationValues) => void;
  disabled?: boolean;
}

export function FreeCreationForm({
  values,
  onChange,
  onSubmit,
  disabled = false,
}: FreeCreationFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<FreeCreationValues>) => {
    onChange({ ...values, ...patch });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      alert("请上传 PNG、JPEG 或 WebP 格式的图片。");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("图片大小不能超过 10MB。");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        update({ referenceImageDataUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    update({ referenceImageDataUrl: undefined });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid="free-creation-form">
      {/* 创作描述 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="free-creation-prompt" className="text-xs font-bold text-slate-800">
            自定义图片描述 <span className="text-rose-500">*</span>
          </label>
          <span className="text-[11px] text-slate-400">
            {values.creativePrompt.length}/{STUDIO_IMAGE_CREATIVE_PROMPT_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id="free-creation-prompt"
          name="creativePrompt"
          data-testid="free-creation-prompt"
          required
          disabled={disabled}
          rows={3}
          maxLength={STUDIO_IMAGE_CREATIVE_PROMPT_MAX_LENGTH}
          value={values.creativePrompt}
          placeholder="例如：极简白色背景的陶瓷马克杯主视觉，柔和侧光，自然阴影，留出文案空间"
          onChange={(e) => update({ creativePrompt: e.target.value })}
          className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:bg-slate-50 disabled:text-slate-500"
        />
        <p className="text-[11px] text-slate-500">
          描述画面本身即可（主体、场景、光线、构图）。不要填写供应商、模型或文件路径等信息。
        </p>
      </div>

      {/* 快速模板 */}
      <div className="space-y-1.5">
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          快速模板（一键填入描述）
        </span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STUDIO_IMAGE_PROMPT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={disabled}
              data-testid={`free-creation-template-${template.id}`}
              onClick={() => update({ creativePrompt: template.prompt })}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:border-cyan-400 hover:bg-cyan-50/50 hover:text-cyan-800 disabled:opacity-50 transition-colors"
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      {/* 必要图片输入：可选参考图 */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700">
          参考图（可选）
        </label>
        {values.referenceImageDataUrl ? (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={values.referenceImageDataUrl}
              alt="参考图预览"
              className="h-16 w-16 rounded-lg object-cover border border-slate-200"
              data-testid="free-creation-reference-preview"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-800">已添加参考图</p>
              <p className="text-[11px] text-slate-500">将作为视觉风格与构图辅助参考</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={handleRemoveImage}
              data-testid="free-creation-remove-reference-btn"
              className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              title="移除参考图"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled}
              data-testid="free-creation-reference-input"
              onChange={handleFileChange}
              className="hidden"
              id="free-creation-reference-input"
            />
            <label
              htmlFor="free-creation-reference-input"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-xs font-medium text-slate-600 hover:border-cyan-400 hover:bg-cyan-50/40 hover:text-cyan-800"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>上传参考图（PNG/JPEG/WebP，≤10MB）</span>
            </label>
          </div>
        )}
      </div>

      {/* 比例与数量 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 比例 */}
        <fieldset className="space-y-1.5" disabled={disabled}>
          <legend className="text-xs font-semibold text-slate-700">图片比例</legend>
          <div className="grid grid-cols-3 gap-2">
            {STUDIO_IMAGE_ASPECT_RATIOS.map((ratio) => {
              const selected = values.aspectRatio === ratio;
              return (
                <label
                  key={ratio}
                  data-testid={`free-creation-aspect-ratio-${ratio}`}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border p-2 text-center text-xs font-medium transition-colors ${
                    selected
                      ? "border-cyan-600 bg-cyan-50 text-cyan-900 font-bold"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="free-creation-aspect-ratio"
                    value={ratio}
                    checked={selected}
                    onChange={() => update({ aspectRatio: ratio })}
                    className="sr-only"
                  />
                  <span>{STUDIO_ASPECT_RATIO_LABELS[ratio]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* 数量 */}
        <fieldset className="space-y-1.5" disabled={disabled}>
          <legend className="text-xs font-semibold text-slate-700">生成数量</legend>
          <div className="grid grid-cols-2 gap-2">
            {([1, 2] as const).map((cnt) => {
              const selected = values.count === cnt;
              return (
                <label
                  key={cnt}
                  data-testid={`free-creation-count-${cnt}`}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border p-2 text-center text-xs font-medium transition-colors ${
                    selected
                      ? "border-cyan-600 bg-cyan-50 text-cyan-900 font-bold"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="free-creation-count"
                    value={cnt}
                    checked={selected}
                    onChange={() => update({ count: cnt })}
                    className="sr-only"
                  />
                  <span>{cnt} 张</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      {/* 提交按钮 */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={disabled || !values.creativePrompt.trim()}
          data-testid="free-creation-submit-btn"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-cyan-700 active:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors sm:w-auto"
        >
          {disabled ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在生成图片…</span>
            </>
          ) : (
            <span>生成图片</span>
          )}
        </button>
      </div>
    </form>
  );
}
