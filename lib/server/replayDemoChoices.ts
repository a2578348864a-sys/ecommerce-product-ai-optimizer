/**
 * Public Replay 演示沙盒选择（门禁 6）：访客在自己的 sandbox 保存 Gate A/Gate B 决策与备注，
 * 与母案例 bundle 完全隔离；刷新保持；DELETE 重置。
 *
 * 契约（以 UI 面板为准，整包表单）：每 demoAccessId × bundleId 一条记录 { gateA?, gateB?, note?, at }。
 */

import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export type ReplayDemoChoice = {
  bundleId: string;
  gateA?: string;
  gateB?: string;
  note?: string;
  at: string;
};

const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function safeId(value: string): string | null {
  return ID_RE.test(value) ? value : null;
}

function dirFor(baseDir: string): string {
  return join(baseDir, "data", "replay-demo-choices");
}

function fileFor(baseDir: string, demoAccessId: string): string {
  const id = safeId(demoAccessId);
  if (!id) throw new Error("invalid demoAccessId");
  return join(dirFor(baseDir), id + ".json");
}

function readAll(baseDir: string, demoAccessId: string): ReplayDemoChoice[] {
  const file = fileFor(baseDir, demoAccessId);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(baseDir: string, demoAccessId: string, choices: ReplayDemoChoice[]): void {
  const file = fileFor(baseDir, demoAccessId);
  mkdirSync(dirFor(baseDir), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(choices, null, 2), "utf8");
  renameSync(tmp, file);
}

export function getDemoChoice(baseDir: string, demoAccessId: string, bundleId: string): ReplayDemoChoice | null {
  const safe = safeId(bundleId);
  if (!safe) return null;
  return readAll(baseDir, demoAccessId).find((c) => c.bundleId === safe) ?? null;
}

export function saveDemoChoice(baseDir: string, demoAccessId: string, choice: ReplayDemoChoice): ReplayDemoChoice {
  const prev = readAll(baseDir, demoAccessId).filter((c) => c.bundleId !== choice.bundleId);
  prev.push(choice);
  writeAll(baseDir, demoAccessId, prev);
  return choice;
}

export function resetDemoChoice(baseDir: string, demoAccessId: string, bundleId: string): void {
  const safe = safeId(bundleId);
  if (!safe) return;
  const prev = readAll(baseDir, demoAccessId).filter((c) => c.bundleId !== safe);
  writeAll(baseDir, demoAccessId, prev);
}
