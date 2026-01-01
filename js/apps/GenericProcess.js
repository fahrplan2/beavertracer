import { OS } from "../devices/OS.js";

export class GenericProcess {
  /** @type {string} */
  title = "";

  /** @type {number} */
  pid;

  /** @type {OS} */
  os;

  /** @type {HTMLElement} */
  root;

  /** @type {boolean} */
  mounted = false;

  static pidCounter = 1;

  /**
   * @param {OS} os
   */
  constructor(os) {
    this.pid = GenericProcess.pidCounter++;
    this.os = os;
    this.root = document.createElement("div");
    this.root.classList.add("process-root");
  }

  /**
   *
   */
  run() {

  }

  /**
   * @returns {HTMLElement}
   */
  render() {
    return this.root;
  }

  /**
   * Called by OS after root was mounted into DOM.
   * Bind events, start timers, subscriptions here.
   * @param {HTMLElement} root
   */
  onMount(root) {
    this.mounted = true;
    if (root !== this.root) {
      console.warn("Process mounted with unexpected root");
      this.root = root;
    }
  }

  /**
    * Called by OS before root is removed from DOM.
    * Clean up EVERYTHING started in onMount.
    */
  onUnmount() {
    this.mounted = false;
  }

  /**
   */
  destroy() {
    if (this.mounted) {
      this.onUnmount();
    }
  }

  /**
   */
  terminate() {
    this.os.exit(this.pid);
  }
}
