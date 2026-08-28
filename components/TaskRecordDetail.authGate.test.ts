import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 契约：local_owner（noAuthOwner=true）模式下，任务详情页不得被「请先输入访问密码」卡住。
 * 回归场景：useEffect 放行条件缺少 noAuthOwner、依赖数组缺少 noAuthOwner → 页面 gate=true 卡死。
 * 仅读源码字符串，断言真实行为契约（页面不得有把 noAuthOwner 挡在门外且不重放行的分支）。
 */
const source = readFileSync(resolve(process.cwd(), "components/TaskRecordDetail.tsx"), "utf8");

describe("TaskRecordDetail noAuthOwner 解锁契约", () => {
  it("local_owner 放行条件必须包含 noAuthOwner（不允许把 noAuthOwner 用户挡在密码门外）", () => {
    expect(source).toContain("!isGuestMode() && !noAuthOwner");
  });
  it("加载 effect 依赖数组必须包含 noAuthOwner（模式切换后能重新放行）", () => {
    expect(source).toContain("[id, accessPassword, isAccessPasswordReady, noAuthOwner]");
  });
});
