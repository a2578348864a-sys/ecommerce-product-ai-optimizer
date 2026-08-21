/**
 * V4.1 — 「亲自体验这个决策」访客沙盒面板（UI + fetch 契约）测试。
 *
 * 本组件只做 UI 与 fetch（接口由服务端实现）。测试用 renderToStaticMarkup 断言 SSR 初始渲染：
 *   - 注明「仅影响我的访客演示沙盒，绝不修改公开案例」；
 *   - 接口不可用 → 「即将开放」诚实空态（用 initialStatus 注入，避免真实 fetch）；
 *   - ready 态渲染 Gate A / Gate B / 备注 / 保存 / 重置（初始状态注入）。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplayDemoChoicePanel } from "./ReplayDemoChoicePanel";

const BUNDLE_ID = "replay-b39aa5cccec5d45f2e74";

describe("ReplayDemoChoicePanel（访客演示沙盒）", () => {
  it("默认初始态：渲染容器与「仅影响我的访客演示沙盒，绝不修改公开案例」标注", () => {
    const html = renderToStaticMarkup(createElement(ReplayDemoChoicePanel, { bundleId: BUNDLE_ID }));
    expect(html).toContain('data-testid="replay-demo-choice"');
    expect(html).toContain("亲自体验这个决策");
    expect(html).toContain("仅影响我的访客演示沙盒，绝不修改公开案例");
    expect(html).toContain('data-testid="replay-demo-choice-loading"');
  });

  it("未建立访客身份/接口不可用 → 诚实空态（指引先进入演示，不请求沙盒接口）", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayDemoChoicePanel, { bundleId: BUNDLE_ID, initialStatus: "unavailable" }),
    );
    expect(html).toContain('data-testid="replay-demo-choice-unavailable"');
    expect(html).toContain("请先进入公开演示建立访客身份");
  });

  it("ready 态渲染 Gate A / Gate B / 备注 / 保存 / 重置，且注入的初始选择被回显", () => {
    const html = renderToStaticMarkup(
      createElement(ReplayDemoChoicePanel, {
        bundleId: BUNDLE_ID,
        initialStatus: "ready",
        initialState: { gateA: "continue_sourcing", gateB: "content_ready", note: "test note" },
      }),
    );
    expect(html).toContain('data-testid="replay-demo-gate-a"');
    expect(html).toContain('data-testid="replay-demo-gate-b"');
    expect(html).toContain('data-testid="replay-demo-note"');
    expect(html).toContain('data-testid="replay-demo-save"');
    expect(html).toContain('data-testid="replay-demo-reset"');
    expect(html).toContain("continue_sourcing");
    expect(html).toContain("content_ready");
    expect(html).toContain("test note");
    // 无表单 method=POST 提交到别处的陷阱：全部为 type=button，避免误解为正式提交。
    expect(html).toContain('type="button"');
    expect(html).not.toContain('<form');
  });
});
