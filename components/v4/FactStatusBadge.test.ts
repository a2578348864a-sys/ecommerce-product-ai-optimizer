/**
 * V4 P3 — FactStatusBadge 测试（独立测试文件，components/v4）。
 * 使用仓库既有约定 renderToStaticMarkup（node 环境，无 jsdom/testing-library）。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactStatusBadge, FACT_STATUS_LABELS, FACT_STATUS_TONES, type DisplayFactStatus } from "@/components/v4/FactStatusBadge";

const ALL_STATUSES: DisplayFactStatus[] = ["confirmed", "rejected", "unknown", "conflict", "revoked", "unconfirmed"];

describe("FactStatusBadge", () => {
  it.each(ALL_STATUSES)("renders the Chinese label for %s", (status) => {
    const html = renderToStaticMarkup(React.createElement(FactStatusBadge, { status }));
    expect(html).toContain(FACT_STATUS_LABELS[status]);
    expect(html).toContain('data-testid="fact-status-badge"');
  });

  it("maps every display status to a tone", () => {
    for (const status of ALL_STATUSES) {
      expect(FACT_STATUS_TONES[status]).toBeTruthy();
    }
  });

  it("uses a distinct muted tone for revoked", () => {
    const html = renderToStaticMarkup(React.createElement(FactStatusBadge, { status: "revoked" }));
    expect(html).toContain("已撤销");
    expect(html).toContain("text-slate-400");
  });

  it("renders confirmed with an affirmative tone", () => {
    const html = renderToStaticMarkup(React.createElement(FactStatusBadge, { status: "confirmed" }));
    expect(html).toContain("已确认");
    expect(html).toContain("text-emerald-700");
  });

  it("falls back to the raw status text for unknown statuses", () => {
    // @ts-expect-error intentionally pass an out-of-contract value to exercise fallback
    const html = renderToStaticMarkup(React.createElement(FactStatusBadge, { status: "bogus" }));
    expect(html).toContain("bogus");
  });
});
