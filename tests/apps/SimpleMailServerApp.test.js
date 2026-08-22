//@ts-check

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SimpleMailServerApp } from '../../src/apps/SimpleMailServerApp.js';

// ── Minimal DOM stub ──────────────────────────────────────────────────────────

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

// ── Async single-item queue ───────────────────────────────────────────────────

function makeQueue() {
  /** @type {any[]} */
  const pending = [];
  let closed = false;
  /** @type {((r: {done: boolean, value: any}) => void) | null} */
  let waiter = null;
  return {
    push(val) {
      if (waiter) { const r = waiter; waiter = null; r({ done: false, value: val }); }
      else pending.push(val);
    },
    close() {
      if (closed) return; closed = true;
      if (waiter) { const r = waiter; waiter = null; r({ done: true, value: null }); }
    },
    next() {
      if (pending.length) return Promise.resolve({ done: false, value: pending.shift() });
      if (closed)         return Promise.resolve({ done: true,  value: null });
      return new Promise(r => { waiter = r; });
    },
  };
}

// ── Virtual TCP network ───────────────────────────────────────────────────────

function makeVirtualTCPNet() {
  let nextId = 0;
  const acceptQueues = new Map();
  const conns = new Map();

  const net = {
    openTCPServerSocket(_ip, _port) {
      const ref = ++nextId;
      acceptQueues.set(ref, makeQueue());
      return ref;
    },
    closeTCPServerSocket(ref) {
      acceptQueues.get(ref)?.close();
      acceptQueues.delete(ref);
    },
    async acceptTCPConn(ref) {
      const q = acceptQueues.get(ref);
      if (!q) return null;
      const { done, value } = await q.next();
      return done ? null : value;
    },
    async recvTCPConn(ck) {
      const c = conns.get(ck);
      if (!c) return null;
      const { done, value } = await c.toServer.next();
      return done ? null : value;
    },
    sendTCPConn(ck, bytes) {
      conns.get(ck)?.toClient.push(bytes);
    },
    closeTCPConn(ck) {
      const c = conns.get(ck);
      if (!c) return;
      c.toServer.close();
      c.toClient.close();
      conns.delete(ck);
    },
  };

  /** @param {number} serverRef */
  function connect(serverRef) {
    const ck = `10.0.0.1:${++nextId * 1000}>server`;
    const toServer = makeQueue();
    const toClient = makeQueue();
    conns.set(ck, { toServer, toClient });
    acceptQueues.get(serverRef)?.push(ck);
    return { toServer, toClient };
  }

  return { net, connect };
}

// ── In-memory FS ─────────────────────────────────────────────────────────────

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
    _files: files, // for test inspection
  };
}

// ── Mock OS ───────────────────────────────────────────────────────────────────

function makeOS(net, fs) {
  return { net, fs, exit() {}, dns: null, tls: null };
}

// ── Protocol line helpers ─────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Build a CRLF-framed protocol client over a raw queue pair.
 */
function makeLineClient(toServer, toClient) {
  let buf = new Uint8Array(0);

  return {
    sendLine(line) {
      toServer.push(enc.encode(line + '\r\n'));
    },
    async recvLine() {
      while (true) {
        for (let i = 0; i + 1 < buf.length; i++) {
          if (buf[i] === 13 && buf[i + 1] === 10) {
            const line = dec.decode(buf.slice(0, i));
            buf = buf.slice(i + 2);
            return line;
          }
        }
        const { done, value } = await toClient.next();
        if (done) return null;
        const merged = new Uint8Array(buf.length + value.length);
        merged.set(buf); merged.set(value, buf.length);
        buf = merged;
      }
    },
    /** Read lines until predicate returns true (inclusive). */
    async readUntil(pred, maxLines = 20) {
      const lines = [];
      for (let i = 0; i < maxLines; i++) {
        const l = await this.recvLine();
        if (l === null) break;
        lines.push(l);
        if (pred(l)) return lines;
      }
      throw new Error(`readUntil: expected line not found (got ${JSON.stringify(lines)})`);
    },
  };
}

