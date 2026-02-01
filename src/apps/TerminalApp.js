//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { registerBuiltins } from "./terminal/commands/index.js";
import { t } from "../i18n/index.js";


/**
 * @typedef {import("./terminal/commands/types.js").ShellContext} ShellContext
 * @typedef {import("./terminal/commands/types.js").Command} Command
 */


export class TerminalApp extends GenericProcess {

    get title() {
        return t("app.terminal.title");
    }
    icon="fa-terminal";

    /** @type {Disposer} */
    disposer = new Disposer();

    /** @type {HTMLPreElement|null} */
    outEl = null;

    /** @type {string[]} */
    history = [];

    /** @type {number} */
    historyIndex = 0;

    /** @type {string} */
    cwd = "/home";

    /** @type {Record<string, string>} */
    env = {
        USER: "user",
        HOST: this.os.name.replace(" ",""),
        TERM: "xterm-ish",
    };

    /** @type {Map<string, Command>} */
    commands = new Map();

    // ---------------------------
    // Terminal geometry
    // ---------------------------

    /** @type {number} */
    cols = 80;

    /** @type {number} */
    rows = 25;

    /** @type {number} */
    scrollbackLimit = 2000;

    /** @type {string[]} visible rows only, each exactly `cols` chars */
    screen = [];

    /** @type {string[]} */
    scrollback = [];

    /** Output cursor (where the next output character would go) */
    /** @type {number} */
    outX = 0;

    /** @type {number} */
    outY = 0;

    // ---------------------------
    // Input editor (logical single line)
    // Visually it wraps in the screen overlay
    // ---------------------------

    /** @type {string} */
    lineBuffer = "";

    /** @type {number} */
    cursor = 0;

    /** @type {boolean} if a command is running (like ping) */
    busy = false;

    // ---------------------------
    // Abort controll managment (CTRL+C)
    // ---------------------------
    /** @type {AbortSignal} */
    signal;

    /** @type {(fn: () => void) => void} */
    onInterrupt;

    /** @type {AbortController|null} */
    currentAbort = null;

    /** @type {(() => void)[]} */
    interruptHandlers = [];

    // ---------------------------
    // Cursor Blink
    // ---------------------------
    /** @type {boolean} */
    cursorVisible = true;

    /** @type {number | null} */
    blinkTimer = null;


    run() {
        this.root.classList.add("app", "app-terminal");
        this._registerBuiltins();

        this._resetScreen();

        this.println(t("app.terminal.welcome", { host: this.env.HOST }));
        this.println("");
        this.println(t("app.terminal.hintHelp", { cmd: "help" }));
        this.println("");
    }

    /**
     * @param {HTMLElement} root
     */
    onMount(root) {
        super.onMount(root);
        this.disposer.dispose();

        const term = /** @type {HTMLPreElement} */ (
            UI.el("pre", {
                className: "term",
                attrs: { tabindex: "0" },
            })
        );

        this.outEl = term;
        this.root.replaceChildren(term);

        this.disposer.on(term, "keydown", (ev) => this._onKeyDown(/** @type {KeyboardEvent} */(ev)));
        this._startCursorBlink();

        this._renderScreen();
        queueMicrotask(() => term.focus());
    }

    onUnmount() {
        this._stopCursorBlink();
        this.disposer.dispose();
        this.outEl = null;
        super.onUnmount();
    }

    // ---------------------------
    // Screen / scrollback
    // ---------------------------

    _resetScreen() {
        this.scrollback = [];
        this.screen = Array.from({ length: this.rows }, () => " ".repeat(this.cols));
        this.outX = 0;
        this.outY = 0;
    }

    /** @param {string} line */
    _pushScrollback(line) {
        this.scrollback.push(line);
        if (this.scrollback.length > this.scrollbackLimit) {
            this.scrollback.splice(0, this.scrollback.length - this.scrollbackLimit);
        }
    }

    /** Scroll visible screen up by 1 line. Top line goes to scrollback. */
    _scrollUp() {
        this._pushScrollback(this.screen[0]);
        this.screen.shift();
        this.screen.push(" ".repeat(this.cols));
        if (this.outY > 0) this.outY--;
    }

    // ---------------------------
    // Output writing with wrapping
    // ---------------------------

