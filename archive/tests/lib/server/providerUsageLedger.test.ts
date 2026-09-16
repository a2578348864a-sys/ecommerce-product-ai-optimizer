import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import {
  reserveGlobalProviderCalls,
  refundGlobalProviderCalls,
  getGlobalProviderUsage,
  getDailyProviderCap,
  PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV,
  PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP_ENV,
} from "@/lib/server/providerUsageLedger";

const RUN = randomBytes(4).toString("hex");
const STORE = join(tmpdir(), "provider-usage-" + RUN + ".json");

beforeEach(() => {
  process.env.QX_RUNTIME_MODE = "public_showcase";
  process.env.PROVIDER_USAGE_STORE_PATH = STORE;
  delete process.env[PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV];
  delete process.env[PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP_ENV];
});

afterEach(() => {
  delete process.env.QX_RUNTIME_MODE;
  delete process.env.PROVIDER_USAGE_STORE_PATH;
  delete process.env[PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV];
  delete process.env[PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP_ENV];
  try { if (existsSync(STORE)) unlinkSync(STORE); } catch { /* ok */ }
  try { if (existsSync(STORE + ".lock")) unlinkSync(STORE + ".lock"); } catch { /* ok */ }
});

describe("Global Provider Hard Cap（§13-18）", () => {
  it("缺省 cap = RECOMMENDED 档（text 200 / image 40），ENV 可配且绝不 unlimited", () => {
    expect(getDailyProviderCap("text")).toBe(200);
    expect(getDailyProviderCap("image")).toBe(40);
    process.env[PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV] = "7";
    expect(getDailyProviderCap("text")).toBe(7);
    process.env[PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV] = "abc";
    expect(getDailyProviderCap("text")).toBe(200);
  });

  it("预留消耗计数；超限 → global_provider_cap_exceeded", () => {
    process.env[PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV] = "5";
    for (let index = 0; index < 5; index += 1) {
      expect(reserveGlobalProviderCalls("text", 1)).toEqual({ ok: true });
    }
    expect(reserveGlobalProviderCalls("text", 1)).toEqual({ ok: false, code: "global_provider_cap_exceeded" });
    expect(getGlobalProviderUsage().text.exhausted).toBe(true);
  });

  it("回补：预留给失败路径 refund 后可继续", () => {
    process.env[PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV] = "2";
    expect(reserveGlobalProviderCalls("text", 2)).toEqual({ ok: true });
    expect(reserveGlobalProviderCalls("text", 1)).toEqual({ ok: false, code: "global_provider_cap_exceeded" });
    refundGlobalProviderCalls("text", 2);
    expect(reserveGlobalProviderCalls("text", 1)).toEqual({ ok: true });
  });

  it("text 与 image 独立计数", () => {
    process.env[PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP_ENV] = "1";
    expect(reserveGlobalProviderCalls("image", 1)).toEqual({ ok: true });
    expect(reserveGlobalProviderCalls("image", 1)).toEqual({ ok: false, code: "global_provider_cap_exceeded" });
    expect(reserveGlobalProviderCalls("text", 1)).toEqual({ ok: true });
  });

  it("GLOBAL_CAP_ATOMICITY：remaining=1 时 10 个并发预留只能 1 个成功", async () => {
    process.env[PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP_ENV] = "1";
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve().then(() => reserveGlobalProviderCalls("text", 1))),
    );
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    expect(attempts.filter((a) => !a.ok && a.code === "global_provider_cap_exceeded")).toHaveLength(9);
  });

  it("非 PUBLIC_SHOWCASE（缺省/legacy）→ 不启用全局预算（no-op）", () => {
    delete process.env.QX_RUNTIME_MODE;
    expect(reserveGlobalProviderCalls("text", 9999)).toEqual({ ok: true });
  });
});