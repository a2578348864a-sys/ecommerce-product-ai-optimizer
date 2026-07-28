"use client";

import { useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { requestMarketScreeningCandidateResearch } from "@/lib/client/marketScreeningCandidateResearch";

export function MarketScreeningResearchAction({
  productKey,
  disabled,
}: {
  productKey: string;
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleResearch() {
    if (disabled || pending) return;
    setPending(true);
    setError("");
    try {
      const href = await requestMarketScreeningCandidateResearch(productKey, buildAccessHeaders());
      window.location.assign(href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "商品暂时无法进入研究，请稍后重试。");
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        data-testid="research-market-screening-item"
        className="linear-button-primary flex h-11 w-full items-center justify-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || pending}
        onClick={handleResearch}
      >
        {pending ? "正在准备 Candidate…" : "研究此商品"}
      </button>
      {disabled ? (
        <p className="mt-2 text-xs font-semibold text-slate-500">当前证据状态不可研究</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs font-semibold text-rose-700" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
