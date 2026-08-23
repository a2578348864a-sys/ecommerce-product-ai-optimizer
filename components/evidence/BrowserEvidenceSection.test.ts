import { resolveSaveConflictRecovery } from "./BrowserEvidenceSection";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BrowserEvidenceSection,
  normalizePreviewFields,
  parseBrowserCollectPreviewView,
  parseBrowserEvidenceView,
} from "@/components/evidence/BrowserEvidenceSection";

function snapshotFixture() {
  return {
    schema: "browser-evidence.v1",
    version: 1,
    candidateId: "candidate-browser-evidence",
    targetAsin: "B0A1B2C3D4",
    updatedAt: "2026-08-06T00:00:00.000Z",
    snapshots: [
      {
        evidenceId: "ev-00000001",
        sourceType: "browser",
        sourceSite: "amazon",
        pageUrl: "https://www.amazon.com/dp/B0A1B2C3D4?language=en_US",
        marketplace: "amazon.com",
        locale: "en_US",
        currency: "USD",
        entityBinding: {
          bound: true,
          urlAsin: "B0A1B2C3D4",
          pageAsin: "B0A1B2C3D4",
          proof: { urlMatchesExpected: true, pageAnchorMatchesExpected: true, productContainerFound: true },
        },
        collectorVersion: "amazon-detail-page-extractor.v1",
        capturedAt: "2026-08-06T00:00:00.000Z",
        fields: {
          asin: { value: "B0A1B2C3D4", status: "correct", reason: null, nature: "snapshot" },
          title: { value: "John Boos Walnut Cutting Board", status: "correct", reason: null, nature: "snapshot" },
          price: { value: 48.95, status: "correct", reason: null, nature: "snapshot" },
          bsr: { value: 2541, status: "correct", reason: null, nature: "snapshot" },
          rating: { value: 4.2, status: "correct", reason: null, nature: "snapshot" },
          reviewCount: { value: 4958, status: "correct", reason: null, nature: "snapshot" },
        },
        failureReasons: [],
        confirmedBy: { mode: "visitor", actorRef: "visitor:demo-access-a" },
        confirmedAt: "2026-08-06T00:00:00.000Z",
      },
    ],
  };
}

function previewFixture() {
  return {
    extraction: {
      schemaVersion: "amazon-detail-page-extraction.v1",
      expectedAsin: "B0A1B2C3D4",
      urlAsin: "B0A1B2C3D4",
      pageAsin: "B0A1B2C3D4",
      entityBound: true,
      bindingProof: { urlMatchesExpected: true, pageAnchorMatchesExpected: true, productContainerFound: true },
      pageStatus: "ok",
      fields: {
        asin: { field: "asin", value: "B0A1B2C3D4", status: "correct", reason: null },
        title: { field: "title", value: "John Boos Walnut Cutting Board", status: "correct", reason: null },
        price: { field: "price", value: 48.95, status: "correct", reason: null },
        bsr: { field: "bsr", value: 2541, status: "correct", reason: null },
        rating: { field: "rating", value: 4.2, status: "correct", reason: null },
        reviews: { field: "reviews", value: 4958, status: "correct", reason: null },
      },
      capturedAt: "2026-08-06T00:00:00.000Z",
      collectorVersion: "amazon-detail-page-extractor.v1",
    },
    navigation: {
      requestedUrl: "https://www.amazon.com/dp/B0A1B2C3D4?language=en_US",
      finalUrl: "https://www.amazon.com/dp/B0A1B2C3D4?language=en_US",
      httpStatus: 200,
      navigationElapsedMs: 2400,
      allowedFinalOrigin: true,
    },
  };
}

describe("parseBrowserEvidenceView (frontend projection)", () => {
  it("parses a full evidence document with snapshots", () => {
    const parsed = parseBrowserEvidenceView(snapshotFixture());
    expect(parsed).not.toBeNull();
    expect(parsed!.snapshots).toHaveLength(1);
    expect(parsed!.snapshots[0].fields).toMatchObject({
      asin: { value: "B0A1B2C3D4", status: "correct" },
      price: { value: 48.95, status: "correct" },
      reviewCount: { value: 4958, status: "correct" },
    });
    expect(parsed!.snapshots[0].entityBound).toBe(true);
    expect(parsed!.snapshots[0].confirmedBy.mode).toBe("visitor");
  });

  it("rejects wrong schema / version / malformed snapshots", () => {
    expect(parseBrowserEvidenceView({ schema: "browser-evidence.v2", version: 1, snapshots: [] })).toBeNull();
    expect(parseBrowserEvidenceView({ schema: "browser-evidence.v1", version: 2, snapshots: [] })).toBeNull();
    expect(parseBrowserEvidenceView(null)).toBeNull();
    const fixture = snapshotFixture();
    const broken = {
      ...fixture,
      snapshots: [{ ...fixture.snapshots[0], fields: { ...fixture.snapshots[0].fields, price: null } }],
    };
    expect(parseBrowserEvidenceView(broken)).toBeNull();
  });

  it("keeps JPY currency and unknown fields visible", () => {
    const fixture = snapshotFixture();
    const jpy = {
      ...fixture,
      snapshots: [{
        ...fixture.snapshots[0],
        currency: "JPY",
        fields: {
          ...fixture.snapshots[0].fields,
          price: { value: null, status: "unknown", reason: "currency_not_usd:JPY", nature: "snapshot" },
        },
      }],
    };
    const parsed = parseBrowserEvidenceView(jpy)!;
    expect(parsed.snapshots[0].currency).toBe("JPY");
    expect(parsed.snapshots[0].fields.price.status).toBe("unknown");
  });
});

