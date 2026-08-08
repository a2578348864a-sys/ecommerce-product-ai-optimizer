/**
 * Phase Guest-Access.1 — Batch Create Guest Codes
 *
 * Usage:
 *   node scripts/create-guest-codes.mjs
 *
 * Creates 10 guest access codes with:
 *   - No time-based Visitor-code expiry (administrator can still disable it)
 *   - 5 complete product journeys per code
 *   - Auto-generated passwords (never committed to Git)
 *
 * Output: plain-text guest codes (printed once — Owner must save)
 * Storage: data/demo-access.json (gitignored)
 */

import { createDemoAccess } from "../lib/server/demoAccess.js";

const COUNT = 10;
console.log(`Creating ${COUNT} guest access codes...`);
console.log("Each code: 5 complete product journeys; no time-based code expiry.");
console.log("");

const codes = [];

for (let i = 1; i <= COUNT; i++) {
  const label = `Guest-${String(i).padStart(2, "0")}`;
  const result = createDemoAccess({
    label,
    maxAiCalls: 0,
    notes: `Guest access code ${i}/${COUNT}. Created ${new Date().toISOString().slice(0, 10)}.`,
  });

  codes.push({
    index: i,
    label,
    id: result.record.id,
    password: result.plainPassword,
  });
}

console.log("=== GUEST ACCESS CODES (SAVE THESE — THEY WILL NOT BE SHOWN AGAIN) ===");
console.log("");

for (const c of codes) {
  console.log(`${c.label} (ID: ${c.id})`);
  console.log(`  Password: ${c.password}`);
  console.log("");
}

console.log("=== END OF CODES ===");
console.log("");
console.log(`Total: ${COUNT} guest codes created.`);
console.log("Store location: data/demo-access.json (gitignored — not committed to Git)");
console.log("");
console.log("Send one code per guest. Each guest enters the password on the login page.");
console.log("Remind guests: 5 complete product journeys per code; existing results remain readable.");
