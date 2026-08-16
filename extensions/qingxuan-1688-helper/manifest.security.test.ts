/**
 * V3.5 — Extension manifest 权限审计 + CDP 回归审计（§36/§28）
 *
 * 自动锁定：manifest 不得出现 debugger / cookies / <all_urls> 等权限；
 * 正式驱动调用路径 ZERO CDP。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST_PATH = resolve(process.cwd(), "extensions", "qingxuan-1688-helper", "manifest.json");
const DRIVER_PATH = resolve(process.cwd(), "lib", "server", "sourcingImageAcquisition.ts");

type Manifest = {
  permissions?: string[];
  host_permissions?: string[];
  background?: { service_worker?: string };
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
};

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

describe("manifest 权限最小化（§9/§36）", () => {
  it("禁止权限零出现：debugger / cookies / history / downloads / scripting / all_urls", () => {
    const manifest = readManifest();
    // 只审计权限声明字段（description 等说明文本允许提及，不构成权限）
    const permissionFields = [
      ...(manifest.permissions ?? []),
      ...(manifest.host_permissions ?? []),
    ].join(" ");
    for (const forbidden of ["debugger", "cookies", "history", "downloads", "scripting", "all_urls", "<all_urls>"]) {
      expect(permissionFields).not.toContain(forbidden);
    }
  });

  it("permissions 仅允许 storage（端口缓存；§9 最小化）", () => {
    const permissions = readManifest().permissions ?? [];
    for (const permission of permissions) {
      expect(["storage"]).toContain(permission);
    }
    expect(permissions).not.toContain("scripting");
  });

  it("host_permissions 仅 1688 图搜相关域", () => {
    const hosts = readManifest().host_permissions ?? [];
    expect(hosts).toEqual([
      "https://s.1688.com/*",
      "https://air.1688.com/*",
    ]);
  });

  it("content_scripts 仅覆盖 1688 域且包含 content.js", () => {
    const scripts = readManifest().content_scripts ?? [];
    expect(scripts.length).toBe(1);
    expect(scripts[0].matches).toEqual(["https://s.1688.com/*", "https://air.1688.com/*"]);
    expect(scripts[0].js).toContain("content.js");
  });

  it("无任意命令/任意 URL 能力声明（background 仅 service-worker.js）", () => {
    expect(readManifest().background?.service_worker).toBe("service-worker.js");
  });
});

describe("正式驱动调用路径 ZERO CDP（§28）", () => {
  it("sourcingImageAcquisition.ts 不 import tools/collectors/1688 的 CDP 驱动", () => {
    const source = readFileSync(DRIVER_PATH, "utf8");
    expect(source).not.toContain("image-search-driver");
    expect(source).not.toContain("browser-session");
    expect(source).not.toContain("remote-debugging");
    expect(source).not.toContain("Runtime.evaluate");
    expect(source).not.toContain("Page.navigate");
  });

  it("正式驱动标识为 native-1688-extension-driver", () => {
    const source = readFileSync(DRIVER_PATH, "utf8");
    expect(source).toContain("NATIVE_1688_EXTENSION_DRIVER_VERSION");
    expect(source).toContain("NO_AUTOMATIC_FALLBACK_TO_CDP");
  });
});
