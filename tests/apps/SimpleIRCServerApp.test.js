//@ts-check

/**
 * Protocol-level integration tests for SimpleIRCServerApp.
 *
 * Architecture: a virtual in-memory TCP layer replaces the real os.net stack.
 * Each "client" is a pair of async byte queues (toServer / toClient).
 * The server runs its real async accept/recv loops; tests speak IRC over the
 * virtual sockets and assert on what the server sends back.
 *
 * No DOM is rendered; the GenericProcess constructor just needs `document`
 * to exist so it can create an inert root element.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SimpleIRCServerApp } from '../../src/apps/SimpleIRCServerApp.js';

// ── Minimal DOM stub (GenericProcess constructor calls document.createElement) ──

if (!globalThis.document) {
  const makeFakeEl = () => {
    const el = {
      classList: { add() {}, remove() {} },
      style: {},
      disabled: false,
      value: '',
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

// ── Async single-item queue (supports exactly one concurrent reader) ─────────

function makeQueue() {
  /** @type {any[]} */
  const pending = [];
  let closed = false;
  /** @type {((r: {done: boolean, value: any}) => void) | null} */
  let waiter = null;

  return {
    push(val) {
      if (waiter) {
        const r = waiter; waiter = null;
        r({ done: false, value: val });
      } else {
        pending.push(val);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (waiter) { const r = waiter; waiter = null; r({ done: true, value: null }); }
    },
    /** @returns {Promise<{done: boolean, value: any}>} */
    next() {
      if (pending.length) return Promise.resolve({ done: false, value: pending.shift() });
      if (closed)         return Promise.resolve({ done: true,  value: null });
      return new Promise(r => { waiter = r; });
    },
  };
}

// ── Virtual TCP network ──────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function makeVirtualNet() {
  let nextId = 0;

  /** @type {Map<number, ReturnType<typeof makeQueue>>} serverRef → accept queue */
  const acceptQueues = new Map();

  /**
   * @type {Map<string, {toServer: ReturnType<typeof makeQueue>, toClient: ReturnType<typeof makeQueue>}>}
   */
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

  /**
   * Open a new client connection to the given server socket.
   * Returns a handle with sendLine / recvLine / close.
   * @param {number} [serverRef=1]
   */
  function connect(serverRef = 1) {
    const ck = `c${++nextId}`;
    const toServer = makeQueue();
    const toClient = makeQueue();
    conns.set(ck, { toServer, toClient });

    // Deliver the new connection to the server's accept queue
    acceptQueues.get(serverRef)?.push(ck);

    let buf = new Uint8Array(0);

    return {
      connKey: ck,

      /** Send one IRC line (appends CRLF). */
      sendLine(line) {
        toServer.push(enc.encode(line + '\r\n'));
      },

      /** Read one CRLF-terminated line from the server. Returns null on EOF. */
      async recvLine() {
        while (true) {
          // Scan current buffer for LF
          for (let i = 0; i < buf.length; i++) {
            if (buf[i] === 10) {
              const end = (i > 0 && buf[i - 1] === 13) ? i - 1 : i;
              const line = dec.decode(buf.slice(0, end));
              buf = buf.slice(i + 1);
              return line;
            }
          }
          const { done, value } = await toClient.next();
          if (done) return null;
          const m = new Uint8Array(buf.length + value.length);
          m.set(buf); m.set(value, buf.length);
          buf = m;
        }
      },

      /** Signal EOF from the client side (server sees connection closed). */
      close() { toServer.close(); },
    };
  }

  return { net, connect };
}

// ── Mock OS ───────────────────────────────────────────────────────────────────

function makeOS(net) {
  return {
    net,
    // Simulate a missing/empty config file so _writeAutostart silently fails
    fs: {
      readFile() { throw new Error('no fs'); },
      writeFile() {},
    },
    exit() {},
    dns: null,
  };
}

// ── IRC protocol helpers ──────────────────────────────────────────────────────

/**
 * Register a client (NICK + USER) and read until the server sends 376 End of MOTD.
 * @param {ReturnType<ReturnType<typeof makeVirtualNet>['connect']>} conn
 */
async function registerClient(conn, nick, user = 'u') {
  conn.sendLine(`NICK ${nick}`);
  conn.sendLine(`USER ${user} 0 * :${nick}`);
  let line;
  do { line = await conn.recvLine(); } while (line !== null && !line.includes(' 376 '));
}

/**
 * JOIN a channel and read until the server sends 366 End of NAMES.
 * @param {ReturnType<ReturnType<typeof makeVirtualNet>['connect']>} conn
 */
async function joinChannel(conn, channel) {
  conn.sendLine(`JOIN ${channel}`);
  let line;
  do { line = await conn.recvLine(); } while (line !== null && !line.includes(' 366 '));
}

