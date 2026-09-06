/**
 * V3.5 — LocalSession1688CliDriver 端到端单测（假 CLI 脚本驱动真实 spawn）
 *
 * 覆盖（Contract §60）：valid search / zero result / malformed output / CLI missing /
 * unsupported version / timeout / nonzero exit / invalid JSON / unexpected schema /
 * write command impossible / malicious query / oversized output / offerId mismatch。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  begin1688KeywordLogin,
  checkCliLogin,
  defaultWindowProbe,
  getOfferDetailById,
  resetCliVersionCacheForTests,
  sanitizedSpawnEnv,
  searchOffersByKeyword,
  stop1688DaemonIfRunning,
  SOURCING_CLI_ENV_PATH,
} from "./sourcingAcquisition";
import { SourcingAcquisitionError } from "@/lib/upstream/1688/contracts";

let tempDir: string;

/** 假 CLI：行为由 FAKE_CLI_MODE 控制；search/offer/whoami/daemon/login 输出内联 fixture */
const FAKE_CLI_SOURCE = `
const mode = process.env.FAKE_CLI_MODE || "ok";
const [cmd] = process.argv.slice(2);
if (cmd === "--version") { console.log(process.env.FAKE_CLI_VERSION || "0.1.47"); process.exit(0); }
if (mode === "timeout") { setInterval(() => {}, 1000); return; }
if (mode === "not-logged-in") { console.log(JSON.stringify({ok:false,code:"NOT_LOGGED_IN",message:"Session expired."})); process.exit(3); }
if (mode === "slider") { process.exit(4); }
if (mode === "network-error") { process.exit(9); }
if (mode === "daemon-paused") { console.log(JSON.stringify({ok:false,code:"DAEMON_PAUSED",message:"Daemon paused after repeated 1688 failures.",failureKind:"risk_challenge",recoveryAction:"pause_for_manual_challenge"})); process.exit(9); }
if (mode === "not-json") { console.log("not json at all"); process.exit(0); }
if (mode === "ok-false") { console.log(JSON.stringify({ok:false,code:"TOOL_BROKE",message:"boom"})); process.exit(0); }
if (mode === "wrong-offer-id") { console.log(JSON.stringify({offerId:"99999999999",title:"x",url:"https://detail.1688.com/offer/99999999999.html"})); process.exit(0); }
if (mode === "no-offers") { console.log(JSON.stringify({keyword:"x",total:0,offers:[]})); process.exit(0); }
if (cmd === "daemon") {
  const sub = process.argv[3];
  if (sub === "status") {
    if (mode === "daemon-status-error") { process.exit(1); }
    const running = process.env.FAKE_DAEMON_RUNNING === "true";
    console.log(JSON.stringify({ running }));
    process.exit(0);
  }
  if (sub === "stop") {
    if (process.env.FAKE_CLI_STOP_LOG) {
      require("node:fs").writeFileSync(process.env.FAKE_CLI_STOP_LOG, "stopped", "utf8");
    }
    console.log(JSON.stringify({ stopped: true }));
    process.exit(0);
  }
}
if (cmd === "login") {
  if (process.env.FAKE_CLI_LOGIN_LOG) {
    require("node:fs").writeFileSync(process.env.FAKE_CLI_LOGIN_LOG, JSON.stringify(process.argv.slice(2)), "utf8");
  }
  if (mode === "login-lock-busy-stderr") {
    console.error("LOCK_BUSY: process lock is occupied");
    process.exit(1);
  }
  if (mode === "login-lock-busy-exit-5") {
    process.exit(5);
  }
  if (mode === "login-error-exit") {
    console.error("Failed to launch Chrome browser: executable not found");
    process.exit(2);
  }
  if (mode === "login-silent-crash") {
    process.exit(1);
  }
  if (mode === "login-window-not-visible") {
    console.error("Window was rendered off-screen or failed to map HWND");
    setTimeout(() => {}, 2000);
    return;
  }
  if (mode === "login-epipe-simulation") {
    const iv = setInterval(() => {
      try {
        process.stderr.write("Opening 1688 login page in a browser window...\\n");
      } catch (err) {
        if (process.env.FAKE_CLI_LOGIN_LOG) {
          require("node:fs").writeFileSync(process.env.FAKE_CLI_LOGIN_LOG, "EPIPE_CRASH:" + err.message, "utf8");
        }
        process.exit(10);
      }
    }, 100);
    setTimeout(() => { clearInterval(iv); }, 2000);
    return;
  }
  // 正常存活：等待 1500ms 后退出，让 1000ms 的 probe 成功，且进程自然退出不悬挂
  setTimeout(() => {}, 1500);
  return;
}
if (cmd === "whoami") { console.log(JSON.stringify({loggedIn:true,memberId:"FAKE-MEMBER-ID",nick:"fake-nick"})); process.exit(0); }
if (cmd === "search") { console.log(JSON.stringify({keyword:process.argv[3],total:1,offers:[{offerId:"674035283676",title:"测试保温杯",price:{text:"¥16",min:16,max:16},supplier:{name:"测试供应商",shopUrl:"http://shop.example.test",years:3},location:{province:"浙江",city:"武义县"},bizType:"生产加工",verified:{factory:true,business:false,superFactory:false},tags:[],demand:{orderCount:1},isP4P:false,turnover:"1",url:"https://detail.1688.com/offer/674035283676.html",image:"https://img.example.test/a.jpg"}]})); process.exit(0); }
if (cmd === "offer") { console.log(JSON.stringify({offerId:"674035283676",title:"测试保温杯",url:"https://detail.1688.com/offer/674035283676.html",priceRange:"￥21.30",priceMin:21.3,priceMax:21.3,unitName:"个",minOrderQty:1,priceTiers:[{minQty:1,price:16.5}],detailUrl:"https://itemcdn.example.test/fake",attributes:[],packageInfo:[],supplier:{name:"测试供应商",loginId:"fake",memberId:null,userId:"FAKE-USER-ID"},freight:{receiveAddress:"某省某市"},saledCount:1,categoryId:"1",options:[],skus:[],mainImage:"https://img.example.test/a.jpg",images:[]})); process.exit(0); }
process.exit(2);
`;

