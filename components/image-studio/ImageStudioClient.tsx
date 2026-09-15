"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ImageHandoffSection } from "@/components/image-handoff/ImageHandoffSection";
import { TaskStudioPreparation } from "@/components/studio/TaskStudioPreparation";
import { StudioProgressRail } from "@/components/studio/StudioProgressRail";
import { deriveImageStudioProgress } from "@/lib/client/studioProgress";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import {
  FreeCreationForm,
  type FreeCreationValues,
} from "./FreeCreationForm";
import {
  ImageResultWorkspace,
  type ImageStudioData,
} from "./ImageResultWorkspace";

type ImageProgress = {
  strategyReady: boolean;
  isGenerating: boolean;
  candidateCount: number;
  selectedImageId: string | null;
};

/**
 * Image Studio 双链路入口：
 * A. 研究主链（带 taskId）：使用研究事实与批准参考图，走既有 image-handoff 链路。
 * B. 独立图片工具（无 taskId）：直接输入自定义创作描述，调用 /api/image-studio 独立生图。
 */
export function ImageStudioClient({ taskId = "" }: { taskId?: string }) {
  const [progressInput, setProgressInput] = useState<ImageProgress>({
    strategyReady: false,
    isGenerating: false,
    candidateCount: 0,
    selectedImageId: null,
  });
  const [handoffEpoch, setHandoffEpoch] = useState(0);

  // 独立生图表单与结果状态
  const [formValues, setFormValues] = useState<FreeCreationValues>({
    creativePrompt: "",
    aspectRatio: "square_1_1",
    count: 1,
  });
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageStudioData | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  const handleHandoffCommitted = useCallback(() => {
    setHandoffEpoch((current) => current + 1);
  }, []);
  const handleTaskReady = useCallback((briefReady: boolean) => {
    setProgressInput((current) => ({ ...current, strategyReady: briefReady }));
  }, []);
  const handleTaskProgress = useCallback((state: ImageProgress) => {
    setProgressInput((current) => ({ ...current, ...state }));
  }, []);

  const handleToggleSelected = useCallback((index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  }, []);

  const handleStandaloneGenerate = useCallback(
    async (values: FreeCreationValues) => {
      if (!values.creativePrompt.trim()) {
        setGenerationError("请填写自定义图片描述。");
        return;
      }
      setGenerating(true);
      setGenerationError(null);
      setProgressInput((prev) => ({
        ...prev,
        strategyReady: true,
        isGenerating: true,
      }));

      try {
        const payload = {
          briefVersion: "studio-creative-brief.v1",
          factsConfirmed: true,
          humanReviewRequired: true,
          creationMode: "prompt",
          creativePrompt: values.creativePrompt.trim(),
          avoidElements: "",
          aspectRatio: values.aspectRatio,
          count: values.count,
          mode: "mock",
          confirmRealAi: false,
          ...(values.referenceImageDataUrl
            ? {
                referenceImageDataUrl: values.referenceImageDataUrl,
                referenceImageApproved: true,
              }
            : {}),
        };

        const res = await fetch("/api/image-studio", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAccessHeaders(),
          },
          body: JSON.stringify(payload),
        });

        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: ImageStudioData;
          error?: { message?: string };
        } | null;

        if (!res.ok || !json?.ok || !json.data) {
          setGenerationError(json?.error?.message ?? "图片生成失败，请重试。");
          setProgressInput((prev) => ({ ...prev, isGenerating: false }));
          return;
        }

        setResult(json.data);
        setSelectedIndices([]);
        setProgressInput({
          strategyReady: true,
          isGenerating: false,
          candidateCount: json.data.images?.length ?? 0,
          selectedImageId: null,
        });
      } catch {
        setGenerationError("网络异常，无法连接生图服务。");
        setProgressInput((prev) => ({ ...prev, isGenerating: false }));
      } finally {
        setGenerating(false);
      }
    },
    [],
  );

  const progressRail = (
    <StudioProgressRail
      label="图片制作进度"
      steps={deriveImageStudioProgress({
        briefReady: progressInput.strategyReady,
        ...progressInput,
      })}
    />
  );

  if (taskId) {
    return (
      <div data-testid="image-studio-task-flow" className="studio-main-flow">
        {progressRail}
        <div
          className="mb-3 flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold leading-5 text-indigo-700"
          data-testid="image-mode-task-linked"
        >
          <span className="whitespace-nowrap">来自研究记录</span>
          <span>商品身份 / 事实 / 参考图来自研究确认</span>
        </div>
        <TaskStudioPreparation
          taskId={taskId}
          kind="image"
          onReadyChange={handleTaskReady}
          onCommitted={handleHandoffCommitted}
        >
          <div className="surface-card p-4" data-testid="image-studio-task-mode">
            <ImageHandoffSection
              key={handoffEpoch}
              taskId={taskId}
              onProgressChange={handleTaskProgress}
            />
          </div>
        </TaskStudioPreparation>
      </div>
    );
  }

  return (
    <div data-testid="image-studio-standalone-flow" className="studio-main-flow">
      {progressRail}
      <div
        className="mb-3 flex max-w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold leading-5 text-slate-600"
        data-testid="image-mode-standalone"
      >
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">
            独立生图工具
          </span>
          <span>
            独立快速生图模式。如需使用商品事实、参考图和创作资料确认，请从商品研究进入图片工作台。
          </span>
        </div>
        <Link
          href="/tasks"
          className="text-cyan-700 hover:text-cyan-800 hover:underline"
        >
          进入商品研究 →
        </Link>
      </div>
      <div className="surface-card p-5" data-testid="image-studio-standalone-mode">
        <FreeCreationForm
          values={formValues}
          onChange={setFormValues}
          onSubmit={handleStandaloneGenerate}
          disabled={generating}
        />
        {generationError && (
          <div
            role="alert"
            data-testid="free-creation-error-banner"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700"
          >
            {generationError}
          </div>
        )}
        {result && (
          <div
            className="mt-6 border-t border-slate-200 pt-6"
            data-testid="free-creation-results"
          >
            <ImageResultWorkspace
              result={result}
              selectedIndices={selectedIndices}
              onToggleSelected={handleToggleSelected}
            />
          </div>
        )}
      </div>
    </div>
  );
}
