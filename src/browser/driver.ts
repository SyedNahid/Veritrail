import { chromium, type Browser, type Page } from 'playwright';
import { config } from '../config.js';
import type { ElementMatch, PageSnapshot, SnapshotElement } from '../agent/types.js';

/**
 * Wraps a real Chromium page. The agent perceives the page through its
 * accessibility tree (role + accessible name), NOT raw CSS/ids — this is what
 * lets it survive a site that renames ids or moves elements around.
 */
export class BrowserDriver {
  private browser!: Browser;
  private page!: Page;

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: config.headless,
      // Required for running Chromium inside containers (Render/Docker/Fly).
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    this.page = await this.browser.newPage({ viewport: { width: 1280, height: 800 } });
    // tsx/esbuild injects a __name() helper into functions; page.evaluate ships
    // those into the browser where __name is undefined. Define a no-op shim on
    // every document so evaluated snapshot code runs. (String form, so it isn't
    // itself transformed by esbuild.)
    await this.page.addInitScript('globalThis.__name = globalThis.__name || function (f) { return f; };');
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  /** Inject stable refs and read the accessibility tree of interactive elements. */
  async snapshot(): Promise<PageSnapshot> {
    // Passed as a STRING (not a function) so the bundler/tsx can't inject
    // helpers like __name that throw a ReferenceError inside page.evaluate.
    const script = `(() => {
      const accessibleName = (el) => {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const id = el.getAttribute('id');
        if (id) {
          const lbl = document.querySelector('label[for="' + id + '"]');
          if (lbl && lbl.textContent) return lbl.textContent.trim();
        }
        const ph = el.getAttribute('placeholder');
        if (ph) return ph.trim();
        const text = el.innerText ? el.innerText.trim() : '';
        if (text) return text;
        return el.value ? String(el.value).trim() : '';
      };
      const roleOf = (el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'a') return 'link';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'button') return 'button';
        if (tag === 'input') {
          const t = el.type;
          if (['button', 'submit', 'reset'].indexOf(t) !== -1) return 'button';
          if (t === 'checkbox') return 'checkbox';
          if (t === 'radio') return 'radio';
          return 'textbox';
        }
        return el.getAttribute('role') || 'generic';
      };
      const cardSel = '[class*="item"], [class*="product"], [class*="card"], li, article, tr';
      const titleSel = '[class*="name"], [class*="title"], h1, h2, h3, h4';
      const contextFor = (el, role, name) => {
        if (role !== 'button' && role !== 'link') return '';
        const card = el.closest(cardSel);
        if (!card) return '';
        const t = card.querySelector(titleSel);
        const txt = t && t.textContent ? t.textContent.trim() : '';
        if (txt && txt.toLowerCase() !== name.toLowerCase() && txt.length <= 80) return txt;
        return '';
      };
      const hintFor = (el, name) => {
        if (name && !/^\\d+$/.test(name)) return '';
        const raw = el.getAttribute('title') || el.id || el.className || '';
        return String(raw).replace(/[-_]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 40);
      };
      const nodes = Array.from(
        document.querySelectorAll('button, a, input, textarea, select, [role="button"]')
      );
      const elements = nodes.map((el, i) => {
        const ref = 'r' + i;
        el.setAttribute('data-vt-ref', ref);
        const role = roleOf(el);
        let name = accessibleName(el);
        const hint = hintFor(el, name);
        if (hint) name = (name ? name + ' ' : '') + hint;
        const ctx = contextFor(el, role, name);
        if (ctx) name = name + ' — ' + ctx;
        return { ref: ref, role: role, name: name, value: el.value || undefined };
      });
      return {
        url: location.href,
        title: document.title,
        elements: elements,
        visibleText: (document.body.innerText || '').slice(0, 2000)
      };
    })()`;
    const data = await this.page.evaluate(script);
    return data as unknown as PageSnapshot;
  }

  /** Resolve a semantic match to a concrete element ref. Null = not found → heal. */
  resolve(snapshot: PageSnapshot, match: ElementMatch): SnapshotElement | null {
    const want = match.name.toLowerCase();
    const sameRole = snapshot.elements.filter(
      (e) => e.role === match.role || (match.role === 'button' && e.role === 'button'),
    );
    return (
      sameRole.find((e) => e.name.toLowerCase().includes(want)) ??
      sameRole.find((e) => want.includes(e.name.toLowerCase()) && e.name.length > 1) ??
      null
    );
  }

  async clickRef(ref: string): Promise<void> {
    await this.page.locator(`[data-vt-ref="${ref}"]`).click({ timeout: 4000 });
    await this.page.waitForTimeout(250);
  }

  async typeRef(ref: string, text: string): Promise<void> {
    const loc = this.page.locator(`[data-vt-ref="${ref}"]`);
    await loc.fill(text, { timeout: 4000 });
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ type: 'png' });
  }

  url(): string {
    return this.page.url();
  }

  /** Naive baseline used only to demonstrate the contrast: hardcoded id selector. */
  async baselineSubmitByHardcodedId(): Promise<void> {
    await this.page.locator('#submit-claim-btn').click({ timeout: 3000 });
  }
}
