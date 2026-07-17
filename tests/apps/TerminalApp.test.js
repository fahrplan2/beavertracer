//@ts-check

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalApp } from '../../src/apps/TerminalApp.js';
import { VirtualFileSystem } from '../../src/apps/lib/VirtualFileSystem.js';

// ── Minimal DOM stub ──────────────────────────────────────────────────────────
// Unlike the other App tests' inert stub, _paintRows()/_renderScreen() actually
// need appendChild/replaceChildren to track children so we can assert on the
// rendered <span class="term-stderr"> runs.

/** @param {string} tag */
function makeFakeEl(tag) {
  /** @type {any} */
  const el = {
    tagName: tag,
    className: '',
    textContent: '',
    style: {},
    children: /** @type {any[]} */ ([]),
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    remove() {},
    contains() { return false; },
    appendChild(/** @type {any} */ child) { el.children.push(child); return child; },
    replaceChildren(/** @type {any[]} */ ...nodes) {
      /** @type {any[]} */
      const flat = [];
      for (const n of nodes) {
        if (n && n.__fragment) flat.push(...n.children);
        else flat.push(n);
      }
      el.children = flat;
    },
    get scrollTop() { return 0; },
    set scrollTop(_v) {},
    get scrollHeight() { return 0; },
  };
  return el;
}

if (!globalThis.document) {
  // @ts-ignore
  globalThis.document = {
    createElement: (/** @type {string} */ tag) => makeFakeEl(tag),
    createTextNode: (/** @type {string} */ text) => ({ nodeType: 3, textContent: text }),
    createDocumentFragment: () => ({ __fragment: true, children: /** @type {any[]} */ ([]), appendChild(/** @type {any} */ child) { this.children.push(child); } }),
    documentElement: { lang: '' },
  };
}
if (!globalThis.window) {
  // @ts-ignore
  globalThis.window = { matchMedia: () => ({ matches: false }), getSelection: () => ({ isCollapsed: true, toString: () => '' }) };
}

/**
 * Flattens outEl's rendered children into plain text, wrapping stderr runs
 * (spans with class "term-stderr") in <<>> markers so tests can assert on
 * which parts of the output were colored red without a real DOM. The
 * underlying screen is a fixed rows×cols grid space-padded to full width,
 * so trailing padding/blank rows are trimmed to compare against what a
 * user would actually perceive.
 * @param {any} outEl
 */
function renderedText(outEl) {
  const raw = outEl.children
    .map((/** @type {any} */ node) => {
      if (node.nodeType === 3) return node.textContent;
      if (node.className === 'term-stderr') return `<<${node.textContent}>>`;
      return node.textContent ?? '';
    })
    .join('');

  return raw
    .split('\n')
    .map((line) => line.replace(/ +$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');
}

describe('TerminalApp (end-to-end through the real command registry)', () => {
  /** @type {TerminalApp} */
  let app;
  /** @type {VirtualFileSystem} */
  let fs;

  beforeEach(() => {
    fs = new VirtualFileSystem();
    const os = /** @type {any} */ ({ name: 'TestOS', fs, exit() {} });

    app = new TerminalApp(os);
    app._registerBuiltins();
    app._resetScreen();
    app.outEl = makeFakeEl('pre');
    app.busy = true; // skip prompt/cursor overlay so rendered output is exactly the command output
  });

  /** @param {string} line */
  async function run(line) {
    app.currentAbort = new AbortController();
    app.interruptHandlers = [];
    await app._handleLine(line);
  }

  it('writes stdout to a file with >, overwriting on repeat', async () => {
    await run('echo hallo > /home/a.txt');
    expect(fs.readFile('/home/a.txt')).toBe('hallo\n');

    await run('echo nochmal > /home/a.txt');
    expect(fs.readFile('/home/a.txt')).toBe('nochmal\n');
  });

  it('appends with >>', async () => {
    await run('echo eins > /home/a.txt');
    await run('echo zwei >> /home/a.txt');
    expect(fs.readFile('/home/a.txt')).toBe('eins\nzwei\n');
  });

  it('does not accumulate a trailing blank line when re-redirecting cat output (ls -l > f; cat f > f2)', async () => {
    await run('ls -l /home > test.txt');
    const first = fs.readFile('/home/test.txt');
    expect(first.endsWith('\n\n')).toBe(false);

    await run('cat test.txt > test2.txt');
    const second = fs.readFile('/home/test2.txt');
    expect(second).toBe(first);
    expect(second.endsWith('\n\n')).toBe(false);

    // Redirecting through cat a third time must stay stable, not compound.
    await run('cat test2.txt > test3.txt');
    expect(fs.readFile('/home/test3.txt')).toBe(first);
  });

  it('renders a real command error in a red span (stderr)', async () => {
    await run('cat /nope');
    const text = renderedText(app.outEl);
    expect(text).toMatch(/^<<.*>>\n?$/s);
  });

  it('redirects a real error to a file with 2>, leaving the terminal clean', async () => {
    await run('cat /nope 2> /home/err.txt');
    expect(renderedText(app.outEl)).toBe('');
    expect(fs.readFile('/home/err.txt').length).toBeGreaterThan(0);
  });

  it('pipes real command output end-to-end (cat | cat)', async () => {
    fs.writeFile('/home/a.txt', 'piped content');
    await run('cat /home/a.txt | cat');
    expect(renderedText(app.outEl)).toBe('piped content\n');
  });

  it('reads stdin from a file with < for a real command', async () => {
    fs.writeFile('/home/a.txt', 'from redirect');
    await run('cat < /home/a.txt');
    expect(renderedText(app.outEl)).toBe('from redirect\n');
  });

  it('/dev/null swallows output and never creates a file', async () => {
    await run('echo secret > /dev/null');
    expect(fs.exists('/dev/null')).toBe(false);
    expect(renderedText(app.outEl)).toBe('');
  });

  it('unaffected commands (no operators) still render in the default color', async () => {
    await run('echo plain text');
    const text = renderedText(app.outEl);
    expect(text).toBe('plain text\n');
    expect(text).not.toContain('<<');
  });

  it('filters ls -l output through grep piped end-to-end', async () => {
    fs.writeFile('/home/photo.png', 'x');
    await run('ls -l /home | grep txt');
    const text = renderedText(app.outEl);
    expect(text).toContain('notes.txt'); // pre-existing default VFS file
    expect(text).not.toContain('photo.png');
  });

  it('chains cat | sort | uniq -c into a file redirect', async () => {
    fs.writeFile('/home/words.txt', 'b\na\nb\na\na\n');
    await run('cat words.txt | sort | uniq -c > out.txt');
    expect(fs.readFile('/home/out.txt')).toBe('   3 a\n   2 b\n');
  });
});
