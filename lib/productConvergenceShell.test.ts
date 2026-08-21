import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function arrayBlock(source: string, name: string) {
  return source.match(new RegExp(`(?:export\\s+)?const\\s+${name}[^=]*=\\s*\\[[\\s\\S]*?\\]\\s+as\\s+const;`))?.[0] ?? "";
}

function labeledRoutes(block: string) {
  return [...block.matchAll(/label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
    .map((match) => ({ label: match[1], href: match[2] }));
}

function itemRoutes(block: string) {
  // workspaceNavGroups 内 items 数组（可能为 ReadonlyArray<SidebarNavItem> 类型标注）
  const itemsRegex = /items:\s*(?:ReadonlyArray<[^>]+>)?\s*\[\s*([\s\S]*?)\s*\],?\s*(?:\}|\] as const)/g;
  const out: Array<{ label: string; href: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = itemsRegex.exec(block)) !== null) {
    for (const mm of m[1].matchAll(/label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)) {
      out.push({ label: mm[1], href: mm[2] });
    }
  }
  return out;
}

describe("Product Architecture Convergence shell", () => {
  const sidebarSource = readSource("components/WorkspaceSidebar.tsx");
  const homeSource = readSource("components/HomeDashboardClient.tsx");

  it("freezes the primary navigation on the research mainline (v4.1)", () => {
    // v4.1: sidebar primary routes are derived by buildV4NavGroups.
    expect(sidebarSource).toMatch(/buildV4NavGroups/);
    expect(sidebarSource).toMatch(/\/opportunities/);
    expect(sidebarSource).toMatch(/\/opportunity-candidates/);
    expect(sidebarSource).toMatch(/\/research/);
    expect(sidebarSource).toMatch(/\/tasks/);
    expect(sidebarSource).toMatch(/\/replay/);
    expect(sidebarSource).toMatch(/\/listing-studio/);
    expect(sidebarSource).toMatch(/\/image-studio/);
  });

  it("hides legacy batch analysis and aligns mobile navigation (v4.1)", () => {
    expect(sidebarSource).not.toContain("/workflow/batch");
    expect(sidebarSource).not.toContain("高级 / Alpha");
    expect(sidebarSource).not.toContain("高级临时分析");
    // v4.1: mobile nav derives from the same buildV4NavGroups as desktop.
    expect(sidebarSource).toMatch(/buildV4NavGroups\(runtime\)\.flatMap/);
  });

  it("positions the product as a cross-border research workbench", () => {
    for (const source of [sidebarSource, homeSource]) {
      expect(source).toContain("轻选工作台");
      expect(source).not.toContain("AI 跨境商品研究助手");
    }
    expect(sidebarSource).toContain("AI 跨境商品研究与上架准备工作台");
    const heroSource = readSource("components/v4/home/V4Hero.tsx");
    expect(heroSource).toContain("AI 跨境商品研究与上架准备工作台");
  });

  it("shows five workflow entrances from discovery to content draft", () => {
    const journey = arrayBlock(homeSource, "homeWorkflowSteps");

    expect(labeledRoutes(journey)).toEqual([
      { label: "发现商品", href: "/opportunities" },
      { label: "商品研究", href: "/opportunity-candidates" },
      { label: "人工决策", href: "/tasks" },
      { label: "创作资料", href: "/tasks" },
      { label: "内容草稿", href: "/tasks" },
    ]);

    for (const cta of [
      "去发现商品",
      "打开待研究商品",
      "打开研究记录",
      "在任务详情确认",
      "在任务详情生成",
    ]) {
      expect(journey).toContain(cta);
    }
    expect(journey).not.toContain("打开 Listing Studio");
    expect(journey).not.toContain("打开 Image Studio");
  });

  it("keeps decisions human-led and avoids unsupported product promises", () => {
    expect(homeSource).toContain("人工");

    for (const forbidden of ["自动选品", "自动赚钱", "爆款预测"]) {
      expect(sidebarSource).not.toContain(forbidden);
      expect(homeSource).not.toContain(forbidden);
    }
  });
});
