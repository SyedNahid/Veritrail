# Veritrail

**An autonomous web agent that recovers from failure — and proves every action it took.**

Theme: *Agentic Web* · Microsoft Build AI 2026

Most web agents can click around a site. The moment the site changes a button or
an `id`, brittle automations break — and even when they work, you have no
trustworthy record of *what the agent actually did* on your behalf. Veritrail
fixes both halves:

1. **Self-healing execution.** The agent perceives pages through their
   accessibility tree (role + accessible name), not CSS selectors. When a step
   fails — element renamed, moved, or missing — it re-reads the page and replans,
   instead of crashing.
2. **A verifiable action receipt.** Every step is hashed into a tamper-evident
   chain and the chain is signed. Anyone can independently re-verify the run and
   detect, to the exact step, if a record was altered after the fact. This is the
   trust layer that makes an autonomous web agent safe to deploy in an enterprise.

---

## Why it matters

A finance team can let an agent file 200 reimbursement claims overnight — and the
next morning hand auditors a signed receipt proving each claim's amount, the page
state at submission, and the confirmation ID, with cryptographic assurance that
nothing was edited. If the portal's UI changed mid-run, the receipt shows the
agent detected it and recovered. That auditability is what current web agents lack.

## Architecture

```
                 ┌──────────────────────────────────────────────┐
   Goal  ───────▶│  Guardrail  (Azure AI Content Safety —          │
                 │  Prompt Shield + action risk tiering)          │
                 └───────────────────────┬──────────────────────┘
                                         │ allow / confirm / block
                                         ▼
        ┌────────────────  Orchestrator: plan → act → verify → heal ───────────────┐
        │                                                                          │
        │   Planner            Browser (Playwright)            Verifier            │
        │  Azure OpenAI   ──▶  real Chromium, a11y-tree   ──▶  Azure OpenAI         │
        │  GPT-4o              snapshot + screenshot           GPT-4o-mini          │
        │  (one action            navigate/type/click/         (postcondition       │
        │   at a time)            extract                       check)              │
        │       ▲                      │                          │                │
        │       └──── replan on ───────┴──── failed ◀─────────────┘                │
        │            failure (self-heal, max 3/step)                               │
        └───────────────────────────────┬──────────────────────────────────────────┘
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │  Receipt Ledger — SHA-256 hash chain,          │
                 │  HMAC-signed. Per step: action, screenshot     │
                 │  hash, snapshot hash, prev-hash, entry-hash.   │
                 └──────────────────────────────────────────────┘
```

Each receipt entry commits to the previous entry's hash, so editing any past step
invalidates every entry after it. The sealed chain tip is signed with HMAC-SHA256;
`npm run verify` re-derives everything from scratch and reports PASS/FAIL plus the
first broken step.

## Microsoft AI stack

| Component | Microsoft technology |
|---|---|
| Planner (decides the next action) | **Azure OpenAI** GPT-4o via Azure AI Foundry |
| Verifier (checks each step's postcondition) | **Azure OpenAI** GPT-4o-mini |
| Prompt-injection guardrail | **Azure AI Content Safety** — Prompt Shield |

> Runs without credentials too: with no Azure key set, Veritrail uses a
> deterministic planner so a **real Chromium browser still drives the demo and
> self-heals**. Only the LLM reasoning is stubbed. This is what makes the live
> demo reliable for judges.

## Setup

```bash
npm install            # installs deps and downloads Chromium for Playwright
cp .env.example .env   # optional: add Azure keys to switch from mock to GPT-4o
npm run dev            # → http://localhost:3000
```

Requirements: Node 18+. (If the Chromium download is blocked on your network,
run `npx playwright install chromium` once on an unrestricted connection.)

## Demo (90 seconds)

1. Open `http://localhost:3000`. Click **Run task** — watch the agent fill and
   submit a reimbursement claim on the bundled portal, step by step, and the
   receipt chain build on the right.
2. Click **Run on changed site** — the portal's submit button is renamed. The
   agent's first attempt misses, a **self-heal** event fires, it re-reads the
   page and recovers. Step 4 shows amber (failed), step 5 verified.
3. Click **Run naive script** → choose the changed site → it **fails outright**
   on the hardcoded selector. Same change, opposite outcome.
4. Click **Verify** → "Receipt authentic and unmodified."
5. Click **Tamper & re-verify** → a forged copy flips one recorded value; the
   chain turns **red from the exact altered step** and verification is rejected.

Verify a saved receipt from the CLI:

```bash
curl -s localhost:3000/api/receipt/<runId> > receipt.json
npm run verify -- receipt.json
```

## Project layout

```
src/
  agent/orchestrator.ts   plan → act → verify → heal loop
  agent/types.ts          shared types
  browser/driver.ts       Playwright; accessibility-first snapshots + actions
  llm/planner.ts          Azure GPT-4o planner (+ deterministic fallback)
  llm/verifier.ts         Azure GPT-4o-mini postcondition verifier
  guardrail/contentSafety.ts  Azure Content Safety Prompt Shield + risk tiering
  receipts/ledger.ts      hash chain, signing, independent verification
  demo/target.ts          bundled reimbursement portal (with ?break toggle)
  server.ts               Express + SSE + receipt store
public/                   live dashboard (vanilla, SSE-driven)
scripts/verify-receipt.ts CLI receipt verifier
```

## AI tools used (disclosure)

Per hackathon rules: GitHub Copilot was used as a coding assistant during
development. All architecture, the self-healing loop, the guardrail integration,
and the hash-chained receipt design represent the team's own engineering and design.

## Security notes

- No secrets are committed; configuration is via `.env` (git-ignored).
- Page content is treated as untrusted and screened by Prompt Shield before it can
  influence planning (defends against indirect prompt injection from a web page).
- Money/send/delete actions are tiered to require human confirmation.

## Team

- *<Your name>* — <role>. (Add 1–3 members with roles, per submission rules.)

## License

MIT.