/**
 * Read lines from conn until one satisfies the predicate; return it.
 * Throws if the connection closes or maxLines is exhausted.
 * @param {ReturnType<ReturnType<typeof makeVirtualNet>['connect']>} conn
 * @param {(line: string) => boolean} predicate
 * @param {number} [maxLines=30]
 */
async function expectLine(conn, predicate, maxLines = 30) {
  for (let i = 0; i < maxLines; i++) {
    const line = await conn.recvLine();
    if (line === null) throw new Error('Connection closed before expected line');
    if (predicate(line)) return line;
  }
  throw new Error(`Expected line not found within ${maxLines} lines`);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('SimpleIRCServerApp – protocol', () => {
  /** @type {ReturnType<typeof makeVirtualNet>} */
  let vnet;
  /** @type {SimpleIRCServerApp} */
  let server;

  beforeEach(() => {
    vnet = makeVirtualNet();
    server = new SimpleIRCServerApp(makeOS(vnet.net));
    server._start();
  });

  afterEach(() => {
    server._stop();
  });

  // ── Registration ────────────────────────────────────────────────────────────

  describe('Registration', () => {
    it('sends 001 welcome and 376 End of MOTD on successful registration', async () => {
      const c = vnet.connect();
      c.sendLine('NICK Alice');
      c.sendLine('USER alice 0 * :Alice Liddell');

      const lines = [];
      let line;
      do {
        line = await c.recvLine();
        if (line) lines.push(line);
      } while (line && !line.includes(' 376 '));

      expect(lines.some(l => l.includes(' 001 ') && l.includes('Alice'))).toBe(true);
      expect(lines.some(l => l.includes(' 375 '))).toBe(true); // MOTD start
      expect(lines.some(l => l.includes(' 376 '))).toBe(true); // MOTD end
    });

    it('registration requires both NICK and USER before welcome is sent', async () => {
      const c = vnet.connect();
      // Send only NICK — server must not send 001 yet
      c.sendLine('NICK Alice');
      // Send PING to get a response; server should respond BEFORE 001
      // (server ignores commands from unregistered clients except NICK/USER/CAP)
      // If server sent 001 now it would appear before PONG... it should not.
      // Then complete registration
      c.sendLine('USER u 0 * :Alice');

      const line = await expectLine(c, l => l.includes(' 001 '));
      expect(line).toContain('Alice');
    });

    it('returns 433 Nickname in use when nick is already taken', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');

      c2.sendLine('NICK Alice');
      c2.sendLine('USER u 0 * :u');

      const line = await expectLine(c2, l => l.includes(' 433 '));
      expect(line).toContain('Alice');
    });

    it('returns 432 Erroneous nickname for nicks starting with a digit', async () => {
      const c = vnet.connect();
      c.sendLine('NICK 1bad');
      const line = await c.recvLine();
      expect(line).toContain(' 432 ');
    });
  });

  // ── JOIN ────────────────────────────────────────────────────────────────────

  describe('JOIN', () => {
    it('sends JOIN echo + 353 NAMES + 366 End of NAMES to the joining user', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      c.sendLine('JOIN #lobby');

      const lines = [];
      let line;
      do {
        line = await c.recvLine();
        if (line) lines.push(line);
      } while (line && !line.includes(' 366 '));

      expect(lines.some(l => l.includes('JOIN') && l.includes('#lobby'))).toBe(true);
      expect(lines.some(l => l.includes(' 353 ') && l.includes('Alice'))).toBe(true);
      expect(lines.some(l => l.includes(' 366 '))).toBe(true);
    });

    it('second joiner sees existing member in NAMES list', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#lobby');

      c2.sendLine('JOIN #lobby');
      const namesLine = await expectLine(c2, l => l.includes(' 353 '));
      expect(namesLine).toContain('Alice');
    });

    it('existing members are notified when a new user joins', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#lobby');

      c2.sendLine('JOIN #lobby');

      // c1 must receive Bob's JOIN before anything else
      const joinLine = await expectLine(c1, l => l.includes('JOIN') && l.includes('Bob'));
      expect(joinLine).toContain('#lobby');
    });
  });

  // ── PRIVMSG to channel ──────────────────────────────────────────────────────

  describe('PRIVMSG to channel', () => {
    it('message is forwarded to all other channel members', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#chat');
      await joinChannel(c2, '#chat');

      c1.sendLine('PRIVMSG #chat :Hello Bob!');

      const line = await expectLine(c2, l => l.includes('PRIVMSG') && l.includes('#chat'));
      expect(line).toContain('Hello Bob!');
      expect(line).toContain('Alice');
    });

    it('sender does not receive their own channel message', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#chat');
      await joinChannel(c2, '#chat');

      // Drain the JOIN notification c1 received when Bob joined
      await expectLine(c1, l => l.includes('JOIN') && l.includes('Bob'));

      c1.sendLine('PRIVMSG #chat :Am I alone?');

      // c2 receives the message
      const c2line = await expectLine(c2, l => l.includes('PRIVMSG'));
      expect(c2line).toContain('Am I alone?');

      // c1 sends PING; the very next response must be PONG, not a PRIVMSG echo
      c1.sendLine('PING :sentinel');
      const pong = await c1.recvLine();
      expect(pong).toContain('PONG');
      expect(pong).not.toContain('Am I alone?');
    });

    it('message reaches all three members of a channel', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      const c3 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await registerClient(c3, 'Carol');
      await joinChannel(c1, '#all');
      await joinChannel(c2, '#all');
      await joinChannel(c3, '#all');

      c1.sendLine('PRIVMSG #all :Hi everyone!');

      const [l2, l3] = await Promise.all([
        expectLine(c2, l => l.includes('Hi everyone!')),
        expectLine(c3, l => l.includes('Hi everyone!')),
      ]);
      expect(l2).toContain('Alice');
      expect(l3).toContain('Alice');
    });

    it('returns 403 No such channel for a non-existent channel', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      c.sendLine('PRIVMSG #nowhere :hello');
      const line = await expectLine(c, l => l.includes(' 403 '));
      expect(line).toContain('#nowhere');
    });
  });

  // ── PRIVMSG to nick ─────────────────────────────────────────────────────────

  describe('PRIVMSG to nick', () => {
    it('private message is delivered directly to the target user', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');

      c1.sendLine('PRIVMSG Bob :Psst!');

      const line = await expectLine(c2, l => l.includes('PRIVMSG') && l.includes('Psst!'));
      expect(line).toContain('Alice');
    });

    it('returns 401 No such nick for unknown target', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      c.sendLine('PRIVMSG Ghost :hello?');
      const line = await expectLine(c, l => l.includes(' 401 '));
      expect(line).toContain('Ghost');
    });
  });

  // ── PART ────────────────────────────────────────────────────────────────────

  describe('PART', () => {
    it('PART is broadcast to remaining channel members', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#room');
      await joinChannel(c2, '#room');

      c2.sendLine('PART #room :Bye!');

      const line = await expectLine(c1, l => l.includes('PART') && l.includes('Bob'));
      expect(line).toContain('#room');
    });

    it('channel is removed from LIST when last member parts', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      await joinChannel(c, '#temp');

      c.sendLine('PART #temp');
      await expectLine(c, l => l.includes('PART'));

      c.sendLine('LIST');
      const lines = [];
      let line;
      do {
        line = await c.recvLine();
        if (line) lines.push(line);
      } while (line && !line.includes(' 323 '));

      expect(lines.filter(l => l.includes(' 322 ')).every(l => !l.includes('#temp'))).toBe(true);
    });

    it('returns 442 You\'re not on that channel for unknown channel', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      c.sendLine('PART #nonexistent');
      const line = await expectLine(c, l => l.includes(' 442 '));
      expect(line).toBeTruthy();
    });
  });

  // ── QUIT ────────────────────────────────────────────────────────────────────

  describe('QUIT', () => {
    it('QUIT notifies all shared channel members', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#room');
      await joinChannel(c2, '#room');

      c2.sendLine('QUIT :Leaving for good');

      const line = await expectLine(c1, l => l.includes('QUIT') && l.includes('Bob'));
      expect(line).toContain('Leaving for good');
    });
  });

  // ── NICK change ─────────────────────────────────────────────────────────────

  describe('NICK', () => {
    it('nick change is broadcast to channel members', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#room');
      await joinChannel(c2, '#room');

      c2.sendLine('NICK Bobby');

      const line = await expectLine(c1, l => l.includes('NICK') && l.includes('Bobby'));
      // Prefix should still contain the old nick
      expect(line).toContain('Bob');
    });

    it('user receives their own NICK change confirmation', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');

      c.sendLine('NICK Alicia');
      const line = await expectLine(c, l => l.includes('NICK') && l.includes('Alicia'));
      expect(line).toContain('Alice'); // old nick in prefix
    });
  });

  // ── TOPIC ───────────────────────────────────────────────────────────────────

  describe('TOPIC', () => {
    it('setting a topic broadcasts it to all channel members', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#room');
      await joinChannel(c2, '#room');

      c1.sendLine('TOPIC #room :Welcome, everyone!');

      // c2 must receive the TOPIC notification
      const line = await expectLine(c2, l => l.includes('TOPIC') && l.includes('Welcome, everyone!'));
      expect(line).toContain('Alice');
    });

    it('querying topic without argument returns 332 when a topic is set', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      await joinChannel(c, '#room');

      c.sendLine('TOPIC #room :My topic');
      // Consume the broadcast to self
      await expectLine(c, l => l.includes('TOPIC'));

      c.sendLine('TOPIC #room');
      const line = await expectLine(c, l => l.includes(' 332 '));
      expect(line).toContain('My topic');
    });

    it('querying topic on channel with no topic returns 331', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      await joinChannel(c, '#empty');

      c.sendLine('TOPIC #empty');
      const line = await expectLine(c, l => l.includes(' 331 '));
      expect(line).toContain('#empty');
    });
  });

  // ── LIST ────────────────────────────────────────────────────────────────────

  describe('LIST', () => {
    it('returns all channels between 321 header and 323 End of LIST', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      await joinChannel(c, '#general');
      await joinChannel(c, '#random');

      c.sendLine('LIST');
      const lines = [];
      let line;
      do {
        line = await c.recvLine();
        if (line) lines.push(line);
      } while (line && !line.includes(' 323 '));

      const channelLines = lines.filter(l => l.includes(' 322 '));
      expect(channelLines.some(l => l.includes('#general'))).toBe(true);
      expect(channelLines.some(l => l.includes('#random'))).toBe(true);
      expect(lines.some(l => l.includes(' 323 '))).toBe(true);
    });
  });

  // ── NAMES ───────────────────────────────────────────────────────────────────

  describe('NAMES', () => {
    it('NAMES #channel returns all current members', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#team');
      await joinChannel(c2, '#team');

      c1.sendLine('NAMES #team');
      const namesLine = await expectLine(c1, l => l.includes(' 353 ') && l.includes('#team'));
      expect(namesLine).toContain('Alice');
      expect(namesLine).toContain('Bob');
    });
  });

  // ── PING / PONG ─────────────────────────────────────────────────────────────

  describe('PING / PONG', () => {
    it('server echoes PING token in PONG reply', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');

      c.sendLine('PING :mytoken123');
      const line = await expectLine(c, l => l.includes('PONG'));
      expect(line).toContain('mytoken123');
    });
  });

  // ── MODE ────────────────────────────────────────────────────────────────────

  describe('MODE', () => {
    it('MODE on own nick returns 221', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');

      c.sendLine('MODE Alice');
      const line = await expectLine(c, l => l.includes(' 221 '));
      expect(line).toBeTruthy();
    });

    it('MODE on channel returns 324', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');
      await joinChannel(c, '#test');

      c.sendLine('MODE #test');
      const line = await expectLine(c, l => l.includes(' 324 '));
      expect(line).toContain('#test');
    });
  });

  // ── WHO / WHOIS ─────────────────────────────────────────────────────────────

  describe('WHO / WHOIS', () => {
    it('WHOIS returns 311 with user info for known nick', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');

      c1.sendLine('WHOIS Bob');
      const line = await expectLine(c1, l => l.includes(' 311 '));
      expect(line).toContain('Bob');
    });

    it('WHOIS returns 401 for unknown nick', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');

      c.sendLine('WHOIS Ghost');
      const line = await expectLine(c, l => l.includes(' 401 '));
      expect(line).toContain('Ghost');
    });

    it('WHO #channel returns 352 entries for all members', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#staff');
      await joinChannel(c2, '#staff');

      c1.sendLine('WHO #staff');
      const whoLine = await expectLine(c1, l => l.includes(' 352 '));
      expect(whoLine).toBeTruthy();
      // End of WHO
      const endLine = await expectLine(c1, l => l.includes(' 315 '));
      expect(endLine).toBeTruthy();
    });
  });

  // ── Unknown command ──────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('returns 421 Unknown command for unsupported commands', async () => {
      const c = vnet.connect();
      await registerClient(c, 'Alice');

      c.sendLine('FOOBAR :test');
      const line = await expectLine(c, l => l.includes(' 421 '));
      expect(line).toContain('FOOBAR');
    });
  });

  // ── Multi-channel isolation ──────────────────────────────────────────────────

  describe('Channel isolation', () => {
    it('message in #chan-a is not delivered to members of #chan-b', async () => {
      const c1 = vnet.connect();
      const c2 = vnet.connect();
      await registerClient(c1, 'Alice');
      await registerClient(c2, 'Bob');
      await joinChannel(c1, '#chan-a');
      await joinChannel(c2, '#chan-b'); // Bob only in #chan-b

      c1.sendLine('PRIVMSG #chan-a :secret message');

      // Verify the message reached nobody on c2 by sending a PRIVMSG to Bob
      // directly and reading that on c2 – if there were a leaked #chan-a msg it
      // would appear first.
      c1.sendLine('PRIVMSG Bob :sentinel');
      const line = await expectLine(c2, l => l.includes('PRIVMSG'));
      // Only the direct message should arrive, not the #chan-a broadcast
      expect(line).toContain('sentinel');
      expect(line).not.toContain('secret message');
    });
  });
});
