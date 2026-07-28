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
      { label: "商品研究", href: "/agent/run" },
      { label: "Listing Studio", href: "/listing-studio" },
      { label: "Image Studio", href: "/image-studio" },
      { label: "研究历史", href: "/tasks" },
    ]);
  });

  it("keeps ad hoc product research out of advanced navigation and aligns mobile navigation", () => {
    const advanced = labeledRoutes(arrayBlock(sidebarSource, "advancedNavItems"));

    expect(advanced).toEqual([
      { label: "批量分析（高级 / Alpha）", href: "/workflow/batch" },
    ]);
    expect(sidebarSource).toMatch(/const mobileNavItems = workspaceNavItems;/);
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

  it("shows five real workflow entrances from discovery to human decision", () => {
    const journey = arrayBlock(homeSource, "workflowSteps");

    expect(labeledRoutes(journey)).toEqual([
      { label: "发现商品", href: "/opportunities" },
      { label: "商品研究", href: "/agent/run" },
      { label: "Listing 准备", href: "/listing-studio" },
      { label: "图片创作", href: "/image-studio" },
      { label: "人工决定", href: "/tasks" },
    ]);

    for (const cta of [
      "去发现商品",
      "开始商品研究",
      "打开 Listing Studio",
      "打开 Image Studio",
      "查看研究历史",
    ]) {
      expect(journey).toContain(cta);
    }
    expect(homeSource).toContain("五阶段研究流程");
    expect(homeSource).not.toContain("三步主路径");
  });

  it("keeps decisions human-led and avoids unsupported product promises", () => {
    expect(homeSource).toContain("人工确认");
    expect(homeSource).toContain("人工决定");

    for (const forbidden of ["自动选品", "自动赚钱", "爆款预测"]) {
      expect(sidebarSource).not.toContain(forbidden);
      expect(homeSource).not.toContain(forbidden);
    }
  });
});