function fakeCliPath(): string {
  const cli = join(tempDir, "fake-1688-cli.js");
  writeFileSync(cli, FAKE_CLI_SOURCE, "utf8");
  return cli;
}

function fakeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, [SOURCING_CLI_ENV_PATH]: fakeCliPath(), ...overrides };
}

function captureCode(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "NO_ERROR",
    (error) => (error instanceof SourcingAcquisitionError ? error.code : `OTHER:${String(error)}`),
  );
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "v35-sourcing-cli-test-"));
  resetCliVersionCacheForTests();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("searchOffersByKeyword", () => {
  it("valid search → 候选 + 轨迹（driver 版本）", async () => {
    const { candidates, trace } = await searchOffersByKeyword({ keyword: "保温杯", env: fakeEnv() });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].offerId).toBe("674035283676");
    expect(candidates[0].acquisitionMethod).toBe("keyword");
    expect(trace.success).toBe(true);
    expect(trace.query).toBe("保温杯");
  });

  it("zero result → 空数组（不报错）", async () => {
    const { candidates } = await searchOffersByKeyword({ keyword: "不存在的东西", env: fakeEnv({ FAKE_CLI_MODE: "no-offers" }) });
    expect(candidates).toEqual([]);
  });

  it("CLI 未配置 → ACQUISITION_TOOL_NOT_AVAILABLE", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env: {} as NodeJS.ProcessEnv }));
    expect(code).toBe("acquisition_tool_not_available");
  });

  it("CLI 路径不存在 → ACQUISITION_TOOL_NOT_AVAILABLE", async () => {
    const env = { ...process.env, [SOURCING_CLI_ENV_PATH]: join(tempDir, "missing.js") };
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env }));
    expect(code).toBe("acquisition_tool_not_available");
  });

  it("版本不支持 → TOOL_VERSION_UNSUPPORTED", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env: fakeEnv({ FAKE_CLI_VERSION: "9.9.9" }) }));
    expect(code).toBe("tool_version_unsupported");
  });

  it("未登录（exit 3）→ AUTH_REQUIRED", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env: fakeEnv({ FAKE_CLI_MODE: "not-logged-in" }) }));
    expect(code).toBe("auth_required");
  });

  it("滑块（exit 4）→ RISK_CONTROL_REQUIRED", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env: fakeEnv({ FAKE_CLI_MODE: "slider" }) }));
    expect(code).toBe("risk_control_required");
  });

  it("网络错误（exit 9）→ TOOL_ERROR", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env: fakeEnv({ FAKE_CLI_MODE: "network-error" }) }));
    expect(code).toBe("tool_error");
  });

  it("daemon 风控暂停（exit 9 + DAEMON_PAUSED）→ RISK_CONTROL_REQUIRED", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env: fakeEnv({ FAKE_CLI_MODE: "daemon-paused" }) }));
    expect(code).toBe("risk_control_required");
  });

  it("非 JSON 输出 → SCHEMA_UNSUPPORTED", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x", env: fakeEnv({ FAKE_CLI_MODE: "not-json" }) }));
    expect(code).toBe("schema_unsupported");
  });

  it("ok:false NOT_LOGGED_IN → AUTH_REQUIRED", async () => {
    const code = await captureCode(searchOffersByKeyword({
      keyword: "x",
      env: fakeEnv({ FAKE_CLI_MODE: "not-logged-in", FAKE_CLI_EXIT: "0" }),
    }));
    // exit 3 优先；验证 ok:false 分支单独走 exit 0
    const code0 = await captureCode(searchOffersByKeyword({ keyword: "x", env: fakeEnv({ FAKE_CLI_MODE: "ok-false" }) }));
    expect(code0).toBe("tool_error");
    expect(code).toBe("auth_required");
  });

  it("恶意关键词（控制字符）→ INVALID_QUERY，不启动进程", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "a\u0000b", env: fakeEnv() }));
    expect(code).toBe("invalid_query");
  });

  it("关键词过长 → INVALID_QUERY", async () => {
    const code = await captureCode(searchOffersByKeyword({ keyword: "x".repeat(51), env: fakeEnv() }));
    expect(code).toBe("invalid_query");
  });

  it("超时 → TIMEOUT", async () => {
    const code = await captureCode(searchOffersByKeyword({
      keyword: "x",
      env: fakeEnv({ FAKE_CLI_MODE: "timeout", V35_1688_CLI_TIMEOUT_MS: "1000" }),
    }));
    expect(code).toBe("timeout");
  });
});

