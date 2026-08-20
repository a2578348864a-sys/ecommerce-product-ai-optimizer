import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeMode, isPublicShowcase, isLocalOwnerNoAuthTrust, RUNTIME_MODE_ENV } from "@/lib/server/runtimeMode";

function setMode(value: string | undefined) {
  if (value === undefined) delete process.env[RUNTIME_MODE_ENV];
  else process.env[RUNTIME_MODE_ENV] = value;
}

afterEach(() => {
  delete process.env[RUNTIME_MODE_ENV];
});

describe("runtimeMode — QX_RUNTIME_MODE（契约 01，唯一正式配置名）", () => {
  it("缺省 → local_owner（契约 01：缺省 = 现状，安全默认）", () => {
    setMode(undefined);
    expect(getRuntimeMode()).toBe("local_owner");
    expect(isPublicShowcase()).toBe(false);
    // 缺省不启用无认证回环信任（防意外部署开口子）
    expect(isLocalOwnerNoAuthTrust()).toBe(false);
  });

  it("显式 local_owner → local_owner + 无认证回环信任（§6）", () => {
    setMode("local_owner");
    expect(getRuntimeMode()).toBe("local_owner");
    expect(isLocalOwnerNoAuthTrust()).toBe(true);
  });

  it("显式 public_showcase → public_showcase（§7）", () => {
    setMode("public_showcase");
    expect(getRuntimeMode()).toBe("public_showcase");
    expect(isPublicShowcase()).toBe(true);
    expect(isLocalOwnerNoAuthTrust()).toBe(false);
  });

  it("非法值 → local_owner（fail-closed 默认），大小写不敏感", () => {
    setMode("PUBLIC_MODE");
    expect(getRuntimeMode()).toBe("local_owner");
    setMode("Public_Showcase");
    expect(getRuntimeMode()).toBe("public_showcase");
  });
});
