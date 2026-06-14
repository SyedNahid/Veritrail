/** A single interactive element as the agent perceives it (accessibility-first). */
export interface SnapshotElement {
  ref: string;        // stable per-snapshot handle injected as data-vt-ref
  role: string;       // button | link | textbox | combobox | checkbox | ...
  name: string;       // accessible name (visible text / label / placeholder)
  value?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
  /** Visible confirmation / status text the verifier can read. */
  visibleText: string;
}

/** How the planner refers to a target element — by meaning, never by brittle id. */
export interface ElementMatch {
  role: string;
  name: string; // matched case-insensitively as a substring
}

export type AgentAction =
  | { action: 'navigate'; url: string; expectation: string }
  | { action: 'type'; match: ElementMatch; text: string; expectation: string }
  | { action: 'click'; match: ElementMatch; expectation: string }
  | { action: 'extract'; match?: ElementMatch; description: string; expectation: string }
  | { action: 'finish'; summary: string; expectation: string };

export interface PlanInput {
  goal: string;
  snapshot: PageSnapshot;
  history: HistoryItem[];
  lastFailure?: string; // set when we are self-healing after a failed step
}

export interface HistoryItem {
  action: AgentAction;
  outcome: 'ok' | 'failed';
  detail: string;
}

export interface PlanResult {
  thought: string;
  action: AgentAction;
}

export interface VerifyResult {
  satisfied: boolean;
  reason: string;
}

/** One immutable, hash-chained entry in the action receipt. */
export interface ReceiptEntry {
  index: number;
  timestamp: string;
  thought: string;
  action: AgentAction;
  outcome: 'ok' | 'failed';
  healed: boolean;
  detail: string;
  screenshotSha256: string;
  snapshotSha256: string;
  prevHash: string;
  entryHash: string;
}

export interface Receipt {
  runId: string;
  goal: string;
  startedAt: string;
  finishedAt: string;
  guardrail: { decision: string; reason: string; engine: string };
  entries: ReceiptEntry[];
  chainTip: string;
  signature: string; // HMAC-SHA256(chainTip, secret)
}

/** Server-sent event payload streamed to the dashboard. */
export type AgentEvent =
  | { type: 'run_started'; runId: string; goal: string; mode: string }
  | { type: 'guardrail'; decision: string; reason: string; engine: string }
  | { type: 'thought'; text: string }
  | { type: 'action'; action: AgentAction }
  | { type: 'observation'; screenshot: string; url: string }
  | { type: 'verify'; satisfied: boolean; reason: string }
  | { type: 'heal'; attempt: number; reason: string }
  | { type: 'receipt_entry'; entry: ReceiptEntry }
  | { type: 'run_finished'; receipt: Receipt; success: boolean }
  | { type: 'error'; message: string };