describe("parseBrowserCollectPreviewView", () => {
  it("parses a valid collect preview", () => {
    const parsed = parseBrowserCollectPreviewView(previewFixture());
    expect(parsed).not.toBeNull();
    expect(parsed!.extraction.pageStatus).toBe("ok");
    expect(parsed!.extraction.entityBound).toBe(true);
    expect(parsed!.navigation.httpStatus).toBe(200);
  });

  it("rejects a preview missing required structure", () => {
    expect(parseBrowserCollectPreviewView({ extraction: null })).toBeNull();
    expect(parseBrowserCollectPreviewView({ extraction: {}, navigation: {} })).not.toBeNull();
  });
});

describe("normalizePreviewFields（P1-E：提取器命名 reviews → 快照命名 reviewCount）", () => {
  it("maps extraction fields into snapshot-shaped fields without crashing", () => {
    const preview = parseBrowserCollectPreviewView(previewFixture())!;
    const normalized = normalizePreviewFields(preview.extraction.fields);
    expect(normalized.reviewCount.value).toBe(4958);
    expect(normalized.reviewCount.status).toBe("correct");
    expect(normalized.price.value).toBe(48.95);
    expect(normalized.asin.value).toBe("B0A1B2C3D4");
  });

  it("falls back to unknown field view when a field key is missing", () => {
    const normalized = normalizePreviewFields({ asin: { value: "B0A1B2C3D4", status: "correct", reason: null } });
    expect(normalized.reviewCount.value).toBeNull();
    expect(normalized.reviewCount.status).toBe("unknown");
    expect(normalized.price.status).toBe("unknown");
  });
});

describe("BrowserEvidenceSection rendering", () => {
  it("renders the collect entry and empty state", () => {
    const element = createElement(BrowserEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: null,
      taskAsin: "B0A1B2C3D4",
      storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-06T00:00:00.000Z" },
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('data-testid="workbench-browser-evidence"');
    expect(html).toContain("采集页面证据");
    expect(html).toContain("尚未保存浏览器证据");
    expect(html).toContain("B0A1B2C3D4");
  });

  it("warns when the task has no bound ASIN", () => {
    const element = createElement(BrowserEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: null,
      taskAsin: null,
      storageVersion: null,
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("当前任务缺少 Amazon 商品身份信息");
  });

  it("renders saved snapshots with fields and confirm actor", () => {
    const parsed = parseBrowserEvidenceView(snapshotFixture());
    const element = createElement(BrowserEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: parsed,
      taskAsin: "B0A1B2C3D4",
      storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-06T00:00:00.000Z" },
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("最新快照");
    expect(html).toContain("John Boos Walnut Cutting Board");
    expect(html).toContain("48.95");
    expect(html).toContain("Visitor 人工确认");
    expect(html).toContain("浏览器采集");
  });

  it("renders a fail-closed preview without a save button when page is blocked", () => {
    const fixture = previewFixture();
    fixture.extraction.pageStatus = "captcha";
    fixture.extraction.entityBound = false;
    const parsed = parseBrowserCollectPreviewView(fixture);
    // 服务端会拦截 blocked 页面；前端组件在 preview 为 fail-closed 时不渲染确认按钮。
    const element = createElement(BrowserEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: null,
      taskAsin: "B0A1B2C3D4",
      storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-06T00:00:00.000Z" },
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("我确认这是目标商品");
    expect(parsed!.extraction.pageStatus).toBe("captcha");
  });

  it("never renders a bypass-save (仍然保存) control anywhere", () => {
    const parsed = parseBrowserEvidenceView(snapshotFixture());
    const element = createElement(BrowserEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: parsed,
      taskAsin: "B0A1B2C3D4",
      storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-06T00:00:00.000Z" },
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("仍然保存");
    expect(html).not.toContain("强制保存");
  });

  it("does not render the confirm-save button when there is no preview", () => {
    const element = createElement(BrowserEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: null,
      taskAsin: "B0A1B2C3D4",
      storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-06T00:00:00.000Z" },
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("我确认这是目标商品");
  });

  it("renders JPY currency note in snapshot display", () => {
    const fixture = snapshotFixture();
    const jpy = {
      ...fixture,
      snapshots: [{
        ...fixture.snapshots[0],
        currency: "JPY",
        fields: {
          ...fixture.snapshots[0].fields,
          price: { value: null, status: "unknown", reason: "currency_not_usd:JPY", nature: "snapshot" },
        },
      }],
    };
    const parsed = parseBrowserEvidenceView(jpy);
    const element = createElement(BrowserEvidenceSection, {
      taskId: "sandbox_task_test",
      evidence: parsed,
      taskAsin: "B0A1B2C3D4",
      storageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-06T00:00:00.000Z" },
      onChanged: () => undefined,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("页面币种为日元");
    expect(html).toContain("本次不保存价格");
  });

describe("保存冲突自动恢复（轮 12）", () => {
  it("首次 409：保留预览并仅重试一次；二次 409：提示“资料刚刚更新，请再试一次”，不无限重试", () => {
    const first = resolveSaveConflictRecovery(409, "task_result_conflict", false);
    expect(first.retry).toBe(true);
    expect(first.message).toBeNull();
    const second = resolveSaveConflictRecovery(409, "task_result_conflict", true);
    expect(second.retry).toBe(false);
    expect(second.message).toContain("请再试一次");
    expect(resolveSaveConflictRecovery(200, null, false).retry).toBe(false);
  });
});
});
