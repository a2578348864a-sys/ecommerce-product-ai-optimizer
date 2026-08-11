import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("/opportunity-candidates", () => {
  it("uses the workspace shell and presents the persistent pool in product language", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("CandidatePoolPanel");
    expect(source).toContain("WorkspaceSidebar");
    expect(source).toContain("待研究商品");
    expect(source).not.toContain("服务端 Candidate");
    expect(source).not.toContain("OpportunitiesForm");
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });
});
