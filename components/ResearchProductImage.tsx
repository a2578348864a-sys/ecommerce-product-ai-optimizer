"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";

export function ResearchProductImage({
  image,
  alt,
  size = "list",
}: {
  image: ResearchProductImageDisplay | null;
  alt: string;
  size?: "list" | "detail";
}) {
  const [failedContentHash, setFailedContentHash] = useState<string | null>(null);
  const sizeClass = size === "detail"
    ? "size-20 md:size-24"
    : "size-14 md:size-20";
  const className = `${sizeClass} flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50`;

  if (!image || failedContentHash === image.contentHash) {
    return (
      <div
        role="img"
        aria-label={`${alt} 商品图片暂不可用`}
        className={`${className} text-slate-400`}
      >
        <ImageOff aria-hidden="true" className="size-6" />
      </div>
    );
  }

  return (
    <div className={className}>
      {/* The source is a validated persistent data URL; Next Image does not add value here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.dataUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailedContentHash(image.contentHash)}
        className="size-full object-contain"
      />
    </div>
  );
}
