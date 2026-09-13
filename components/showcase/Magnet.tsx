"use client";

import React, { useRef, useState, useEffect } from "react";

interface MagnetProps extends React.PropsWithChildren {
  padding?: number; // 激活感应半径 (px)
  magnetStrength?: number; // 磁吸衰减系数 (越小吸附感越强，推荐 2.5 ~ 4)
  className?: string;
  disabled?: boolean;
}

export function Magnet({
  children,
  padding = 65,
  magnetStrength = 3.2,
  className = "",
  disabled = false,
}: MagnetProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const distX = Math.abs(centerX - e.clientX);
      const distY = Math.abs(centerY - e.clientY);

      // 如果光标进入感应区
      if (distX < rect.width / 2 + padding && distY < rect.height / 2 + padding) {
        setIsActive(true);
        const offsetX = (e.clientX - centerX) / magnetStrength;
        const offsetY = (e.clientY - centerY) / magnetStrength;
        // 限制最大吸附位移，保持按键优雅受控
        const clampedX = Math.max(-16, Math.min(16, offsetX));
        const clampedY = Math.max(-16, Math.min(16, offsetY));
        setPosition({ x: clampedX, y: clampedY });
      } else if (isActive) {
        setIsActive(false);
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [padding, magnetStrength, disabled, isActive]);

  return (
    <div
      ref={ref}
      className={`inline-block ${className}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        transition: isActive
          ? "transform 0.12s ease-out"
          : "transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
}

export default Magnet;
