//@ts-check
import { GenericProcess } from "./GenericProcess.js";

export class HelloWorldApp extends GenericProcess {
    /** @type {number|null} */
    timer = null;

    run() {
        this.root.textContent = "Hallo Welt";
    }

    /**
     * 
     * @param {HTMLElement} root 
     */

    onMount(root) {
        super.onMount(root);
        this.tick();
    }

    tick() {
        this.root.textContent =
            `Hallo Welt – PID ${this.pid} – ${Date.now()}`;
        this.timer = window.setTimeout(() => this.tick(), 1000);
    }

    onUnmount() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        super.onUnmount();
    }
}
