import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("research-pool navigation convergence", () => {
  it("routes the sidebar Product Research entry to the persistent pool", () => {
    const sidebar = source("components/WorkspaceSidebar.tsx");
    expect(sidebar).toContain('{ label: "待研究商品", href: "/opportunity-candidates"');
  });

  it("loads the home Candidate count from the authenticated server API", () => {
    const home = source("components/HomeDashboardClient.tsx");
    expect(home).toContain('fetch("/api/opportunity-candidates?limit=100&offset=0"');
    expect(home).toContain('href="/opportunity-candidates"');
    expect(home).toContain("暂不可用");
    expect(home).not.toContain("readCandidatePool");
    expect(home).not.toContain("setCandidateItems");
  });
});
