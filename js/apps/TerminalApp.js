//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { CleanupBag } from "./lib/CleanupBag.js";

/**
 * @typedef {{
 *   app: TerminalApp,
 *   os: any,
 *   pid: number,
 *   env: Record<string, string>,
 *   cwd: string,
 *   setCwd: (cwd: string) => void,
 *   println: (text?: string) => void,
 *   clear: () => void,
 *   terminate: () => void,
 * }} ShellContext
 */

/**
 * @typedef {{
 *   name: string,
 *   run: (ctx: ShellContext, args: string[]) => (string|void|Promise<string|void>)
 * }} Command
 */

export class TerminalApp extends GenericProcess {
    /** @type {CleanupBag} */
    bag = new CleanupBag();

    /** @type {HTMLPreElement|null} */
    outEl = null;

    /** @type {HTMLInputElement|null} */
    inEl = null;

    /** @type {string[]} */
    history = [];

    /** @type {number} */
    historyIndex = 0;

    /** @type {string} */
    cwd = "/";

    /** @type {Record<string, string>} */
    env = {
        USER: "user",
        HOST: "sim-os",
        TERM: "xterm-ish",
    };

    /** @type {Map<string, Command>} */
    commands = new Map();

    /** @type {string} */
    lineBuffer = "";

    /** @type {number} */
    cursor = 0;

    /** @type {string[]} */
    lines = [];

    /** @type {boolean} if a command is running (like ping) */
    busy = false;

    run() {
        this.title = "Terminal";
        this.root.classList.add("app", "app-terminal");
        this._registerBuiltins();

        if (this.lines.length === 0) {
            this.lines.push(`Welcome to ${this.env.HOST}`, "");
        }
    }

    /**
     * @param {HTMLElement} root
     */
    onMount(root) {
        super.onMount(root);
        this.bag.dispose();

        const term = /** @type {HTMLPreElement} */ (
            UI.el("pre", {
                className: "term",
                attrs: { tabindex: "0" }, // <-- wichtig
            })
        );

        this.outEl = term;

        const panel = UI.panel("Terminal", [
            term,
        ]);

        this.root.replaceChildren(panel);
        this.bag.on(term, "keydown", (ev) => this._onKeyDown(/** @type {KeyboardEvent}*/(ev)));
        this._renderScreen();

        queueMicrotask(() => term.focus());
    }

    onUnmount() {
        this.bag.dispose();
        this.outEl = null;
        this.inEl = null;
        super.onUnmount();
    }

    // ---------------------------
    // Output helpers
    // ---------------------------

    _println(text = "") {
        this.lines.push(text);
        this._renderScreen();
    }

    _scrollToBottom() {
        if (!this.outEl) return;
        this.outEl.scrollTop = this.outEl.scrollHeight;
    }

    _clear() {
        this.lines = [];
        this.lineBuffer = "";
        this.cursor = 0;
        this._renderScreen();
    }

    _promptString() {
        const user = this.env.USER ?? "user";
        const host = this.env.HOST ?? "host";
        return `${user}@${host}:${this.cwd}$ `;
    }

    /**
     * 
     * @param {string} v 
     * @returns 
     */

    _setInputValue(v) {
        if (!this.inEl) return;
        this.inEl.value = v;
        this.inEl.setSelectionRange(v.length, v.length);
    }

    // ---------------------------
    // Input handling
    // ---------------------------

    /**
     * @param {KeyboardEvent} ev
     */
    _onKeyDown(ev) {
        if (this.busy) {
            ev.preventDefault();
            return;
        }
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
            ev.preventDefault();
            this._insert(ev.key);
            return;
        }

