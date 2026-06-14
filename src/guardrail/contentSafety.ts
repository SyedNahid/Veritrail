import { config, usingContentSafety } from '../config.js';
import type { AgentAction } from '../agent/types.js';

export interface GuardrailResult {
  decision: 'allow' | 'confirm' | 'block';
  reason: string;
  engine: string;
}

/**
 * Pre-flight guardrail. Two jobs:
 *  1) Detect prompt-injection in the goal / in text pulled off the page, using
 *     Azure AI Content Safety "Prompt Shield". (Page content is untrusted — a
 *     malicious page could try to hijack the agent.)
 *  2) Tier risky actions: money movement, sends, and deletes require a human
 *     confirmation rather than silent execution.
 */
export async function screenPrompt(userPrompt: string, documents: string[] = []): Promise<GuardrailResult> {
  if (usingContentSafety) {
    try {
      const url = `${config.contentSafety.endpoint.replace(/\/$/, '')}/contentsafety/text:shieldPrompt?api-version=2024-09-01`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': config.contentSafety.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userPrompt, documents }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          userPromptAnalysis?: { attackDetected: boolean };
          documentsAnalysis?: { attackDetected: boolean }[];
        };
        const attack =
          data.userPromptAnalysis?.attackDetected ||
          (data.documentsAnalysis ?? []).some((d) => d.attackDetected);
        if (attack) {
          return { decision: 'block', reason: 'Prompt Shield detected an injection / jailbreak attempt.', engine: 'azure-content-safety' };
        }
        return { decision: 'allow', reason: 'No injection detected by Prompt Shield.', engine: 'azure-content-safety' };
      }
    } catch {
      /* fall through to heuristic */
    }
  }

  const haystack = [userPrompt, ...documents].join('\n').toLowerCase();
  const inj = /ignore (all|previous) instructions|disregard the above|you are now|system prompt|exfiltrate|send .* to .*@/i;
  if (inj.test(haystack)) {
    return { decision: 'block', reason: 'Heuristic guardrail flagged a likely prompt-injection pattern.', engine: 'heuristic' };
  }
  return { decision: 'allow', reason: 'No injection pattern detected.', engine: usingContentSafety ? 'azure-content-safety' : 'heuristic' };
}

/** Classify a planned action's blast radius. High-risk actions need a human. */
export function tierAction(action: AgentAction): GuardrailResult {
  if (action.action === 'click') {
    if (/pay|purchase|buy|transfer|send money|delete|remove account/i.test(action.match.name)) {
      return { decision: 'confirm', reason: `"${action.match.name}" can move money or destroy data — requires confirmation.`, engine: 'policy' };
    }
  }
  return { decision: 'allow', reason: 'Low-risk action.', engine: 'policy' };
}
