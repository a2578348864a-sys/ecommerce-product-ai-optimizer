import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("/opportunity-candidates", () => {
  it("uses the workspace shell and independent server-authoritative Candidate pool", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("CandidatePoolPanel");
    expect(source).toContain("WorkspaceSidebar");
    expect(source).toContain("商品研究池");
    expect(source).not.toContain("OpportunitiesForm");
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });
});
