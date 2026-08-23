import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "components/TaskRecordDetail.tsx"), "utf8");

/*
 * 轮 15 追加修复：ResearchCompletionControl「确认研究结论仍然有效」按钮在自动化/headless 环境
 * window.confirm 阻塞/返回 false → 静默无响应。必须改为组件内自定义确认对话框（React 状态）。
 */

describe("ResearchCompletionControl 确认对话框（无 window.confirm 依赖）", () => {
  it("completeResearch 不再使用 window.confirm（native confirm 在自动化环境静默返回 false）", () => {
    const fnStart = source.indexOf("async function completeResearch()");
    const fnEnd = source.indexOf("      setCompleting(false);", fnStart) + "      setCompleting(false);\n    }\n  }".length;
    const fnBody = source.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1200);
    // 注释允许出现说明文字；代码不得再调用 window.confirm（native confirm 在自动化环境静默失败）
    const codeOnly = fnBody.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toContain("window.confirm");
    expect(codeOnly).not.toContain("if (!confirmed)");
  });
  it("存在自定义确认状态与对话框（confirmOpen + 确认/取消按钮 + 不再静默返回）", () => {
    expect(source).toContain("confirmOpen");
    expect(source).toContain("确认研究结论仍然有效？");
    expect(source).toContain("setConfirmOpen");
    expect(source).toContain("data-testid=\"research-confirm-dialog\"");
  });
});
