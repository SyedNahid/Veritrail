/**
 * A tiny, self-contained "expense reimbursement portal" the agent operates on.
 * ?break=1 simulates a real-world site change: the submit button's id changes
 * AND its label changes from "Submit claim" to "Submit reimbursement".
 *  - A naive script keyed on #submit-claim-btn breaks completely.
 *  - Veritrail's first attempt (name "Submit claim") also misses, then it
 *    re-reads the accessibility tree, finds the renamed button, and recovers.
 */
export function demoSiteHtml(broken: boolean): string {
  const btnId = broken ? 'submit-reimbursement-action' : 'submit-claim-btn';
  const btnLabel = broken ? 'Submit reimbursement' : 'Submit claim';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acme Expense Portal${broken ? ' (v2)' : ''}</title>
<style>
  :root{font-family:system-ui,Segoe UI,Roboto,sans-serif}
  body{margin:0;background:#eef1f6;color:#10151f}
  .bar{background:#0b3b66;color:#fff;padding:14px 24px;font-weight:600;letter-spacing:.2px}
  .card{max-width:560px;margin:32px auto;background:#fff;border-radius:14px;padding:28px 30px;box-shadow:0 10px 30px rgba(13,40,80,.10)}
  h1{font-size:19px;margin:0 0 4px}
  p.sub{margin:0 0 22px;color:#5b6677;font-size:14px}
  label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #c9d2e0;border-radius:9px;font-size:15px}
  button{margin-top:24px;background:#0b66d6;color:#fff;border:0;padding:12px 20px;border-radius:9px;font-size:15px;font-weight:600;cursor:pointer}
  .ok{margin-top:22px;padding:14px 16px;border-radius:10px;background:#e8f7ee;border:1px solid #b4e3c6;color:#0c6b39;font-weight:600;display:none}
</style></head>
<body>
  <div class="bar">Acme Expense Portal</div>
  <div class="card">
    <h1>New reimbursement claim</h1>
    <p class="sub">Submit out-of-pocket expenses for approval.</p>
    <label for="amount">Amount (₹)</label>
    <input id="amount" name="amount" autocomplete="off" />
    <label for="category">Category</label>
    <input id="category" name="category" autocomplete="off" />
    <label for="description">Description</label>
    <input id="description" name="description" autocomplete="off" />
    <button id="${btnId}" type="button" onclick="submitClaim()">${btnLabel}</button>
    <div id="confirmation" class="ok"></div>
  </div>
<script>
  function submitClaim(){
    var amt=document.getElementById('amount').value.trim();
    if(!amt){return;}
    var id='VT-'+Math.random().toString(36).slice(2,7).toUpperCase();
    var c=document.getElementById('confirmation');
    c.textContent='Claim submitted. Confirmation ID: '+id;
    c.style.display='block';
  }
</script>
</body></html>`;
}
