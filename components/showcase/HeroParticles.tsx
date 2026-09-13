"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseVx: number;
  baseVy: number;
  radius: number;
  baseAlpha: number;
  alpha: number;
  pulsePhase: number;
  pulseSpeed: number;
  color: string;
}

const PARTICLE_COLORS = [
  "rgba(34, 197, 94, ",   // grass-500
  "rgba(22, 163, 74, ",   // grass-600
  "rgba(16, 185, 129, ",  // emerald-500
  "rgba(74, 222, 128, ",  // grass-400
  "rgba(52, 211, 153, ",  // emerald-400
];

export function HeroParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animId: number;
    let isVisible = true;
    let width = 0;
    let height = 0;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const particleCount = isMobile ? 22 : 48;
    const particles: Particle[] = [];

    const mouse = {
      x: -1000,
      y: -1000,
      radius: isMobile ? 0 : 130,
    };

    const handleResize = () => {
      if (!canvas) return;
      const parent = canvas.parentElement;
      width = parent?.clientWidth || window.innerWidth;
      height = parent?.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    handleResize();
    window.addEventListener("resize", handleResize, { passive: true });

    // 初始化粒子
    for (let i = 0; i < particleCount; i++) {
      const baseAlpha = Math.random() * 0.4 + 0.15;
      const bVx = (Math.random() - 0.5) * 0.35;
      const bVy = (Math.random() - 0.5) * 0.35;
      particles.push({
        x: Math.random() * (width || 800),
        y: Math.random() * (height || 600),
        vx: bVx,
        vy: bVy,
        baseVx: bVx,
        baseVy: bVy,
        radius: Math.random() * 1.8 + 1.2,
        baseAlpha,
        alpha: baseAlpha,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.02 + 0.01,
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      });
    }

    // 鼠标微引力交互
    const handleMouseMove = (e: MouseEvent) => {
      if (isMobile) return;
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

    const parentElem = canvas.parentElement || canvas;
    parentElem.addEventListener("mousemove", handleMouseMove as EventListener, { passive: true });
    parentElem.addEventListener("mouseleave", handleMouseLeave as EventListener, { passive: true });

    // 视口感知（离开视口自动挂起，0 功耗）
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        isVisible = Boolean(entry?.isIntersecting);
        if (isVisible && !animId && !prefersReducedMotion) {
          animId = requestAnimationFrame(render);
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(canvas);

    const render = () => {
      if (!isVisible) {
        animId = 0;
        return;
      }

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // 呼吸脉动
        p.pulsePhase += p.pulseSpeed;
        p.alpha = p.baseAlpha + Math.sin(p.pulsePhase) * 0.12;

        // 鼠标微斥力 / 水波避让
        if (mouse.radius > 0) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < mouse.radius && dist > 0) {
            const force = (mouse.radius - dist) / mouse.radius;
            const angle = Math.atan2(dy, dx);
            p.vx += Math.cos(angle) * force * 0.45;
            p.vy += Math.sin(angle) * force * 0.45;
          }
        }

        // 自然阻尼恢复基线速度
        p.vx += (p.baseVx - p.vx) * 0.03;
        p.vy += (p.baseVy - p.vy) * 0.03;

        p.x += p.vx;
        p.y += p.vy;

        // 柔和边界循环
        if (p.x < -10) p.x = width + 10;
        else if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        else if (p.y > height + 10) p.y = -10;

        // 绘制微光粒子
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `${p.color}${Math.max(0.05, Math.min(0.8, p.alpha))})`;
        ctx.shadowColor = "rgba(34, 197, 94, 0.45)";
        ctx.shadowBlur = p.radius * 2.5;
        ctx.fill();
        ctx.restore();
      }

      if (!prefersReducedMotion) {
        animId = requestAnimationFrame(render);
      }
    };

    if (!prefersReducedMotion) {
      animId = requestAnimationFrame(render);
    } else {
      render();
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      parentElem.removeEventListener("mousemove", handleMouseMove as EventListener);
      parentElem.removeEventListener("mouseleave", handleMouseLeave as EventListener);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 size-full opacity-80"
    />
  );
}