    /**
     * Write text (no implicit newline). Supports \n and \r. Auto-wraps at cols.
     * @param {string} text
     */
    print(text = "") {
        for (const ch of text) {
            if (ch === "\n") {
                this._newline();
                continue;
            }
            if (ch === "\r") {
                this.outX = 0;
                continue;
            }
            this._putChar(ch);
        }
        this._renderScreen();
    }

    /**
     * Print line with newline.
     * @param {string} text
     */
    println(text = "") {
        this.print(text + "\n");
    }

    _newline() {
        this.outX = 0;
        this.outY++;
        if (this.outY >= this.rows) {
            this._scrollUp();
            this.outY = this.rows - 1;
        }
    }

    /** @param {string} ch */
    _putChar(ch) {
        // soft wrap
        if (this.outX >= this.cols) {
            this._newline();
        }

        if (this.outY >= this.rows) {
            this._scrollUp();
            this.outY = this.rows - 1;
        }

        const row = this.screen[this.outY];
        this.screen[this.outY] = row.slice(0, this.outX) + ch + row.slice(this.outX + 1);

        this.outX++;
        // next char will wrap if needed
    }

    _clear() {
        this._resetScreen();
        this.lineBuffer = "";
        this.cursor = 0;
        this._renderScreen();
    }

    _promptString() {
        const user = this.env.USER ?? "user";
        const host = this.env.HOST ?? "host";
        return `${user}@${host}:${this.cwd}$ `;
    }

    // ---------------------------
    // Input handling
    // ---------------------------

