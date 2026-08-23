import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSaveBrowserUsePayload, type BrowserUseStorageVersion } from "./BrowserUseCollectButton";

const source = readFileSync(resolve(process.cwd(), "components/evidence/KeywordPendingSubmitCard.tsx"), "utf8");

describe("轮 10 合并：KeywordPendingSubmitCard 契约", () => {
  it("接线：卡片标题/保存/取消/摘要存在，保存端点=keyword-evidence", () => {
    expect(source).toContain("待确认：竞品采集得到的关键词");
    expect(source).toContain("keyword-pending-save");
    expect(source).toContain("keyword-pending-cancel");
    expect(source).toContain("种子 ASIN");
    expect(source).toContain("keyword-evidence");
    expect(source).toContain("buildSaveBrowserUsePayload");
  });
  it("保存 payload 契约：previewId+expectedStorageVersion 完整才发送（buildSaveBrowserUsePayload 语义不变）", () => {
    const sv: BrowserUseStorageVersion = { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-23T00:00:00.000Z" };
    expect(buildSaveBrowserUsePayload("preview-1", sv)).toEqual({ action: "save_browser_use", previewId: "preview-1", expectedStorageVersion: sv });
    expect(buildSaveBrowserUsePayload(null, sv)).toBeNull();
    expect(buildSaveBrowserUsePayload("preview-1", null)).toBeNull();
    expect(buildSaveBrowserUsePayload("preview-1", { resultJsonHash: "", updatedAt: "x" } as unknown as BrowserUseStorageVersion)).toBeNull();
  });
});
