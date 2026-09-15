"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ImageHandoffSection } from "@/components/image-handoff/ImageHandoffSection";
import { TaskStudioPreparation } from "@/components/studio/TaskStudioPreparation";
import { StudioProgressRail } from "@/components/studio/StudioProgressRail";
import { deriveImageStudioProgress } from "@/lib/client/studioProgress";

type ImageProgress = {
  strategyReady: boolean;
  isGenerating: boolean;
  candidateCount: number;
  selectedImageId: string | null;
};

/**
 * Image Studio 入口。
 *
 * Image Studio 只接受研究任务上下文：商品身份、事实、参考图和创作交接都由
 * 服务端任务链提供。独立手工创作入口不再渲染，避免出现第二套事实与生图流程。
 */
export function ImageStudioClient({ taskId = "" }: { taskId?: string }) {
  const [progressInput, setProgressInput] = useState<ImageProgress>({
    strategyReady: false,
    isGenerating: false,
    candidateCount: 0,
    selectedImageId: null,
  });
  const [handoffEpoch, setHandoffEpoch] = useState(0);
  const handleHandoffCommitted = useCallback(() => {
    setHandoffEpoch((current) => current + 1);
  }, []);
  const handleTaskReady = useCallback((briefReady: boolean) => {
    setProgressInput((current) => ({ ...current, strategyReady: briefReady }));
  }, []);
  const handleTaskProgress = useCallback((state: ImageProgress) => {
    setProgressInput((current) => ({ ...current, ...state }));
  }, []);
  const progressRail = (
    <StudioProgressRail
      label="图片制作进度"
      steps={deriveImageStudioProgress({ briefReady: progressInput.strategyReady, ...progressInput })}
    />
  );

  if (taskId) {
    return (
      <div data-testid="image-studio-task-flow" className="studio-main-flow">
        {progressRail}
        <div className="mb-3 flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold leading-5 text-indigo-700" data-testid="image-mode-task-linked">
          <span className="whitespace-nowrap">来自研究记录</span>
          <span>商品身份 / 事实 / 参考图来自研究确认</span>
        </div>
        <TaskStudioPreparation taskId={taskId} kind="image" onReadyChange={handleTaskReady} onCommitted={handleHandoffCommitted}>
          <div className="surface-card p-4" data-testid="image-studio-task-mode">
            <ImageHandoffSection key={handoffEpoch} taskId={taskId} onProgressChange={handleTaskProgress} />
          </div>
        </TaskStudioPreparation>
      </div>
    );
  }

  return (
    <div data-testid="image-studio-standalone-flow" className="studio-main-flow">
      {progressRail}
      <section className="surface-card border-amber-200 p-5" data-testid="image-mode-standalone">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">需要研究任务</p>
        <h2 className="mt-1 text-xl font-bold text-slate-950">请从商品研究进入图片工作台</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Image Studio 已收敛为商品研究结果驱动的图片生成辅助模块。请先完成商品事实、参考图和创作资料确认，再从具体研究任务进入。
        </p>
        <Link href="/tasks" className="mt-4 inline-flex h-10 items-center rounded-xl bg-cyan-600 px-4 text-sm font-bold text-white hover:bg-cyan-700">
          进入商品研究
        </Link>
      </section>
    </div>
  );
}
