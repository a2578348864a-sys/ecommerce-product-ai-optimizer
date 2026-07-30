import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SellerSpritePreviewPanel V2 contract", () => {
  it("uses the shared authenticated Preview endpoint without owning a second workspace shell", async () => {
    const source = await readFile(new URL("./SellerSpritePreviewPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain('fetch("/api/opportunities/sellersprite-preview"');
    expect(source).toContain("buildAccessHeaders()");
    expect(source).toContain("上传并安全解析");
    expect(source).toContain("surface-card");
    expect(source).toContain("linear-button-primary");
    expect(source).not.toMatch(/WorkspaceSidebar|WorkspaceMobileNav|workspace-layout/);
    expect(source).not.toMatch(/requireOwnerOnly|opportunityCandidateService|Task|marketSignalRanking|marketSnapshot|ShadowReport/i);
  });
});
