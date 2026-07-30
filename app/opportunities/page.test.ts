import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Opportunities SellerSprite Preview entry", () => {
  it("keeps the existing discovery workbench and exposes the isolated safe-preview entry", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain("ProductBatchManager");
    expect(source).toContain("MarketScreeningWorkbench");
    expect(source).toContain('href="/opportunities/sellersprite-preview"');
    expect(source).toContain("卖家精灵数据导入");
    expect(source).toContain("安全预览报表");
    expect(source).toContain("只读预览");
    expect(source).not.toContain("opportunityCandidateService");
    expect(source).not.toContain("marketSignalRanking");
  });
});
