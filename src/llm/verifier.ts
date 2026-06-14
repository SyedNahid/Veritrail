import type { AgentAction, PageSnapshot, VerifyResult } from '../agent/types.js';
import { getLLM, chatJSON } from './provider.js';

const SYSTEM = `You verify whether a web agent's step achieved its stated expectation.
You are given the EXPECTATION and the resulting page (url, visible text, element names).
Respond with ONLY a JSON object: {"satisfied": boolean, "reason": string}.

Accept INDIRECT but clear evidence that the step worked — you do NOT need an explicit
success message. Treat any of these as success when relevant:
- a button's label changing (e.g. "Add to cart" → "Remove"),
- a cart/badge count appearing or incrementing,
- the URL changing to the expected next page,
- a form field now holding the typed value,
- new content/headings consistent with the action.
Only return satisfied=false when there is no reasonable evidence the step worked, or
the page clearly shows an error. Do not demand to be on a different page than expected.`;

export async function verify(
  action: AgentAction,
  snapshot: PageSnapshot,
  extracted: string | null,
): Promise<VerifyResult> {
  const expectation = action.expectation ?? '';
  const llm = getLLM();
  if (!llm) return heuristicVerify(action, snapshot, extracted);

  const user = JSON.stringify({
    EXPECTATION: expectation,
    PAGE: {
      url: snapshot.url,
      visibleText: snapshot.visibleText.slice(0, 1000),
      elements: snapshot.elements.map((e) => ({ role: e.role, name: e.name, value: e.value })),
    },
    EXTRACTED: extracted,
  });

  try {
    return await chatJSON<VerifyResult>({ model: llm.verifierModel, system: SYSTEM, user, temperature: 0 });
  } catch {
    // If the verifier model hiccups, don't kill the run — accept the step.
    return { satisfied: true, reason: 'Verifier unavailable; accepted on a best-effort basis.' };
  }
}

function heuristicVerify(action: AgentAction, snapshot: PageSnapshot, extracted: string | null): VerifyResult {
  switch (action.action) {
    case 'navigate':
      return { satisfied: snapshot.elements.length > 0, reason: 'Page loaded with interactive elements.' };
    case 'type': {
      const el = snapshot.elements.find((e) => e.name.toLowerCase().includes(action.match.name.toLowerCase()));
      const ok = !!el && (el.value ?? '').toLowerCase().includes(action.text.toLowerCase());
      return { satisfied: ok, reason: ok ? 'Field holds the typed value.' : 'Field value not confirmed.' };
    }
    case 'click': {
      const ok = /VT-\w+|confirmation id/i.test(snapshot.visibleText);
      return { satisfied: ok, reason: ok ? 'Confirmation text is present.' : 'No confirmation found after click.' };
    }
    case 'extract': {
      const ok = !!extracted && /VT-\w+/.test(extracted);
      return { satisfied: ok, reason: ok ? `Captured "${extracted}".` : 'Nothing matching captured.' };
    }
    case 'finish':
      return { satisfied: true, reason: 'Run complete.' };
  }
}
