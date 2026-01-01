//@ts-check

export class DisposableBag {

  /**
   * This class helps to disable all timers and events, when the App looses foreground effect
   * 
   */

  constructor() {
    /** @type {Array<() => void>} */
    this._fns = [];
  }

  /** @param {() => void} fn */
  add(fn) {
    this._fns.push(fn);
    return fn;
  }

  dispose() {
    //reverse order
    for (let i = this._fns.length - 1; i >= 0; i--) {
      try { this._fns[i](); } catch (e) { console.warn(e); }
    }
    this._fns = [];
  }

  /**
   * Helper: addEventListener + auto-remove
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} handler
   * @param {boolean|AddEventListenerOptions} [options]
   */
  on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.add(() => target.removeEventListener(type, handler, options));
  }

  /**
   * Helper: setInterval + auto-clear
   * @param {() => void} fn
   * @param {number} ms
   */
  interval(fn, ms) {
    const id = window.setInterval(fn, ms);
    this.add(() => window.clearInterval(id));
    return id;
  }

  /**
   * Helper: setTimeout + auto-clear
   * @param {() => void} fn
   * @param {number} ms
   */
  timeout(fn, ms) {
    const id = window.setTimeout(fn, ms);
    this.add(() => window.clearTimeout(id));
    return id;
  }
}