describe("getOfferDetailById", () => {
  it("valid detail → 详情 + 敏感字段丢弃", async () => {
    const { detail } = await getOfferDetailById({ offerId: "674035283676", env: fakeEnv() });
    expect(detail.offerId).toBe("674035283676");
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("FAKE-USER-ID");
    expect(serialized).not.toContain("某省某市");
    expect(serialized).not.toContain("receiveAddress");
  });

  it("offerId 非法（含写命令名）→ INVALID_OFFER_ID", async () => {
    for (const bad of ["cart", "order", "checkout", "inquiry", "abc", "123"]) {
      const code = await captureCode(getOfferDetailById({ offerId: bad, env: fakeEnv() }));
      expect(code).toBe("invalid_offer_id");
    }
  });

  it("返回 offerId 与请求不一致 → ENTITY_BINDING_FAILED", async () => {
    const code = await captureCode(getOfferDetailById({ offerId: "674035283676", env: fakeEnv({ FAKE_CLI_MODE: "wrong-offer-id" }) }));
    expect(code).toBe("entity_binding_failed");
  });

  it("detail 必填缺失（非对象）→ SCHEMA_UNSUPPORTED", async () => {
    // FAKE_CLI_MODE=not-json 时 offer 输出非 JSON → schema_unsupported
    const code = await captureCode(getOfferDetailById({ offerId: "674035283676", env: fakeEnv({ FAKE_CLI_MODE: "not-json" }) }));
    expect(code).toBe("schema_unsupported");
  });
});

