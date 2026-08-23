//@ts-check

import { t } from "../../i18n/index.js";

/**
 * Full-screen text editor engine (nano/pico-style). Decoupled from
 * TerminalApp: the command wrapper (`commands/fs/nano.js`) owns wiring this
 * into `app.rawKeyHandler` and restoring the screen on exit - this class
 * only knows about its own line buffer, cursor, viewport and the VFS.
 *
 * Layout (top to bottom, always exactly `rows` lines):
 *   row 0                    title bar (inverted)
 *   rows 1 .. rows-3         file content viewport
 *   row rows-2               status/message line, or the active prompt
 *   row rows-1               shortcut footer (inverted)
 */
export class Editor {
  /**
   * @param {{
   *   fs: any,
   *   cwd: string,
   *   path: string|null,
   *   content: string,
   *   rows: number,
   *   cols: number,
   *   programName?: string,
   *   onExit: () => void,
   * }} opts
   */
  constructor(opts) {
    this.fs = opts.fs;
    this.cwd = opts.cwd;
    this.path = opts.path;
    this.rows = opts.rows;
    this.cols = opts.cols;
    this.programName = opts.programName ?? "nano";
    this.onExit = opts.onExit;

    /** @type {string[]} always at least one entry, even for an empty buffer */
    this.lines = opts.content.split("\n");

    this.row = 0;
    this.col = 0;
    this.topLine = 0;
    this.leftCol = 0;
    this.modified = false;

    /** @type {"edit"|"prompt-save"|"prompt-exit"} */
    this.mode = "edit";
    this.promptBuffer = "";
    this.promptCursor = 0;
    this._exitAfterSave = false;

    this.message = opts.path ? "" : t("app.terminal.commands.nano.status.newFile");
    this.messageIsError = false;
  }

  /** How many rows are available for file content (title + status + footer reserved). */
  get contentHeight() {
    return Math.max(1, this.rows - 3);
  }

  // ---------------------------
  // Key dispatch
  // ---------------------------

  /** @param {KeyboardEvent} ev */
  handleKey(ev) {
    if (this.mode === "prompt-save") return this._handlePromptSaveKey(ev);
    if (this.mode === "prompt-exit") return this._handlePromptExitKey(ev);
    return this._handleEditKey(ev);
  }

  /** @param {KeyboardEvent} ev */
  _handleEditKey(ev) {
    const key = ev.key;

    if (key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      this._insertText(key);
      return;
    }

    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      const k = key.toLowerCase();
      if (k === "o") this._beginSavePrompt();
      else if (k === "x") this.promptExit();
      return;
    }

