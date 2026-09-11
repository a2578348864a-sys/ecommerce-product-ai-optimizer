import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * 获取项目根目录。
 * 优先读取环境变量 PROJECT_ROOT，默认回退到 process.cwd()。
 */
export function getProjectRoot(): string {
  return resolve(process.env.PROJECT_ROOT || process.cwd());
}

/**
 * 获取 Smoke / 自动化测试的输出根目录。
 * 优先读取环境变量 SMOKE_OUTPUT_DIR，默认回退到 os.tmpdir()/qingxuan-smoke。
 */
export function getSmokeOutputDir(): string {
  return resolve(process.env.SMOKE_OUTPUT_DIR || join(tmpdir(), "qingxuan-smoke"));
}

/**
 * 获取环境配置文件路径。
 * 优先读取环境变量 ENV_FILE，默认回退到当前项目根目录下的 .env.local。
 */
export function getEnvFilePath(fallbackFileName = ".env.local"): string {
  if (process.env.ENV_FILE) {
    return resolve(process.env.ENV_FILE);
  }
  return join(getProjectRoot(), fallbackFileName);
}

/**
 * 获取系统 Chrome 可执行文件路径。
 * 优先读取环境变量 CHROME_BIN，次之 CHROME_PATH，Windows 下默认探测常用路径。
 */
export function getChromeExecutablePath(): string {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === "win32") {
    const defaultWin = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const defaultWinX86 = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
    if (existsSync(defaultWin)) return defaultWin;
    if (existsSync(defaultWinX86)) return defaultWinX86;
    return defaultWin;
  }
  return "google-chrome";
}

/**
 * 获取真实测试 PNG 图片源路径。
 * 优先读取环境变量 TEST_REAL_PNG_SOURCE，默认返回空字符串（指示未配置）。
 */
export function getRealPngSource(): string {
  return process.env.TEST_REAL_PNG_SOURCE || "";
}
