import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request as esmHttpRequest } from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

type MutableModule = Record<string, unknown>;

const rootPath = mkdtempSync(join(tmpdir(), "candidate-write-characterization-"));
const databasePath = join(rootPath, "owner.db");
const sandboxPath = join(rootPath, "visitor-sandbox.json");
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
const originalSandboxStorePath = process.env.DEMO_SANDBOX_STORE_PATH;
const requireForNetworkGuard = createRequire(import.meta.url);

export const candidateWriteTestPrisma = new PrismaClient({
  datasourceUrl: databaseUrl,
});

export const candidateWriteIsolation = Object.freeze({
  rootPath,
  databasePath,
  sandboxPath,
});

export function installCandidateWriteNetworkIsolation(label: string) {
  const calls: string[] = [];
  const restores: Array<() => void> = [];
  let restored = false;
  const blocked = (channel: string) => {
    calls.push(channel);
    throw new Error(`unregistered_candidate_write_network:${label}:${channel}`);
  };
  const replace = (target: MutableModule, key: string, channel: string) => {
    const original = target[key];
    if (typeof original !== "function") {
      throw new Error(`candidate_write_network_guard_missing:${channel}`);
    }
    target[key] = () => blocked(channel);
    restores.push(() => {
      target[key] = original;
    });
  };
  const restoreReplacements = () => {
    const errors: unknown[] = [];
    for (let index = restores.length - 1; index >= 0; index -= 1) {
      try {
        restores[index]();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      syncBuiltinESMExports();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "candidate_write_network_restore_failed");
    }
  };

  const globalTarget = globalThis as unknown as MutableModule;
  const modules = {
    http: requireForNetworkGuard("node:http") as MutableModule,
    https: requireForNetworkGuard("node:https") as MutableModule,
    http2: requireForNetworkGuard("node:http2") as MutableModule,
    net: requireForNetworkGuard("node:net") as MutableModule,
    tls: requireForNetworkGuard("node:tls") as MutableModule,
    dgram: requireForNetworkGuard("node:dgram") as MutableModule,
  };

  try {
    replace(globalTarget, "fetch", "fetch");
    replace(modules.http, "request", "http.request");
    replace(modules.http, "get", "http.get");
    replace(modules.https, "request", "https.request");
    replace(modules.https, "get", "https.get");
    replace(modules.http2, "connect", "http2.connect");
    replace(modules.net, "connect", "net.connect");
    replace(modules.net, "createConnection", "net.createConnection");
    const socket = modules.net.Socket as { prototype?: MutableModule } | undefined;
    if (!socket?.prototype) {
      throw new Error("candidate_write_network_guard_missing:net.Socket.prototype");
    }
    replace(socket.prototype, "connect", "net.Socket.connect");
    replace(modules.tls, "connect", "tls.connect");
    replace(modules.dgram, "createSocket", "dgram.createSocket");
    syncBuiltinESMExports();
    if (esmHttpRequest !== modules.http.request) {
      throw new Error("candidate_write_network_guard_esm_sync_failed:http.request");
    }
  } catch (error) {
    try {
      restoreReplacements();
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "candidate_write_network_install_and_restore_failed",
      );
    }
    throw error;
  }

  return Object.freeze({
    assertUnused() {
      if (calls.length > 0) {
        throw new Error(`candidate_write_network_guard_used:${calls.join(",")}`);
      }
    },
    restore() {
      if (restored) return;
      restored = true;
      restoreReplacements();
    },
  });
}

export async function initializeCandidateWriteIsolation(): Promise<void> {
  await candidateWriteTestPrisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OpportunityCandidate" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "rawInput" TEXT NOT NULL DEFAULT '',
      "link" TEXT,
      "score" INTEGER NOT NULL DEFAULT 0,
      "source" TEXT NOT NULL DEFAULT '机会雷达',
      "keyword" TEXT NOT NULL DEFAULT '',
      "riskLevel" TEXT NOT NULL DEFAULT '',
      "riskLabel" TEXT NOT NULL DEFAULT '',
      "summaryLabel" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'pending',
      "sourceMetaJson" TEXT NOT NULL DEFAULT '{}',
      "analysisJson" TEXT NOT NULL DEFAULT '{}',
      "convertedTaskId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "lastActionAt" DATETIME
    )
  `);
  await resetCandidateWriteIsolation();
}

export async function resetCandidateWriteIsolation(): Promise<void> {
  process.env.DEMO_SANDBOX_STORE_PATH = sandboxPath;
  await candidateWriteTestPrisma.opportunityCandidate.deleteMany();
  writeFileSync(
    sandboxPath,
    JSON.stringify({ version: 1, tasks: [], candidates: [] }, null, 2),
    "utf8",
  );
}

export function assertCandidateWriteIsolationHasNoTransientFiles(): void {
  const transientFiles = readdirSync(rootPath)
    .filter((name) => name.endsWith(".tmp") || name.endsWith(".backup"));
  if (transientFiles.length > 0) {
    throw new Error(`candidate_write_isolation_transient_files:${transientFiles.join(",")}`);
  }
}

export async function disposeCandidateWriteIsolation(): Promise<void> {
  const cleanupErrors: unknown[] = [];
  try {
    await candidateWriteTestPrisma.$disconnect();
  } catch (error) {
    cleanupErrors.push(error);
  } finally {
    if (originalSandboxStorePath === undefined) {
      delete process.env.DEMO_SANDBOX_STORE_PATH;
    } else {
      process.env.DEMO_SANDBOX_STORE_PATH = originalSandboxStorePath;
    }
    try {
      rmSync(rootPath, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (existsSync(rootPath)) {
    cleanupErrors.push(new Error("candidate_write_isolation_cleanup_failed"));
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "candidate_write_isolation_dispose_failed");
  }
}
