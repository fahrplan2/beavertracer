//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { UILib as UI } from "./lib/UILib.js";
import { DisposableBag } from "./lib/DisposeableBag.js";

export class HelloWorldApp extends GenericProcess {

    /** @type {DisposableBag} */
    bag = new DisposableBag();

    /** @type {HTMLElement|null} */
    msgEl = null;

    /** @type {number} */
    counter = 0;

    run() {
        this.title = "Hello World";
        this.root.classList.add("app", "app-hello");
    }

    /**
     * 
     * @param {HTMLElement} root 
     */

    onMount(root) {
        super.onMount(root);
        this.bag.dispose();

        const msg = UI.el("div", { className: "msg" });
        this.msgEl = msg;

        const refreshBtn = UI.button("Update", () => this._renderText(), { primary: true });
        const closeBtn = UI.button("Close", () => this.terminate());

        const panel = UI.panel("Hello World", [
            UI.el("div", { className: "text", text: "Hello World 👋" }),
            msg,
            UI.buttonRow([refreshBtn, closeBtn]),
        ]);

        this.root.replaceChildren(panel);

        this.bag.interval(() => {
            this.counter++;
            this._renderText();
        }, 1000);

        this._renderText();
    }

    onUnmount() {
        this.bag.dispose();
        this.msgEl = null;
        super.onUnmount();
    }

    _renderText() {
        if (!this.msgEl) return;

        this.msgEl.textContent =
            `OS: ${this.os.name}\n` +
            `PID: ${this.pid}\n` +
            `Counter: ${this.counter}\n` +
            `Time: ${new Date().toLocaleTimeString()}`;
    }
}