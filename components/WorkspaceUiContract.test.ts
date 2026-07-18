import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("workspace UI contract", () => {
  it("keeps the mobile navigation visible without a hidden horizontal rail", () => {
    const sidebar = source("components/WorkspaceSidebar.tsx");

    expect(sidebar).toContain("grid-cols-3");
    expect(sidebar).not.toContain("overflow-x-auto");
    expect(sidebar).not.toContain("no-scrollbar");
  });

  it("puts market screening inside the shared workspace shell", () => {
    const page = source("app/opportunities/page.tsx");

    expect(page).toContain("WorkspaceSidebar");
    expect(page).toContain("WorkspaceMobileNav");
    expect(page).toContain("workspace-layout");
  });

  it("keeps the profit calculator to one page heading", () => {
    const page = source("app/products/new/page.tsx");

    expect(page.match(/<h1\b/gu) ?? []).toHaveLength(1);
  });

  it("provides a branded recovery path for unknown routes", () => {
    const page = source("app/not-found.tsx");

    expect(page).toContain("页面没有找到");
    expect(page).toContain('href="/"');
  });
});
