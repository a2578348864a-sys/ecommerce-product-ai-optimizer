import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function arrayBlock(source: string, name: string) {
  return source.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\\[[\\s\\S]*?\\]\\s+as\\s+const;`))?.[0] ?? "";
}

function labeledRoutes(block: string) {
  return [...block.matchAll(/\{\s*label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
    .map((match) => ({ label: match[1], href: match[2] }));
}

describe("Product Architecture Convergence shell", () => {
  const sidebarSource = readSource("components/WorkspaceSidebar.tsx");
  const homeSource = readSource("components/HomeDashboardClient.tsx");

  it("freezes the six-step primary navigation and keeps Studio routes first-class", () => {
    const primary = labeledRoutes(arrayBlock(sidebarSource, "workspaceNavItems"));

    expect(primary).toEqual([
      { label: "工作台", href: "/" },
      { label: "发现商品", href: "/opportunities" },
      { label: "商品研究池", href: "/opportunity-candidates" },
      { label: "Listing Studio", href: "/listing-studio" },
      { label: "Image Studio", href: "/image-studio" },
      { label: "研究历史", href: "/tasks" },
    ]);
  });

  it("hides legacy batch analysis and aligns mobile navigation", () => {
    const advanced = labeledRoutes(arrayBlock(sidebarSource, "advancedNavItems"));

    expect(advanced).toEqual([]);
    expect(sidebarSource).toMatch(/const mobileNavItems = workspaceNavItems;/);
    expect(sidebarSource).not.toContain("/workflow/batch");
    expect(sidebarSource).not.toContain("高级 / Alpha");
    expect(sidebarSource).not.toContain("高级临时分析");
  });

  it("positions the product as an AI cross-border product research assistant", () => {
    for (const source of [sidebarSource, homeSource]) {
      expect(source).toContain("AI 跨境商品研究助手");
    }
    expect(homeSource).toContain(
      "从候选发现到 Listing 和图片准备，用一条清晰流程完成商品研究。",
    );
  });

  it("shows five real workflow entrances from discovery to human confirmation", () => {
    const journey = arrayBlock(homeSource, "workflowSteps");

    expect(labeledRoutes(journey)).toEqual([
      { label: "发现商品", href: "/opportunities" },
      { label: "商品研究池", href: "/opportunity-candidates" },
      { label: "Listing 准备", href: "/listing-studio" },
      { label: "图片创作", href: "/image-studio" },
      { label: "人工确认", href: "/tasks" },
    ]);

    for (const cta of [
      "去发现商品",
      "打开商品研究池",
      "打开 Listing Studio",
      "打开 Image Studio",
      "查看研究历史",
    ]) {
      expect(journey).toContain(cta);
    }
    expect(homeSource).toContain("五步完成一次商品研究");
    expect(homeSource).not.toContain("三步主路径");
  });

  it("keeps decisions human-led and avoids unsupported product promises", () => {
    expect(homeSource).toContain("人工确认");
    expect(homeSource).toContain("人工确认是否继续");

    for (const forbidden of ["自动选品", "自动赚钱", "爆款预测"]) {
      expect(sidebarSource).not.toContain(forbidden);
      expect(homeSource).not.toContain(forbidden);
    }
  });
});
