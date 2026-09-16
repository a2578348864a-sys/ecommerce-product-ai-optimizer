import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { DemoSandboxStore } from "@/lib/server/demoSandbox";

function storePath(): string {
  if (process.env.NODE_ENV !== "test") throw new Error("DEMO_SANDBOX_TEST_SUPPORT_FORBIDDEN");
  return process.env.DEMO_SANDBOX_STORE_PATH
    || resolve(process.cwd(), ".next", "test-stores", "demo-sandbox.default.json");
}

export function replaceDemoSandboxStoreForTest(store: DemoSandboxStore): void {
  const target = storePath();
  const backup = `${target}.backup`;
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  mkdirSync(resolve(target, ".."), { recursive: true });
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    try {
      renameSync(temporary, target);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EPERM" && code !== "EEXIST") throw error;
      let moved = false;
      if (existsSync(target)) {
        renameSync(target, backup);
        moved = true;
      }
      try {
        renameSync(temporary, target);
      } catch (replacementError) {
        if (moved && existsSync(backup) && !existsSync(target)) {
          try { renameSync(backup, target); } catch { /* retain controlled backup */ }
        }
        throw replacementError;
      }
      if (moved && existsSync(backup)) unlinkSync(backup);
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
