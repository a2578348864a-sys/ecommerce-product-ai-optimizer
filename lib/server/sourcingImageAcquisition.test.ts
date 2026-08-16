/**
 * V3.5 — Native1688ExtensionDriver 编排错误映射测试（fake bridge 注入）
 *
 * §25/§26/§27/§35 覆盖：extension_not_installed / auth_required / risk_control_required /
 * upload 重试与 Wrong Upload 门禁 / 结果不足 / 正常全链（fake 命令序列）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireByImage, normalizeImageAcquisitionError } from "@/lib/server/sourcingImageAcquisition";
import { SourcingAcquisitionError } from "@/lib/upstream/1688/contracts";
import type { Native1688BridgeClient } from "@/lib/server/native1688BridgeClient";

/** fake bridge：按脚本序列响应命令 */
function fakeBridge(script: {
  extensionSeen?: boolean;
  commands?: Array<{ type: string; respond: () => Record<string, unknown> }>;
}) {
  const bridge = {
    async start() {},
    async getStatus() {
      return { extensionSeen: script.extensionSeen ?? true, lastExtensionSeenAt: Date.now() };
    },
    async registerJob() {
      return "fake-job-1";
    },
    async enqueue(_jobId: string, _command: { type: string }) {
      return { duplicate: false };
    },
    async waitResult(): Promise<Record<string, unknown>> {
      const next = script.commands?.shift();
      if (next) return next.respond();
      return { ok: false, code: "client_timeout" }; // 模拟真实：无命令时超时
    },
  };
  return bridge as unknown as Pick<Native1688BridgeClient, "start" | "getStatus" | "registerJob" | "enqueue" | "waitResult">;
}

function tinyPngFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "v35-driver-test-"));
  const path = join(dir, "candidate.png");
  writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 80, 15, 0, 4, 132, 1, 129, 138, 153, 49, 8, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
  return path;
}

/** 本地 tiny PNG 的 base64 长度（预览 Identity Proof 需要匹配） */
function tinyPngBase64Length(): number {
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 80, 15, 0, 4, 132, 1, 129, 138, 153, 49, 8, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
  return Math.ceil(bytes.length / 3) * 4;
}

function capture(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "NO_ERROR",
    (error) => (error instanceof SourcingAcquisitionError ? error.code : `OTHER:${String(error)}`),
  );
}

describe("Native1688ExtensionDriver 编排错误映射", () => {
  it("扩展未见（extensionSeen=false）→ EXTENSION_NOT_INSTALLED", { timeout: 30_000 }, async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({ extensionSeen: false });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("extension_not_installed");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("登录墙（login_wall）→ AUTH_REQUIRED", async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: true, pageKind: "login_wall" }) },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("auth_required");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("风控页（risk_control）→ RISK_CONTROL_REQUIRED", async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: true, pageKind: "risk_control" }) },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("risk_control_required");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("页面非上传页（自动导航后仍非上传页）→ PAGE_IDENTITY_UNKNOWN", { timeout: 30_000 }, async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: true, pageKind: "unknown", uploadTarget: { found: false } }) },
          { type: "navigateUploadPage", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "unknown", uploadTarget: { found: false } }) },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("page_identity_unknown");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("上传预览与候选不一致（重试后仍失败）→ UPLOAD_NOT_CONFIRMED（Wrong Upload 门禁）", { timeout: 60_000 }, async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          // getState 页面 OK
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", uploadTarget: { found: true, unique: true } }) },
          // 上传 3 次均成功，但预览一直不匹配（srcLength 与本地差异大）
          ...Array.from({ length: 3 }, () => ({ type: "upload", respond: () => ({ ok: true }) })),
          ...Array.from({ length: 3 }, () => ({ type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", preview: { confirmed: true, srcLength: 500 } }) })),
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("upload_not_confirmed");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("扩展 idle（SW 在但无 1688 页面 tab）→ EXTENSION_DISCONNECTED（no_1688_tab）", async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: false, code: "no_1688_tab" }) },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("extension_disconnected");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("扩展已加载但 content script 不可达 → EXTENSION_DISCONNECTED", async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: false, code: "content_script_unreachable" }) },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("extension_disconnected");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("submit 失败 → SEARCH_TRIGGER_NOT_CONFIRMED", async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", uploadTarget: { found: true, unique: true } }) },
          { type: "upload", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", preview: { confirmed: true, srcLength: tinyPngBase64Length() } }) },
          { type: "submit", respond: () => ({ ok: false, code: "search_trigger_not_confirmed" }) },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("search_trigger_not_confirmed");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("结果不足（collect < 3）→ IMAGE_RESULTS_INSUFFICIENT", { timeout: 60_000 }, async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", uploadTarget: { found: true, unique: true } }) },
          { type: "upload", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", preview: { confirmed: true, srcLength: tinyPngBase64Length() } }) },
          { type: "submit", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          { type: "collect", respond: () => ({ ok: true, cards: [{ offerId: "12345" }, { offerId: "23456" }] }) },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("image_results_insufficient");
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("正常全链（fake 命令序列）→ 候选 + trace（driver=native-1688-extension-driver）", { timeout: 60_000 }, async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", uploadTarget: { found: true, unique: true } }) },
          { type: "upload", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", preview: { confirmed: true, srcLength: tinyPngBase64Length() } }) },
          { type: "submit", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          {
            type: "collect",
            respond: () => ({
              ok: true,
              cards: [
                { offerId: "1036420364519", title: "保温杯A", priceText: "¥13.3", moqText: "2件起批", imageUrl: "https://img.example/a.jpg", detailUrl: "https://detail.1688.com/offer/1036420364519.html", entityBound: true },
                { offerId: "1035039187306", title: "保温杯B", priceText: null, moqText: null, imageUrl: null, detailUrl: "https://detail.1688.com/offer/1035039187306.html", entityBound: true },
                { offerId: "1031650493303", title: "保温杯C", priceText: "¥8", moqText: null, imageUrl: null, detailUrl: "https://detail.1688.com/offer/1031650493303.html", entityBound: true },
              ],
            }),
          },
        ],
      });
      const result = await acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      });
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates[0].offerId).toBe("1036420364519");
      expect(result.candidates[0].acquisitionMethod).toBe("image");
      expect(result.candidates[0].sourceProductRole).toBe("similar");
      expect(result.candidates[0].matchState).toBe("unknown");
      expect(result.candidates[0].displayedPrice?.text).toBe("¥13.3");
      expect(result.trace.driverVersion).toContain("native-1688-extension-driver");
      expect(result.trace.success).toBe(true);
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("错误归一化：SourcingAcquisitionError 透传 code/status", () => {
    const normalized = normalizeImageAcquisitionError(new SourcingAcquisitionError("auth_required", 401, "msg"));
    expect(normalized).toEqual({ code: "auth_required", status: 401, message: "msg" });
    const generic = normalizeImageAcquisitionError(new Error("boom"));
    expect(generic.code).toBe("extension_bridge_not_available");
  });
});
