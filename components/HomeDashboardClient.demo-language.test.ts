import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("home dashboard demo language", () => {
  it("derives a user-facing connection state from the loaded workspace data", async () => {
    const source = await readFile(new URL("./HomeDashboardClient.tsx", import.meta.url), "utf8");

    expect(source).toContain("数据已同步");
    expect(source).toContain("待研究商品");
    expect(source).not.toContain("服务端 Candidate");
    expect(source).not.toContain("API 鉴权未确认");
  });

  it("renders the local C-end workbench with Chinese-only user language", async () => {
    const source = await readFile(new URL("./HomeDashboardClient.tsx", import.meta.url), "utf8");

    // C 端工作台标题与主卡
    expect(source).toContain("工作台");
    expect(source).toContain("了解你的商品研究进度，下一步由你决定。");
    expect(source).toContain("开始研究一个商品");
    expect(source).toContain("从一个真实候选商品开始，AI 整理证据，关键决定由你确认。");
    // v2 三个状态区标题
    expect(source).toContain("需要我处理");
    expect(source).toContain("AI 研究中");
    expect(source).toContain("已完成");
    expect(source).toContain('href="/opportunity-candidates"');
    // flag off 纯文字引导 + 诚实空态
    expect(source).toContain("本地研究能力未开启，请联系管理员开启后使用");
    expect(source).toContain("当前没有正在研究的商品");
    // 普通页面不出现内部英文枚举 / 技术标签
    expect(source).not.toContain("Evidence-first");
    expect(source).not.toContain("approve_export");
    expect(source).not.toContain("V4 研究图未启用");
  });
});
