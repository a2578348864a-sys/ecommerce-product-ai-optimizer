"use client";

import { showcaseContent } from "@/content/showcase";
import { ShowcaseHero } from "./ShowcaseHero";
import { ShowcaseVideo } from "./ShowcaseVideo";
import { ShowcaseSlider } from "./ShowcaseSlider";
import { ShowcaseWorkflow } from "./ShowcaseWorkflow";
import { ShowcaseWorkScope } from "./ShowcaseWorkScope";
import { ShowcaseFooter } from "./ShowcaseFooter";

export function ShowcasePage() {
  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-clip bg-gradient-to-b from-white via-grass-50/15 to-slate-50 text-slate-900 antialiased selection:bg-grass-500/20 selection:text-grass-900">
      {/* 顶部柔和环境微光 */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 size-[42rem] rounded-full bg-grass-100/35 blur-3xl"
        aria-hidden="true"
      />

      {/* ① Hero 首屏 */}
      <ShowcaseHero content={showcaseContent.hero} />

      {/* 主体单页内容区 */}
      <main className="relative flex-1 w-full">
        {/* ② 真实演示视频区域 */}
        <ShowcaseVideo video={showcaseContent.video} />

        {/* ③ 项目图片左右滑动区域 */}
        <ShowcaseSlider slides={showcaseContent.slides} />

        {/* ④ 核心主链说明 */}
        <ShowcaseWorkflow workflow={showcaseContent.workflow} />

        {/* ⑤ 项目完成度 / 我的工作 */}
        <ShowcaseWorkScope projectWork={showcaseContent.projectWork} />
      </main>

      {/* ⑥ GitHub / Footer */}
      <ShowcaseFooter footer={showcaseContent.footer} />
    </div>
  );
}
