import { describe, expect, it, vi } from "vitest";
import type { ValidatedTarget } from "../../lib/server/ssrfGuard";
import { GLOBAL_SOURCES_ROBOTS_URL } from "./stage2-global-sources-discovery-r1";
import { fetchGlobalSourcesRobotsOnce } from "./global-sources-robots-request";

const target: ValidatedTarget = {
  url: new URL(GLOBAL_SOURCES_ROBOTS_URL),
  addresses: [{ address: "93.184.216.34", family: 4 }],
};

describe("Global Sources pinned robots request", () => {
  it("rejects every URL except the exact fixed robots target before DNS", async () => {
    const validateTarget = vi.fn();
    await expect(fetchGlobalSourcesRobotsOnce("https://www.globalsources.com/other", {
      validateTarget,
      requestPinned: vi.fn(),
      now: () => 1,
    })).rejects.toThrowError("ROBOTS_REQUEST_URL_INVALID");
    expect(validateTarget).not.toHaveBeenCalled();
  });

  it("uses only an address returned by the validated DNS result", async () => {
    const validateTarget = vi.fn(async () => target);
    const requestPinned = vi.fn(async () => new Response("User-agent: *\nDisallow: /private", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }));
    const result = await fetchGlobalSourcesRobotsOnce(GLOBAL_SOURCES_ROBOTS_URL, {
      validateTarget,
      requestPinned,
      now: (() => { let value = 100; return () => value += 10; })(),
    });
    expect(validateTarget).toHaveBeenCalledWith(new URL(GLOBAL_SOURCES_ROBOTS_URL));
    expect(requestPinned).toHaveBeenCalledWith(
      target.url,
      target.addresses[0],
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({ status: 200, finalUrl: GLOBAL_SOURCES_ROBOTS_URL });
  });

  it("does not retry another validated address after the single connection attempt fails", async () => {
    const multiAddressTarget: ValidatedTarget = {
      url: new URL(GLOBAL_SOURCES_ROBOTS_URL),
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "93.184.216.35", family: 4 },
      ],
    };
    const validateTarget = vi.fn(async () => multiAddressTarget);
    const requestPinned = vi.fn()
      .mockRejectedValueOnce(new Error("first connection failed"))
      .mockResolvedValueOnce(new Response("User-agent: *\nDisallow: /private", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }));

    await expect(fetchGlobalSourcesRobotsOnce(GLOBAL_SOURCES_ROBOTS_URL, {
      validateTarget,
      requestPinned,
      now: () => 1,
    })).rejects.toThrowError("first connection failed");
    expect(requestPinned).toHaveBeenCalledTimes(1);
    expect(requestPinned).toHaveBeenCalledWith(
      multiAddressTarget.url,
      multiAddressTarget.addresses[0],
      expect.any(AbortSignal),
    );
  });

  it("rejects non-text responses and bounded bodies without retrying unvalidated addresses", async () => {
    const validateTarget = vi.fn(async () => target);
    const nonText = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(fetchGlobalSourcesRobotsOnce(GLOBAL_SOURCES_ROBOTS_URL, {
      validateTarget, requestPinned: nonText, now: () => 1,
    })).rejects.toThrowError("ROBOTS_CONTENT_TYPE_INVALID");
    expect(nonText).toHaveBeenCalledTimes(1);

    const oversized = vi.fn(async () => new Response(new Uint8Array(262_145), {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    await expect(fetchGlobalSourcesRobotsOnce(GLOBAL_SOURCES_ROBOTS_URL, {
      validateTarget, requestPinned: oversized, now: () => 1,
    })).rejects.toThrowError("ROBOTS_BODY_TOO_LARGE");
    expect(oversized).toHaveBeenCalledTimes(1);
  });
});
