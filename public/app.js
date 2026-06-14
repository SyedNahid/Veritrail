const $ = (id) => document.getElementById(id);
const feed = $('feed'), links = $('links'), shot = $('shot'), shotUrl = $('shotUrl');
const statusPill = $('status'), verdict = $('verdict'), mode = $('mode'), shotEmpty = $('shotEmpty');
let currentReceipt = null, es = null;

fetch('/api/receipt/__none__').catch(() => {}); // warm
detectMode();

$('run').onclick = () => start(false);
$('runBroken').onclick = () => start(true);
$('baseline').onclick = runBaseline;
$('verify').onclick = () => verify(currentReceipt);
$('tamper').onclick = tamperAndVerify;

function detectMode() {
  // server prints mode; we infer from a tiny probe response header isn't exposed,
  // so just label generically until run_started tells us.
  mode.textContent = 'mode: ready';
}

function start(broken) {
  resetUI(broken ? 'running on changed site' : 'running');
  const goal = encodeURIComponent($('goal').value.trim());
  es?.close();
  es = new EventSource(`/api/run?break=${broken ? 1 : 0}&goal=${goal}`);
  es.onmessage = (m) => handle(JSON.parse(m.data));
  es.onerror = () => { es.close(); if (statusPill.textContent === 'running' || statusPill.classList.contains('live')) setStatus('stream closed', 'fail'); };
}

function resetUI(label) {
  feed.innerHTML = ''; links.innerHTML = ''; verdict.hidden = true;
  shot.removeAttribute('src'); shot.hidden = true; shotEmpty.hidden = false; shotUrl.textContent = '';
  $('baselineNote').hidden = true;
  $('verify').disabled = true; $('tamper').disabled = true;
  setStatus(label, 'live');
}
function setStatus(t, cls) { statusPill.textContent = t; statusPill.className = 'pill ' + (cls || ''); }

function addRow(ico, icoCls, html) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<div class="ico ${icoCls}">${ico}</div><div class="txt">${html}</div>`;
  feed.appendChild(row); feed.scrollTop = feed.scrollHeight;
}

function handle(e) {
  switch (e.type) {
    case 'run_started':
      mode.textContent = 'mode: ' + e.mode;
      addRow('goal', 'act', `<b>Goal.</b> ${escape(e.goal)}`); break;
    case 'guardrail':
      addRow('guard', 'guard', `<b>Guardrail (${e.engine}).</b> ${escape(e.reason)}`); break;
    case 'thought':
      addRow('think', 'think', escape(e.text)); break;
    case 'action':
      addRow('act', 'act', describe(e.action)); break;
    case 'observation':
      shot.src = e.screenshot; shot.hidden = false; shotEmpty.hidden = true; shotUrl.textContent = e.url; break;
    case 'verify':
      addRow(e.satisfied ? 'verify' : 'fail', e.satisfied ? 'ok' : 'bad',
        `<b>${e.satisfied ? 'Verified.' : 'Not satisfied.'}</b> ${escape(e.reason)}`); break;
    case 'heal':
      addRow('heal', 'heal', `<b>Self-heal #${e.attempt}.</b> ${escape(e.reason)}`); break;
    case 'receipt_entry':
      addLink(e.entry); break;
    case 'run_finished':
      currentReceipt = e.receipt;
      setStatus(e.success ? 'task complete' : 'ended', e.success ? 'done' : 'fail');
      $('verify').disabled = false; $('tamper').disabled = false;
      es?.close(); break;
    case 'error':
      addRow('err', 'bad', `<b>Error.</b> ${escape(e.message)}`); break;
  }
}

function describe(a) {
  if (a.action === 'navigate') return `<b>navigate</b> → <code>${escape(a.url)}</code>`;
  if (a.action === 'type') return `<b>type</b> "${escape(a.text)}" into <code>${escape(a.match.role)}:${escape(a.match.name)}</code>`;
  if (a.action === 'click') return `<b>click</b> <code>${escape(a.match.role)}:${escape(a.match.name)}</code>`;
  if (a.action === 'extract') return `<b>extract</b> ${escape(a.description)}`;
  if (a.action === 'finish') return `<b>finish</b> — ${escape(a.summary)}`;
  return a.action;
}

function addLink(entry) {
  const failed = entry.outcome === 'failed';
  const el = document.createElement('div');
  el.className = 'link' + (failed ? ' failed' : '');
  el.dataset.index = entry.index;
  const tags = [];
  if (entry.healed) tags.push('<span class="tag healed">healed</span>');
  if (entry.outcome === 'ok') tags.push('<span class="tag verified">verified</span>');
  el.innerHTML = `
    <div class="node"></div>
    <div class="block">
      <div class="head"><span class="step">Step ${entry.index}</span><span class="verb">${entry.action.action}</span></div>
      <div class="desc">${escape(entry.detail)}</div>
      <div>${tags.join('')}</div>
      <div class="hash"><b>hash</b> ${entry.entryHash.slice(0, 24)}…<br><b>prev</b> ${entry.prevHash.slice(0, 24)}…</div>
    </div>`;
  if (links.querySelector('.empty')) links.innerHTML = '';
  links.appendChild(el);
}

async function runBaseline() {
  const broken = false; // run the same broken toggle as last? keep simple: prompt both
  const useBroken = confirm('Run the naive script against the CHANGED site? (Cancel = unchanged site)');
  const note = $('baselineNote');
  note.hidden = false; note.className = 'banner'; note.textContent = 'Running naive hardcoded-selector script…';
  const r = await fetch(`/api/baseline?break=${useBroken ? 1 : 0}`).then((x) => x.json());
  note.className = 'banner ' + (r.ok ? 'ok' : 'bad');
  note.textContent = (useBroken ? '[changed site] ' : '[unchanged site] ') + r.message +
    (useBroken && !r.ok ? '  ← Veritrail recovered from this exact change.' : '');
}

async function verify(receipt) {
  if (!receipt) return;
  const report = await fetch('/api/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receipt }),
  }).then((r) => r.json());
  showVerdict(report);
}

async function tamperAndVerify() {
  if (!currentReceipt) return;
  // Forge a copy: silently flip a recorded action so the on-chain claim is false.
  const forged = JSON.parse(JSON.stringify(currentReceipt));
  const target = forged.entries.find((e) => e.action.action === 'type') || forged.entries[1] || forged.entries[0];
  if (target?.action?.text !== undefined) target.action.text = '999999';
  else target.detail = target.detail + ' (edited)';
  const report = await fetch('/api/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receipt: forged }),
  }).then((r) => r.json());
  // mark the broken node in the UI
  document.querySelectorAll('.link').forEach((l) => {
    if (report.brokenAt !== null && Number(l.dataset.index) >= report.brokenAt) l.classList.add('broken');
  });
  showVerdict(report, true);
}

function showVerdict(report, tampered) {
  verdict.hidden = false;
  verdict.className = 'verdict ' + (report.valid ? 'ok' : 'bad');
  const head = report.valid ? '✓ Receipt authentic and unmodified.' : '✗ Receipt rejected.';
  const extra = report.brokenAt !== null ? `  First broken step: ${report.brokenAt}.` : '';
  verdict.textContent = (tampered && report.valid ? '' : '') + head + ' ' + report.reason + extra;
}

function escape(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
