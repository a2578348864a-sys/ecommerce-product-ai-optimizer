#!/usr/bin/env node
/**
 * 外部项目材料集成测试运行器。
 *
 * 这些测试读取项目父目录的 `06_测试与验证/` 材料（Stage 1/2 验证记录），
 * 不属于普通单元测试运行条件，默认 `npm test` 不执行。
 *
 * 前置条件：项目材料根存在（仓库父目录含 frozen-validation-manifest）。
 * 缺失时明确提示，不静默跳过。
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { PROJECT_MATERIALS_TEST_FILES } from "../vitest.project-materials.files.ts";

const materialsRoot = resolve(process.cwd(), "..");
const manifestMarker = resolve(materialsRoot, "frozen-validation-manifest.v1.json");

if (!existsSync(manifestMarker)) {
  console.error(
    `[test:project-materials] 未找到项目材料根：${materialsRoot}\n` +
      "这些测试依赖仓库父目录的 06_测试与验证/ 外部材料，无法在干净 clone 中运行。\n" +
      "请在有项目材料的机器上执行，或忽略此错误（不影响默认 npm test）。",
  );
  process.exit(1);
}

console.log(`[test:project-materials] 材料根存在：${materialsRoot}`);
const files = PROJECT_MATERIALS_TEST_FILES.join(" ");
execSync(`npx vitest run ${files}`, {
  stdio: "inherit",
});
