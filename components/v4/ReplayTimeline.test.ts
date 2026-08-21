/**
 * V4 P6 — ReplayTimeline 测试（渲染 / 暂停快进 / Evidence 展开 / 标识 / 无虚假进度）。
 *
 * 遵循本仓库测试约定：vitest 环境为 node，使用 react-dom/server 的 renderToStaticMarkup
 * 做静态渲染断言（无 DOM / 无 testing-library）；暂停/快进/展开逻辑通过导出的纯函数直接单测。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK,
  replayPlaybackReducer,
  toggleEvidence,
  ReplayTimeline,
  type ReplayPlaybackState,
} from "./ReplayTimeline";

function render(state?: Partial<ReplayPlaybackState>, open?: string[]) {
  return renderToStaticMarkup(
    createElement(ReplayTimeline, {
      steps: [
        { id: "s1", at: "2026-01-01T00:00:01.000Z", title: "加载上下文", detail: "读取候选与上下文" },
        {
          id: "s2",
          at: "2026-01-01T00:00:02.000Z",
          title: "市场综合分析",
          evidenceRefs: [
            { id: "ev-1", label: "评论样本", summary: "用户反馈关键词：便携、耐用。", sourceUrl: "https://example.com/review/1", capturedAt: "2026-01-01T00:00:00.000Z" },
          ],
        },
        { id: "s3", at: "2026-01-01T00:00:03.000Z", title: "内容审核" },
      ],
      initialState: state ? { position: 0, ...state } : undefined,
      initialEvidenceOpen: open,
    }),
  );
}

describe("ReplayTimeline playback reducer", () => {
  it("toggles play/pause locally", () => {
    const playing = replayPlaybackReducer(DEFAULT_PLAYBACK, { type: "toggle_play" }, 3);
    expect(playing.playing).toBe(true);
    const paused = replayPlaybackReducer(playing, { type: "toggle_play" }, 3);
    expect(paused.playing).toBe(false);
  });

  it("steps forward/backward across discrete steps (no fake percentage)", () => {
    const fwd = replayPlaybackReducer({ playing: false, rate: 1, position: 0 }, { type: "step", delta: 1 }, 3);
    expect(fwd.position).toBe(1);
    const back = replayPlaybackReducer(fwd, { type: "step", delta: -1 }, 3);
    expect(back.position).toBe(0);
  });

  it("clamps step position to the timeline bounds", () => {
    expect(replayPlaybackReducer({ playing: false, rate: 1, position: 0 }, { type: "step", delta: -1 }, 3).position).toBe(0);
    expect(replayPlaybackReducer({ playing: false, rate: 1, position: 2 }, { type: "step", delta: 1 }, 3).position).toBe(2);
  });

  it("sets a local playback rate and handles jump/reset", () => {
    const fast = replayPlaybackReducer({ playing: false, rate: 1, position: 0 }, { type: "set_rate", rate: 4 }, 3);
    expect(fast.rate).toBe(4);
    const jumped = replayPlaybackReducer(fast, { type: "jump", position: 2 }, 3);
    expect(jumped.position).toBe(2);
    const reset = replayPlaybackReducer(jumped, { type: "reset" }, 3);
    expect(reset.position).toBe(0);
    expect(reset.playing).toBe(false);
  });
});

describe("ReplayTimeline evidence toggle", () => {
  it("adds and removes an evidence id from the expanded set", () => {
    expect(toggleEvidence([], "ev-1")).toEqual(["ev-1"]);
    expect(toggleEvidence(["ev-1"], "ev-1")).toEqual([]);
    expect(toggleEvidence(["ev-1"], "ev-2")).toEqual(["ev-1", "ev-2"]);
  });
});

describe("ReplayTimeline render", () => {
  it("renders empty state when there are no steps", () => {
    const html = renderToStaticMarkup(createElement(ReplayTimeline, { steps: [] }));
    expect(html).toContain('data-testid="replay-timeline"');
    expect(html).toContain("暂无回放步骤记录");
  });

  it("renders steps, controls and a discrete step indicator, never a fake progress bar", () => {
    const html = render();
    expect(html).toContain('data-testid="replay-timeline"');
    expect(html).toContain('data-testid="replay-toggle-play"');
    expect(html).toContain('data-testid="replay-step-forward"');
    expect(html).toContain("播放");
    expect(html).toContain("快进");
    expect(html).toContain("倍速");
    expect(html).toContain("加载上下文");
    expect(html).toContain("市场综合分析");
    expect(html).toContain('data-testid="replay-step-indicator"');
    expect(html).toContain("第 1 / 3 步");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("<progress");
  });

  it("starts paused (play label) and offers a rate selector", () => {
    const html = render();
    expect(html).toContain("播放");
    expect(html).not.toContain(">暂停<");
    expect(html).toContain('data-testid="replay-rate"');
    expect(html).toContain("1x");
  });

  it("shows evidence detail when a reference is expanded", () => {
    const html = render({ position: 1 }, ["ev-1"]);
    expect(html).toContain('data-testid="replay-evidence-detail-ev-1"');
    expect(html).toContain("用户反馈关键词：便携、耐用。");
    expect(html).toContain("https://example.com/review/1");
    expect(html).toContain("采集：");
  });

  it("hides evidence detail until expanded but keeps the chip visible", () => {
    const html = render();
    expect(html).not.toContain('data-testid="replay-evidence-detail-ev-1"');
    expect(html).not.toContain("用户反馈关键词：便携、耐用。");
    expect(html).toContain('data-testid="replay-evidence-chip-ev-1"');
  });
});