        switch (ev.key) {
            case "Backspace":
                ev.preventDefault();
                this._backspace();
                break;

            case "Enter":
                ev.preventDefault();
                this._commitLine();
                break;

            case "ArrowLeft":
                ev.preventDefault();
                this._moveCursor(-1);
                break;

            case "ArrowRight":
                ev.preventDefault();
                this._moveCursor(1);
                break;

            case "ArrowUp":
                ev.preventDefault();
                this._historyUp();
                break;

            case "ArrowDown":
                ev.preventDefault();
                this._historyDown();
                break;

            case "Tab":
                ev.preventDefault();
                //TODO: Auto complete, not for now
                break;

            case "l":
                if (ev.ctrlKey || ev.metaKey) {
                    ev.preventDefault();
                    this._clear();
                    this._renderScreen();
                }
                break;
        }
    }

    /**
     * 
     * @param {string} ch 
     */
    _insert(ch) {
        this.lineBuffer =
            this.lineBuffer.slice(0, this.cursor) +
            ch +
            this.lineBuffer.slice(this.cursor);
        this.cursor++;
        this._renderScreen();
    }

    _backspace() {
        if (this.cursor === 0) return;
        this.lineBuffer =
            this.lineBuffer.slice(0, this.cursor - 1) +
            this.lineBuffer.slice(this.cursor);
        this.cursor--;
        this._renderScreen();
    }

    _historyUp() {
        if (this.history.length === 0) return;

        if (this.historyIndex > 0) {
            this.historyIndex--;
        }

        this.lineBuffer = this.history[this.historyIndex] ?? "";
        this.cursor = this.lineBuffer.length;
        this._renderScreen();
    }

    _historyDown() {
        if (this.history.length === 0) return;

        if (this.historyIndex < this.history.length) {
            this.historyIndex++;
        }

        if (this.historyIndex === this.history.length) {
            this.lineBuffer = "";
        } else {
            this.lineBuffer = this.history[this.historyIndex] ?? "";
        }

        this.cursor = this.lineBuffer.length;
        this._renderScreen();
    }

    /**
     * 
     * @param {number} delta 
     */

    _moveCursor(delta) {
        this.cursor = Math.max(0, Math.min(this.lineBuffer.length, this.cursor + delta));
        this._renderScreen();
    }

    _commitLine() {
        const line = this.lineBuffer;

        this.lines.push(this._promptString() + line);

        const trimmed = line.trim();
        if (trimmed.length > 0) {
            this.history.push(trimmed);
        }
        this.historyIndex = this.history.length;

        this.lineBuffer = "";
        this.cursor = 0;

        // WICHTIG: Busy an, und prompt NICHT anzeigen
        this.busy = true;
        this._renderScreen();

        void this._handleLine(line)
            .finally(() => {
                this.busy = false;
                this._renderScreen(); // prompt erscheint erst jetzt wieder
            });
    }

    _renderScreen() {
        if (!this.outEl) return;

        // Wenn busy: KEIN Prompt/Editorzeile anzeigen.
        if (this.busy) {
            this.outEl.textContent = (this.lines.length ? this.lines.join("\n") + "\n" : "");
            this._scrollToBottom();
            return;
        }

        const before = this.lineBuffer.slice(0, this.cursor);
        const after = this.lineBuffer.slice(this.cursor);
        const editLine = this._promptString() + before + "▉" + after;

        this.outEl.textContent =
            (this.lines.length ? this.lines.join("\n") + "\n" : "") +
            editLine;

        this._scrollToBottom();
    }

    /**
     * @param {string} line
     */
    async _handleLine(line) {
        const trimmed = line.trim();

        if (trimmed.length === 0) {
            this._renderScreen();
            return;
        }

        const { cmd, args } = this._parse(trimmed);

        const ctx = /** @type {ShellContext} */ ({
            app: this,
            os: this.os,
            pid: this.pid,
            env: this.env,
            cwd: this.cwd,
            setCwd: (cwd) => { this.cwd = cwd; },
            println: (t) => this._println(t ?? ""),
            clear: () => this._clear(),
            terminate: () => this.terminate(),
        });

        const entry = this.commands.get(cmd);
        if (!entry) {
            this._println(`command not found: ${cmd}`);
            this._renderScreen();
            return;
        }

        try {
            const res = await entry.run(ctx, args);
            if (typeof res === "string" && res.length) this._println(res);
        } catch (e) {
            this._println(`error: ${e instanceof Error ? e.message : String(e)}`);
        }

        this._renderScreen();
    }

    /**
     * Very small parser: supports quotes "like this" and 'like this'.
     * No escapes yet.
     * @param {string} line
     */
    _parse(line) {
        /** @type {string[]} */
        const tokens = [];
        let cur = "";
        let quote = /** @type {null | "'" | '"'} */ (null);

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];

            if (quote) {
                if (ch === quote) {
                    quote = null;
                } else {
                    cur += ch;
                }
                continue;
            }

            if (ch === "'" || ch === '"') {
                quote = ch;
                continue;
            }

            if (/\s/.test(ch)) {
                if (cur.length) {
                    tokens.push(cur);
                    cur = "";
                }
            } else {
                cur += ch;
            }
        }
        if (cur.length) tokens.push(cur);

        const cmd = tokens[0] ?? "";
        const args = tokens.slice(1);
        return { cmd, args };
    }

    // ---------------------------
    // Commands
    // ---------------------------

    _registerBuiltins() {
        /** @param {Command} c */
        const add = (c) => this.commands.set(c.name, c);

        add({
            name: "help",
            run: () => {
                const names = [...this.commands.keys()].sort();
                return [
                    "Built-in commands:",
                    "  " + names.join("  "),
                ].join("\n");
            },
        });

        add({
            name: "echo",
            run: (_ctx, args) => args.join(" "),
        });

        add({
            name: "clear",
            run: (ctx) => { ctx.clear(); },
        });

        add({
            name: "date",
            run: () => new Date().toString(),
        });

        add({
            name: "uname",
            run: (ctx, args) => {
                const a = args[0] ?? "";
                if (a === "-a") return `SimOS ${ctx.os?.name ?? "UnknownOS"} pid=${ctx.pid}`;
                return `${ctx.os?.name ?? "SimOS"}`;
            },
        });

        add({
            name: "whoami",
            run: (ctx) => ctx.env.USER ?? "user",
        });

        add({
            name: "pwd",
            run: (ctx) => ctx.cwd,
        });

        add({
            name: "cd",
            run: (ctx, args) => {
                const fs = ctx.os.fs;
                if (!fs) return "cd: no filesystem";

                const target = args[0] ?? "/home";
                const abs = fs.resolve(ctx.cwd, target);

                const st = fs.stat(abs);
                if (st.type !== "dir") return `cd: not a directory: ${target}`;

                ctx.setCwd(abs);
            },
        });

        add({
            name: "ls",
            run: (ctx, args) => {
                const fs = ctx.os.fs;
                if (!fs) return "ls: no filesystem";

                const p = args[0] ?? ctx.cwd;
                const abs = fs.resolve(ctx.cwd, p);
                const st = fs.stat(abs);

                if (st.type === "file") return p;
                return fs.readdir(abs).join("  ");
            },
        });

        add({
            name: "cat",
            run: (ctx, args) => {
                const fs = ctx.os.fs;
                if (!fs) return "cat: no filesystem";
                if (!args[0]) return "usage: cat <file>";

                const abs = fs.resolve(ctx.cwd, args[0]);
                return fs.readFile(abs);
            },
        });

        add({
            name: "touch",
            run: (ctx, args) => {
                const fs = ctx.os.fs;
                if (!fs) return "touch: no filesystem";
                if (args.length === 0) return "usage: touch <file> [...]";

                for (const p of args) {
                    const abs = fs.resolve(ctx.cwd, p);

                    // writeFile überschreibt oder legt neu an
                    // wir lassen vorhandenen Inhalt bewusst leer, falls neu
                    if (!fs.exists(abs)) {
                        fs.writeFile(abs, "");
                    } else {
                        // mtime "aktualisieren": read + write same content
                        const data = fs.readFile(abs);
                        fs.writeFile(abs, data);
                    }
                }
            },
        });

        add({
            name: "mkdir",
            run: (ctx, args) => {
                const fs = ctx.os.fs;
                if (!fs) return "mkdir: no filesystem";
                if (args.length === 0) return "usage: mkdir [-p] <dir> [...]";

                let recursive = false;
                const paths = [];

                for (const a of args) {
                    if (a === "-p") recursive = true;
                    else paths.push(a);
                }

                if (paths.length === 0) return "mkdir: missing operand";

                for (const p of paths) {
                    const abs = fs.resolve(ctx.cwd, p);
                    fs.mkdir(abs, { recursive });
                }
            },
        });
        add({
            name: "ping",
            run: (ctx, args) => this._cmdPing(ctx, args),
        });

    }

    /**
     * @param {string} cwd
     * @param {string} target
     */
    _resolvePath(cwd, target) {
        if (target.startsWith("/")) return this._normalizePath(target);
        return this._normalizePath(cwd.replace(/\/+$/, "") + "/" + target);
    }

    /**
     * @param {string} p
     */
    _normalizePath(p) {
        const parts = p.split("/").filter(Boolean);
        /** @type {string[]} */
        const stack = [];
        for (const part of parts) {
            if (part === ".") continue;
            if (part === "..") stack.pop();
            else stack.push(part);
        }
        return "/" + stack.join("/");
    }


    /**
     * ping [-c count] [-i interval] [-W timeout] <host>
     *
     * -c <count>    Anzahl der Pakete
     * -i <seconds>  Intervall zwischen Paketen (float erlaubt)
     * -W <seconds>  Timeout pro Paket (float erlaubt)
     *
     * @param {string[]} argv
     * @returns {string | {host: string, count: number, intervalMs: number, timeoutMs: number}}
     */
    _parsePingArgs(argv) {
        const args = [...argv];

        let count = 4;
        let intervalMs = 1000;
        let timeoutMs = 1000;
        let host = "";

        const usage = () => "usage: ping [-c count] [-i interval] [-W timeout] <host>";

        const take = () => args.shift();

        while (args.length) {
            const a = args[0];

            if (a === "-c") {
                args.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "ping: invalid count";
                count = Math.floor(v);
                // niemals mehr als 4
                if (count > 4) count = 4;
                continue;
            }

            if (a === "-i") {
                args.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "ping: invalid interval";
                intervalMs = Math.max(1, Math.floor(v * 1000));
                continue;
            }

            if (a === "-W") {
                args.shift();
                const v = Number(take());
                if (!Number.isFinite(v) || v <= 0) return "ping: invalid timeout";
                timeoutMs = Math.max(1, Math.floor(v * 1000));
                continue;
            }

            host = take() ?? "";
            break;
        }

        if (!host) return usage();
        return { host, count, intervalMs, timeoutMs };
    }




    /************************************ PING ***********************************/

    /**
     * ping [-c count] [-i interval] [-W timeout] <host>
     * Nutzt ctx.os.ipforwarder.icmpEcho(...)
     *
     * Erwartet: ctx.os.ipforwarder.icmpEcho(dstIpNum, { timeoutMs, identifier?, sequence?, payload? })
     * -> Promise<{ bytes:number, ttl:number, timeMs:number, identifier:number, sequence:number }>
     *
     * @param {ShellContext} ctx
     * @param {string[]} args
     */
    async _cmdPing(ctx, args) {
        const opt = this._parsePingArgs(args);
        if (typeof opt === "string") return opt;

        const { host, count, intervalMs, timeoutMs } = opt;

        // --- helpers: IPv4 string <-> number (network order)
        /** @param {string} s */
        const ipStringToNumber = (s) => {
            const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
            if (!m) return null;
            const a = m.slice(1).map((x) => Number(x));
            if (a.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
            // >>> 0 to keep unsigned
            return (((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0);
        };

        /** @param {number} n */
        const ipNumberToString = (n) => {
            const a = (n >>> 24) & 255;
            const b = (n >>> 16) & 255;
            const c = (n >>> 8) & 255;
            const d = n & 255;
            return `${a}.${b}.${c}.${d}`;
        };

        /** @param {number} ms */
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

        // --- resolve host -> dst as number
        let dstNum = ipStringToNumber(host);

        if (dstNum == null) {
            // Prefer OS DNS if present
            const dns = ctx.os?.dns;
            if (dns?.resolve) {
                const resolved = await dns.resolve(host); // can be string or number, depending on your impl
                if (typeof resolved === "number") dstNum = resolved >>> 0;
                else if (typeof resolved === "string") dstNum = ipStringToNumber(resolved);
            }
        }

        if (dstNum == null) {
            return `ping: cannot resolve ${host}`;
        }

        const dstStr = ipNumberToString(dstNum);

        // --- pick a stable identifier for this ping run
        const identifier = (Math.random() * 0xffff) | 0;

        ctx.println(`PING ${host} (${dstStr}) 56(84) bytes of data.`);

        let transmitted = 0;
        let received = 0;
        let minMs = Infinity;
        let maxMs = 0;
        let sumMs = 0;

        const started = now();

        for (let seq = 1; seq <= count; seq++) {
            transmitted++;

            try {
                // payload: 56 bytes "data" (typisch bei ping)
                const payload = new Uint8Array(56);

                const res = await ctx.os.ipforwarder.icmpEcho(dstNum, {
                    timeoutMs,
                    identifier,
                    sequence: seq & 0xffff,
                    payload,
                });

                received++;

                const t = Math.max(0, Math.round(res.timeMs ?? 0));
                minMs = Math.min(minMs, t);
                maxMs = Math.max(maxMs, t);
                sumMs += t;

                const ttl = res.ttl ?? 64;
                const bytes = res.bytes ?? (56 + 8); // data + icmp header fallback

                ctx.println(`${bytes} bytes from ${dstStr}: icmp_seq=${seq} ttl=${ttl} time=${t} ms`);
            } catch (e) {
                ctx.println(`Request timeout for icmp_seq ${seq}`);
            }

            if (seq < count) await sleep(intervalMs);
        }

        const elapsedMs = Math.max(1, Math.round(now() - started));
        const lossPct = Math.round(((transmitted - received) / transmitted) * 100);
        const avgMs = received ? (sumMs / received) : 0;

        ctx.println("");
        ctx.println(`--- ${host} ping statistics ---`);
        ctx.println(`${transmitted} packets transmitted, ${received} received, ${lossPct}% packet loss, time ${elapsedMs}ms`);
        if (received) {
            ctx.println(`rtt min/avg/max = ${Math.round(minMs)}/${Math.round(avgMs)}/${Math.round(maxMs)} ms`);
        }
    }

}