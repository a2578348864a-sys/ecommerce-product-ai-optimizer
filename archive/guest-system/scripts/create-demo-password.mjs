/**
 * Phase Demo-Login.1-B — Create Demo Password Script
 *
 * Usage:
 *   node scripts/create-demo-password.mjs --label "Visitor acceptance"
 *   npm run demo:create -- --label "Visitor acceptance"
 *
 * Generates a random demo password, hashes it, stores in data/demo-access.json.
 * Prints the plain password ONCE to stdout. Does NOT write passwords to any file.
 */

import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const STORE_PATH = resolve(DATA_DIR, "demo-access.json");

// ── Parse args ──────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

const label = getArg("label");
if (!label) {
  console.error("Usage: node scripts/create-demo-password.mjs --label <label>");
  console.error("  --label   Label for this Visitor access code");
  process.exit(1);
}

// ── Crypto ──────────────────────────────────────

function generateSalt() {
  return randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  const h = createHash("sha256").update(salt + password).digest("hex");
  return `sha256:${h}`;
}

function generateDemoPassword() {
  return randomBytes(12).toString("base64url");
}

function generateDemoId() {
  return `demo_${randomBytes(8).toString("hex")}`;
}

// ── Load / Save store ───────────────────────────

function loadStore() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(STORE_PATH)) {
    return { version: 1, accesses: [] };
  }
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.accesses)) {
      return parsed;
    }
    return { version: 1, accesses: [] };
  } catch {
    return { version: 1, accesses: [] };
  }
}

function saveStore(store) {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ── Main ────────────────────────────────────────

const plainPassword = generateDemoPassword();
const salt = generateSalt();
const passwordHash = hashPassword(plainPassword, salt);
const now = new Date();

const record = {
  id: generateDemoId(),
  label,
  passwordHash,
  salt,
  expiresAt: null,
  maxAiCalls: 0,
  usedAiCalls: 0,
  isActive: true,
  createdAt: now.toISOString(),
  lastUsedAt: null,
  notes: "",
};

const store = loadStore();
store.accesses.push(record);
saveStore(store);

// ── Output ──────────────────────────────────────

console.log("Demo access created.");
console.log(`  Label:      ${label}`);
console.log("  Visitor code: no time-based expiry; administrator can disable it");
console.log("  Product journeys: 5");
console.log(`  Password:   ${plainPassword}`);
console.log("");
console.log("Password 只显示一次，请复制保存。不会写入任何文件。");
