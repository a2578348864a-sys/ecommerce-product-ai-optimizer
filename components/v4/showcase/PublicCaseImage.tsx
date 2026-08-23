"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";

/** 公网案例商品图：同源资产 + 加载失败诚实占位（不显示破图/图片URL文本）。 */
export function PublicCaseImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 水合前图片已失败（网络拦截/破损）→ 水合后兜底，避免 onError 挂载前丢失。
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) {
    return (
      <div
        data-testid="showcase-image-fallback"
        className={"flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500 " + (className || "")}
      >
        <span className="flex flex-col items-center gap-1">
          <ImageIcon className="size-6" aria-hidden="true" />
          <span>商品图片暂不可用</span>
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      data-testid="showcase-image"
      className={"object-contain " + (className || "")}
      onError={() => setFailed(true)}
    />
  );
}
