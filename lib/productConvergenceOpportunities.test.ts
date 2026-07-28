import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(__dirname, "..", path), "utf8");
}

describe("发现商品产品层收敛", () => {
  const pageSource = readSource("app/opportunities/page.tsx");
  const workbenchSource = readSource("components/cross-border/MarketScreeningWorkbench.tsx");

  it("使用统一工作台壳并将页面定位为发现商品", () => {
    expect(pageSource).toMatch(/WorkspaceSidebar/);
    expect(pageSource).toMatch(/WorkspaceMobileNav/);
    expect(pageSource).toMatch(/发现商品 - 轻选 Agent/);
    expect(pageSource).not.toMatch(/市场预筛工作台 - 轻选 Agent/);
  });

  it("优先展示候选商品池和开始研究动作", () => {
    expect(workbenchSource).toMatch(/候选商品池/);
    expect(workbenchSource).toMatch(/开始商品研究/);
    expect(workbenchSource).toMatch(/查看市场预览/);
    expect(workbenchSource).toMatch(/data-testid="market-screening-preview"/);
    expect(workbenchSource).not.toMatch(/href=\{`\/agent\/run\?productName=/);
    expect(workbenchSource).toMatch(/order-2[^"]*" data-region="candidate-pool"/);
    expect(workbenchSource).toMatch(/order-3[^"]*" data-region="advanced-evidence"/);
  });

  it("将内部证据与阶段详情收进默认关闭的高级区", () => {
    expect(workbenchSource).toMatch(
      /<details[^>]*data-region="advanced-evidence"[^>]*>/,
    );
    expect(workbenchSource).not.toMatch(
      /<details[^>]*data-region="advanced-evidence"[^>]*\sopen(?:=|\s|>)/,
    );
    expect(workbenchSource).toMatch(/高级证据详情/);
    expect(workbenchSource).toMatch(/Stage 1 初筛/);
    expect(workbenchSource).toMatch(/Stage 1\.5/);
  });

  it("主商品卡使用中文研究状态，原始原因码只在详情中保留", () => {
    expect(workbenchSource).toMatch(/function researchStatusLabel/);
    for (const label of ["优先研究", "继续观察", "暂不研究", "证据不足"]) {
      expect(workbenchSource).toContain(label);
    }
    expect(workbenchSource).toMatch(/原始证据与原因码/);
  });

  it("继续声明候选池不是正式选品结论", () => {
    expect(workbenchSource).toMatch(/不是正式选品结论/);
    expect(workbenchSource).toMatch(/需要人工决定/);
  });
});
