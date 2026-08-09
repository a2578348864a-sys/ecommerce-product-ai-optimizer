import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  product: {
    productName: "",
    category: "",
    targetPlatform: "shopify",
    description: "",
    targetPrice: "",
    claims: "",
  },
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/opportunities" }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string } & Record<string, unknown>) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/hooks/useSharedProduct", () => ({
  useSharedProduct: () => [mocks.product, vi.fn()],
}));
vi.mock("@/components/DemoAccessBanner", () => ({ DemoAccessBanner: () => null }));

import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";

describe("WorkspaceSidebar current research product presentation", () => {
  beforeEach(() => {
    mocks.product.productName = "";
    mocks.product.category = "";
    mocks.product.targetPlatform = "shopify";
  });

  it("does not expose a full URL or the internal shopify platform value", () => {
    mocks.product.productName = "https://supplier.example/products/blue-bottle?internal=1";
    mocks.product.category = "水杯";

    const html = renderToStaticMarkup(createElement(WorkspaceSidebar));

    expect(html).toContain("当前研究商品");
    expect(html).toContain("已选择商品链接");
    expect(html).toContain("品类：水杯");
    expect(html).not.toContain("supplier.example");
    expect(html.toLowerCase()).not.toContain("shopify");
  });

  it("keeps an ordinary product title as the user-facing label", () => {
    mocks.product.productName = "Owala FreeSip Water Bottle";

    const html = renderToStaticMarkup(createElement(WorkspaceSidebar));

    expect(html).toContain("当前研究商品");
    expect(html).toContain("Owala FreeSip Water Bottle");
    expect(html).toContain("商品资料已载入");
  });
});