    switch (key) {
      case "Enter":      ev.preventDefault(); this._splitLine(); return;
      case "Backspace":  ev.preventDefault(); this._backspace(); return;
      case "Delete":     ev.preventDefault(); this._deleteForward(); return;
      case "ArrowLeft":  ev.preventDefault(); this._moveLeft(); return;
      case "ArrowRight": ev.preventDefault(); this._moveRight(); return;
      case "ArrowUp":    ev.preventDefault(); this._moveUp(); return;
      case "ArrowDown":  ev.preventDefault(); this._moveDown(); return;
      case "Home":       ev.preventDefault(); this.col = 0; this._clampScroll(); return;
      case "End":        ev.preventDefault(); this.col = this.lines[this.row].length; this._clampScroll(); return;
      case "PageUp":     ev.preventDefault(); this._pageUp(); return;
      case "PageDown":   ev.preventDefault(); this._pageDown(); return;
      case "Tab":        ev.preventDefault(); this._insertText("    "); return;
      default:           ev.preventDefault(); return;
    }
  }

  /** @param {KeyboardEvent} ev */
  _handlePromptSaveKey(ev) {
    const key = ev.key;
    ev.preventDefault();

    if (key === "Escape") {
      this.mode = "edit";
      this._exitAfterSave = false;
      this._setMessage(t("app.terminal.commands.nano.status.cancelled"), false);
      return;
    }
    if (key === "Enter") { this._commitSave(); return; }
    if (key === "Backspace") {
      if (this.promptCursor > 0) {
        this.promptBuffer = this.promptBuffer.slice(0, this.promptCursor - 1) + this.promptBuffer.slice(this.promptCursor);
        this.promptCursor--;
      }
      return;
    }
    if (key === "ArrowLeft")  { this.promptCursor = Math.max(0, this.promptCursor - 1); return; }
    if (key === "ArrowRight") { this.promptCursor = Math.min(this.promptBuffer.length, this.promptCursor + 1); return; }
    if (key === "Home") { this.promptCursor = 0; return; }
    if (key === "End")  { this.promptCursor = this.promptBuffer.length; return; }
    if (key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
      this.promptBuffer = this.promptBuffer.slice(0, this.promptCursor) + key + this.promptBuffer.slice(this.promptCursor);
      this.promptCursor++;
    }
  }

  /** @param {KeyboardEvent} ev */
  _handlePromptExitKey(ev) {
    ev.preventDefault();
    const key = ev.key.toLowerCase();

    if (ev.key === "Escape" || key === "c") {
      this.mode = "edit";
      this._setMessage(t("app.terminal.commands.nano.status.cancelled"), false);
      return;
    }
    if (key === "n") { this.mode = "edit"; this.onExit(); return; }
    if (key === "y") {
      if (this.path) {
        this.mode = "edit";
        if (this._writeToPath(this.path)) this.onExit();
      } else {
        this._exitAfterSave = true;
        this.mode = "prompt-save";
        this.promptBuffer = "";
        this.promptCursor = 0;
      }
    }
  }

  // ---------------------------
  // Buffer editing
  // ---------------------------

  /** @param {string} s */
  _insertText(s) {
    const line = this.lines[this.row];
    this.lines[this.row] = line.slice(0, this.col) + s + line.slice(this.col);
    this.col += s.length;
    this.modified = true;
    this._clearMessage();
    this._clampScroll();
  }

  _splitLine() {
    const line = this.lines[this.row];
    const before = line.slice(0, this.col);
    const after = line.slice(this.col);
    this.lines[this.row] = before;
    this.lines.splice(this.row + 1, 0, after);
    this.row++;
    this.col = 0;
    this.modified = true;
    this._clearMessage();
    this._clampScroll();
  }

  _backspace() {
    if (this.col > 0) {
      const line = this.lines[this.row];
      this.lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col);
      this.col--;
      this.modified = true;
    } else if (this.row > 0) {
      const prevLen = this.lines[this.row - 1].length;
      this.lines[this.row - 1] += this.lines[this.row];
      this.lines.splice(this.row, 1);
      this.row--;
      this.col = prevLen;
      this.modified = true;
    }
    this._clearMessage();
    this._clampScroll();
  }

  _deleteForward() {
    const line = this.lines[this.row];
    if (this.col < line.length) {
      this.lines[this.row] = line.slice(0, this.col) + line.slice(this.col + 1);
      this.modified = true;
    } else if (this.row < this.lines.length - 1) {
      this.lines[this.row] += this.lines[this.row + 1];
      this.lines.splice(this.row + 1, 1);
      this.modified = true;
    }
    this._clearMessage();
    this._clampScroll();
  }

  // ---------------------------
  // Cursor movement
  // ---------------------------

  _moveLeft() {
    if (this.col > 0) this.col--;
    else if (this.row > 0) { this.row--; this.col = this.lines[this.row].length; }
    this._clampScroll();
  }

  _moveRight() {
    const line = this.lines[this.row];
    if (this.col < line.length) this.col++;
    else if (this.row < this.lines.length - 1) { this.row++; this.col = 0; }
    this._clampScroll();
  }

  _moveUp() {
    if (this.row > 0) { this.row--; this.col = Math.min(this.col, this.lines[this.row].length); }
    this._clampScroll();
  }

  _moveDown() {
    if (this.row < this.lines.length - 1) { this.row++; this.col = Math.min(this.col, this.lines[this.row].length); }
    this._clampScroll();
  }

  _pageUp() {
    this.row = Math.max(0, this.row - this.contentHeight);
    this.col = Math.min(this.col, this.lines[this.row].length);
    this._clampScroll();
  }

  _pageDown() {
    this.row = Math.min(this.lines.length - 1, this.row + this.contentHeight);
    this.col = Math.min(this.col, this.lines[this.row].length);
    this._clampScroll();
  }

  /** Keeps the cursor within the visible viewport, scrolling it if needed. */
  _clampScroll() {
    const h = this.contentHeight;
    if (this.row < this.topLine) this.topLine = this.row;
    if (this.row >= this.topLine + h) this.topLine = this.row - h + 1;

    if (this.col < this.leftCol) this.leftCol = this.col;
    if (this.col >= this.leftCol + this.cols) this.leftCol = this.col - this.cols + 1;
  }

  // ---------------------------
  // Save / exit
  // ---------------------------

  _beginSavePrompt() {
    this.mode = "prompt-save";
    this.promptBuffer = this.path ?? "";
    this.promptCursor = this.promptBuffer.length;
  }

  /**
   * Exits immediately if there's nothing unsaved, otherwise opens the
   * exit-confirmation prompt instead of discarding changes outright. Bound
   * to both Ctrl+X and Ctrl+C (see `commands/fs/nano.js`) - a reflexive
   * Ctrl+C shouldn't silently throw away a student's work.
   */
  promptExit() {
    if (!this.modified) { this.onExit(); return; }
    this.mode = "prompt-exit";
  }

  _commitSave() {
    const raw = this.promptBuffer.trim();
    if (!raw) {
      this._setMessage(t("app.terminal.commands.nano.status.noFilename"), true);
      return;
    }

    /** @type {string} */
    let abs;
    try {
      abs = this.fs.resolve(this.cwd, raw);
    } catch (e) {
      this.mode = "edit";
      this._exitAfterSave = false;
      this._setMessage(t("app.terminal.commands.nano.status.writeError", { reason: e instanceof Error ? e.message : String(e) }), true);
      return;
    }

    this.mode = "edit";
    const ok = this._writeToPath(abs);
    const exitAfter = this._exitAfterSave;
    this._exitAfterSave = false;
    if (ok && exitAfter) this.onExit();
  }

  /**
   * @param {string} absPath
   * @returns {boolean} whether the write succeeded
   */
  _writeToPath(absPath) {
    try {
      this.fs.writeFile(absPath, this.lines.join("\n"));
      this.path = absPath;
      this.modified = false;
      this._setMessage(t("app.terminal.commands.nano.status.wroteFile", { path: absPath }), false);
      return true;
    } catch (e) {
      this._setMessage(t("app.terminal.commands.nano.status.writeError", { reason: e instanceof Error ? e.message : String(e) }), true);
      return false;
    }
  }

  /** @param {string} text @param {boolean} isError */
  _setMessage(text, isError) {
    this.message = text;
    this.messageIsError = isError;
  }

  _clearMessage() {
    this.message = "";
    this.messageIsError = false;
  }

  // ---------------------------
  // Rendering
  // ---------------------------

  /**
   * @param {string} s
   * @param {number} width
   */
  _padTrunc(s, width) {
    if (s.length >= width) return s.slice(0, width);
    return s.padEnd(width, " ");
  }

  _titleText() {
    const name = this.path ?? `[${t("app.terminal.commands.nano.status.newFile")}]`;
    const marker = this.modified ? " *" : "";
    return ` ${this.programName}  ${name}${marker}`;
  }

  /**
   * Writes this editor's full layout into the given grid arrays (mutated
   * in place - both must already have exactly `this.rows` entries of
   * length `this.cols`, matching TerminalApp's `screen`/`screenColor`).
   * @param {string[]} screenRows
   * @param {string[]} screenColorRows
   */
  render(screenRows, screenColorRows) {
    const { cols, rows } = this;
    const h = this.contentHeight;

    screenRows[0] = this._padTrunc(this._titleText(), cols);
    screenColorRows[0] = "2".repeat(cols);

    for (let i = 0; i < h; i++) {
      const lineIdx = this.topLine + i;
      const y = 1 + i;
      const raw = lineIdx < this.lines.length ? this.lines[lineIdx].slice(this.leftCol, this.leftCol + cols) : "";
      screenRows[y] = this._padTrunc(raw, cols);
      screenColorRows[y] = "0".repeat(cols);
    }

    const statusY = rows - 2;
    if (this.mode === "prompt-save") {
      const text = t("app.terminal.commands.nano.prompt.saveAs") + this.promptBuffer;
      screenRows[statusY] = this._padTrunc(text, cols);
      screenColorRows[statusY] = "2".repeat(cols);
    } else if (this.mode === "prompt-exit") {
      screenRows[statusY] = this._padTrunc(t("app.terminal.commands.nano.prompt.exitConfirm"), cols);
      screenColorRows[statusY] = "2".repeat(cols);
    } else if (this.message) {
      screenRows[statusY] = this._padTrunc(this.message, cols);
      screenColorRows[statusY] = (this.messageIsError ? "1" : "2").repeat(cols);
    } else {
      screenRows[statusY] = " ".repeat(cols);
      screenColorRows[statusY] = "0".repeat(cols);
    }

    const footerY = rows - 1;
    screenRows[footerY] = this._padTrunc(t("app.terminal.commands.nano.footer"), cols);
    screenColorRows[footerY] = "2".repeat(cols);

    // Cursor glyph - drawn last so it's never overwritten.
    if (this.mode === "edit") {
      const cy = 1 + (this.row - this.topLine);
      const cx = this.col - this.leftCol;
      if (cy >= 1 && cy <= h && cx >= 0 && cx < cols) {
        screenRows[cy] = screenRows[cy].slice(0, cx) + "▉" + screenRows[cy].slice(cx + 1);
      }
    } else if (this.mode === "prompt-save") {
      const cx = t("app.terminal.commands.nano.prompt.saveAs").length + this.promptCursor;
      if (cx < cols) {
        screenRows[statusY] = screenRows[statusY].slice(0, cx) + "▉" + screenRows[statusY].slice(cx + 1);
      }
    }
  }
}
