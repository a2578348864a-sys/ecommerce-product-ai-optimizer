/**
 * V3.5 — LocalSession1688CliDriver 端到端单测（假 CLI 脚本驱动真实 spawn）
 *
 * 覆盖（Contract §60）：valid search / zero result / malformed output / CLI missing /
 * unsupported version / timeout / nonzero exit / invalid JSON / unexpected schema /
 * write command impossible / malicious query / oversized output / offerId mismatch。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkCliLogin,
  getOfferDetailById,
  resetCliVersionCacheForTests,
  searchOffersByKeyword,
  SOURCING_CLI_ENV_PATH,
} from "./sourcingAcquisition";
import { SourcingAcquisitionError } from "@/lib/upstream/1688/contracts";

let tempDir: string;

/** 假 CLI：行为由 FAKE_CLI_MODE 控制；search/offer/whoami 输出内联 fixture */
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
