import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  headless: (process.env.HEADLESS ?? 'true') !== 'false',
  signingSecret: process.env.VERITRAIL_SIGNING_SECRET ?? 'change-me-in-production',

  // Which LLM backend to use: 'auto' | 'azure' | 'grok' | 'groq' | 'mock'.
  llmProvider: (process.env.LLM_PROVIDER ?? 'auto').toLowerCase(),

  azureOpenAI: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    apiKey: process.env.AZURE_OPENAI_API_KEY ?? '',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
    plannerDeployment: process.env.AZURE_OPENAI_PLANNER_DEPLOYMENT ?? 'gpt-4o',
    verifierDeployment: process.env.AZURE_OPENAI_VERIFIER_DEPLOYMENT ?? 'gpt-4o-mini',
  },

  // xAI Grok — OpenAI-compatible (api.x.ai). Fallback / dev unblock.
  grok: {
    apiKey: process.env.XAI_API_KEY ?? '',
    baseUrl: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
    model: process.env.XAI_MODEL ?? 'grok-4.3',
  },

  // Groq — fast OpenAI-compatible inference (api.groq.com), hosts Llama etc.
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? '',
    baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  },

  contentSafety: {
    endpoint: process.env.AZURE_CONTENT_SAFETY_ENDPOINT ?? '',
    apiKey: process.env.AZURE_CONTENT_SAFETY_KEY ?? '',
  },
};

/** True when real Azure OpenAI credentials are present. Otherwise we run the
 *  deterministic mock planner so the product still demos end-to-end. */
export const usingAzure = Boolean(config.azureOpenAI.endpoint && config.azureOpenAI.apiKey);

/** True when Azure Content Safety is configured. */
export const usingContentSafety = Boolean(config.contentSafety.endpoint && config.contentSafety.apiKey);
