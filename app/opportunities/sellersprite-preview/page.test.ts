import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SellerSprite Preview V2 page entry", () => {
  it("uses the V2 workspace shell while keeping Preview isolated from the opportunities main page", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("SellerSpritePreviewPanel");
    expect(source).toContain("WorkspaceSidebar");
    expect(source).toContain("WorkspaceMobileNav");
    expect(source).toContain("workspace-layout");
    expect(source).toContain('href="/opportunities"');
    expect(source).toContain("发现商品");
    expect(source).toContain("卖家精灵数据导入");
    expect(source).toContain("上传并选择 SellerSprite 商品");
    expect(source).toContain("卖家精灵美国站搜索结果导出");
    expect(source).toContain("结构检查、异常隔离和人工选择");
    expect(source).toContain("只读预览，尚未进入商品研究池");
    expect(source).toContain("不是 Amazon 官方导出");
    expect(source).not.toContain("notFound");
    expect(source).not.toContain("opportunityCandidateService");
    expect(source).not.toMatch(/Ranking|Snapshot|Shadow Report|机会分|推荐采购/);
  });

  it("uses the existing child-route navigation rule so 发现商品 is active", async () => {
    const sidebar = await readFile(
      new URL("../../../components/WorkspaceSidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(sidebar).toContain('{ label: "发现商品", href: "/opportunities"');
    expect(sidebar).toContain('pathname.startsWith(href + "/")');
    expect(sidebar).toContain("linear-nav-active");
  });
});
