import type { PlanInput, PlanResult, AgentAction } from '../agent/types.js';
import { getLLM, chatJSON } from './provider.js';

const SYSTEM = `You are the planner for Veritrail, an autonomous web agent.
You are given a GOAL, a SNAPSHOT of the current page's interactive elements
(each with a role and an accessible name), the HISTORY of actions so far, and
sometimes a LAST_FAILURE describing why the previous attempt did not work.

Choose exactly ONE next action. Respond with ONLY a JSON object (no markdown, no
text before or after) of the form:
{"thought": string, "action": <action>}

where <action> is one of:
{"action":"navigate","url":string,"expectation":string}
{"action":"type","match":{"role":string,"name":string},"text":string,"expectation":string}
{"action":"click","match":{"role":string,"name":string},"expectation":string}
{"action":"extract","match":{"role":string,"name":string},"description":string,"expectation":string}
{"action":"finish","summary":string,"expectation":string}

Rules:
- Keep "thought" to ONE short sentence.
- Refer to elements ONLY by role + accessible name. Never invent ids or CSS selectors.
- Buttons/links may carry context after an em-dash (e.g. "Add to cart — Sauce Labs
  Bolt T-Shirt"). When several share the same base label, target the one whose
  context matches your goal item.
- "expectation" states what must be true after the action — keep it concrete and
  checkable from the page (e.g. "the button now reads Remove", "cart shows 1 item",
  "URL contains /checkout"). Avoid vague expectations like "item was added".
- If an action already succeeded (HISTORY shows it), do NOT repeat it; move on.
- If LAST_FAILURE says an element was not found, RE-READ the snapshot and pick the
  closest element that actually exists (the site may have been re-labelled).
- Call "finish" once the goal is satisfied and you have any requested data.`;

export async function plan(input: PlanInput): Promise<PlanResult> {
  const llm = getLLM();
  if (!llm) return mockPlan(input);

  const user = JSON.stringify(
    {
      GOAL: input.goal,
      SNAPSHOT: {
        url: input.snapshot.url,
        elements: input.snapshot.elements.map((e) => ({ role: e.role, name: e.name, value: e.value })),
        visibleText: input.snapshot.visibleText.slice(0, 600),
      },
      HISTORY: input.history.map((h) => ({ action: h.action.action, outcome: h.outcome, detail: h.detail })),
      LAST_FAILURE: input.lastFailure ?? null,
    },
    null,
    0,
  );

  return chatJSON<PlanResult>({ model: llm.plannerModel, system: SYSTEM, user, temperature: 0.1 });
}

/* ── Deterministic fallback so the product demos with zero credentials. ──
   It drives the bundled reimbursement-portal demo and, crucially, SELF-HEALS:
   if a step is reported as failed (because the site was "broken"), it re-reads
   the snapshot and targets the element that actually exists. */
function mockPlan(input: PlanInput): PlanResult {
  const done = new Set(input.history.filter((h) => h.outcome === 'ok').map((h) => h.action.action + ':' + key(h.action)));
  const has = (a: string, k = '') => done.has(a + ':' + k);

  if (!has('navigate')) {
    return wrap('I will open the reimbursement portal.', {
      action: 'navigate',
      url: input.goal.match(/https?:\/\/\S+/)?.[0] ?? 'http://localhost:3000/demo',
      expectation: 'The reimbursement form is visible.',
    });
  }
  if (!has('type', 'Amount')) {
    return wrap('Entering the claim amount.', {
      action: 'type',
      match: { role: 'textbox', name: 'Amount' },
      text: input.goal.match(/[₹$]?\s?([\d,]{2,})/)?.[1]?.replace(/,/g, '') ?? '2400',
      expectation: 'Amount field contains the value.',
    });
  }
  if (!has('type', 'Category')) {
    return wrap('Setting the category.', {
      action: 'type',
      match: { role: 'textbox', name: 'Category' },
      text: 'Meals',
      expectation: 'Category field is set.',
    });
  }
  if (!has('type', 'Description')) {
    return wrap('Adding the description.', {
      action: 'type',
      match: { role: 'textbox', name: 'Description' },
      text: input.goal.match(/['"]([^'"]+)['"]/)?.[1] ?? 'Client dinner',
      expectation: 'Description field is set.',
    });
  }
  if (!has('click', 'submit')) {
    // Self-heal: first try the originally-labelled button; if that failed,
    // target whatever submit-like button is actually present now.
    if (input.lastFailure) {
      const btn = input.snapshot.elements.find((e) => e.role === 'button' && /submit|send|claim|reimburse/i.test(e.name));
      return wrap(
        `The expected button was not found (${input.lastFailure}). Re-reading the page, the actual button is "${btn?.name ?? 'a submit button'}". Targeting it instead.`,
        { action: 'click', match: { role: 'button', name: btn?.name ?? 'Submit' }, expectation: 'A confirmation ID appears.' },
      );
    }
    return wrap('Submitting the claim.', {
      action: 'click',
      match: { role: 'button', name: 'Submit claim' },
      expectation: 'A confirmation ID appears on the page.',
    });
  }
  if (!has('extract')) {
    return wrap('Reading the confirmation ID from the page.', {
      action: 'extract',
      description: 'confirmation id',
      expectation: 'A confirmation ID like VT-XXXX is captured.',
    });
  }
  return wrap('Goal complete: claim submitted and confirmation captured.', {
    action: 'finish',
    summary: 'Submitted the reimbursement claim and captured the confirmation ID.',
    expectation: 'Done.',
  });
}

function key(a: AgentAction): string {
  if (a.action === 'type') return a.match.name;
  if (a.action === 'click') return /submit|send|claim|reimburse/i.test(a.match.name) ? 'submit' : a.match.name;
  return '';
}
function wrap(thought: string, action: AgentAction): PlanResult {
  return { thought, action };
}
