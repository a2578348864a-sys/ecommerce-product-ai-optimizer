import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { writeFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildSellerSpriteCollectionScript,
  parseCollectorObservation,
  collectorObservationToPreview,
  defaultBrowserUseSpawn,
  resolveBrowserUseCli,
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

  it("观察解析（中文支持）：中文登录墙→login_required；中文验证码→captcha_required；查询中超时→seller_sprite_keyword_timeout", () => {
    const loginZh1 = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "u", title: "t", bodyText: "卖家精灵用户登录", panelMarker: true, observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(loginZh1?.failureHint).toBe("login_required");

    const loginZh2 = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "u", title: "t", bodyText: "请先登录", panelMarker: true, observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(loginZh2?.failureHint).toBe("login_required");

    const captchaZh = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "u", title: "t", bodyText: "请输入验证码", panelMarker: false, observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(captchaZh?.failureHint).toBe("captcha_required");

    const timeout = parseCollectorObservation(JSON.stringify({ schema: "browser-use-observation.v1", url: "u", title: "t", bodyText: "卖家精灵插件查询中，请稍候", panelMarker: true, keywords: [], observedAt: "2026-08-14T02:00:00.000Z" }));
    expect(timeout?.failureHint).toBe("seller_sprite_keyword_timeout");
  });

  it("修复第 140 行误归因 Bug：面板存在但提取关键词为 0 时绝不误归因为 panel_not_detected", () => {
    // 场景 A：面板存在，正常空结果（无查询超时）→ failureReason 应保持 null，绝非 panel_not_detected
    const normalEmpty = parseCollectorObservation(JSON.stringify({
      schema: "browser-use-observation.v1",
      url: "https://www.amazon.com/dp/B0SAMPLE12",
      title: "t",
      bodyText: "暂无数据",
      panelMarker: true,
      keywords: [],
      observedAt: "2026-08-14T02:00:00.000Z",
    })) as NonNullable<ReturnType<typeof parseCollectorObservation>>;
    const previewA = collectorObservationToPreview({ kind: "keyword", seedAsin: "B0SAMPLE12", marketplaceTld: "com", productUrl: null }, normalEmpty, "0.1.9");
    expect(previewA.failureReason).toBeNull();
    expect(previewA.results).toEqual([]);

    // 场景 B：面板存在但查询超时（查询中状态）→ failureReason 应为 seller_sprite_keyword_timeout，绝非 panel_not_detected
    const timeoutObs = parseCollectorObservation(JSON.stringify({
      schema: "browser-use-observation.v1",
      url: "https://www.amazon.com/dp/B0SAMPLE12",
      title: "t",
      bodyText: "卖家精灵插件查询中，请稍候",
      panelMarker: true,
      keywords: [],
      observedAt: "2026-08-14T02:00:00.000Z",
    })) as NonNullable<ReturnType<typeof parseCollectorObservation>>;
    const previewB = collectorObservationToPreview({ kind: "keyword", seedAsin: "B0SAMPLE12", marketplaceTld: "com", productUrl: null }, timeoutObs, "0.1.9");
    expect(previewB.failureReason).toBe("seller_sprite_keyword_timeout");
    expect(previewB.missing).toContain("sellersprite_panel_rows");
  });

  it("脚本 ASCII 安全与轮询逻辑完整性：包含 20s deadline 轮询、5s Tab 等待与 15s 数据等待，无高位字符且 Python 语法合法", async () => {
    const script = buildSellerSpriteCollectionScript(input);
    expect(script).toContain("time.time() - t_poll_start < 20.0");
    expect(script).toContain("time.time() - t_nav_start < 5.0");
    expect(script).toContain("time.time() - t_data_start < 15.0");
    expect(script).toContain("seller_sprite_keyword_timeout");
    // 必须 100% ASCII，严防 Windows CMD 代码页 UnicodeDecodeError
    for (let i = 0; i < script.length; i++) {
      expect(script.charCodeAt(i)).toBeLessThan(128);
    }
    const { spawnSync } = await import("node:child_process");
    const py = spawnSync("python", ["-c", "import sys; compile(sys.stdin.read(), '<test>', 'exec')"], {
      input: script,
      encoding: "utf8",
    });
    if (py.status !== null) {
      expect(py.status).toBe(0);
      expect(py.stderr).toBe("");
    }
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

  it("延迟注入场景（Delayed Injection Fixture）：经过轮询等待成功检测到面板并解析关键词", async () => {
    const delayedFixture = {
      schema: "browser-use-observation.v1",
      url: "https://www.amazon.com/dp/B0SAMPLE12",
      title: "Amazon Product Page",
      bodyText: "SellerSprite Extension Ready",
      panelMarker: true,
      observedAt: "2026-08-14T02:00:08.000Z",
      failureHint: null,
      keywords: [
        {
          keyword: "water bottle",
          keywordTranslation: "水杯",
          searchVolume: 42000,
          abaWeeklyRank: 120,
          purchaseVolume: 3500,
          adCompetitorCount: 15,
        },
      ],
    };

    const run = await runSellerSpriteCollection(input, async () => ({
      stdout: JSON.stringify(delayedFixture),
      stderr: "",
      code: 0,
    }));

    if (!run.ok) throw new Error("expected run.ok = true");
    expect(run.preview.failureReason).toBeNull();
    expect(run.preview.results).toHaveLength(1);
    expect(run.preview.results[0]).toMatchObject({
      keyword: "water bottle",
      keywordTranslation: "水杯",
      searchVolume: 42000,
      abaWeeklyRank: 120,
      purchaseVolume: 3500,
      competition: 15,
    });
    expect(run.preview.missing).toEqual([]);
  });

  it("轮询数据超时场景（Polling Timeout Fixture）：面板已加载但数据加载超时，明确返回 seller_sprite_keyword_timeout", async () => {
    const timeoutFixture = {
      schema: "browser-use-observation.v1",
      url: "https://www.amazon.com/dp/B0SAMPLE12",
      title: "Amazon Product Page",
      bodyText: "卖家精灵插件查询中，请稍候",
      panelMarker: true,
      observedAt: "2026-08-14T02:00:20.000Z",
      failureHint: "seller_sprite_keyword_timeout",
      keywords: [],
    };

    const run = await runSellerSpriteCollection(input, async () => ({
      stdout: JSON.stringify(timeoutFixture),
      stderr: "",
      code: 0,
    }));

    if (!run.ok) throw new Error("expected run.ok = true");
    expect(run.preview.failureReason).toBe("seller_sprite_keyword_timeout");
    expect(run.preview.failureReason).not.toBe("panel_not_detected");
    expect(run.preview.results).toEqual([]);
    expect(run.preview.missing).toContain("sellersprite_panel_rows");
  });
});

describe("Browser Use CLI resolution and process boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("显式 BROWSER_USE_CLI_PATH 优先，且保留包含空格的完整路径", () => {
    const command = "C:\\Program Files\\Browser Use\\browser-use.exe";
    expect(resolveBrowserUseCli({ BROWSER_USE_CLI_PATH: command })).toEqual({ command, source: "env" });
  });

  it("未配置时只返回 PATH 命令，不返回个人绝对路径", () => {
    const resolution = resolveBrowserUseCli({});
    expect(resolution).toEqual({ command: "browser-use", source: "path" });
    expect(resolution.command).not.toMatch(/[\\/]Users[\\/]|[\\/]home[\\/]|a2578/i);
  });

  it("使用独立 executable + stdin，不把含空格路径拼进 shell 命令", async () => {
    const command = "C:\\Program Files\\Browser Use\\browser-use.exe";
    vi.stubEnv("BROWSER_USE_CLI_PATH", command);
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; kill: ReturnType<typeof vi.fn> };
    child.stdin = new PassThrough();
    let received = "";
    child.stdin.on("data", (chunk: Buffer) => { received += chunk.toString("utf8"); });
    child.kill = vi.fn();
    const fakeSpawn = vi.fn((actualCommand: string, args: string[], options: { shell?: boolean; env?: NodeJS.ProcessEnv }) => {
      expect(actualCommand).toBe(command);
      expect(args).toEqual([]);
      expect(options.shell).toBe(false);
      expect(options.env?.BROWSER_USE_CLI_PATH).toBe(command);
      const outputPath = options.env?.BU_COLLECT_OUTPUT;
      if (!outputPath) throw new Error("missing output path");
      writeFileSync(outputPath, "");
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    const run = await defaultBrowserUseSpawn("print('ok')", 1_000, fakeSpawn as never);
    expect(run.code).toBe(0);
    expect(fakeSpawn).toHaveBeenCalledOnce();
    expect(received).toBe("print('ok')");
  });

  it("CLI ENOENT 映射为明确的 collector_unavailable，而不是 collect_failed", async () => {
    const run = await runSellerSpriteCollection(input, (script) => defaultBrowserUseSpawn(script, 1_000, ((_: string, __: string[], ___: unknown) => {
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; kill: ReturnType<typeof vi.fn> };
      child.stdin = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
      return child;
    }) as never));
    expect(run).toMatchObject({ ok: false, failureReason: "collector_unavailable" });
    if (!run.ok) expect(run.detail).toContain("BROWSER_USE_CLI_PATH");
  });
});
});
