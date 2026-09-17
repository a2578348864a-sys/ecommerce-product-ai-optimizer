/**
 * V3.5 — Extension 源码 invariant 审计（R1 replay 工程化；§37）
 *
 * 锁定 R1 已实证的关键机制（确定性断言，防回归）：
 * - composed:true 事件（closed shadow 穿透）
 * - chrome.dom.openOrClosedShadowRoot（Level 1 resolver）
 * - data-renderkey offerId 提取（sanitized fixture 格式）
 * - §38 结果页守卫（拒绝推荐流）
 * - action allowlist（无任意执行）
 * - 零 eval / 零 cookies / 零 debugger
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTENT_PATH = resolve(process.cwd(), "extensions", "qingxuan-1688-helper", "content.js");
const SW_PATH = resolve(process.cwd(), "extensions", "qingxuan-1688-helper", "service-worker.js");

function readContent(): string {
  return readFileSync(CONTENT_PATH, "utf8");
}

describe("content.js 关键机制 invariant（R1 实证锁定）", () => {
  it("composed:true 事件（closed shadow 穿透，R1 关键发现）", () => {
    expect(readContent()).toContain("composed: true");
    expect(readContent()).toContain("MouseEvent");
  });

  it("chrome.dom.openOrClosedShadowRoot（Level 1 resolver）", () => {
    const source = readContent();
    expect(source).toContain("openOrClosedShadowRoot");
    expect(source).toContain("chrome.dom");
  });

  it("data-renderkey offerId 提取（sanitized fixture 格式锁定）", () => {
    const source = readContent();
    expect(source).toContain("data-renderkey");
    expect(source).toContain("renderKey");
    expect(source).toContain("\\d{5,20}");
  });

  it("data-renderkey fixture 格式（sanitized）能被提取正则匹配", () => {
    // 与 content.js 一致的提取语义（sanitized 样本）
    const renderKey = "1_0_normal_b2b-222211767994770d47_1036420364519";
    const match = renderKey.match(/_(\d{5,20})$/);
    expect(match?.[1]).toBe("1036420364519");
    // malformed 拒绝
    expect("no_numbers".match(/_(\d{5,20})$/)).toBeNull();
    expect("_123".match(/_(\d{5,20})$/)).toBeNull();
  });

  it("§38 结果页守卫（拒绝推荐流）", () => {
    const source = readContent();
    expect(source).toContain("not_result_page");
    expect(source).toContain("resultsReady");
  });

  it("action allowlist（getState/upload/submit/collect；无任意执行）", () => {
    const source = readContent();
    expect(source).toContain('"getState"');
    expect(source).toContain('"upload"');
    expect(source).toContain('"submit"');
    expect(source).toContain('"collect"');
    expect(source).toContain("unknown_action");
  });

  it("零 eval / 零 cookies / 零 debugger / 零 fetch（页面上下文）", () => {
    const source = readContent();
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toContain("chrome.cookies");
    expect(source).not.toContain("chrome.debugger");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("resolver 版本化（upload v3 + submit v2 + extractor v2）", () => {
    const source = readContent();
    expect(source).toContain("native-1688-upload-resolver.v3");
    expect(source).toContain("native-1688-image-submit-resolver.v2");
    expect(source).toContain("native-1688-result-extractor.v2");
  });
});

describe("service-worker.js invariant", () => {
  it("无 debugger / 无 cookies / 无任意 fetch 目标（仅 bridge 常量）", () => {
    const source = readFileSync(SW_PATH, "utf8");
    expect(source).not.toContain("chrome.debugger");
    expect(source).not.toContain("chrome.cookies");
    // 只允许 bridge 常量（127.0.0.1 候选端口）与命令转发
    expect(source).toContain("127.0.0.1");
    expect(source).toContain("53318");
    expect(source).toContain("invalid_command");
    expect(source).toContain("heartbeat");
  });

  it("SW 不依赖内存状态（重启容忍；job 状态在 bridge）", () => {
    const source = readFileSync(SW_PATH, "utf8");
    expect(source).toContain("polling");
  });
});