    /**
     * @param {KeyboardEvent} ev
     */
    _onKeyDown(ev) {
        // Ctrl+C
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "c" || ev.key === "C")) {
            ev.preventDefault();
            this._interrupt();
            return;
        }

        // On interaction, show cursor immediatel
        if (!this.busy) {
            this.cursorVisible = true;
        }

        // if busy, ignore typing (like your previous behavior)
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
                // TODO: autocomplete
                break;

            case "l":
                if (ev.ctrlKey || ev.metaKey) {
                    ev.preventDefault();
                    this._clear();
                }
                break;
        }
    }

    /** @param {string} ch */
    _insert(ch) {
        this.lineBuffer =
            this.lineBuffer.slice(0, this.cursor) + ch + this.lineBuffer.slice(this.cursor);
        this.cursor++;
        this._renderScreen();
    }

    _backspace() {
        if (this.cursor === 0) return;
        this.lineBuffer =
            this.lineBuffer.slice(0, this.cursor - 1) + this.lineBuffer.slice(this.cursor);
        this.cursor--;
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

    _historyUp() {
        if (this.history.length === 0) return;
        if (this.historyIndex > 0) this.historyIndex--;
        this.lineBuffer = this.history[this.historyIndex] ?? "";
        this.cursor = this.lineBuffer.length;
        this._renderScreen();
    }

    _historyDown() {
        if (this.history.length === 0) return;

        if (this.historyIndex < this.history.length) this.historyIndex++;

        this.lineBuffer =
            this.historyIndex === this.history.length ? "" : this.history[this.historyIndex] ?? "";
        this.cursor = this.lineBuffer.length;
        this._renderScreen();
    }

    _commitLine() {
        const line = this.lineBuffer;

        // Commit prompt + line into the REAL buffer (this will wrap/scroll for real)
        this.println(this._promptString() + line);

        const trimmed = line.trim();
        if (trimmed.length > 0) this.history.push(trimmed);
        this.historyIndex = this.history.length;

        this.lineBuffer = "";
        this.cursor = 0;

        this.busy = true;
        this._renderScreen();

        this.currentAbort = new AbortController();
        this.interruptHandlers = [];

        void this._handleLine(line).finally(() => {
            this.busy = false;
            this._renderScreen();
        });
    }

    // ---------------------------
    // Render (overlay prompt+input into the current screen)
    // ---------------------------

    _renderScreen() {
        if (!this.outEl) return;

        // Clone base screen
        /** @type {string[]} */
        const tmp = this.screen.slice();

        // If busy: just show output buffer (no overlay cursor)
        if (this.busy) {
            this.outEl.textContent = tmp.join("\n");
            return;
        }

        const prompt = this._promptString();
        const full = prompt + this.lineBuffer;

        const cursorPos = prompt.length + this.cursor; // index in `full`

        let x = this.outX;
        let y = this.outY;

        const visScrollUp = () => {
            tmp.shift();
            tmp.push(" ".repeat(this.cols));
            y = Math.max(0, y - 1);
        };

        // Track cursor cell, but draw it AFTER text is rendered
        let cursorX = x;
        let cursorY = y;

        const ensureVisible = () => {
            // wrap
            if (x >= this.cols) {
                x = 0;
                y++;
            }
            // scroll if needed
            if (y >= this.rows) {
                visScrollUp();
                y = this.rows - 1;
            }
        };

        // Render all chars
        for (let i = 0; i < full.length; i++) {
            // If cursor is *before* this character, it sits at current x/y
            if (i === cursorPos) {
                cursorX = x;
                cursorY = y;
            }

            ensureVisible();

            const ch = full[i];
            tmp[y] = tmp[y].slice(0, x) + ch + tmp[y].slice(x + 1);
            x++;
        }

        // Cursor at end-of-line (after last char)
        if (cursorPos === full.length) {
            // cursor sits where the next char would go
            cursorX = x;
            cursorY = y;
            // normalize in case it's exactly at cols
            if (cursorX >= this.cols) {
                cursorX = 0;
                cursorY++;
            }
            if (cursorY >= this.rows) {
                // visually scroll one line to make room
                visScrollUp();
                cursorY = this.rows - 1;
            }
        }

        // Paint cursor block last (so it cannot be overwritten)
        if (cursorY >= this.rows) {
            // just in case
            cursorY = this.rows - 1;
        }
        if (cursorX >= this.cols) {
            cursorX = this.cols - 1;
        }
        if (this.cursorVisible) {
            tmp[cursorY] = tmp[cursorY].slice(0, cursorX) + "▉" + tmp[cursorY].slice(cursorX + 1);
        }

        this.outEl.textContent = tmp.join("\n");
    }


    // ---------------------------
    // Command execution
    // ---------------------------

    /**
     * @param {string} line
     */
    async _handleLine(line) {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;

        const { cmd, args } = this._parse(trimmed);

        const ctx = /** @type {ShellContext} */ ({
            app: this,
            os: this.os,
            pid: this.pid,
            env: this.env,
            cwd: this.cwd,
            setCwd: (cwd) => { this.cwd = cwd; },
            println: (t2) => this.println(t2 ?? ""),
            clear: () => this._clear(),
            terminate: () => this.terminate(),

            signal: this.currentAbort?.signal ?? new AbortController().signal,
            onInterrupt: (fn) => { this.interruptHandlers.push(fn); },
        });

        const entry = this.commands.get(cmd);
        if (!entry) {
            ctx.println(t("app.terminal.err.commandNotFound", { cmd }));
            return;
        }

        try {
            const res = await entry.run(ctx, args);
            if (typeof res === "string" && res.length) ctx.println(res);
        } catch (e) {
            // Ignore abort “errors”
            if (ctx.signal.aborted) return;

            ctx.println(t("app.terminal.err.errorPrefix", { msg: (e instanceof Error ? e.message : String(e)) }));
        }

    }

    /**
     * Very small parser: supports quotes "like this" and 'like this'. No escapes.
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
                if (ch === quote) quote = null;
                else cur += ch;
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
    // Built-in commands
    // ---------------------------

    _registerBuiltins() {
        registerBuiltins(this);
    }


    _interrupt() {
        // Print ^C like a real terminal
        this.println(t("app.terminal.interrupt"));

        // Clear current input buffer
        this.lineBuffer = "";
        this.cursor = 0;

        // Call optional interrupt handlers (rarely needed, but nice)
        for (const fn of this.interruptHandlers.splice(0)) {
            try { fn(); } catch { /* ignore */ }
        }

        // Abort running command if any
        if (this.currentAbort && !this.currentAbort.signal.aborted) {
            this.currentAbort.abort();
        }

        // Unbusy immediately so prompt returns
        this.busy = false;
        this._renderScreen();
    }

    _startCursorBlink() {
        this._stopCursorBlink(); // defensive
        this.cursorVisible = true;

        this.blinkTimer = window.setInterval(() => {
            // If busy, you can either keep blinking off, or do nothing.
            // Doing nothing avoids re-render spam while commands run.
            if (this.busy) return;

            this.cursorVisible = !this.cursorVisible;
            this._renderScreen();
        }, 500);
    }

    _stopCursorBlink() {
        if (this.blinkTimer != null) {
            clearInterval(this.blinkTimer);
            this.blinkTimer = null;
        }
    }
}
