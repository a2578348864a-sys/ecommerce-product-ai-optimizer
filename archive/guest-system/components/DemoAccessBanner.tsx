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
  const listingRemaining = demo.standaloneListingRemaining ?? 3;
  const imageRemaining = demo.standaloneImageUnitsRemaining ?? 3;
  // Public Guest（契约 04-4 / §25 / §26）：研究 OFF → 不展示「商品研究 0/5」；只展示有消费路径的 Listing/Image 额度
  if (demo.credentialKind === "anonymous") {
    const globalNote = demo.globalCapExhausted?.image
      ? " · 今日公开生图额度已用完"
      : demo.globalCapExhausted?.text
        ? " · 今日公开 AI 额度已用完"
        : "";
    return `访客体验 · 独立 Listing 剩余 ${listingRemaining} 次 · 独立生图 剩余 ${imageRemaining} 张 · 演示回放不限次数${globalNote}`;
  }
  return `访客体验 · 商品研究 ${demo.usedProducts}/${demo.maxProducts} · 独立 Listing 剩余 ${listingRemaining} 次 · 独立生图 剩余 ${imageRemaining} 张${demo.remainingProducts <= 0 ? " · 已有研究记录仍可查看" : ""}`;
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
  const exhausted = demo.credentialKind === "anonymous"
    ? (demo.standaloneListingRemaining ?? 1) <= 0 && (demo.standaloneImageUnitsRemaining ?? 1) <= 0
    : demo.remainingProducts <= 0;
  const tone = exhausted
    ? "border-rose-200 bg-rose-50/90 text-rose-700"
    : "border-amber-200 bg-amber-50/90 text-amber-700";

  return (
    <div
      className={`demo-banner fixed left-0 right-0 top-0 z-40 border-b px-4 py-1.5 ${tone} backdrop-blur-sm`}
      role="status"
      aria-label="访客体验模式提示"
    >
      <div className="mx-auto flex max-w-[1540px] flex-wrap items-center justify-center gap-x-2 text-center text-xs leading-5 sm:text-sm">
        <Eye className="size-3.5 shrink-0 sm:size-4" />
        <span>{content}</span>
        <details className="group">
          <summary className="cursor-pointer list-none underline decoration-dotted underline-offset-2">
            额度说明
          </summary>
          <span className="block px-2 pb-1 text-[11px] leading-4 sm:inline sm:text-xs">
            研究记录进入的 Listing / Image 不占独立工具额度。
          </span>
        </details>
      </div>
    </div>
  );
}