/**
 * Standalone receipt verifier.
 *   npm run verify -- path/to/receipt.json
 * Re-derives every hash and the signature with no trust in the file's own
 * claims. Flip any byte in the entries and this prints exactly where it broke.
 */
import { readFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { verifyReceipt } from '../src/receipts/ledger.js';
import type { Receipt } from '../src/agent/types.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run verify -- <receipt.json>');
  process.exit(1);
}

const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt;
const report = verifyReceipt(receipt, config.signingSecret);

console.log(`\nRun ${receipt.runId} — "${receipt.goal}"`);
console.log(`Steps: ${receipt.entries.length}  Chain tip: ${receipt.chainTip.slice(0, 16)}…`);
console.log(report.valid ? '\n  ✓ VALID' : '\n  ✗ INVALID');
console.log(`  ${report.reason}`);
if (report.brokenAt !== null) console.log(`  First broken step: ${report.brokenAt}`);
console.log();
process.exit(report.valid ? 0 : 2);
