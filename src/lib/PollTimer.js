//@ts-check

/** Wraps setInterval/clearInterval with a null-safe start/stop API. */
export class PollTimer {
  /** @type {number|null} */
  #id = null;

  /**
   * @param {() => void} callback
   * @param {number} ms
   */
  start(callback, ms) {
    this.stop();
    this.#id = window.setInterval(callback, ms);
  }

  stop() {
    if (this.#id != null) {
      clearInterval(this.#id);
      this.#id = null;
    }
  }

  get running() { return this.#id != null; }
}
