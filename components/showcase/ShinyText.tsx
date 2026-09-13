"use client";

import React from "react";

interface ShinyTextProps {
  children: React.ReactNode;
  className?: string;
  speed?: number; // seconds
}

export function ShinyText({
  children,
  className = "",
  speed = 3.5,
}: ShinyTextProps) {
  return (
    <span className={`relative inline-flex items-center overflow-hidden ${className}`}>
      {children}
      {/* 优雅白瓷浅绿流光条 */}
      <span
        className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent"
        style={{ animationDuration: `${speed}s` }}
        aria-hidden="true"
      />
    </span>
  );
}

export default ShinyText;
