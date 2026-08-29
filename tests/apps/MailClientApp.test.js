//@ts-check

import { describe, it, expect } from 'vitest';
import { MailClientApp } from '../../src/apps/MailClientApp.js';

// ── Minimal DOM stub (only run() is exercised — no _build()/UI here) ────────

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {} },
      style: {},
      disabled: false,
      value: '',
      checked: false,
      textContent: '',
      childElementCount: 0,
      get scrollTop() { return 0; },
      set scrollTop(_v) {},
      get scrollHeight() { return 0; },
      replaceChildren() {},
      appendChild() { return el; },
      removeChild() { return el; },
      addEventListener() {},
      setAttribute() {},
      querySelectorAll() { return []; },
    };
    return el;
  };
  // @ts-ignore
  globalThis.document = {
    createElement: (_tag) => makeFakeEl(),
    createTextNode: (_t) => ({}),
    createDocumentFragment: () => ({ appendChild() {} }),
  };
}

// ── In-memory FS (same shape as SimpleMailServerApp.test.js's mock) ─────────

function makeMockFS() {
  /** @type {Record<string, string>} */
  const files = {};
  return {
    mkdir(_path, _opts) {},
    exists(path) { return Object.prototype.hasOwnProperty.call(files, path); },
    readFile(path) {
      if (!Object.prototype.hasOwnProperty.call(files, path))
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return files[path];
    },
    writeFile(path, content) { files[path] = String(content); },
    readdir(path) {
      const prefix = (path.endsWith('/') ? path : path + '/');
      return Object.keys(files)
        .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(k => k.slice(prefix.length));
    },
    _files: files,
  };
}

function makeOS(fs) {
  return { fs, net: {}, exit() {}, dns: null, tls: null };
}

/** @param {MailClientApp} app @param {string} raw */
function sendMock(app, raw) {
  app.sent.push({ raw, headers: {} });
  app._appendSent(raw);
}

describe('MailClientApp – sent folder persistence', () => {
  it('_loadSent() is a no-op when nothing was ever sent', () => {
    const app = new MailClientApp(makeOS(makeMockFS()));
    app.run();
    app._loadSent();
    expect(app.sent).toEqual([]);
  });

  it('a sent message survives being written and re-read (simulated save/load)', () => {
    const fs = makeMockFS();
    const app1 = new MailClientApp(makeOS(fs));
    app1.run();
    app1._loadSent();
    sendMock(app1, 'From: me@example.local\r\nTo: you@example.local\r\nSubject: hi\r\n\r\nhello there');

    // Fresh instance sharing the same fs — as if the scene had just been reloaded.
    const app2 = new MailClientApp(makeOS(fs));
    app2.run();
    app2._loadSent();

    expect(app2.sent).toHaveLength(1);
    expect(app2.sent[0].raw).toContain('hello there');
    expect(app2.sent[0].headers.subject).toBe('hi');
  });

  it('multiple sent messages are all preserved in order across a reload', () => {
    const fs = makeMockFS();
    const app1 = new MailClientApp(makeOS(fs));
    app1.run();
    sendMock(app1, 'From: me@x\r\nTo: a@x\r\nSubject: one\r\n\r\nfirst');
    sendMock(app1, 'From: me@x\r\nTo: b@x\r\nSubject: two\r\n\r\nsecond');

    const app2 = new MailClientApp(makeOS(fs));
    app2.run();
    app2._loadSent();

    expect(app2.sent).toHaveLength(2);
    expect(app2.sent[0].headers.subject).toBe('one');
    expect(app2.sent[1].headers.subject).toBe('two');
  });

  it('a sent message body containing a line starting with "From " is not mistaken for a new mbox entry', () => {
    const fs = makeMockFS();
    const app1 = new MailClientApp(makeOS(fs));
    app1.run();
    sendMock(app1, 'From: me@x\r\nTo: a@x\r\nSubject: fwd\r\n\r\nSee below:\r\nFrom bob@old.com Wed Jan 1 00:00:00 2025\r\noriginal body');

    const app2 = new MailClientApp(makeOS(fs));
    app2.run();
    app2._loadSent();

    expect(app2.sent).toHaveLength(1);
    expect(app2.sent[0].raw).toContain('From bob@old.com Wed Jan 1 00:00:00 2025');
    expect(app2.sent[0].raw).toContain('original body');
  });
});
