import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSaveBrowserUsePayload, type BrowserUseStorageVersion } from "./BrowserUseCollectButton";

const source = readFileSync(resolve(process.cwd(), "components/evidence/CompetitorPendingSubmitCard.tsx"), "utf8");

describe("CompetitorPendingSubmitCard 契约", () => {
  it("接线：卡片标题/保存/取消/摘要存在，保存端点=competitor-evidence", () => {
    expect(source).toContain("待确认：自动采集发现的候选竞品");
    expect(source).toContain("competitor-pending-save");
    expect(source).toContain("competitor-pending-cancel");
    expect(source).toContain("种子 ASIN");
    expect(source).toContain("competitor-evidence");
    expect(source).toContain("buildSaveBrowserUsePayload");
  });

  it("候选竞品列表渲染契约：包含候选竞品图片、标题、ASIN、价格、评分、BSR", () => {
    expect(source).toContain("competitor-pending-list");
    expect(source).toContain("competitor-pending-item-");
    expect(source).toContain("item.imageUrl");
    expect(source).toContain("item.title");
    expect(source).toContain("item.asin");
    expect(source).toContain("item.price");
    expect(source).toContain("item.rating");
    expect(source).toContain("item.bsr");
  });

  it("保存 payload 契约：previewId+expectedStorageVersion 完整才发送（buildSaveBrowserUsePayload 语义不变）", () => {
    const sv: BrowserUseStorageVersion = { resultJsonHash: "b".repeat(64), updatedAt: "2026-08-23T00:00:00.000Z" };
    expect(buildSaveBrowserUsePayload("preview-comp-1", sv)).toEqual({
      action: "save_browser_use",
      previewId: "preview-comp-1",
      expectedStorageVersion: sv,
    });
    expect(buildSaveBrowserUsePayload(null, sv)).toBeNull();
    expect(buildSaveBrowserUsePayload("preview-comp-1", null)).toBeNull();
  });
});
