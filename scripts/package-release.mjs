/**
 * Release artifact packager（部署收口）
 *
 * 将 .next 生产构建打包为自包含 artifact：
 * - 跟随 symlink（--dereference）打包 .next/node_modules，确保 turbopack
 *   hashed external modules（@prisma/client-*、sharp-*）内容完整；
 * - 生成 manifest.json（BUILD_ID、大小、文件数、external modules 清单）；
 * - 打包后本地校验：BUILD_ID 一致 + external modules 存在。
 *
 * 用法：node scripts/package-release.mjs [--out <dir>]
 * 输出：release/next-v<version>-<short-sha>-linux-x64.tar.gz + release-manifest.json
 *
 * 服务器侧解压后校验脚本见 docs/deployment/production-runbook.md。
 */

import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** git bash 的 tar 不识别 D:\ 前缀，转换为 /d/ 风格 */
function unixPath(p) {
  const norm = p.replaceAll("\\", "/");
  const m = norm.match(/^([A-Za-z]):\/(.*)$/);
  return m ? `/${m[1].toLowerCase()}/${m[2]}` : norm;
}
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_DIR = join(ROOT, ".next");
const OUT_DIR = resolve(process.argv[2] === "--out" ? process.argv[3] : join(ROOT, "release"));

const EXTRA_EXCLUDES = [
  ".next/cache",
  ".next/dev",
];

const TAR_EXCLUDES = ["./cache", "./dev"].map((p) => `--exclude=.next${p.slice(1)}`);

function mustRun(command, args) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function shortSha() {
  return mustRun("git", ["rev-parse", "--short", "HEAD"]);
}

function version() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return pkg.version;
}

/** 收集 .next/node_modules 下 hashed external modules 名（真实目录或 symlink 名） */
function collectExternalModules() {
  const nm = join(NEXT_DIR, "node_modules");
  if (!existsSync(nm)) return [];
  const out = [];
  for (const top of readdirSync(nm)) {
    const topPath = join(nm, top);
    if (/^(client|sharp)-[a-f0-9]+$/.test(top)) {
      out.push(top);
      continue;
    }
    if (lstatSync(topPath).isDirectory()) {
      for (const sub of readdirSync(topPath)) {
        if (/^(client|sharp)-[a-f0-9]+$/.test(sub)) out.push(`${top}/${sub}`);
      }
    }
  }
  return out.sort();
}

/**
 * 实体化 symlink：git bash tar 的 --dereference 无法跟随 `\\?\` 前缀的
 * Windows symlink（如 .next/node_modules/sharp-*），导致内容丢失。
 * 用 Node cpSync(dereference:true) 把 symlink 复制为真实目录后再打包。
 */
function materializeSymlinks() {
  const nm = join(NEXT_DIR, "node_modules");
  if (!existsSync(nm)) return [];
  const fixed = [];
  for (const top of readdirSync(nm)) {
    const topPath = join(nm, top);
    if (lstatSync(topPath).isDirectory()) {
      for (const sub of readdirSync(topPath)) {
        const subPath = join(topPath, sub);
        if (/^(client|sharp)-[a-f0-9]+$/.test(sub) && lstatSync(subPath).isSymbolicLink()) {
          const tmp = `${subPath}.materialized`;
          rmSync(tmp, { recursive: true, force: true });
          cpSync(subPath, tmp, { recursive: true, dereference: true });
          rmSync(subPath, { force: true });
          cpSync(tmp, subPath, { recursive: true });
          rmSync(tmp, { recursive: true, force: true });
          fixed.push(`${top}/${sub}`);
        }
      }
    } else if (lstatSync(topPath).isSymbolicLink() && /^(client|sharp)-[a-f0-9]+$/.test(top)) {
      const tmp = `${topPath}.materialized`;
      rmSync(tmp, { recursive: true, force: true });
      cpSync(topPath, tmp, { recursive: true, dereference: true });
      rmSync(topPath, { force: true });
      cpSync(tmp, topPath, { recursive: true });
      rmSync(tmp, { recursive: true, force: true });
      fixed.push(top);
    }
  }
  return fixed;
}

/** 打包：tar --dereference 跟随 symlink，确保 external modules 内容入包 */
function pack(outFile, excludes) {
  mkdirSync(dirname(outFile), { recursive: true });
  const args = [
    "-czf", outFile,
    "--dereference",
    ...excludes,
    "--exclude=./node_modules", "--exclude=./.git", "--exclude=*.log",
    "-C", ROOT, ".next",
  ];
  mustRun("tar", args);
}

function fileSize(p) {
  return statSync(p).size;
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/** 打包后校验：BUILD_ID 一致 + external modules 目录存在 */
function verifyArtifact(outFile, buildId, modules) {
  const list = mustRun("tar", ["-tzf", outFile]);
  if (!list.includes(".next/BUILD_ID")) throw new Error("artifact missing .next/BUILD_ID");
  for (const mod of modules) {
    const marker = `.next/node_modules/${mod}/package.json`;
    if (!list.includes(marker)) throw new Error(`artifact missing external module: ${mod}`);
  }
  // BUILD_ID 内容校验（从 tar 中读取；解包目录与 artifact 同处 ASCII 工作目录）
  const tmpDir = join(dirname(outFile), ".verify-tmp");
  mkdirSync(tmpDir, { recursive: true });
  mustRun("tar", ["-xzf", outFile, "-C", tmpDir, ".next/BUILD_ID"]);
  const packedBuildId = readFileSync(join(tmpDir, ".next", "BUILD_ID"), "utf8").trim();
  if (packedBuildId !== buildId) throw new Error(`BUILD_ID mismatch: packed=${packedBuildId} expected=${buildId}`);
  rmSync(tmpDir, { recursive: true, force: true });
}

const buildId = readFileSync(join(NEXT_DIR, "BUILD_ID"), "utf8").trim();
const materialized = materializeSymlinks();
const modules = collectExternalModules();
if (modules.length === 0) {
  console.error("WARN: no hashed external modules found under .next/node_modules");
}
if (materialized.length > 0) {
  console.log(`materialized symlinks: ${materialized.join(", ")}`);
}

// Windows 中文路径兼容：tar（bsdtar）经 Node execFileSync 传参时无法打开含非
// ASCII 字符的输出文件（路径编码损坏）。artifact 先在 ASCII 临时目录打包并校验，
// 完成后用 Node fs（UTF-16 原生 API，无编码问题）复制到最终输出目录。
const artifactName = `next-v${version()}-${shortSha()}-linux-x64.tar.gz`;
const finalArtifact = join(OUT_DIR, artifactName);
const workDir = mkdtempSync(join(tmpdir(), "release-pack-"));
const artifact = join(workDir, artifactName);
try {
  pack(artifact, TAR_EXCLUDES);
  verifyArtifact(artifact, buildId, modules);
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(artifact, finalArtifact);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const manifest = {
  schema: "release-artifact.v1",
  version: version(),
  commit: shortSha(),
  buildId,
  artifact: finalArtifact,
  artifactSizeBytes: fileSize(finalArtifact),
  artifactSha256: sha256File(finalArtifact),
  externalModules: modules,
  packedAt: new Date().toISOString(),
};
const manifestPath = join(OUT_DIR, "release-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
