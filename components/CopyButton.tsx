"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

type CopyButtonProps = {
  text: string;
  label?: string;
  className?: string;
};

export function CopyButton({ text, label = "复制结果", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  function fallbackCopy(value: string) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    textarea.remove();
    return success;
  }

  async function handleCopy() {
    if (!text) {
      return;
    }

    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        success = true;
      } else {
        success = fallbackCopy(text);
      }
    } catch {
      success = fallbackCopy(text);
    }

    if (success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-teal-300 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${className}`}
      title={label}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span>{copied ? "已复制" : label}</span>
    </button>
  );
}
