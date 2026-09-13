"use client";

import React, { useEffect, useRef, useState } from "react";

interface CountUpProps {
  to: number;
  from?: number;
  duration?: number; // seconds
  delay?: number; // seconds
  className?: string;
  prefix?: string;
  suffix?: string;
  separator?: string;
}

export function CountUp({
  to,
  from = 0,
  duration = 1.2,
  delay = 0,
  className = "",
  prefix = "",
  suffix = "",
  separator = ",",
}: CountUpProps) {
  const [value, setValue] = useState(from);
  const [hasAnimated, setHasAnimated] = useState(false);
  const elementRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setValue(to);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimated) {
          setHasAnimated(true);

          const startTimeout = setTimeout(() => {
            const startTime = performance.now();
            const totalDuration = duration * 1000;

            const update = (currentTime: number) => {
              const elapsed = currentTime - startTime;
              const progress = Math.min(elapsed / totalDuration, 1);
              // 四次方缓出曲线 (easeOutQuart): 快速冲起，柔和刹车
              const easeOut = 1 - Math.pow(1 - progress, 4);
              const currentVal = Math.round(from + (to - from) * easeOut);
              setValue(currentVal);

              if (progress < 1) {
                requestAnimationFrame(update);
              } else {
                setValue(to);
              }
            };

            requestAnimationFrame(update);
          }, delay * 1000);

          return () => clearTimeout(startTimeout);
        }
      },
      { threshold: 0.15 }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, [to, from, duration, delay, hasAnimated]);

  const formattedValue = separator
    ? value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, separator)
    : value.toString();

  return (
    <span ref={elementRef} className={`font-mono ${className}`}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  );
}

export default CountUp;
