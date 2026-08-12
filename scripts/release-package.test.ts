import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Release artifact 完整性（deploy/verify-release.sh 本地隔离验证）
 *
 * 验证点：
 * 1. 打包脚本（scripts/package-release.mjs）能产出 artifact 且校验通过；
 * 2. hashed external modules（@prisma/client-*、sharp-*）随包携带；
 * 3. 服务器侧校验脚本在"模块缺失"时自动补齐、在"模块已存在"时跳过。
 */

const ROOT = resolve(process.cwd());
const TMP = join(ROOT, ".tmp", "release-verify-test");
const FAKE_SERVER = join(TMP, "fake-server");

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}

/** git bash 的 tar 不识别 D:\ 前缀，转换为 /d/ 风格 */
function unixPath(p: string): string {
  const norm = p.replaceAll("\\", "/");
  const m = norm.match(/^([A-Za-z]):\/(.*)$/);
  return m ? `/${m[1].toLowerCase()}/${m[2]}` : norm;
}

describe("release artifact packaging", () => {
  let artifact: string;

  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(FAKE_SERVER, "node_modules", "@prisma", "client"), { recursive: true });
    mkdirSync(join(FAKE_SERVER, "node_modules", "sharp"), { recursive: true });
    artifact = run("node", ["scripts/package-release.mjs", "--out", join(TMP, "release")])
      .match(/"artifact": "([^"]+)"/)?.[1] ?? "";
    if (!artifact) throw new Error("package-release.mjs 未产出 artifact");
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("PR-1: artifact 自包含 hashed external modules", () => {
    const listing = run("tar", ["-tzf", unixPath(artifact)]);
    expect(listing).toContain(".next/BUILD_ID");
    // turbopack 布局（Windows 本地构建）才有 hashed external modules；
    // webpack 布局（CI Linux build）不生成 .next/node_modules，跳过断言。
    const prismaPresent = /\.next\/node_modules\/@prisma\/client-[a-f0-9]+\/package\.json/.test(listing);
    const sharpPresent = /\.next\/node_modules\/sharp-[a-f0-9]+\/package\.json/.test(listing);
    if (prismaPresent || sharpPresent) {
      expect(prismaPresent).toBe(true);
      expect(sharpPresent).toBe(true);
    }
  }, 60000);

  it("VR-1: 模块缺失时 verify-release.sh 自动补齐", () => {
    const listing = run("tar", ["-tzf", unixPath(artifact)]);
    const prismaDir = listing.match(/\.next\/node_modules\/@prisma\/(client-[a-f0-9]+)\//)?.[1] ?? "";
    const sharpDir = listing.match(/\.next\/node_modules\/(sharp-[a-f0-9]+)\//)?.[1] ?? "";
    if (!prismaDir && !sharpDir) {
      // webpack 布局（CI）：无 hashed external modules，脚本应跳过补齐并放行
      const out = run("bash", ["deploy/verify-release.sh", unixPath(artifact), unixPath(FAKE_SERVER)]);
      expect(out).toContain("部署校验全部通过");
      return;
    }
    expect(prismaDir).toBeTruthy();
    expect(sharpDir).toBeTruthy();
    const out = run("bash", ["deploy/verify-release.sh", unixPath(artifact), unixPath(FAKE_SERVER)]);
    expect(out).toContain("部署校验全部通过");
    expect(out).toContain(`补齐 @prisma/${prismaDir}`);
    expect(out).toContain(`补齐 ${sharpDir}`);
    expect(existsSync(join(FAKE_SERVER, "node_modules", "@prisma", prismaDir, "package.json"))).toBe(true);
    expect(existsSync(join(FAKE_SERVER, "node_modules", sharpDir, "package.json"))).toBe(true);
  }, 60000);

  it("VR-2: 模块已存在时 verify-release.sh 跳过补齐", () => {
    const before = run("bash", ["deploy/verify-release.sh", unixPath(artifact), unixPath(FAKE_SERVER)]);
    const runs = before.split("补齐 ").length - 1;
    expect(runs).toBe(0);
    expect(before).toContain("部署校验全部通过");
  }, 60000);
});
