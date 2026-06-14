import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { runAgent } from './agent/orchestrator.js';
import { demoSiteHtml } from './demo/target.js';
import { verifyReceipt } from './receipts/ledger.js';
import { providerLabel } from './llm/provider.js';
import { BrowserDriver } from './browser/driver.js';
import type { AgentEvent, Receipt } from './agent/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// In-memory receipt store (a DB would back this in production).
const receipts = new Map<string, Receipt>();

/** The site the agent operates on. ?break=1 renames the submit button. */
app.get('/demo', (req, res) => {
  res.type('html').send(demoSiteHtml(req.query.break === '1'));
});

/** Stream a full agent run over Server-Sent Events. */
app.get('/api/run', async (req, res) => {
  const broken = req.query.break === '1';
  const goal =
    String(req.query.goal ?? '') ||
    `Submit a reimbursement claim for ₹2400 for "Client dinner" at http://localhost:${config.port}/demo${broken ? '?break=1' : ''} and capture the confirmation ID.`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const emit = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  try {
    const receipt = await runAgent(goal, emit);
    receipts.set(receipt.runId, receipt);
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  } finally {
    res.end();
  }
});

/** The naive baseline, for the side-by-side contrast: hardcoded id selector. */
app.get('/api/baseline', async (req, res) => {
  const broken = req.query.break === '1';
  const driver = new BrowserDriver();
  try {
    await driver.launch();
    await driver.navigate(`http://localhost:${config.port}/demo${broken ? '?break=1' : ''}`);
    await driver.typeRef((await find(driver, 'Amount')) ?? 'r0', '2400');
    await driver.baselineSubmitByHardcodedId();
    res.json({ ok: true, message: 'Baseline succeeded (site unchanged).' });
  } catch (err) {
    res.json({ ok: false, message: `Baseline FAILED: ${(err as Error).message.split('\n')[0]}` });
  } finally {
    await driver.close();
  }
});

async function find(driver: BrowserDriver, name: string): Promise<string | null> {
  const snap = await driver.snapshot();
  return driver.resolve(snap, { role: 'textbox', name })?.ref ?? null;
}

app.get('/api/receipt/:id', (req, res) => {
  const r = receipts.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
});

/** Verify any receipt — optionally a tampered copy posted back to us. */
app.post('/api/verify', (req, res) => {
  const receipt = (req.body?.receipt ?? receipts.get(req.body?.runId)) as Receipt | undefined;
  if (!receipt) return res.status(400).json({ error: 'provide { receipt } or { runId }' });
  res.json(verifyReceipt(receipt, config.signingSecret));
});

app.listen(config.port, () => {
  console.log(`\n  Veritrail running → http://localhost:${config.port}`);
  console.log(`  LLM provider: ${providerLabel()}\n`);
});
