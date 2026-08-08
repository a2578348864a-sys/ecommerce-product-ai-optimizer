"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import {
  DEMO_ACCESS_UPDATED_EVENT,
  getAccessMode,
  getDemoAccessInfo,
  type DemoAccessInfo,
} from "@/lib/client/accessToken";

const BODY_PADDING_CLASS = "demo-banner-visible";

export function formatDemoAccessBannerContent(demo: DemoAccessInfo): string {
  if (demo.remainingProducts <= 0) {
    return "访客体验 · 5个商品体验名额已全部使用，已有研究记录仍可查看。";
  }
  return `访客体验 · 已使用商品 ${demo.usedProducts} / ${demo.maxProducts} · 剩余 ${demo.remainingProducts} 个商品 · 每个商品可体验商品研究、人工决策、Listing和产品图片完整流程。`;
}

export function DemoAccessBanner() {
  const [mode, setMode] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoAccessInfo | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMode(getAccessMode());
    setDemo(getDemoAccessInfo());
    setHydrated(true);
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<DemoAccessInfo>).detail;
      setDemo(detail || getDemoAccessInfo());
    };
    window.addEventListener(DEMO_ACCESS_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(DEMO_ACCESS_UPDATED_EVENT, handleUpdate);
  }, []);

  // Add body padding when banner is visible
  useEffect(() => {
    if (!hydrated || mode !== "demo" || !demo) return;
    document.body.classList.add(BODY_PADDING_CLASS);
    return () => {
      document.body.classList.remove(BODY_PADDING_CLASS);
    };
  }, [hydrated, mode, demo]);

  // Nothing to show until hydrated, or if not demo mode
  if (!hydrated || mode !== "demo" || !demo) return null;

  const content = formatDemoAccessBannerContent(demo);
  const tone = demo.remainingProducts <= 0
    ? "border-rose-200 bg-rose-50/90 text-rose-700"
    : "border-amber-200 bg-amber-50/90 text-amber-700";

  return (
    <div
      className={`demo-banner fixed left-0 right-0 top-0 z-40 border-b px-4 py-1.5 ${tone} backdrop-blur-sm`}
      role="status"
      aria-label="访客体验模式提示"
    >
      <div className="mx-auto flex max-w-[1540px] items-center justify-center gap-2 text-center text-xs leading-5 sm:text-sm">
        <Eye className="size-3.5 shrink-0 sm:size-4" />
        <span>{content}</span>
      </div>
    </div>
  );
}
