/**
 * V3 Final Product Integration — F3 Sourcing 分能力 readiness 测试
 *
 * Case A：CLI false + Image true → keyword/url 不可用、image 可用
 * Case B：CLI true + Image false → keyword/url 可用、image 不可用
 * Case C：全 true → 全部可用
 * Case D：全 false → 各自显示原因（reasonCode 保留）
 */
import { describe, expect, it } from "vitest";
import { sourcingCapabilities, type SourcingToolStatus } from "@/lib/client/sourcingCapabilities";

describe("sourcingCapabilities（F3 分能力 readiness）", () => {
  it("Case A: CLI not logged in, image extension ready -> image only", () => {
    const caps = sourcingCapabilities({
      loggedIn: false,
      toolAvailable: true,
      cli: { loggedIn: false, toolAvailable: true },
      image: { extensionAvailable: true, reasonCode: "extension_seen" },
    } satisfies SourcingToolStatus);
    expect(caps.cliReady).toBe(false);
    expect(caps.imageReady).toBe(true);
  });

  it("Case B: CLI ready, image extension unavailable -> keyword/url only", () => {
    const caps = sourcingCapabilities({
      loggedIn: true,
      toolAvailable: true,
      cli: { loggedIn: true, toolAvailable: true },
      image: { extensionAvailable: false, reasonCode: "extension_not_seen" },
    } satisfies SourcingToolStatus);
    expect(caps.cliReady).toBe(true);
    expect(caps.imageReady).toBe(false);
    expect(caps.imageReasonCode).toBe("extension_not_seen");
  });

  it("Case C: both ready -> all available", () => {
    const caps = sourcingCapabilities({
      loggedIn: true,
      toolAvailable: true,
      cli: { loggedIn: true, toolAvailable: true },
      image: { extensionAvailable: true, reasonCode: "extension_seen" },
    } satisfies SourcingToolStatus);
    expect(caps.cliReady).toBe(true);
    expect(caps.imageReady).toBe(true);
  });

  it("Case D: both unavailable -> independent reason codes", () => {
    const caps = sourcingCapabilities({
      loggedIn: false,
      toolAvailable: false,
      cli: { loggedIn: false, toolAvailable: false },
      image: { extensionAvailable: false, reasonCode: "bridge_unavailable" },
    } satisfies SourcingToolStatus);
    expect(caps.cliReady).toBe(false);
    expect(caps.cliToolAvailable).toBe(false);
    expect(caps.imageReady).toBe(false);
    expect(caps.imageReasonCode).toBe("bridge_unavailable");
  });

  it("backward compatible: top-level fields only (legacy server response)", () => {
    const caps = sourcingCapabilities({ loggedIn: true, toolAvailable: true });
    expect(caps.cliReady).toBe(true);
    expect(caps.imageReady).toBe(false);
    expect(caps.imageReasonCode).toBe("unknown");
  });

  it("null status -> everything unavailable", () => {
    const caps = sourcingCapabilities(null);
    expect(caps.cliReady).toBe(false);
    expect(caps.imageReady).toBe(false);
  });
});
