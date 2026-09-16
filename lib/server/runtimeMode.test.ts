import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeMode, isPublicShowcase, isLocalSingleUser, isLocalOwnerNoAuthTrust, RUNTIME_MODE_ENV } from "@/lib/server/runtimeMode";

function setMode(value: string | undefined) {
  if (value === undefined) delete process.env[RUNTIME_MODE_ENV];
  else process.env[RUNTIME_MODE_ENV] = value;
}

afterEach(() => {
  delete process.env[RUNTIME_MODE_ENV];
});

describe("runtimeMode — local_single_user 唯一模式", () => {
  it("缺省 → local_single_user 单用户工作台", () => {
    setMode(undefined);
    expect(getRuntimeMode()).toBe("local_single_user");
    expect(isLocalSingleUser()).toBe(true);
    expect(isPublicShowcase()).toBe(false);
    expect(isLocalOwnerNoAuthTrust()).toBe(true);
  });

  it("显式环境变量不改变单用户唯一模式", () => {
    setMode("local_single_user");
    expect(getRuntimeMode()).toBe("local_single_user");
    expect(isLocalSingleUser()).toBe(true);
  });

  it("历史配置值恒定收敛为 local_single_user", () => {
    setMode("public_showcase");
    expect(getRuntimeMode()).toBe("local_single_user");
    expect(isPublicShowcase()).toBe(false);
  });
});

