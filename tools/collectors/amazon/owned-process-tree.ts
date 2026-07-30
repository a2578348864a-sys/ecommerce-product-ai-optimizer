import { spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";

export type RecordedProcessExitWait = {
  exited: boolean;
  remainingProcessIds: number[];
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
function isPositiveProcessId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

function forceTerminateProcessTreeById(processId: number): void {
  spawnSync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

export async function waitForOwnedProcessExit(ownedProcess: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (ownedProcess.exitCode !== null || ownedProcess.signalCode !== null) return true;
  return await Promise.race([
    once(ownedProcess, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

export function forceTerminateOwnedProcessTree(ownedProcess: ChildProcess): void {
  if (!ownedProcess.pid || ownedProcess.exitCode !== null || ownedProcess.signalCode !== null) return;
  if (process.platform === "win32") {
    forceTerminateProcessTreeById(ownedProcess.pid);
    return;
  }
  ownedProcess.kill("SIGKILL");
}

export function isRecordedProcessAlive(processId: number): boolean {
  if (!isPositiveProcessId(processId)) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}

export async function waitForRecordedProcessIdsToExit(
  processIds: readonly number[],
  timeoutMs: number,
): Promise<RecordedProcessExitWait> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw new Error("RECORDED_PROCESS_TIMEOUT_INVALID");
  const uniqueProcessIds = [...new Set(processIds.filter(isPositiveProcessId))];
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remainingProcessIds = uniqueProcessIds.filter(isRecordedProcessAlive);
    if (remainingProcessIds.length === 0) return { exited: true, remainingProcessIds };
    if (Date.now() >= deadline) return { exited: false, remainingProcessIds };
    await delay(Math.min(25, Math.max(1, deadline - Date.now())));
  }
}
