/**
 * V3.5 — Native1688ExtensionDriver 编排错误映射测试（fake bridge 注入）
 *
 * §25/§26/§27/§35 覆盖：extension_not_installed / auth_required / risk_control_required /
 * upload 重试与 Wrong Upload 门禁 / 结果不足 / 正常全链（fake 命令序列）。
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireByImage, fetchImageWithRedirectGuard, normalizeImageAcquisitionError } from "@/lib/server/sourcingImageAcquisition";
import { SourcingAcquisitionError } from "@/lib/upstream/1688/contracts";
import type { Native1688BridgeClient } from "@/lib/server/native1688BridgeClient";

/** fake bridge：按脚本序列响应命令 */
function fakeBridge(script: {
  extensionSeen?: boolean;
  commands?: Array<{ type: string; respond: () => Record<string, unknown> }>;
  /** 记录 registerJob 调用次数（V3 Final R13：upload 重试必须重新注册 job） */
  onRegisterJob?: (call: number) => void;
  onEnqueue?: (command: { type: string }) => void;
}) {
  let jobCounter = 0;
  const bridge = {
    async start() {},
    async getStatus() {
      return { extensionSeen: script.extensionSeen ?? true, lastExtensionSeenAt: Date.now() };
    },
    async registerJob() {
      jobCounter += 1;
      script.onRegisterJob?.(jobCounter);
      return `fake-job-${jobCounter}`;
    },
    async enqueue(_jobId: string, command: { type: string }) {
      script.onEnqueue?.(command);
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
  it("扩展未见（extensionSeen=false）→ EXTENSION_NOT_INSTALLED", { timeout: 60_000 }, async () => {
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

  it("页面非上传页（两次自动导航+轮询后仍非上传页）→ PAGE_IDENTITY_UNKNOWN", { timeout: 90_000 }, async () => {
    const path = tinyPngFile();
    try {
      const unknownState = () => ({ ok: true, pageKind: "unknown", uploadTarget: { found: false } });
      const fb = fakeBridge({
        commands: [
          // 初始 getState：非上传页
          { type: "getState", respond: unknownState },
          // 第 1 次导航 + 轮询 30s（每 2s 一次 getState；脚本耗尽后立即 client_timeout）
          { type: "navigateUploadPage", respond: () => ({ ok: true }) },
          ...Array.from({ length: 16 }, () => ({ type: "getState", respond: unknownState })),
          // 第 2 次导航 + 轮询 30s
          { type: "getState", respond: unknownState },
          { type: "navigateUploadPage", respond: () => ({ ok: true }) },
          ...Array.from({ length: 16 }, () => ({ type: "getState", respond: unknownState })),
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

  it("确定性不支持 DOM（已在上传页但 documentReadyState=complete 且找不到 uploadTarget）→ 快速失败为 page_identity_unknown（零 30s 导航重试）", async () => {
    const path = tinyPngFile();
    try {
      const state = () => ({
        ok: true,
        pageKind: "upload_page",
        documentReadyState: "complete",
        uploadTarget: { found: false },
      });
      const enqueuedCommands: string[] = [];
      const fb = fakeBridge({
        onEnqueue: (c) => enqueuedCommands.push(c.type),
        commands: [
          // 初始 getState + 1 次短时复核 getState
          { type: "getState", respond: state },
          { type: "getState", respond: state },
        ],
      });
      const code = await capture(acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      }));
      expect(code).toBe("page_identity_unknown");
      // 确认未进行任何无意义的 navigateUploadPage 命令下发
      expect(enqueuedCommands).not.toContain("navigateUploadPage");
      expect(enqueuedCommands).toEqual(["getState", "getState"]);
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("结果页 → 第 1 次导航轮询超时 → 第 2 次导航成功 → 全链正常", { timeout: 90_000 }, async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          // 初始 getState：停留在结果页
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          // 第 1 次导航：轮询 30s 内页面仍未就绪（脚本耗尽 → client_timeout）
          { type: "navigateUploadPage", respond: () => ({ ok: true }) },
          ...Array.from({ length: 16 }, () => ({ type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) })),
          // 第 2 次导航：轮询第 1 次 getState 即就绪
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          { type: "navigateUploadPage", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", uploadTarget: { found: true, unique: true } }) },
          // 正常全链
          { type: "upload", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", preview: { confirmed: true, srcLength: tinyPngBase64Length() } }) },
          { type: "submit", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          {
            type: "collect",
            respond: () => ({
              ok: true,
              cards: [
                { offerId: "1036420364519", title: "保温杯A", entityBound: true },
                { offerId: "1035039187306", title: "保温杯B", entityBound: true },
                { offerId: "1031650493303", title: "保温杯C", entityBound: true },
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
      expect(result.trace.success).toBe(true);
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });

  it("导航后页面加载慢（轮询中 result_page → upload_page）→ 全链正常", { timeout: 60_000 }, async () => {
    const path = tinyPngFile();
    try {
      const fb = fakeBridge({
        commands: [
          // 初始 getState：停留在结果页
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          { type: "navigateUploadPage", respond: () => ({ ok: true }) },
          // 轮询：前 2 次仍结果页（页面加载中），第 3 次上传页就绪
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", uploadTarget: { found: true, unique: true } }) },
          // 正常全链
          { type: "upload", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", preview: { confirmed: true, srcLength: tinyPngBase64Length() } }) },
          { type: "submit", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          {
            type: "collect",
            respond: () => ({
              ok: true,
              cards: [
                { offerId: "1036420364519", title: "保温杯A", entityBound: true },
                { offerId: "1035039187306", title: "保温杯B", entityBound: true },
                { offerId: "1031650493303", title: "保温杯C", entityBound: true },
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
      expect(result.trace.success).toBe(true);
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

  // V3 Final R13：upload 重试必须重新注册 job（Bridge 图片一次性消费；防止 job_image_consumed）
  it("upload 第一次失败 → 重试时重新注册 job（registerJob 次数递增）且全链成功", { timeout: 120_000 }, async () => {
    const path = tinyPngFile();
    const base64Len = tinyPngBase64Length();
    const registerCalls: number[] = [];
    try {
      const fb = fakeBridge({
        commands: [
          // 页面身份：上传页就绪
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", uploadTarget: { found: true, unique: true } }) },
          // attempt 1：upload 执行失败（如 SW 瞬时不可达）
          { type: "upload", respond: () => ({ ok: false, code: "client_timeout" }) },
          // attempt 2：upload 成功 + preview 一致（identity proof）
          { type: "upload", respond: () => ({ ok: true }) },
          { type: "getState", respond: () => ({ ok: true, pageKind: "upload_page", preview: { confirmed: true, srcLength: base64Len } }) },
          // submit 成功
          { type: "submit", respond: () => ({ ok: true }) },
          // 结果页就绪（轮询第一次命中）
          { type: "getState", respond: () => ({ ok: true, pageKind: "result_page", resultPage: { resultsReady: true } }) },
          // collect 3 张卡片
          { type: "collect", respond: () => ({ ok: true, cards: [
            { offerId: "1036420364519", title: "保温杯A", priceText: "¥13.3", moqText: "2件起批", imageUrl: "https://img.example/a.jpg", detailUrl: "https://detail.1688.com/offer/1036420364519.html", entityBound: true },
            { offerId: "1035039187306", title: "保温杯B", priceText: null, moqText: null, imageUrl: null, detailUrl: "https://detail.1688.com/offer/1035039187306.html", entityBound: true },
            { offerId: "1031650493303", title: "保温杯C", priceText: "¥8", moqText: null, imageUrl: null, detailUrl: "https://detail.1688.com/offer/1031650493303.html", entityBound: true },
          ] }) },
        ],
        onRegisterJob: (call) => registerCalls.push(call),
      });
      const result = await acquireByImage({
        localImagePath: path,
        taskId: "t1",
        candidateId: "c1",
        bridgeFactory: () => fb,
      });
      // 首次注册（步骤 3）+ upload 重试重新注册（attempt 2）= 2 次
      expect(registerCalls.length).toBe(2);
      expect(result.candidates).toHaveLength(3);
      expect(result.trace.success).toBe(true);
    } finally {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  });
});

// ── V3 Final R9：redirect 逐跳验证（§149；禁止盲目跟随到内网/保留地址） ──

describe("fetchImageWithRedirectGuard", () => {
  /** 测试用 proxy-aware lookup：一律解析为公网地址（与真实代理环境一致） */
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  function imageResponse(body: string, init?: ResponseInit): Response {
    return new Response(body, { status: 200, headers: { "content-type": "image/png" }, ...init });
  }

  it("正常 200 → 返回最终响应", async () => {
    const fetchMock = vi.fn(async () => imageResponse("png-bytes"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await fetchImageWithRedirectGuard(new URL("https://m.media-amazon.com/images/I/x.jpg"), AbortSignal.timeout(5_000));
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("redirect → 内网目标 → 拒绝（invalid_image_url）", async () => {
    const fetchMock = vi.fn(async (url: URL | string) => {
      const current = String(url);
      if (current.includes("initial.example")) {
        return new Response(null, { status: 302, headers: { location: "https://192.168.1.5/steal.png" } });
      }
      return imageResponse("png");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchImageWithRedirectGuard(new URL("https://initial.example/a.png"), AbortSignal.timeout(5_000), publicLookup))
        .rejects.toMatchObject({ code: "invalid_image_url" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("redirect → 协议降级 http → 拒绝（image_redirect_downgrade）", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 301, headers: { location: "http://cdn.example/b.png" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchImageWithRedirectGuard(new URL("https://initial.example/a.png"), AbortSignal.timeout(5_000), publicLookup))
        .rejects.toMatchObject({ code: "image_redirect_downgrade" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("redirect → 保留网段字面量（28.0.0.1）→ 拒绝（literal_private 路径）", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://28.0.0.1/x.png" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchImageWithRedirectGuard(new URL("https://initial.example/a.png"), AbortSignal.timeout(5_000), publicLookup))
        .rejects.toMatchObject({ code: "invalid_image_url" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("redirect 超过 5 跳 → 拒绝（image_redirect_too_deep）", async () => {
    let hops = 0;
    const fetchMock = vi.fn(async () => {
      hops += 1;
      return new Response(null, { status: 302, headers: { location: `https://hop.example/${hops}.png` } });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchImageWithRedirectGuard(new URL("https://start.example/a.png"), AbortSignal.timeout(10_000), publicLookup))
        .rejects.toMatchObject({ code: "image_redirect_too_deep" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("redirect → 合法 https 公网目标 → 跟随并返回最终 200", async () => {
    const fetchMock = vi.fn(async (url: URL | string) => {
      const current = String(url);
      if (current.includes("cdn.example")) return imageResponse("final-png");
      return new Response(null, { status: 302, headers: { location: "https://cdn.example/final.png" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await fetchImageWithRedirectGuard(new URL("https://initial.example/a.png"), AbortSignal.timeout(10_000), publicLookup);
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("3xx 无 location → 拒绝（image_redirect_missing_target）", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(fetchImageWithRedirectGuard(new URL("https://initial.example/a.png"), AbortSignal.timeout(5_000), publicLookup))
        .rejects.toMatchObject({ code: "image_redirect_missing_target" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
