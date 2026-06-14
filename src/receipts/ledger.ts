import { createHash, createHmac } from 'node:crypto';
import type { AgentAction, Receipt, ReceiptEntry } from '../agent/types.js';

export const sha256 = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

const GENESIS = '0'.repeat(64);

/** Canonical string for an entry — the exact bytes that get hashed. Order matters. */
function canonical(e: Omit<ReceiptEntry, 'entryHash'>): string {
  return [
    e.index,
    e.timestamp,
    e.thought,
    JSON.stringify(e.action),
    e.outcome,
    e.healed,
    e.detail,
    e.screenshotSha256,
    e.snapshotSha256,
    e.prevHash,
  ].join('\u241F'); // unit separator, unlikely to appear in content
}

/**
 * Append-only, tamper-evident ledger. Each entry commits to the previous entry's
 * hash, so altering any past step invalidates every entry after it. The final
 * chain tip is signed with HMAC-SHA256 so a third party can confirm the run came
 * from this Veritrail instance and was not edited afterward.
 */
export class ReceiptLedger {
  private entries: ReceiptEntry[] = [];
  private prevHash = GENESIS;

  constructor(
    readonly runId: string,
    readonly goal: string,
    private readonly secret: string,
    readonly startedAt = new Date().toISOString(),
  ) {}

  append(input: {
    thought: string;
    action: AgentAction;
    outcome: 'ok' | 'failed';
    healed: boolean;
    detail: string;
    screenshotSha256: string;
    snapshotSha256: string;
  }): ReceiptEntry {
    const base = {
      index: this.entries.length,
      timestamp: new Date().toISOString(),
      prevHash: this.prevHash,
      ...input,
    };
    const entryHash = sha256(canonical(base));
    const entry: ReceiptEntry = { ...base, entryHash };
    this.entries.push(entry);
    this.prevHash = entryHash;
    return entry;
  }

  seal(guardrail: Receipt['guardrail']): Receipt {
    const chainTip = this.prevHash;
    return {
      runId: this.runId,
      goal: this.goal,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      guardrail,
      entries: this.entries,
      chainTip,
      signature: createHmac('sha256', this.secret).update(chainTip).digest('hex'),
    };
  }
}

export interface VerificationReport {
  valid: boolean;
  signatureValid: boolean;
  chainValid: boolean;
  brokenAt: number | null;
  reason: string;
}

/** Independently re-derive every hash and the signature. No trust in the file. */
export function verifyReceipt(receipt: Receipt, secret: string): VerificationReport {
  let prev = GENESIS;
  for (const e of receipt.entries) {
    const recomputed = sha256(
      canonical({
        index: e.index,
        timestamp: e.timestamp,
        thought: e.thought,
        action: e.action,
        outcome: e.outcome,
        healed: e.healed,
        detail: e.detail,
        screenshotSha256: e.screenshotSha256,
        snapshotSha256: e.snapshotSha256,
        prevHash: e.prevHash,
      }),
    );
    if (e.prevHash !== prev || recomputed !== e.entryHash) {
      return {
        valid: false,
        signatureValid: false,
        chainValid: false,
        brokenAt: e.index,
        reason: `Hash chain broken at step ${e.index}: the recorded action does not match its hash. The receipt was modified after signing.`,
      };
    }
    prev = e.entryHash;
  }

  const expectedSig = createHmac('sha256', secret).update(receipt.chainTip).digest('hex');
  const signatureValid = expectedSig === receipt.signature && receipt.chainTip === prev;

  return {
    valid: signatureValid,
    signatureValid,
    chainValid: true,
    brokenAt: null,
    reason: signatureValid
      ? 'Receipt is authentic and unmodified. Every step hashes correctly and the signature matches.'
      : 'Hash chain is intact but the signature does not match — wrong signing key, or the chain tip was altered.',
  };
}
