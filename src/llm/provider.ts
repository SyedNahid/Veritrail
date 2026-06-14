import OpenAI, { AzureOpenAI } from 'openai';
import { config } from '../config.js';

export type Provider = 'azure' | 'grok' | 'mock';

export interface LLM {
  provider: Provider;
  client: OpenAI; // AzureOpenAI extends OpenAI, so one type covers both
  plannerModel: string;
  verifierModel: string;
}

/**
 * Decide which backend to use. LLM_PROVIDER pins a choice; 'auto' (default)
 * prefers Azure, then the OpenAI-compatible provider (Grok/Groq/etc.), then the
 * deterministic mock. Optional chaining keeps a missing config block from
 * crashing the server — it just falls back to mock.
 */
export function resolveProvider(): Provider {
  const azureReady = Boolean(config.azureOpenAI?.endpoint && config.azureOpenAI?.apiKey);
  const grokReady = Boolean(config.grok?.apiKey);

  switch (config.llmProvider) {
    case 'azure':
      return azureReady ? 'azure' : 'mock';
    case 'grok':
    case 'groq': // accept either spelling — both use the OpenAI-compatible slot
      return grokReady ? 'grok' : 'mock';
    case 'mock':
      return 'mock';
    default: // 'auto'
      if (azureReady) return 'azure';
      if (grokReady) return 'grok';
      return 'mock';
  }
}

/** Human-readable label for the resolved backend, based on the endpoint host. */
export function providerLabel(): string {
  const p = resolveProvider();
  if (p === 'azure') return 'azure-openai';
  if (p === 'mock') return 'mock-llm';
  const url = config.grok?.baseUrl ?? '';
  if (url.includes('groq.com')) return 'groq';
  if (url.includes('x.ai')) return 'xai-grok';
  return 'openai-compatible';
}

let cached: LLM | null | undefined;

/** Returns a ready LLM client, or null when running in mock mode. */
export function getLLM(): LLM | null {
  if (cached !== undefined) return cached;
  const provider = resolveProvider();

  if (provider === 'azure') {
    cached = {
      provider,
      client: new AzureOpenAI({
        endpoint: config.azureOpenAI.endpoint,
        apiKey: config.azureOpenAI.apiKey,
        apiVersion: config.azureOpenAI.apiVersion,
      }),
      plannerModel: config.azureOpenAI.plannerDeployment,
      verifierModel: config.azureOpenAI.verifierDeployment,
    };
  } else if (provider === 'grok') {
    // Any OpenAI-compatible endpoint: xAI Grok, Groq, etc. Same SDK, custom baseURL.
    const client = new OpenAI({ apiKey: config.grok.apiKey, baseURL: config.grok.baseUrl });
    cached = { provider, client, plannerModel: config.grok.model, verifierModel: config.grok.model };
  } else {
    cached = null;
  }
  return cached;
}

/** Tolerant JSON parse — strips code fences and grabs the first {...} block. */
export function parseJsonObject<T>(raw: string): T {
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}

/**
 * Resilient JSON chat. Uses strict json_object mode only on Azure (where it's
 * reliable); for OpenAI-compatible providers like Groq it relies on the prompt +
 * tolerant parsing, since their strict-JSON mode can 400 on valid-looking output.
 * Retries once on a transient failure before giving up.
 */
export async function chatJSON<T>(opts: {
  model: string;
  system: string;
  user: string;
  temperature: number;
}): Promise<T> {
  const llm = getLLM();
  if (!llm) throw new Error('No LLM provider configured');

  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  };
  if (llm.provider === 'azure') body.response_format = { type: 'json_object' };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await llm.client.chat.completions.create(body as any);
      return parseJsonObject<T>(res.choices[0]?.message?.content ?? '');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
