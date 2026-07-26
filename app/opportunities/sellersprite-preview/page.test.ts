import { afterEach, describe, expect, it, vi } from "vitest";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@/components/cross-border/SellerSpriteOpportunityPreview", () => ({
  SellerSpriteOpportunityPreview: () => null,
}));

import SellerSpriteOpportunityPreviewPage from "./page";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("SellerSprite opportunity preview page gate", () => {
  it("is not routable in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => SellerSpriteOpportunityPreviewPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("renders only in a non-production environment", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(SellerSpriteOpportunityPreviewPage()).not.toBeNull();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
