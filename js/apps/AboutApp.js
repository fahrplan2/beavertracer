//@ts-check
import { GenericProcess } from "./GenericProcess.js";

export class AboutApp extends GenericProcess {
    /** @type {number|null} */
    timer = null;

    run() {
        this.title = "About";
        this.root.classList.add("app-about");
    }

    /**
     * 
     * @param {HTMLElement} root 
     */
    onMount(root) {
        super.onMount(root);
        this._tick();
    }

    _tick() {
        this.root.replaceChildren();

        const h = document.createElement("h3");
        h.textContent = "Systeminfo";

        const pre = document.createElement("pre");
        pre.textContent =
            `OS: ${this.os.name}\n` +
            `PID: ${this.pid}\n` +
            `Running apps: ${this.os.runningApps.length}\n` +
            `FocusID: ${this.os.focusID}\n` +
            `Time: ${new Date().toLocaleTimeString()}`;

        this.root.append(h, pre);

        this.timer = window.setTimeout(() => this._tick(), 500);
    }

    onUnmount() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        super.onUnmount();
    }
}