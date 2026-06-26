"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { getAccessMode, getDemoAccessInfo, type DemoAccessInfo } from "@/lib/client/accessToken";

function formatExpiry(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
}

const BODY_PADDING_CLASS = "demo-banner-visible";

export function DemoAccessBanner() {
  const [mode, setMode] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoAccessInfo | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMode(getAccessMode());
    setDemo(getDemoAccessInfo());
    setHydrated(true);
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

  const isExpired = new Date(demo.expiresAt) < new Date();
  const isQuotaExhausted = demo.remainingAiCalls <= 0;

  let content: string;
  if (isExpired) {
    content = "临时访问已过期，请联系管理员获取新的访问码";
  } else if (isQuotaExhausted) {
    content = `访客体验模式 · AI 分析额度已用完 · 可继续浏览样例与复制报告`;
  } else {
    content = `访客体验模式 · AI 分析额度 ${demo.remainingAiCalls}/${demo.maxAiCalls} · 有效期至 ${formatExpiry(demo.expiresAt)} · 部分数据操作受限`;
  }

  const tone = isExpired ? "border-rose-200 bg-rose-50/90 text-rose-700" : "border-amber-200 bg-amber-50/90 text-amber-700";

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
