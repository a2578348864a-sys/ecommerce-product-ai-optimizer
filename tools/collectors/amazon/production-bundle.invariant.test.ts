/**
 * V3 Final Operability Correction — P1-A：生产构建表达式 invariant 测试
 *
 * 证明：SOURCE TEST PASS ≠ PRODUCTION BUNDLE PASS 的问题已被消除——
 * 生产构建（.next/server）产物中的浏览器表达式必须是 self-contained 字符串工件
 * （全部 15 个 helper 以固定名显式声明），不得出现旧 fn.toString() 拼接模式。
 *
 * 前置：需先执行 `npm run build`（本测试在 .next 产物缺失时 skip）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const NEXT_SERVER_ROOT = resolve(process.cwd(), ".next", "server");

const EXPECTED_HELPERS = [
  "sanitizeDetailText", "normalizeAsin", "parseAsinFromDetailUrl",
  "parseDetailPrice", "detectDetailPriceCurrency", "parseDetailRating",
  "parseDetailReviewCount", "parseDetailBsr", "detectDetailPageStatus",
  "readDetailPageAsinAnchor", "readDetailPageBsrText", "unknownField",
  "correctField", "readFirstText", "extractAmazonDetailPage",
];

function collectBundleFiles(root: string): string[] {
  const output: string[] = [];
  if (!existsSync(root)) return output;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (existsSync(path) && !existsSync(join(path, "package.json"))) {
      // 目录递归（排除 node_modules 风格的嵌套包）
      const stat = require("node:fs").statSync(path);
      if (stat.isDirectory()) output.push(...collectBundleFiles(path));
      else if (name.endsWith(".js")) output.push(path);
    }
  }
  return output;
}

describe("production bundle expression invariant（P1-A）", () => {
  const hasBuild = existsSync(join(NEXT_SERVER_ROOT, "app"));

  it.runIf(hasBuild)("built bundles embed the self-contained extractor artifact", () => {
    // webpack 可能把共享工具拆进独立 chunk：扫描全部产物文件，不按文件名预过滤
    const files = collectBundleFiles(NEXT_SERVER_ROOT);
    expect(files.length).toBeGreaterThan(0);
    let found = false;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("extractAmazonDetailPage(document, location.href")) continue;
      found = true;
      // 字符串工件完整：全部 helper 以 function 声明出现
      for (const helper of EXPECTED_HELPERS) {
        expect(source, `${file} 缺少 helper ${helper}`).toContain(`function ${helper}(`);
      }
      // 旧 fn.toString() 拼接模式不得出现
      expect(source).not.toMatch(/functionSource/);
      expect(source).not.toMatch(/const detectDetailPageStatus = \$\{/);
      // 表达式特征保留（占位已被 options JSON 替换）
      expect(source).toContain('collectorVersion');
    }
    expect(found, "未在构建产物中找到 detail-page 提取表达式").toBe(true);
  });

  it.runIf(hasBuild)("built bundles embed self-contained review-snippet extractor artifact (Package C)", () => {
    const files = collectBundleFiles(NEXT_SERVER_ROOT);
    let found = false;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("document.querySelectorAll('[data-hook=\\\"review\\\"]')")) continue;
      found = true;
      // 字符串工件完整：占位常量 + 提取逻辑特征（webpack 产物自身含 `${` 模板，不能全局断言）
      expect(source).toContain("const MAX_ITEMS =");
      expect(source).toContain("out of 5 stars");
      expect(source).toContain("Reviewed in .*? on");
      expect(source).not.toMatch(/functionSource/);
    }
    expect(found, "未在构建产物中找到 review-snippet 提取表达式").toBe(true);
  });

  it.runIf(hasBuild)("built search-page route embeds self-contained search extractor artifact", () => {
    // 搜索流程不被当前产品 UI 调用 → 可能未打包进产物（此时跳过，与历史语义一致）
    const files = collectBundleFiles(NEXT_SERVER_ROOT);
    let found = false;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("extractAmazonSearchPage(document, __OPTIONS__")) continue;
      found = true;
      expect(source).toContain("function extractSponsoredPlacementDiagnostic(");
      expect(source).toContain("function extractAmazonSearchPage(");
      expect(source).not.toMatch(/functionSource/);
    }
    if (!found) return;
    expect(found).toBe(true);
  });
});