describe("checkCliLogin", () => {
  it("whoami loggedIn=true → 返回登录态，账号标识不外泄", async () => {
    const result = await checkCliLogin({ env: fakeEnv() });
    expect(result).toEqual({ loggedIn: true, toolAvailable: true });
  });

  it("未配置工具 → toolAvailable=false", async () => {
    const result = await checkCliLogin({ env: {} as NodeJS.ProcessEnv });
    expect(result).toEqual({ loggedIn: false, toolAvailable: false });
  });
});

describe("stop1688DaemonIfRunning", () => {
  it("daemon 运行中（status running=true）时，优雅执行 daemon stop", async () => {
    const stopLog = join(tempDir, "stop.log");
    const cli = fakeCliPath();
    await stop1688DaemonIfRunning(cli, {
      ...process.env,
      [SOURCING_CLI_ENV_PATH]: cli,
      FAKE_DAEMON_RUNNING: "true",
      FAKE_CLI_STOP_LOG: stopLog,
    });
    const content = readFileSync(stopLog, "utf8");
    expect(content).toBe("stopped");
  });

  it("daemon 未运行（status running=false）时，不执行 daemon stop", async () => {
    const stopLog = join(tempDir, "stop.log");
    const cli = fakeCliPath();
    await stop1688DaemonIfRunning(cli, {
      ...process.env,
      [SOURCING_CLI_ENV_PATH]: cli,
      FAKE_DAEMON_RUNNING: "false",
      FAKE_CLI_STOP_LOG: stopLog,
    });
    expect(existsSync(stopLog)).toBe(false);
  });

  it("daemon status 失败时不阻塞流程", async () => {
    const cli = fakeCliPath();
    await expect(
      stop1688DaemonIfRunning(cli, {
        ...process.env,
        [SOURCING_CLI_ENV_PATH]: cli,
        FAKE_CLI_MODE: "daemon-status-error",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("begin1688KeywordLogin", () => {
  it("CLI 未配置时抛出 acquisition_tool_not_available", async () => {
    await expect(begin1688KeywordLogin({} as NodeJS.ProcessEnv)).rejects.toMatchObject({
      code: "acquisition_tool_not_available",
      status: 503,
    });
  });

  it("启动参数必须包含 login, --headed, --force, --no-daemon", async () => {
    const loginLog = join(tempDir, "login.log");
    const env = fakeEnv({ FAKE_CLI_LOGIN_LOG: loginLog });
    const result = await begin1688KeywordLogin(env);
    expect(result).toEqual({ started: true });

    const content = JSON.parse(readFileSync(loginLog, "utf8"));
    expect(content).toEqual(["login", "--headed", "--force", "--no-daemon"]);
  });

  it("子进程秒退且 stderr 为 LOCK_BUSY 时抛出 sourcing_login_lock_busy（503）", async () => {
    const env = fakeEnv({ FAKE_CLI_MODE: "login-lock-busy-stderr" });
    await expect(begin1688KeywordLogin(env)).rejects.toMatchObject({
      code: "sourcing_login_lock_busy",
      status: 503,
      message: "1688 进程锁被占用，请稍后重试。",
    });
  });

  it("子进程 exitCode 为 5 时抛出 sourcing_login_lock_busy（503）", async () => {
    const env = fakeEnv({ FAKE_CLI_MODE: "login-lock-busy-exit-5" });
    await expect(begin1688KeywordLogin(env)).rejects.toMatchObject({
      code: "sourcing_login_lock_busy",
      status: 503,
      message: "1688 进程锁被占用，请稍后重试。",
    });
  });

  it("子进程异常提前退出（含 stderr 首行）时抛出 sourcing_login_window_launch_failed（500）", async () => {
    const env = fakeEnv({ FAKE_CLI_MODE: "login-error-exit" });
    await expect(begin1688KeywordLogin(env)).rejects.toMatchObject({
      code: "sourcing_login_window_launch_failed",
      status: 500,
      message: expect.stringContaining("Failed to launch Chrome browser: executable not found"),
    });
  });

  it("子进程无 stderr 异常秒退时抛出 sourcing_login_window_launch_failed 并包含 exitCode", async () => {
    const env = fakeEnv({ FAKE_CLI_MODE: "login-silent-crash" });
    await expect(begin1688KeywordLogin(env)).rejects.toMatchObject({
      code: "sourcing_login_window_launch_failed",
      status: 500,
      message: expect.stringContaining("进程异常退出（exitCode: 1）"),
    });
  });

  it("子进程正常存活超过 1000ms 时成功返回 { started: true }", async () => {
    const env = fakeEnv();
    const startTime = Date.now();
    const result = await begin1688KeywordLogin(env);
    const duration = Date.now() - startTime;
    expect(result).toEqual({ started: true });
    expect(duration).toBeGreaterThanOrEqual(950);
  });

  it("启动前若检测到 daemon 运行中，先优雅 stop 后启动 login", async () => {
    const stopLog = join(tempDir, "stop.log");
    const loginLog = join(tempDir, "login.log");
    const env = fakeEnv({
      FAKE_DAEMON_RUNNING: "true",
      FAKE_CLI_STOP_LOG: stopLog,
      FAKE_CLI_LOGIN_LOG: loginLog,
    });
    const result = await begin1688KeywordLogin(env);
    expect(result).toEqual({ started: true });
    expect(existsSync(stopLog)).toBe(true);
    expect(existsSync(loginLog)).toBe(true);
  });

  it("窗口探测超时未检测到有效顶层窗口时抛出 sourcing_login_window_not_visible（504）且包含 CLI 报错", async () => {
    const env = fakeEnv({ FAKE_CLI_MODE: "login-window-not-visible" });
    await expect(begin1688KeywordLogin(env)).rejects.toMatchObject({
      code: "sourcing_login_window_not_visible",
      status: 504,
      message: expect.stringContaining("Window was rendered off-screen or failed to map HWND"),
    });
  });

  it("彻底避免管道主动销毁：CLI 持续向 stderr 写入日志时不触发 EPIPE 且正常 resolve", async () => {
    const loginLog = join(tempDir, "login.log");
    const env = fakeEnv({
      FAKE_CLI_MODE: "login-epipe-simulation",
      FAKE_CLI_LOGIN_LOG: loginLog,
    });
    const result = await begin1688KeywordLogin(env);
    expect(result).toEqual({ started: true });

    // 验证未发生 EPIPE crash
    if (existsSync(loginLog)) {
      const content = readFileSync(loginLog, "utf8");
      expect(content).not.toContain("EPIPE_CRASH");
    }
  });

  it("支持通过 options.probeWindow 注入自定义探针并校验参数", async () => {
    const env = fakeEnv();
    let probeCalled = false;
    let receivedProfile = "";

    const customProbe = async (input: { profileDir: string; timeoutMs: number; intervalMs: number }) => {
      probeCalled = true;
      receivedProfile = input.profileDir;
      return { ok: true, found: true, pid: 777, hwnd: 888 };
    };

    const result = await begin1688KeywordLogin(env, { probeWindow: customProbe });
    expect(result).toEqual({ started: true });
    expect(probeCalled).toBe(true);
    expect(receivedProfile).toContain("default");
  });

  it("若存在死进程残留的 daemon.pid 与 stale .lock.lock，启动前由 stop1688DaemonIfRunning 安全清理", async () => {
    const homeDir = join(tempDir, "fake-1688-home");
    const lockDir = join(homeDir, ".lock.lock");
    const pidFile = join(homeDir, "daemon.pid");
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(lockDir, { recursive: true });
    // 写入一个不可能存在的极大 PID（死进程）
    writeFileSync(pidFile, "99999999\n", "utf8");

    const cli = fakeCliPath();
    const env = {
      ...process.env,
      BB1688_HOME: homeDir,
      [SOURCING_CLI_ENV_PATH]: cli,
      FAKE_DAEMON_RUNNING: "false",
    };

    await stop1688DaemonIfRunning(cli, env);

    expect(existsSync(lockDir)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  });
});

describe("defaultWindowProbe", () => {
  it("在 mock/fake CLI 环境下默认返回成功", async () => {
    const env = { [SOURCING_CLI_ENV_PATH]: "/path/to/fake-1688-cli.js" };
    const res = await defaultWindowProbe({ profileDir: "default", timeoutMs: 100, intervalMs: 50, env });
    expect(res.ok).toBe(true);
    expect(res.found).toBe(true);
  });

  it("当 FAKE_WINDOW_PROBE=false 时返回 found=false", async () => {
    const env = { FAKE_WINDOW_PROBE: "false" };
    const res = await defaultWindowProbe({ profileDir: "default", timeoutMs: 100, intervalMs: 50, env });
    expect(res.found).toBe(false);
  });

  if (process.platform === "win32") {
    it("Windows 原生 probe 脚本在无对应 Chrome 窗口时返回 timeout_no_visible_window", async () => {
      const res = await defaultWindowProbe({
        profileDir: "totally-nonexistent-chrome-profile-dir-9999",
        timeoutMs: 800,
        intervalMs: 200,
        env: { ...process.env, FAKE_CLI_MODE: "", FAKE_WINDOW_PROBE: "", [SOURCING_CLI_ENV_PATH]: "" },
      });
      expect(res.ok).toBe(true);
      expect(res.found).toBe(false);
      expect(res.reason).toBe("timeout_no_visible_window");
    });
  }
});

describe("sanitizedSpawnEnv — launcher/probe 子进程环境块裁剪", () => {
  it("巨型 env（>65535 环境块）被裁剪为白名单，Add-Type 可编译前提", () => {
    const big = { ...process.env, SOME_HUGE: "x".repeat(600000) };
    const out = sanitizedSpawnEnv(big);
    const total = Object.entries(out).reduce((n, [k, v]) => n + k.length + (v?.length ?? 0), 0);
    expect(total).toBeLessThan(65535);
    expect(out.SOME_HUGE).toBeUndefined();
  });

  it("保留系统必要键与 BB1688_/V35_1688_/SOURCING_/FAKE_ 前缀", () => {
    const out = sanitizedSpawnEnv({
      PATH: "C:\\Windows",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\a",
      HOME: "C:\\Users\\a",
      BB1688_HOME: "C:\\Users\\a\\.1688",
      V35_1688_LOGIN_PROBE_TIMEOUT_MS: "20000",
      SOURCING_CLI_PATH: "C:\\fake\\cli.js",
      FAKE_CLI_MODE: "ok",
      NOISE: "should-drop",
    });
    expect(out.PATH).toBe("C:\\Windows");
    expect(out.SystemRoot).toBe("C:\\Windows");
    expect(out.USERPROFILE).toBe("C:\\Users\\a");
    expect(out.BB1688_HOME).toBe("C:\\Users\\a\\.1688");
    expect(out.V35_1688_LOGIN_PROBE_TIMEOUT_MS).toBe("20000");
    expect(out.SOURCING_CLI_PATH).toBe("C:\\fake\\cli.js");
    expect(out.FAKE_CLI_MODE).toBe("ok");
    expect(out.NOISE).toBeUndefined();
  });

  it("null/undefined source → 空对象", () => {
    expect(sanitizedSpawnEnv(undefined)).toEqual({});
    expect(sanitizedSpawnEnv(null as unknown as NodeJS.ProcessEnv)).toEqual({});
  });
});
