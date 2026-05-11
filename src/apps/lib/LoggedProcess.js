//@ts-check

import { GenericProcess } from "../GenericProcess.js";

/**
 * Base class for apps that display a scrolling text log.
 *
 * Subclasses get `this.log`, `this.logEl`, `_appendLog()`, and `_renderLog()`
 * for free. Override `_LOG_MAX_LINES` or `_LOG_BUFFER` to tune the limits.
 *
 * If `logEl` is an HTMLTextAreaElement its `.value` is updated; otherwise
 * `.textContent` is used — so both `<textarea>` and `<div>`/`<pre>` work.
 */
export class LoggedProcess extends GenericProcess {
  /** @type {string[]} */
  log = [];

  /** @type {HTMLElement|HTMLTextAreaElement|null} */
  logEl = null;

  /** Maximum lines kept in the visible render window. */
  _LOG_MAX_LINES = 250;

  /** Maximum lines kept in the backing `log` array before trimming. */
  _LOG_BUFFER = 4000;

  /** @param {string} line */
  _appendLog(line) {
    this.log.push(line);
    if (this.log.length > this._LOG_BUFFER) {
      this.log.splice(0, this.log.length - this._LOG_BUFFER);
    }
    if (this.mounted) this._renderLog();
  }

  _renderLog() {
    if (!this.logEl) return;
    const lines = this.log.length > this._LOG_MAX_LINES
      ? this.log.slice(-this._LOG_MAX_LINES)
      : this.log;
    const text = lines.join("\n");
    if (this.logEl instanceof HTMLTextAreaElement) {
      this.logEl.value = text;
    } else {
      this.logEl.textContent = text;
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
