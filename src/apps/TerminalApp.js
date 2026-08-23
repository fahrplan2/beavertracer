//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { Disposer } from "../lib/Disposer.js";
import { registerBuiltins } from "./terminal/commands/index.js";
import { splitCommandList, parsePipeline } from "./terminal/Parser.js";
import { runPipeline } from "./terminal/Pipeline.js";
import { computeCompletions, longestCommonPrefix } from "./terminal/Completion.js";
import { expandCommandSubstitutions } from "./terminal/CommandSubstitution.js";
import { expandArithmetic } from "./terminal/Arithmetic.js";
import { parseScript, runScript, makeFunctionResolver, IncompleteInputError } from "./terminal/Script.js";
import { CommandError } from "./terminal/commands/lib/errors.js";
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
        HOME: "/home",
    };

    /** Exit status of the last executed pipeline - backs `$?`, persists across lines like real bash. */
    lastExitCode = 0;

    /**
     * Text accumulated across Enter-presses while an if/for/while/case
     * construct is still open (no closing fi/done/esac yet) - null when not
     * mid-continuation. Mirrors a real shell's PS2 prompt.
     * @type {string|null}
     */
    pendingInput = null;

    /** @type {Map<string, Command>} */
    commands = new Map();

    /**
     * Shell functions (`name() { ...; }`) defined interactively - shared,
     * mutable reference threaded into every `_handleLine`'s state (like
     * `env`), so a definition persists across separate commands the same
     * way it would in a real interactive shell. `sh script.sh` gets its own
     * fresh, empty one instead (see sh.js) - real subshell semantics, a
     * script doesn't inherit the caller's functions.
     * @type {Map<string, import("./terminal/Script.js").ScriptNode[]>}
     */
    functions = new Map();

    // ---------------------------
    // Terminal geometry
    // ---------------------------

    /** @type {number} */
    cols = 60;

    /** @type {number} */
    rows = 20;

    /** @type {number} */
    scrollbackLimit = 2000;

    /** @type {string[]} visible rows only, each exactly `cols` chars */
    screen = [];

    /** @type {string[]} */
    scrollback = [];

    /** @type {string[]} per-cell color tags parallel to `screen` ("0"=normal, "1"=stderr) */
    screenColor = [];

    /** @type {string[]} per-cell color tags parallel to `scrollback` */
    scrollbackColor = [];

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

    /** @type {((line: string) => void) | null} raw input mode: Enter sends line here instead of shell */
    rawInputHandler = null;

    /**
     * Raw key mode: every keydown is forwarded here as-is (no line editing,
     * no prompt overlay) instead of going through the normal input model.
     * Used by full-screen programs like `nano` - the handler is responsible
     * for its own preventDefault() and for drawing into `screen`/`screenColor`.
     * @type {((ev: KeyboardEvent) => void) | null}
     */
    rawKeyHandler = null;

    // ---------------------------
    // Abort controll managment (CTRL+C)
    // ---------------------------
    /** @type {AbortSignal} */
    signal = /** @type {any} */ (undefined);

    /** @type {(fn: () => void) => void} */
    onInterrupt = /** @type {any} */ (undefined);

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

    /** @type {HTMLInputElement|null} */
    _mobileInput = null;

    /** @type {boolean} true while mouse button is held down for text selection */
    _isSelecting = false;


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

        const isMobile = window.matchMedia("(max-width: 600px)").matches;

        const term = /** @type {HTMLPreElement} */ (
            UI.el("pre", {
                className: "term",
                attrs: { tabindex: "0" },
            })
        );

        this.outEl = term;

        if (isMobile) {
            // Hidden input captures virtual keyboard on touch devices.
            // font-size ≥ 16px prevents iOS from zooming the viewport on focus.
            const mi = /** @type {HTMLInputElement} */ (UI.el("input", {
                className: "term-mobile-input",
                attrs: {
                    type: "text",
                    autocomplete: "off",
                    autocorrect: "off",
                    autocapitalize: "off",
                    spellcheck: "false",
                },
            }));
            this._mobileInput = mi;
            this.focusTarget = mi;
            this.root.replaceChildren(mi, term);

            let suppressNextInput = false;

            this.disposer.on(mi, "keydown", /** @type {any} */ ((/** @type {Event} */ ev) => {
                const ke = /** @type {KeyboardEvent} */ (ev);

                if ((ke.ctrlKey || ke.metaKey) && (ke.key === "c" || ke.key === "C")) {
                    ke.preventDefault(); mi.value = ""; suppressNextInput = true;
                    this._interrupt(); return;
                }
                if ((ke.ctrlKey || ke.metaKey) && ke.key === "l") {
                    ke.preventDefault(); mi.value = ""; suppressNextInput = true;
                    this._clear(); return;
                }

                // Printable single chars → handled by `input` event
                if (ke.key.length === 1 && !ke.ctrlKey && !ke.metaKey) return;

                ke.preventDefault();
                suppressNextInput = true;
                mi.value = "";

                switch (ke.key) {
                    case "Enter":    this._commitLine(); break;
                    case "Backspace": this._backspace(); break;
                    case "Delete":   this._moveCursor(1); this._backspace(); break;
                    case "ArrowLeft":  this._moveCursor(-1); break;
                    case "ArrowRight": this._moveCursor(1); break;
                    case "ArrowUp":    this._historyUp(); break;
                    case "ArrowDown":  this._historyDown(); break;
                    case "Home": this.cursor = 0; this._renderScreen(); break;
                    case "End":  this.cursor = this.lineBuffer.length; this._renderScreen(); break;
                }
            }));

            this.disposer.on(mi, "input", /** @type {any} */ ((/** @type {Event} */ ev) => {
                if (suppressNextInput) { suppressNextInput = false; mi.value = ""; return; }
                const ie = /** @type {InputEvent} */ (ev);
                if (ie.inputType === "insertText" && ie.data) {
                    for (const ch of ie.data) this._insert(ch);
                } else if (ie.inputType === "deleteContentBackward") {
                    this._backspace();
                } else if (ie.inputType === "insertLineBreak" || ie.inputType === "insertParagraph") {
                    this._commitLine();
                }
                mi.value = "";
            }));

            this.disposer.on(term,      "pointerdown", () => mi.focus());
            this.disposer.on(this.root, "pointerdown", () => mi.focus());
        } else {
            this.focusTarget = term;
            this.root.replaceChildren(term);
            this.disposer.on(term, "keydown", (ev) => this._onKeyDown(/** @type {KeyboardEvent} */(ev)));
            this.disposer.on(term,      "pointerdown", () => term.focus());
            this.disposer.on(this.root, "pointerdown", () => term.focus());
            this.disposer.on(term, "mousedown", () => { this._isSelecting = true; });
            this.disposer.on(document, "mouseup", () => { this._isSelecting = false; });
            this.disposer.on(term, "contextmenu", (ev) => {
                ev.preventDefault();
                this._showContextMenu(/** @type {MouseEvent} */ (ev).clientX, /** @type {MouseEvent} */ (ev).clientY);
            });
        }

        // Recalculate column/row count based on actual pixel size (mobile font is smaller)
        requestAnimationFrame(() => {
            this._recalcGeometry(term);
            this._renderScreen();
        });

        this._startCursorBlink();
        this._renderScreen();
        setTimeout(() => (this._mobileInput ?? term).focus(), 0);
    }

    onUnmount() {
        this._stopCursorBlink();
        this.disposer.dispose();
        this.outEl = null;
        this._mobileInput = null;
        this.focusTarget = null;
        super.onUnmount();
    }

    /**
     * Recalculate `cols`/`rows` from the terminal element's actual rendered
     * size (font metrics + padding), so the grid fills the real viewport
     * instead of staying at the fixed 60x20 field defaults. Uses a
     * single-char probe for width, `line-height` for height (mobile uses a
     * smaller font and a tighter line-height, see app-terminal.css).
     * @param {HTMLElement} termEl
     */
    _recalcGeometry(termEl) {
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit";
        probe.textContent = "X".repeat(10);
        termEl.appendChild(probe);
        const charWidth = probe.getBoundingClientRect().width / 10;
        probe.remove();

        const lineHeight = parseFloat(window.getComputedStyle(termEl).lineHeight);

        if (!charWidth || !lineHeight) return;

        const padding = 14; // 2 × 7px from .term { padding: 7px }
        const newCols = Math.max(20, Math.floor((termEl.clientWidth - padding) / charWidth));
        const newRows = Math.max(10, Math.floor((termEl.clientHeight - padding) / lineHeight));

        if (newCols !== this.cols || newRows !== this.rows) {
            this.cols = newCols;
            this.rows = newRows;
            this._resetScreen();
            this.println(t("app.terminal.welcome", { host: this.env.HOST }));
            this.println("");
            this.println(t("app.terminal.hintHelp", { cmd: "help" }));
            this.println("");
        }
    }

    // ---------------------------
    // Screen / scrollback
    // ---------------------------

    _resetScreen() {
        this.scrollback = [];
        this.scrollbackColor = [];
        this.screen = Array.from({ length: this.rows }, () => " ".repeat(this.cols));
        this.screenColor = Array.from({ length: this.rows }, () => "0".repeat(this.cols));
        this.outX = 0;
        this.outY = 0;
    }

    /**
     * @param {string} line
     * @param {string} color
     */
    _pushScrollback(line, color) {
        this.scrollback.push(line);
        this.scrollbackColor.push(color);
        if (this.scrollback.length > this.scrollbackLimit) {
            const excess = this.scrollback.length - this.scrollbackLimit;
            this.scrollback.splice(0, excess);
            this.scrollbackColor.splice(0, excess);
        }
    }

    /** Scroll visible screen up by 1 line. Top line goes to scrollback. */
    _scrollUp() {
        this._pushScrollback(this.screen[0], this.screenColor[0]);
        this.screen.shift();
        this.screenColor.shift();
        this.screen.push(" ".repeat(this.cols));
        this.screenColor.push("0".repeat(this.cols));
        if (this.outY > 0) this.outY--;
    }

    // ---------------------------
    // Output writing with wrapping
    // ---------------------------

    /**
     * Write text (no implicit newline). Supports \n and \r. Wraps at word boundaries.
     * @param {string} text
     * @param {"0"|"1"} color "0" = normal (stdout), "1" = stderr
     */
    print(text = "", color = "0") {
        let pos = 0;
        while (pos < text.length) {
            const ch = text[pos];
            if (ch === "\n") { this._newline(); pos++; continue; }
            if (ch === "\r") { this.outX = 0;   pos++; continue; }
            if (ch === " ")  { this._putChar(" ", color); pos++; continue; }

            // find end of word
            let end = pos;
            while (end < text.length && text[end] !== " " && text[end] !== "\n" && text[end] !== "\r") end++;

            // wrap before word if it doesn't fit and we're not already at column 0
            const wordLen = end - pos;
            if (this.outX > 0 && this.outX + wordLen > this.cols) this._newline();

            for (let i = pos; i < end; i++) this._putChar(text[i], color);
            pos = end;
        }
        this._renderScreen();
    }

    /**
     * Print line with newline.
     * @param {string} text
     * @param {"0"|"1"} color "0" = normal (stdout), "1" = stderr
     */
    println(text = "", color = "0") {
        this.print(text + "\n", color);
    }

    _newline() {
        this.outX = 0;
        this.outY++;
        if (this.outY >= this.rows) {
            this._scrollUp();
            this.outY = this.rows - 1;
        }
    }

    /**
     * @param {string} ch
     * @param {"0"|"1"} color
     */
    _putChar(ch, color = "0") {
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

        const colorRow = this.screenColor[this.outY];
        this.screenColor[this.outY] = colorRow.slice(0, this.outX) + color + colorRow.slice(this.outX + 1);

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
        if (this.pendingInput) return "> "; // continuation prompt, like a real shell's PS2
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

        // Ctrl+Shift+C — copy selection (Ctrl+C is reserved for interrupt)
        if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "c" || ev.key === "C")) {
            ev.preventDefault();
            this._copySelection();
            return;
        }

        // Ctrl+V / Cmd+V
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "v" || ev.key === "V")) {
            ev.preventDefault();
            this._pasteFromClipboard();
            return;
        }

        // Raw key mode (e.g. nano): forward every keydown as-is, before line
        // editing and before the busy check - the handler owns the screen.
        if (this.rawKeyHandler) {
            this.rawKeyHandler(ev);
            return;
        }

        // Raw input mode (e.g. telnet): route keys to handler before busy check
        if (this.rawInputHandler) {
            if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
                ev.preventDefault(); this._insert(ev.key);
            } else if (ev.key === "Backspace") {
                ev.preventDefault(); this._backspace();
            } else if (ev.key === "Delete") {
                ev.preventDefault(); this._moveCursor(1); this._backspace();
            } else if (ev.key === "Enter") {
                ev.preventDefault();
                const line = this.lineBuffer;
                this.println(line);
                this.lineBuffer = ""; this.cursor = 0;
                this._renderScreen();
                this.rawInputHandler(line);
            } else if (ev.key === "ArrowLeft")  { ev.preventDefault(); this._moveCursor(-1); }
              else if (ev.key === "ArrowRight") { ev.preventDefault(); this._moveCursor(1); }
              else if (ev.key === "Home") { ev.preventDefault(); this.cursor = 0; this._renderScreen(); }
              else if (ev.key === "End")  { ev.preventDefault(); this.cursor = this.lineBuffer.length; this._renderScreen(); }
            return;
        }

        // On interaction, show cursor immediately
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

            case "Delete":
                ev.preventDefault();
                this._moveCursor(1);
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

            case "Home":
                ev.preventDefault();
                this.cursor = 0;
                this._renderScreen();
                break;

            case "End":
                ev.preventDefault();
                this.cursor = this.lineBuffer.length;
                this._renderScreen();
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
                this._tabComplete();
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

    _tabComplete() {
        const head = this.lineBuffer.slice(0, this.cursor);
        const tail = this.lineBuffer.slice(this.cursor);

        const result = computeCompletions(head, {
            commandNames: [...this.commands.entries()].filter(([, c]) => !c.hidden).map(([n]) => n),
            cwd: this.cwd,
            fs: this.os.fs,
        });
        if (!result) return;

        const { prefix, names, trailingFor } = result;

        if (names.length === 1) {
            this._insertCompletionText(names[0].slice(prefix.length), tail, trailingFor(names[0]));
            return;
        }

        // Ambiguous: complete as far as we unambiguously can. If that's no
        // further than what's already typed, just stop - no candidate dump,
        // keeps typing flow uninterrupted.
        const lcp = longestCommonPrefix(names);
        if (lcp.length > prefix.length) {
            this._insertCompletionText(lcp.slice(prefix.length), tail, "");
        }
    }

    /**
     * @param {string} suffix
     * @param {string} tail
     * @param {string} trailingChar
     */
    _insertCompletionText(suffix, tail, trailingChar) {
        let toInsert = suffix;
        if (trailingChar && !tail.startsWith(trailingChar)) toInsert += trailingChar;
        if (!toInsert) return;

        this.lineBuffer = this.lineBuffer.slice(0, this.cursor) + toInsert + this.lineBuffer.slice(this.cursor);
        this.cursor += toInsert.length;
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

        // Don't overwrite textContent while mouse is held down or text is selected — destroys the selection
        if (this._isSelecting) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && this.outEl.contains(sel.anchorNode)) return;

        // Raw key mode (e.g. nano): the handler owns `screen`/`screenColor`
        // entirely (its own layout, its own cursor glyph) - no prompt overlay.
        if (this.rawKeyHandler) {
            this._paintRows(this.screen, this.screenColor);
            return;
        }

        // Clone base screen
        /** @type {string[]} */
        const tmp = this.screen.slice();
        /** @type {string[]} */
        const tmpColor = this.screenColor.slice();

        // If busy and not in raw mode: just show output buffer (no overlay cursor)
        if (this.busy && !this.rawInputHandler) {
            this._paintRows(tmp, tmpColor);
            return;
        }

        const prompt = this.rawInputHandler ? "" : this._promptString();
        const full = prompt + this.lineBuffer;

        const cursorPos = prompt.length + this.cursor; // index in `full`

        let x = this.outX;
        let y = this.outY;

        const visScrollUp = () => {
            tmp.shift();
            tmpColor.shift();
            tmp.push(" ".repeat(this.cols));
            tmpColor.push("0".repeat(this.cols));
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

        // Render all chars (prompt + input line always render as normal color)
        for (let i = 0; i < full.length; i++) {
            // If cursor is *before* this character, it sits at current x/y
            if (i === cursorPos) {
                cursorX = x;
                cursorY = y;
            }

            ensureVisible();

            const ch = full[i];
            tmp[y] = tmp[y].slice(0, x) + ch + tmp[y].slice(x + 1);
            tmpColor[y] = tmpColor[y].slice(0, x) + "0" + tmpColor[y].slice(x + 1);
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
            tmpColor[cursorY] = tmpColor[cursorY].slice(0, cursorX) + "0" + tmpColor[cursorY].slice(cursorX + 1);
        }

        this._paintRows(tmp, tmpColor);
    }

    /**
     * Renders text/color row grids into `outEl` as DOM nodes, grouping
     * consecutive same-color runs into spans so stderr (color "1") can be
     * styled without touching the plain-text (color "0") fast path.
     * Uses only createTextNode/createElement (no innerHTML) - no escaping
     * concerns, and copy/paste via getSelection() keeps working as before.
     * @param {string[]} rows
     * @param {string[]} colorRows
     */
    _paintRows(rows, colorRows) {
        if (!this.outEl) return;
        const frag = document.createDocumentFragment();

        for (let y = 0; y < rows.length; y++) {
            if (y > 0) frag.appendChild(document.createTextNode("\n"));

            const row = rows[y];
            const colorRow = colorRows[y] ?? "0".repeat(row.length);

            let runStart = 0;
            while (runStart < row.length) {
                const c = colorRow[runStart];
                let runEnd = runStart + 1;
                while (runEnd < row.length && colorRow[runEnd] === c) runEnd++;

                const text = row.slice(runStart, runEnd);
                if (c === "1") {
                    const span = document.createElement("span");
                    span.className = "term-stderr";
                    span.textContent = text;
                    frag.appendChild(span);
                } else if (c === "2") {
                    const span = document.createElement("span");
                    span.className = "term-status";
                    span.textContent = text;
                    frag.appendChild(span);
                } else {
                    frag.appendChild(document.createTextNode(text));
                }

                runStart = runEnd;
            }
        }

        this.outEl.replaceChildren(frag);
    }


    // ---------------------------
    // Command execution
    // ---------------------------

    /**
     * @param {string} line
     */
    async _handleLine(line) {
        if (!this.pendingInput && line.trim().length === 0) return;

        // Accumulate across Enter-presses while a construct (if/for/while/
        // case) is still open - mirrors a real shell's PS2 continuation
        // prompt. Structure (if/for/while/case) and execution both go
        // through Script.js now - the same engine `sh` uses for whole
        // files - so `$?`/export/cd/etc. are visible line-to-line exactly
        // like they already were entry-to-entry within one `;`/`&&`/`||`
        // chain.
        const combinedText = this.pendingInput ? `${this.pendingInput}\n${line}` : line;

        /** @type {import("./terminal/Script.js").ScriptNode[]} */
        let nodes;
        try {
            nodes = parseScript(combinedText);
        } catch (e) {
            if (e instanceof IncompleteInputError) {
                this.pendingInput = combinedText;
                return;
            }
            this.pendingInput = null;
            this.println(e instanceof CommandError ? e.message : t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }), "1");
            return;
        }
        this.pendingInput = null;

        const state = {
            app: this,
            env: this.env, // shared reference - this IS the session, no isolation
            cwd: this.cwd,
            pid: this.pid,
            positional: /** @type {string[]} */ ([]),
            scriptName: "sh",
            lastExitCode: this.lastExitCode,
            signal: this.currentAbort?.signal ?? new AbortController().signal,
            functions: this.functions, // shared reference - same reasoning as env
            heredocs: /** @type {Map<string, {body: string, literal: boolean}>} */ (
                /** @type {any} */ (nodes).heredocs ?? new Map()
            ),
        };

        try {
            // Individual command failures inside a "simple" node are already
            // handled by runPipeline's own per-stage try/catch and never
            // reach here. What *can* propagate up to this level: Ctrl+C
            // (AbortError) from a loop's own abort check, and a while/until
            // loop hitting its iteration cap - neither goes through
            // runPipeline, so there's no other net catching them.
            await runScript(nodes, state);
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") {
                // already interrupted (Ctrl+C) - nothing more to report
            } else if (!this.currentAbort?.signal.aborted) {
                this.println(e instanceof CommandError ? e.message : t("app.terminal.err.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }), "1");
            }
        }

        this.cwd = state.cwd;
        this.lastExitCode = state.lastExitCode;
    }

    /**
     * Runs `cmdText` (a possibly `;`/`&&`/`||`-joined chain, itself first
     * expanded for any further nested `$(...)`) with stdout captured into a
     * string instead of rendered - the engine behind `$(...)` command
     * substitution. stderr (color "1") still goes to the real terminal,
     * matching real shells (only stdout is captured). `env`/`cwd` are local
     * copies of `baseEnv`/`baseCwd` (default: this session's live ones) -
     * subshell-like isolation, so `cd`/`export`/assignments inside a
     * substitution never leak into the caller, whether that caller is the
     * interactive session or a running script (which passes its own,
     * already-isolated env/cwd as the base - see Script.js).
     * @param {string} cmdText
     * @param {Record<string,string>} [baseEnv]
     * @param {string} [baseCwd]
     * @param {Map<string, import("./terminal/Script.js").ScriptNode[]>} [baseFunctions]
     * @returns {Promise<string>}
     */
    async _runNestedCapture(cmdText, baseEnv = this.env, baseCwd = this.cwd, baseFunctions = this.functions) {
        /** @type {import("./terminal/Script.js").ScriptExecState} */
        const state = {
            app: this,
            env: { ...baseEnv },
            cwd: baseCwd,
            pid: this.pid,
            lastExitCode: this.lastExitCode,
            positional: [],
            scriptName: "sh",
            // Subshell semantics: inherits (copies) the caller's currently
            // defined functions, but a funcdef executed inside `$(...)`
            // itself never leaks back out - same isolation env already gets.
            functions: new Map(baseFunctions),
            // Heredocs aren't supported inside `$(...)` (this capture never
            // runs Script.js's heredoc pre-pass) - always empty, just needs
            // to exist so a function called from here (which does go
            // through runSimpleText) doesn't crash reading `.size` on it.
            heredocs: new Map(),
            signal: this.currentAbort?.signal ?? new AbortController().signal,
        };

        /** @type {string[]} */
        const chunks = [];
        const captureApp = new Proxy(this, {
            get: (target, prop) => {
                if (prop === "cwd") return state.cwd;
                if (prop === "print") return (/** @type {string} */ text, /** @type {"0"|"1"} */ color = "0") =>
                    color === "1" ? target.print(text, color) : chunks.push(text ?? "");
                if (prop === "println") return (/** @type {string} */ text, /** @type {"0"|"1"} */ color = "0") =>
                    color === "1" ? target.println(text, color) : chunks.push((text ?? "") + "\n");
                return Reflect.get(target, prop);
            },
        });

        const buildCtx = (/** @type {Partial<ShellContext>} */ overrides) => ({
            ...this._buildShellContext(overrides),
            env: state.env,
            cwd: state.cwd,
            setCwd: (/** @type {string} */ cwd) => { state.cwd = cwd; },
        });

        const entries = splitCommandList(cmdText);
        let lastOk = true;

        for (const entry of entries) {
            if (!entry.text) continue;
            if (entry.op === "&&" && !lastOk) continue;
            if (entry.op === "||" && lastOk) continue;

            const substituted = await expandCommandSubstitutions(entry.text, (inner) => this._runNestedCapture(inner, state.env, state.cwd, state.functions));
            const expanded = expandArithmetic(substituted, state.env);
            const stages = parsePipeline(expanded, state.env, {
                fs: this.os.fs,
                cwd: state.cwd,
                pid: this.pid,
                lastExitCode: this.lastExitCode,
            });

            lastOk = await runPipeline(captureApp, stages, buildCtx, makeFunctionResolver(state));
        }

        return chunks.join("").replace(/\n+$/, "");
    }

    /**
     * Runs `cmdText` fully headless: no DOM/terminal panel is ever created
     * or touched, stdout is captured (not rendered), and — unlike
     * `_runNestedCapture` (the `$(...)` substitution engine, whose string-only
     * return contract two other call sites already depend on) — whether the
     * command chain succeeded is also returned. Used by CheckApi for
     * ":::task" shell-command checks in the lessons panel.
     * @param {string} cmdText
     * @returns {Promise<{ stdout: string, ok: boolean }>}
     */
    async runHeadless(cmdText) {
        /** @type {import("./terminal/Script.js").ScriptExecState} */
        const state = {
            app: this,
            env: { ...this.env },
            cwd: this.cwd,
            pid: this.pid,
            lastExitCode: this.lastExitCode,
            positional: [],
            scriptName: "sh",
            functions: new Map(this.functions),
            heredocs: new Map(),
            signal: this.currentAbort?.signal ?? new AbortController().signal,
        };

        /** @type {string[]} */
        const chunks = [];
        const captureApp = new Proxy(this, {
            get: (target, prop) => {
                if (prop === "cwd") return state.cwd;
                if (prop === "print") return (/** @type {string} */ text, /** @type {"0"|"1"} */ color = "0") =>
                    color === "1" ? undefined : chunks.push(text ?? "");
                if (prop === "println") return (/** @type {string} */ text, /** @type {"0"|"1"} */ color = "0") =>
                    color === "1" ? undefined : chunks.push((text ?? "") + "\n");
                return Reflect.get(target, prop);
            },
        });

        const buildCtx = (/** @type {Partial<ShellContext>} */ overrides) => ({
            ...this._buildShellContext(overrides),
            env: state.env,
            cwd: state.cwd,
            setCwd: (/** @type {string} */ cwd) => { state.cwd = cwd; },
        });

        const entries = splitCommandList(cmdText);
        let lastOk = true;

        for (const entry of entries) {
            if (!entry.text) continue;
            if (entry.op === "&&" && !lastOk) continue;
            if (entry.op === "||" && lastOk) continue;

            const substituted = await expandCommandSubstitutions(entry.text, (inner) => this._runNestedCapture(inner, state.env, state.cwd, state.functions));
            const expanded = expandArithmetic(substituted, state.env);
            const stages = parsePipeline(expanded, state.env, {
                fs: this.os.fs,
                cwd: state.cwd,
                pid: this.pid,
                lastExitCode: this.lastExitCode,
            });

            lastOk = await runPipeline(captureApp, stages, buildCtx, makeFunctionResolver(state));
        }

        return { stdout: chunks.join("").replace(/\n+$/, ""), ok: lastOk };
    }

    /**
     * Builds the base ShellContext shared by every stage of a pipeline.
     * `overrides` supplies the per-stage stdout/stderr/stdin/println wiring.
     * @param {Partial<ShellContext>} overrides
     * @returns {ShellContext}
     */
    _buildShellContext(overrides) {
        return /** @type {ShellContext} */ ({
            app: this,
            os: this.os,
            pid: this.pid,
            env: this.env,
            cwd: this.cwd,
            setCwd: (cwd) => { this.cwd = cwd; },
            clear: () => this._clear(),
            terminate: () => this.terminate(),

            signal: this.currentAbort?.signal ?? new AbortController().signal,
            onInterrupt: (fn) => { this.interruptHandlers.push(fn); },

            ...overrides,
        });
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

        // Cancel any open if/for/while/case continuation - matches a real
        // shell discarding a partially-typed command on Ctrl+C
        this.pendingInput = null;

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

    async _pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            for (const ch of text) {
                if (ch === "\n" || ch === "\r") continue;
                if (ch >= " " || ch === "\t") this._insert(ch);
            }
        } catch {
            // clipboard permission denied or unavailable — silently ignore
        }
    }

    async _copySelection() {
        const sel = window.getSelection()?.toString();
        if (!sel) return;
        try {
            await navigator.clipboard.writeText(sel);
        } catch {
            // clipboard permission denied or unavailable — silently ignore
        }
    }

    /**
     * @param {number} x clientX
     * @param {number} y clientY
     */
    _showContextMenu(x, y) {
        const existing = document.querySelector(".term-context-menu");
        if (existing) existing.remove();

        const selectedText = window.getSelection()?.toString() ?? "";

        const menu = document.createElement("div");
        menu.className = "term-context-menu";
        menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9999`;

        if (selectedText) {
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.textContent = t("app.terminal.copy");
            copyBtn.addEventListener("pointerdown", (ev) => {
                ev.preventDefault();
                menu.remove();
                this._copySelection();
            });
            menu.appendChild(copyBtn);
        }

        const pasteBtn = document.createElement("button");
        pasteBtn.type = "button";
        pasteBtn.textContent = t("app.terminal.paste");
        pasteBtn.addEventListener("pointerdown", (ev) => {
            ev.preventDefault();
            menu.remove();
            this._pasteFromClipboard();
        });
        menu.appendChild(pasteBtn);

        document.body.appendChild(menu);

        // clamp into viewport
        const r = menu.getBoundingClientRect();
        if (r.right  > window.innerWidth)  menu.style.left = `${x - r.width}px`;
        if (r.bottom > window.innerHeight) menu.style.top  = `${y - r.height}px`;

        const close = (/** @type {Event} */ ev) => {
            if (!menu.contains(/** @type {Node} */(ev.target))) {
                menu.remove();
                document.removeEventListener("pointerdown", close, { capture: true });
            }
        };
        document.addEventListener("pointerdown", close, { capture: true });
    }

    _startCursorBlink() {
        this._stopCursorBlink(); // defensive
        this.cursorVisible = true;

        this.blinkTimer = window.setInterval(() => {
            // If busy, you can either keep blinking off, or do nothing.
            // Doing nothing avoids re-render spam while commands run.
            if (this.busy) return;
            // Raw key mode (e.g. nano) draws its own static cursor glyph -
            // nothing here to blink, and re-rendering would just be wasted work.
            if (this.rawKeyHandler) return;

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
