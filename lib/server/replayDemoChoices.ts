/**
 * Public Replay 演示沙盒选择（门禁 6）：访客在自己的 sandbox 保存 Gate 决策/备注，
 * 与母案例 bundle 完全隔离；刷新保持；DELETE 重置。
 *
 * 安全：demoAccessId/bundleId 强白名单格式；文件写入 tmp+rename 原子替换；
 * 目录为受控运行数据（.gitignore）。
 */

import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export type ReplayDemoChoice = {
  bundleId: string;
  gateId: string;
  decision: string;
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

function readChoices(baseDir: string, demoAccessId: string): ReplayDemoChoice[] {
  const file = fileFor(baseDir, demoAccessId);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChoices(baseDir: string, demoAccessId: string, choices: ReplayDemoChoice[]): void {
  const file = fileFor(baseDir, demoAccessId);
  const dir = dirFor(baseDir);
  mkdirSync(dir, { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(choices, null, 2), "utf8");
  renameSync(tmp, file);
}

/** 读取该访客对某 bundle 的选择（无 → []）。 */
export function getDemoChoices(baseDir: string, demoAccessId: string, bundleId: string): ReplayDemoChoice[] {
  const safe = safeId(bundleId) ?? "";
  return readChoices(baseDir, demoAccessId).filter((c) => c.bundleId === safe);
}

/** 保存（upsert by bundleId+gateId）。 */
export function saveDemoChoice(baseDir: string, demoAccessId: string, choice: ReplayDemoChoice): ReplayDemoChoice[] {
  const prev = readChoices(baseDir, demoAccessId);
  const next = prev.filter((c) => !(c.bundleId === choice.bundleId && c.gateId === choice.gateId));
  next.push(choice);
  writeChoices(baseDir, demoAccessId, next);
  return getDemoChoices(baseDir, demoAccessId, choice.bundleId);
}

/** 重置该 bundle 的全部选择。 */
export function resetDemoChoices(baseDir: string, demoAccessId: string, bundleId: string): ReplayDemoChoice[] {
  const safe = safeId(bundleId) ?? "";
  const prev = readChoices(baseDir, demoAccessId).filter((c) => c.bundleId !== safe);
  writeChoices(baseDir, demoAccessId, prev);
  return [];
}

export const REPLAY_DEMO_CHOICES_DIR = "data/replay-demo-choices";
