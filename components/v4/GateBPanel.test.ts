/**
 * V4 P4 — GateBPanel 测试（四选项 / revision / stop 原因门禁 / stale 禁用 proceed / 只由人提交）。
 *
 * 遵循本仓库测试约定：vitest 环境为 node，使用 react-dom/server 的 renderToStaticMarkup
 * 做静态渲染断言；交互门禁逻辑通过导出的纯函数 canSubmitGateB / isProceedStaleBlocked 验证。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GateBPanel,
  GATE_B_OPTIONS,
  canSubmitGateB,
  isProceedStaleBlocked,
} from "@/components/v4/GateBPanel";

/** 从静态标记中抽取包含某 data-testid 的完整开标签（用于断言 disabled 等属性）。 */
function tagMarkup(html: string, testid: string): string {
  const marker = 'data-testid="' + testid + '"';
  const idx = html.indexOf(marker);
  if (idx === -1) return "";
  const start = html.lastIndexOf("<", idx);
  const end = html.indexOf(">", idx);
  return html.slice(start, end + 1);
}

function render(props: Partial<Parameters<typeof GateBPanel>[0]>): string {
  return renderToStaticMarkup(
    createElement(GateBPanel, {
      revision: 3,
      actor: "owner@example",
      onSubmit: () => undefined,
      ...props,
    }),
  );
}

describe("GateBPanel", () => {
  it("renders the four Gate B options with Chinese labels", () => {
    const html = render({});
    expect(html).toContain('data-testid="gate-b-panel"');
    for (const opt of GATE_B_OPTIONS) {
      expect(html).toContain('data-testid="gate-b-option-' + opt + '"');
    }
    expect(html).toContain("继续（进入内容制作）");
    expect(html).toContain("返回补充信息");
    expect(html).toContain("修改产品后重算");
    expect(html).toContain("放弃（不进入内容制作）");
  });

  it("displays the revision and the human-only submission note", () => {
    const html = render({ revision: 7 });
    expect(html).toContain('data-testid="gate-b-revision"');
    expect(html).toContain("版本 7");
    expect(html).toContain("只由人提交");
  });

  it("disables submit until an option is selected and (for stop) a reason is provided", () => {
    // 未选择任何选项 → 提交禁用
    expect(tagMarkup(render({}), "gate-b-submit")).toContain("disabled");
    // stop 缺 reason → 不可提交
    expect(canSubmitGateB({ option: "abandon", reason: "", rulesStale: false, staleConfirmed: false })).toBe(false);
    // stop 填 reason → 可提交
    expect(canSubmitGateB({ option: "abandon", reason: "毛利过低，不考虑", rulesStale: false, staleConfirmed: false })).toBe(true);
    // 其他选项缺 reason 也可提交
    expect(canSubmitGateB({ option: "content_ready", reason: "", rulesStale: false, staleConfirmed: false })).toBe(true);
    expect(canSubmitGateB({ option: "needs_information", rulesStale: false })).toBe(true);
    expect(canSubmitGateB({ option: "revise_product", rulesStale: false })).toBe(true);
    // 无选项 → 不可提交
    expect(canSubmitGateB({ option: "", rulesStale: false })).toBe(false);
  });

  it("keeps proceed disabled while rules are stale until a confirm callback is given", () => {
    const html = render({ rulesStale: true });
    // stale 警示出现
    expect(html).toContain('data-testid="gate-b-stale-warning"');
    expect(html).toContain('data-testid="gate-b-confirm-stale"');
    // proceed 按钮被禁用
    expect(tagMarkup(html, "gate-b-option-content_ready")).toContain("disabled");
    // 非 proceed 选项不被 stale 禁用
    expect(tagMarkup(html, "gate-b-option-needs_information")).not.toContain("disabled");
    // 门禁逻辑：stale 未确认时 proceed 不可提交，确认后可提交
    expect(isProceedStaleBlocked(true, false)).toBe(true);
    expect(isProceedStaleBlocked(true, true)).toBe(false);
    expect(canSubmitGateB({ option: "content_ready", rulesStale: true, staleConfirmed: false })).toBe(false);
    expect(canSubmitGateB({ option: "content_ready", rulesStale: true, staleConfirmed: true })).toBe(true);
  });

  it("does not emit monthly-earnings text (D8)", () => {
    const html = render({});
    expect(html).not.toContain("月赚");
    expect(html).not.toContain("月利润");
    expect(html).not.toContain("月收入");
  });
});
