import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { BrowserDriver } from '../browser/driver.js';
import { plan } from '../llm/planner.js';
import { verify } from '../llm/verifier.js';
import { providerLabel } from '../llm/provider.js';
import { screenPrompt } from '../guardrail/contentSafety.js';
import { ReceiptLedger, sha256 } from '../receipts/ledger.js';
import type { AgentAction, AgentEvent, HistoryItem, Receipt } from './types.js';

const MAX_STEPS = 22;
const MAX_HEALS_PER_STEP = 3;

type Emit = (e: AgentEvent) => void;

export async function runAgent(goal: string, emit: Emit): Promise<Receipt> {
  const runId = randomUUID().slice(0, 8);
  const mode = providerLabel();
  emit({ type: 'run_started', runId, goal, mode });

  const guardrail = await screenPrompt(goal);
  emit({ type: 'guardrail', ...guardrail });

  const ledger = new ReceiptLedger(runId, goal, config.signingSecret);
  const driver = new BrowserDriver();
  const history: HistoryItem[] = [];
  let success = false;

  if (guardrail.decision === 'block') {
    const receipt = ledger.seal(guardrail);
    emit({ type: 'run_finished', receipt, success: false });
    return receipt;
  }

  await driver.launch();
  try {
    let lastFailure: string | undefined;
    let healsThisStep = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const snapshot = await driver.snapshot();

      const { thought, action } = await plan({ goal, snapshot, history, lastFailure });
      emit({ type: 'thought', text: thought });
      emit({ type: 'action', action });

      const { outcome, detail, healed, extracted } = await execute(driver, action, lastFailure !== undefined);

      const after = await driver.snapshot();
      const shot = await driver.screenshot();
      emit({ type: 'observation', screenshot: `data:image/png;base64,${shot.toString('base64')}`, url: after.url });

      let satisfied = outcome === 'ok';
      if (outcome === 'ok' && action.action !== 'finish') {
        const v = await verify(action, after, extracted);
        satisfied = v.satisfied;
        emit({ type: 'verify', satisfied: v.satisfied, reason: v.reason });
      }

      const finalOutcome: 'ok' | 'failed' = satisfied ? 'ok' : 'failed';
      const entry = ledger.append({
        thought,
        action,
        outcome: finalOutcome,
        healed,
        detail: extracted ? `${detail} | captured: ${extracted}` : detail,
        screenshotSha256: sha256(shot),
        snapshotSha256: sha256(JSON.stringify(after)),
      });
      emit({ type: 'receipt_entry', entry });

      if (finalOutcome === 'failed') {
        healsThisStep++;
        if (healsThisStep > MAX_HEALS_PER_STEP) {
          emit({ type: 'error', message: `Gave up after ${MAX_HEALS_PER_STEP} self-heal attempts on one step.` });
          break;
        }
        lastFailure = detail;
        emit({ type: 'heal', attempt: healsThisStep, reason: detail });
        history.push({ action, outcome: 'failed', detail });
        continue;
      }

      // success on this step
      healsThisStep = 0;
      lastFailure = undefined;
      history.push({ action, outcome: 'ok', detail });

      if (action.action === 'finish') {
        success = true;
        break;
      }
    }
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  } finally {
    await driver.close();
  }

  const receipt = ledger.seal(guardrail);
  emit({ type: 'run_finished', receipt, success });
  return receipt;
}

async function execute(
  driver: BrowserDriver,
  action: AgentAction,
  healing: boolean,
): Promise<{ outcome: 'ok' | 'failed'; detail: string; healed: boolean; extracted: string | null }> {
  try {
    switch (action.action) {
      case 'navigate':
        await driver.navigate(action.url);
        return { outcome: 'ok', detail: `Navigated to ${action.url}`, healed: healing, extracted: null };

      case 'type': {
        const snap = await driver.snapshot();
        const el = driver.resolve(snap, action.match);
        if (!el) return fail(`No ${action.match.role} named "${action.match.name}" was found.`, healing);
        await driver.typeRef(el.ref, action.text);
        return { outcome: 'ok', detail: `Typed into "${el.name}"`, healed: healing, extracted: null };
      }

      case 'click': {
        const snap = await driver.snapshot();
        const el = driver.resolve(snap, action.match);
        if (!el) return fail(`No ${action.match.role} named "${action.match.name}" was found.`, healing);
        await driver.clickRef(el.ref);
        return { outcome: 'ok', detail: `Clicked "${el.name}"`, healed: healing, extracted: null };
      }

      case 'extract': {
        const snap = await driver.snapshot();
        const text = snap.visibleText;
        const desc = (action.description ?? '').toLowerCase();
        // 1) explicit codes: demo VT- ids, or "Order #1234 / Confirmation: ABC123"
        const code =
          text.match(/VT-[A-Z0-9]+/)?.[0] ??
          text.match(/\b(?:order|confirmation|ref(?:erence)?)\s*#?\s*[:\-]?\s*([A-Z0-9-]{3,})/i)?.[0];
        // 2) the line that best matches the description's keywords
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        const kws = desc.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
        const line = kws.length ? lines.find((l) => kws.some((k) => l.toLowerCase().includes(k))) : undefined;
        const extracted = code ?? line ?? lines[0] ?? null;
        if (!extracted) return fail('Could not find the requested data on the page.', healing);
        return { outcome: 'ok', detail: `Extracted ${action.description}`, healed: healing, extracted };
      }

      case 'finish':
        return { outcome: 'ok', detail: action.summary, healed: healing, extracted: null };
    }
  } catch (err) {
    return fail((err as Error).message, healing);
  }
}

function fail(detail: string, healing: boolean) {
  return { outcome: 'failed' as const, detail, healed: healing, extracted: null };
}