// ── SMTP helpers ──────────────────────────────────────────────────────────────

/**
 * Run EHLO + MAIL FROM + RCPT TO + DATA + message + QUIT.
 * Returns the "250 2.0.0 OK" (or error) line.
 */
async function smtpSend(client, { from, to, subject, body }) {
  // greeting
  await client.recvLine(); // 220 ...
  client.sendLine(`EHLO testclient`);
  // read multi-line EHLO response until line starting with "250 " (no dash)
  await client.readUntil(l => l.startsWith('250 '));
  client.sendLine(`MAIL FROM:<${from}>`);
  await client.recvLine(); // 250 OK
  client.sendLine(`RCPT TO:<${to}>`);
  await client.recvLine(); // 250 OK
  client.sendLine('DATA');
  await client.recvLine(); // 354 ...
  client.sendLine(`Subject: ${subject}`);
  client.sendLine('');
  client.sendLine(body);
  client.sendLine('.');
  const queueLine = await client.recvLine(); // 250 2.0.0 OK queued
  client.sendLine('QUIT');
  return queueLine;
}

/**
 * POP3 login flow — returns the client already in TRANSACTION state.
 * Reads greeting, sends USER+PASS.
 */
async function pop3Login(client, user, pass) {
  await client.recvLine(); // +OK greeting
  client.sendLine(`USER ${user}`);
  await client.recvLine(); // +OK
  client.sendLine(`PASS ${pass}`);
  const ok = await client.recvLine(); // +OK or -ERR
  return ok;
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe('SimpleMailServerApp', () => {
  /** @type {ReturnType<typeof makeVirtualTCPNet>} */
  let vnet;
  /** @type {SimpleMailServerApp} */
  let server;
  let fs;

  beforeEach(() => {
    vnet = makeVirtualTCPNet();
    fs = makeMockFS();
    server = new SimpleMailServerApp(makeOS(vnet.net, fs));
    // Add a test user
    server.users = [{ user: 'alice', password: 'secret' }];
    server._start();
  });

  afterEach(() => {
    server._stop();
  });

  // ── SMTP ──────────────────────────────────────────────────────────────────────

  describe('SMTP', () => {
    it('sends 220 greeting on connect', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      const greeting = await client.recvLine();
      expect(greeting).toMatch(/^220 /);
    });

    it('responds to EHLO with 250', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('EHLO testclient');
      const lines = await client.readUntil(l => l.startsWith('250 '));
      expect(lines.some(l => l.startsWith('250'))).toBe(true);
    });

    it('responds to NOOP with 250 OK', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('EHLO x');
      await client.readUntil(l => l.startsWith('250 '));
      client.sendLine('NOOP');
      const line = await client.recvLine();
      expect(line).toMatch(/^250/);
    });

    it('responds to QUIT with 221', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('QUIT');
      const line = await client.recvLine();
      expect(line).toMatch(/^221/);
    });

    it('delivers mail locally and returns 250 queued', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      const result = await smtpSend(client, {
        from: 'sender@other.com',
        to: 'alice@example.local',
        subject: 'Test',
        body: 'Hello Alice!',
      });
      expect(result).toMatch(/^250/);
    });

    it('DATA before MAIL FROM returns 503', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('EHLO x');
      await client.readUntil(l => l.startsWith('250 '));
      client.sendLine('DATA');
      const line = await client.recvLine();
      expect(line).toMatch(/^503/);
    });
  });

  // ── POP3 ──────────────────────────────────────────────────────────────────────

  describe('POP3', () => {
    async function deliverMail(subject, body) {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      await smtpSend(client, { from: 'x@other.com', to: 'alice@example.local', subject, body });
    }

    it('sends +OK greeting on connect', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.pop3);
      const client = makeLineClient(ts, tc);
      const greeting = await client.recvLine();
      expect(greeting).toMatch(/^\+OK/);
    });

    it('accepts valid USER/PASS authentication', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.pop3);
      const client = makeLineClient(ts, tc);
      const result = await pop3Login(client, 'alice', 'secret');
      expect(result).toMatch(/^\+OK/);
    });

    it('rejects wrong password with -ERR', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.pop3);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('USER alice');
      await client.recvLine();
      client.sendLine('PASS wrongpassword');
      const line = await client.recvLine();
      expect(line).toMatch(/^-ERR/);
    });

    it('STAT returns message count after SMTP delivery', async () => {
      await deliverMail('Hello', 'Test body');

      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.pop3);
      const client = makeLineClient(ts, tc);
      await pop3Login(client, 'alice', 'secret');
      client.sendLine('STAT');
      const stat = await client.recvLine();
      expect(stat).toMatch(/^\+OK 1 /); // 1 message
    });

    it('RETR 1 returns the delivered message', async () => {
      await deliverMail('SubjectX', 'Body content here');

      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.pop3);
      const client = makeLineClient(ts, tc);
      await pop3Login(client, 'alice', 'secret');
      client.sendLine('RETR 1');
      const header = await client.recvLine(); // +OK ...
      expect(header).toMatch(/^\+OK/);
      // read until dot terminator
      const lines = await client.readUntil(l => l === '.');
      const body = lines.join('\n');
      expect(body).toContain('Body content here');
    });

    it('RETR on non-existent message returns -ERR', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.pop3);
      const client = makeLineClient(ts, tc);
      await pop3Login(client, 'alice', 'secret');
      client.sendLine('RETR 99');
      const line = await client.recvLine();
      expect(line).toMatch(/^-ERR/);
    });

    it('QUIT returns +OK Goodbye', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.pop3);
      const client = makeLineClient(ts, tc);
      await pop3Login(client, 'alice', 'secret');
      client.sendLine('QUIT');
      const line = await client.recvLine();
      expect(line).toMatch(/^\+OK/);
    });
  });

  // ── IMAP ──────────────────────────────────────────────────────────────────────

  describe('IMAP', () => {
    async function deliverMail(subject, body) {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      await smtpSend(client, { from: 'x@other.com', to: 'alice@example.local', subject, body });
    }

    it('sends * OK greeting on connect', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.imap);
      const client = makeLineClient(ts, tc);
      const greeting = await client.recvLine();
      expect(greeting).toMatch(/^\* OK/);
    });

    it('accepts LOGIN with correct credentials', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.imap);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('A1 LOGIN alice secret');
      const resp = await client.recvLine();
      expect(resp).toMatch(/^A1 OK/);
    });

    it('rejects LOGIN with wrong password', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.imap);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('A1 LOGIN alice wrongpass');
      const resp = await client.recvLine();
      expect(resp).toMatch(/^A1 NO/);
    });

    it('SELECT INBOX reports message count', async () => {
      await deliverMail('ImapTest', 'Hello IMAP');

      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.imap);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('A1 LOGIN alice secret');
      await client.recvLine();
      client.sendLine('A2 SELECT INBOX');
      const lines = await client.readUntil(l => l.startsWith('A2 OK'));
      expect(lines.some(l => l.includes('1 EXISTS'))).toBe(true);
    });

    it('FETCH 1 BODY[] returns the message content', async () => {
      await deliverMail('FetchTest', 'Fetch body content');

      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.imap);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('A1 LOGIN alice secret');
      await client.recvLine();
      client.sendLine('A2 SELECT INBOX');
      await client.readUntil(l => l.startsWith('A2 OK'));
      client.sendLine('A3 FETCH 1 BODY[]');
      const lines = await client.readUntil(l => l.startsWith('A3 OK'));
      const content = lines.join('\n');
      expect(content).toContain('Fetch body content');
    });

    it('SEARCH ALL returns sequence numbers for all messages', async () => {
      await deliverMail('S1', 'msg1');
      await deliverMail('S2', 'msg2');

      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.imap);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('A1 LOGIN alice secret');
      await client.recvLine();
      client.sendLine('A2 SELECT INBOX');
      await client.readUntil(l => l.startsWith('A2 OK'));
      client.sendLine('A3 SEARCH ALL');
      const lines = await client.readUntil(l => l.startsWith('A3 OK'));
      const searchLine = lines.find(l => l.startsWith('* SEARCH'));
      expect(searchLine).toContain('1');
      expect(searchLine).toContain('2');
    });

    it('LOGOUT sends BYE and OK', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.imap);
      const client = makeLineClient(ts, tc);
      await client.recvLine();
      client.sendLine('A1 LOGIN alice secret');
      await client.recvLine();
      client.sendLine('A2 LOGOUT');
      const lines = await client.readUntil(l => l.startsWith('A2 OK'));
      expect(lines.some(l => l.includes('BYE'))).toBe(true);
    });
  });

  // ── Case sensitivity ──────────────────────────────────────────────────────────
  // Regression tests for: SMTP/auth account lookup is case-insensitive, but the
  // mailbox file used to be named after whatever case happened to be typed at
  // delivery time vs. retrieval time. Mail sent to "Alice@…" (or CC'd to a
  // capitalized name) could silently vanish for a user registered as "alice".

  describe('case sensitivity', () => {
    it('mail delivered to a differently-cased address is still visible via POP3', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      const result = await smtpSend(client, {
        from: 'sender@other.com',
        to: 'Alice@example.local', // capitalized, unlike the registered "alice"
        subject: 'Case test',
        body: 'hello',
      });
      expect(result).toMatch(/^250/);

      const { toServer: pts, toClient: ptc } = vnet.connect(server.serverRef.pop3);
      const pop3Client = makeLineClient(pts, ptc);
      await pop3Login(pop3Client, 'alice', 'secret');
      pop3Client.sendLine('STAT');
      const stat = await pop3Client.recvLine();
      expect(stat).toMatch(/^\+OK 1 /);
    });

    it('a CC recipient typed with different case than the registered username still receives mail', async () => {
      server.users.push({ user: 'bob', password: 'secret' });

      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const client = makeLineClient(ts, tc);
      await client.recvLine(); // 220
      client.sendLine('EHLO testclient');
      await client.readUntil(l => l.startsWith('250 '));
      client.sendLine('MAIL FROM:<sender@other.com>');
      await client.recvLine();
      client.sendLine('RCPT TO:<alice@example.local>');
      await client.recvLine();
      client.sendLine('RCPT TO:<Bob@example.local>'); // CC'd with capitalized name
      await client.recvLine();
      client.sendLine('DATA');
      await client.recvLine();
      client.sendLine('Subject: CC test');
      client.sendLine('To: alice@example.local');
      client.sendLine('Cc: Bob@example.local');
      client.sendLine('');
      client.sendLine('hello cc');
      client.sendLine('.');
      const result = await client.recvLine();
      expect(result).toMatch(/^250/);

      const { toServer: pts, toClient: ptc } = vnet.connect(server.serverRef.pop3);
      const pop3Client = makeLineClient(pts, ptc);
      await pop3Login(pop3Client, 'bob', 'secret');
      pop3Client.sendLine('STAT');
      const stat = await pop3Client.recvLine();
      expect(stat).toMatch(/^\+OK 1 /);
    });

    it('IMAP LOGIN with different case than the registered username still finds delivered mail', async () => {
      const { toServer: ts, toClient: tc } = vnet.connect(server.serverRef.smtp);
      const smtpClient = makeLineClient(ts, tc);
      await smtpSend(smtpClient, {
        from: 'sender@other.com',
        to: 'Alice@example.local',
        subject: 'IMAP case test',
        body: 'hello imap',
      });

      const { toServer: its, toClient: itc } = vnet.connect(server.serverRef.imap);
      const imapClient = makeLineClient(its, itc);
      await imapClient.recvLine();
      imapClient.sendLine('A1 LOGIN ALICE secret'); // all-caps login
      await imapClient.recvLine();
      imapClient.sendLine('A2 SELECT INBOX');
      const lines = await imapClient.readUntil(l => l.startsWith('A2 OK'));
      expect(lines.some(l => l.includes('1 EXISTS'))).toBe(true);
    });
  });
});
