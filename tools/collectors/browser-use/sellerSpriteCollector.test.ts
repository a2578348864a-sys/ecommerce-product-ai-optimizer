import { describe, expect, it } from "vitest";
import {
  buildSellerSpriteCollectionScript,
  parseCollectorObservation,
  collectorObservationToPreview,
  runSellerSpriteCollection,
  type SellerSpriteCollectionInput,
} from "./sellerSpriteCollector";

describe("SellerSprite Browser Use 采集器（轮 9）", () => {
  const input: SellerSpriteCollectionInput = {
    kind: "competitor",
    seedAsin: "B0SAMPLE12",
    marketplaceTld: "com",
    productUrl: null,
  };

  it("脚本模板确定性：包含导航（种子 ASIN）、观察与 JSON 输出；不硬编码页面数据", () => {
    const script = buildSellerSpriteCollectionScript(input);
    expect(script).toContain("B0SAMPLE12");
    expect(script).toContain("BU_COLLECT_OUTPUT");
  expect(script).toContain("main-sellersprite-extension");
  expect(script).toContain("keywords");
    expect(script).not.toContain("B0COMP0002");
  expect(script).toContain("BU_COLLECT_OUTPUT");
  });

  it("观察解析：登录墙→login_required；验证码→captcha_required；无面板→panel_not_detected；畸形→null", () => {
    const login = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "u", title: "t", bodyText: "Please sign in", panelMarker: false, observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(login?.failureHint).toBe("login_required");
    const captcha = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "u", title: "t", bodyText: "Enter the characters you see below", panelMarker: false, observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(captcha?.failureHint).toBe("captcha_required");
    const noPanel = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "u", title: "t", bodyText: "Normal product page", panelMarker: false, observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(noPanel?.failureHint).toBe("panel_not_detected");
    expect(parseCollectorObservation("not json")).toBeNull();
  });

  it("观察 → 严格 Preview：面板未发现时结果为空 + panel_not_detected（不冒充无数据）", () => {
    const observation = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "https://www.amazon.com/dp/B0SAMPLE12", title: "t", bodyText: "ordinary page", panelMarker: false, observedAt: "2026-08-14T02:00:00.000Z" })) as NonNullable<ReturnType<typeof parseCollectorObservation>>;
    const preview = collectorObservationToPreview(input, observation, "0.1.9");
    expect(preview.kind).toBe("competitor");
    expect(preview.seedAsin).toBe("B0SAMPLE12");
    expect(preview.failureReason).toBe("panel_not_detected");
    expect(preview.results).toEqual([]);
    expect(preview.missing).toContain("sellersprite_panel_rows");
  });

describe("runSellerSpriteCollection（轮 9）", () => {
  const input: SellerSpriteCollectionInput = {
    kind: "keyword", seedAsin: "B0SAMPLE12", marketplaceTld: "com", productUrl: null,
  };

  it("浏览器未启动/超时 → collector_unavailable；观察畸形 → collect_failed（不冒充无数据）", async () => {
    const unavailable = await runSellerSpriteCollection(input, async () => { throw new Error("spawn EPERM"); });
    expect(unavailable).toMatchObject({ ok: false, failureReason: "collector_unavailable" });
    const malformed = await runSellerSpriteCollection(input, async () => ({ stdout: "garbage", stderr: "", code: 0 }));
    expect(malformed).toMatchObject({ ok: false, failureReason: "collect_failed" });
  });

  it("正常观察 → 严格 Preview（seed/来源 URL/失败原因正确）", async () => {
    const run = await runSellerSpriteCollection(input, async () => ({
      stdout: JSON.stringify({ schema: "browser-use-observation.v1", url: "https://www.amazon.com/dp/B0SAMPLE12", title: "t", bodyText: "ordinary", panelMarker: false, observedAt: "2026-08-14T02:00:00.000Z" }),
      stderr: "", code: 0,
    }));
    if (run.ok) {
      expect(run.preview.seedAsin).toBe("B0SAMPLE12");
      expect(run.preview.kind).toBe("keyword");
      expect(run.preview.failureReason).toBe("panel_not_detected");
      expect(run.preview.missing).toContain("sellersprite_panel_rows");
    } else {
      throw new Error("expected ok");
    }
  });
});
});
