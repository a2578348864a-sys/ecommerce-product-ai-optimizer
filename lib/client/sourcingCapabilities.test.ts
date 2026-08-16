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

// ── V3 Final R13（§196/§197）：Protocol Handshake——连接 ≠ READY，版本不兼容不假绿 ──

describe("sourcingCapabilities — 版本握手", () => {
  it("extensionSeen 但 SW 版本不匹配 → imageReady=false（HELPER_OUTDATED，不假绿）", () => {
    const caps = sourcingCapabilities({
      loggedIn: false,
      toolAvailable: false,
      image: { extensionAvailable: true, versionCompatible: false, extensionSwVersion: "0.2.0", reasonCode: "extension_version_mismatch" },
    } satisfies SourcingToolStatus);
    expect(caps.imageReady).toBe(false);
    expect(caps.imageVersionCompatible).toBe(false);
    expect(caps.imageExtensionSwVersion).toBe("0.2.0");
    expect(caps.imageReasonCode).toBe("extension_version_mismatch");
  });

  it("extensionSeen 且版本匹配（versionCompatible=true）→ READY", () => {
    const caps = sourcingCapabilities({
      loggedIn: false,
      toolAvailable: false,
      image: { extensionAvailable: true, versionCompatible: true, extensionSwVersion: "0.3.1", reasonCode: "extension_seen" },
    } satisfies SourcingToolStatus);
    expect(caps.imageReady).toBe(true);
    expect(caps.imageVersionCompatible).toBe(true);
  });

  it("versionCompatible 缺省（旧服务端响应）→ 视为兼容（向后兼容）", () => {
    const caps = sourcingCapabilities({
      loggedIn: false,
      toolAvailable: false,
      image: { extensionAvailable: true, reasonCode: "extension_seen" },
    } satisfies SourcingToolStatus);
    expect(caps.imageReady).toBe(true);
  });

  it("未连接（extension_not_seen）→ imageReady=false 且无版本信息", () => {
    const caps = sourcingCapabilities({
      loggedIn: false,
      toolAvailable: false,
      image: { extensionAvailable: false, reasonCode: "extension_not_seen" },
    } satisfies SourcingToolStatus);
    expect(caps.imageReady).toBe(false);
    expect(caps.imageExtensionSwVersion).toBeNull();
  });
});
