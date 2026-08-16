/**
 * V3 Final R10 — 本地 1688 采集工具自动发现（限定目录，§155/§156）
 *
 * - env 显式配置优先（discovered=false）
 * - 未配置时只在限定目录发现（~/.1688/cli/dist/cli.js、<cwd>/tools/1688-cli/dist/cli.js）
 * - 找不到 → not_configured（用户层 = "组件尚未准备完成"，绝不提示"去登录"）
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];

function makeCliAt(dir: string): string {
  mkdirSync(join(dir, "dist"), { recursive: true });
  const cliPath = join(dir, "dist", "cli.js");
  writeFileSync(cliPath, "#!/usr/bin/env node\nconsole.log('1688-cli');\n");
  return cliPath;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("discoverCliPath / getCliToolStatus（自动发现）", () => {
  it("env 未配置 + ~/.1688/cli 存在 → available:true（discovered）", async () => {
    const home = mkdtempSync(join(tmpdir(), "v35-cli-home-"));
    dirs.push(home);
    makeCliAt(join(home, ".1688", "cli"));
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "v35-cli-cwd-")));
    dirs.push(process.cwd());

    const mod = await import("./sourcingAcquisition");
    const env: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: home };
    delete env.V35_1688_CLI_PATH;
    const status = mod.getCliToolStatus(env);
    expect(status).toMatchObject({ available: true, discovered: true });
    expect(status.available && status.cliPath.endsWith("cli.js")).toBe(true);
  });

  it("env 未配置 + 项目 tools/1688-cli 存在 → available:true（discovered）", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "v35-cli-cwd-"));
    dirs.push(cwd);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    makeCliAt(join(cwd, "tools", "1688-cli"));

    const mod = await import("./sourcingAcquisition");
    const status = mod.getCliToolStatus({ ...process.env, USERPROFILE: mkdtempSync(join(tmpdir(), "v35-empty-home-")) });
    expect(status).toMatchObject({ available: true, discovered: true });
  });

  it("env 未配置 + 限定目录都不存在 → not_configured（用户层 = 组件尚未安装）", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "v35-cli-cwd-"));
    dirs.push(cwd);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const home = mkdtempSync(join(tmpdir(), "v35-empty-home-"));
    dirs.push(home);

    const mod = await import("./sourcingAcquisition");
    const status = mod.getCliToolStatus({ ...process.env, USERPROFILE: home });
    expect(status).toEqual({ available: false, reason: "not_configured" });
  });

  it("env 显式配置存在 → available:true（discovered=false，显式优先）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "v35-cli-explicit-"));
    dirs.push(dir);
    const cliPath = makeCliAt(dir);

    const mod = await import("./sourcingAcquisition");
    const status = mod.getCliToolStatus({ ...process.env, V35_1688_CLI_PATH: cliPath });
    expect(status).toMatchObject({ available: true, cliPath, discovered: false });
  });

  it("env 显式配置但文件不存在 → not_found", async () => {
    const mod = await import("./sourcingAcquisition");
    const status = mod.getCliToolStatus({ ...process.env, V35_1688_CLI_PATH: "C:\\nonexistent\\cli.js" });
    expect(status).toMatchObject({ available: false, reason: "not_found" });
  });

  it("resolveCliPath：env 显式优先，其次自动发现", async () => {
    const home = mkdtempSync(join(tmpdir(), "v35-cli-home-"));
    dirs.push(home);
    const discoveredPath = makeCliAt(join(home, ".1688", "cli"));

    const mod = await import("./sourcingAcquisition");
    expect(mod.resolveCliPath({ ...process.env, USERPROFILE: home })).toBe(discoveredPath);
    expect(mod.resolveCliPath({ ...process.env, USERPROFILE: home, V35_1688_CLI_PATH: "C:\\explicit\\cli.js" })).toBe("C:\\explicit\\cli.js");
    expect(mod.resolveCliPath({ ...process.env, USERPROFILE: mkdtempSync(join(tmpdir(), "v35-empty2-")) })).toBeNull();
  });
});
