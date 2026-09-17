import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string } & Record<string, unknown>) =>
    createElement("a", { href, ...props }, children),
}));

import { StandaloneListingStudio } from "@/components/listing-studio/StandaloneListingStudio";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

/**
 * 第十二轮入口修复：`/listing-studio` 必须同时支持
 * - 无 taskId → 独立 Listing 创作工具（不阻断、不进入 V5 主链路）；
 * - 有 taskId → 研究主链路模式（V5 Strategy/Writer/Validator 链，行为不变）。
 */
describe("Listing Studio 入口：独立工具模式（无 taskId）", () => {
  const html = renderToStaticMarkup(createElement(StandaloneListingStudio));

  it("renders the standalone tool entry instead of a blocking notice", () => {
    expect(html).toContain('data-testid="listing-studio-standalone-mode"');
    expect(html).toContain("独立工具");
    expect(html).toContain("独立 Listing 创作工具");
    expect(html).not.toContain("请从研究任务进入");
    expect(html).not.toContain("无法确定要为哪个商品生成 Listing");
  });

  it("offers the product info input entry (reused from the existing standalone tool)", () => {
    expect(html).toContain('id="listing-product-name"');
    expect(html).toContain('id="listing-description"');
    expect(html).toContain('id="listing-category"');
    expect(html).toContain('id="listing-confirmed-facts"');
  });

  it("keeps standalone and research-chain status displays independent", () => {
    // V5 主链路的状态面板 / 输出来源徽标只属于 taskId 模式
    expect(html).not.toContain("listing-v5-ai-status");
    expect(html).not.toContain("listing-v5-output-source");
    // 独立模式明确说明未经商品研究验证，并提供回到研究记录的入口
    expect(html).toContain("未经商品研究验证");
    expect(html).toContain('href="/tasks"');
  });

  it("无 taskId 走独立工具，有 taskId 保持 V5 主链路（入口判断唯一来源）", () => {
    const client = source("components/listing-v5/ListingStudioV5Client.tsx");
    expect(client).toContain("if (!taskId) return <StandaloneListingStudio />;");
    expect(client).not.toContain("请从研究任务进入");
    const page = source("app/listing-studio/page.tsx");
    expect(page).toContain("<ListingStudioV5Client taskId={taskId} />");
    expect(page).toContain("基于服务端重新核验的研究事实生成 Listing 草稿。");
    expect(page).toContain("输入并确认商品资料，生成可审核、可优化的 Listing 草稿。");
  });

  it("独立模式复用既有生成实现，未新增 Listing 生成规则", () => {
    const standalone = source("components/listing-studio/StandaloneListingStudio.tsx");
    expect(standalone).toContain("ManualListingStudioClient");
    // V5 生成链（含 Validator / Writer prompt 版本）不得被独立模式引用
    expect(standalone).not.toContain("@/lib/listingV5");
    const manual = source("components/listing-studio/ListingStudioClient.tsx");
    expect(manual).toContain('fetch("/api/listing-studio"');
  });
});
