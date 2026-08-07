import { describe, expect, it, vi, afterEach } from "vitest";
import { createBrowserUuid } from "./browserUuid";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createBrowserUuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("优先使用原生 crypto.randomUUID（secure context）", () => {
    const native = "11111111-2222-4333-8444-555555555555";
    vi.stubGlobal("crypto", {
      randomUUID: () => native,
      getRandomValues: () => {
        throw new Error("不应调用 getRandomValues");
      },
    });
    expect(createBrowserUuid()).toBe(native);
  });

  it("randomUUID 不存在时使用 getRandomValues fallback，生成合法 UUID v4", () => {
    // 构造确定性字节序列（version/variant 位会被改写）
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = i;
    vi.stubGlobal("crypto", {
      getRandomValues: (buf: Uint8Array) => {
        buf.set(bytes);
        return buf;
      },
    });
    const uuid = createBrowserUuid();
    expect(uuid).toMatch(UUID_V4_PATTERN);
    // version nibble = 4
    expect(uuid[14]).toBe("4");
    // variant nibble = 8/9/a/b
    expect("89ab".includes(uuid[19])).toBe(true);
  });

  it("fallback 生成的 UUID 格式正确且 lowercase", () => {
    const calls: Uint8Array[] = [];
    vi.stubGlobal("crypto", {
      getRandomValues: (buf: Uint8Array) => {
        calls.push(new Uint8Array(buf));
        buf.set(Array.from({ length: 16 }, (_, i) => (i * 37 + 11) % 256));
        return buf;
      },
    });
    const uuid = createBrowserUuid();
    expect(uuid).toMatch(UUID_V4_PATTERN);
    expect(uuid).toBe(uuid.toLowerCase());
    expect(calls.length).toBe(1);
  });

  it("多次生成不重复（不同随机字节产生不同 UUID）", () => {
    let seed = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (buf: Uint8Array) => {
        seed = (seed + 7919) % 65536;
        for (let i = 0; i < 16; i++) buf[i] = (seed + i * 31) % 256;
        return buf;
      },
    });
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(createBrowserUuid());
    expect(seen.size).toBe(20);
  });

  it("crypto 与 getRandomValues 均不可用时 fail-closed，不使用 Math.random", () => {
    const mathRandomSpy = vi.spyOn(Math, "random");
    vi.stubGlobal("crypto", undefined);
    expect(() => createBrowserUuid()).toThrow(/不支持安全 UUID 生成/);
    expect(mathRandomSpy).not.toHaveBeenCalled();
    mathRandomSpy.mockRestore();
  });

  it("crypto 存在但无任何方法时 fail-closed", () => {
    vi.stubGlobal("crypto", {});
    expect(() => createBrowserUuid()).toThrow(/不支持安全 UUID 生成/);
  });
});
