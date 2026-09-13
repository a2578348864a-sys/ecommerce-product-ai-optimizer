"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";

interface DecryptedTextProps {
  text: string;
  speed?: number; // ms per tick
  maxIterations?: number;
  characters?: string;
  className?: string;
  parentClassName?: string;
  encryptedClassName?: string;
  animateOnHover?: boolean;
}

const DEFAULT_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?/~0123456789";

export function DecryptedText({
  text,
  speed = 45,
  maxIterations = 10,
  characters = DEFAULT_CHARS,
  className = "",
  parentClassName = "",
  encryptedClassName = "text-grass-500 font-mono tracking-wider opacity-90",
  animateOnHover = true,
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState<string>(text);
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set());
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const isMountedRef = useRef(false);

  const startDecryption = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setRevealedIndices(new Set());

    let iteration = 0;
    const totalChars = text.length;
    const charArray = characters.split("");

    const interval = setInterval(() => {
      iteration++;

      setRevealedIndices((prev) => {
        const nextSet = new Set(prev);
        const unrevealed: number[] = [];
        for (let i = 0; i < totalChars; i++) {
          if (!nextSet.has(i) && text[i] !== " ") {
            unrevealed.push(i);
          }
        }

        if (unrevealed.length > 0) {
          const lockCount = Math.max(1, Math.ceil(totalChars / maxIterations));
          for (let k = 0; k < lockCount && unrevealed.length > 0; k++) {
            nextSet.add(unrevealed[0]);
            unrevealed.shift();
          }
        }

        const scrambled = text
          .split("")
          .map((char, idx) => {
            if (char === " " || char === "：" || char === "、") return char;
            if (nextSet.has(idx)) return char;
            return charArray[Math.floor(Math.random() * charArray.length)];
          })
          .join("");

        setDisplayText(scrambled);

        if (nextSet.size >= totalChars || iteration >= maxIterations + 4) {
          clearInterval(interval);
          setDisplayText(text);
          setIsAnimating(false);
        }

        return nextSet;
      });
    }, speed);

    return () => clearInterval(interval);
  }, [text, characters, speed, maxIterations, isAnimating]);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      // 首屏加载后 300ms 自动触发黑客破译解密动画
      const t = setTimeout(() => {
        startDecryption();
      }, 350);
      return () => clearTimeout(t);
    }
  }, [startDecryption]);

  return (
    <span
      className={`inline-block cursor-pointer transition-all select-none ${parentClassName}`}
      onMouseEnter={() => {
        if (animateOnHover && !isAnimating) {
          startDecryption();
        }
      }}
      title="点击或悬浮重新解密"
      onClick={() => {
        if (!isAnimating) startDecryption();
      }}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {displayText.split("").map((char, index) => {
          const isRevealed = revealedIndices.has(index) || !isAnimating;
          return (
            <span
              key={index}
              className={isRevealed ? className : encryptedClassName}
            >
              {char}
            </span>
          );
        })}
      </span>
    </span>
  );
}

export default DecryptedText;
