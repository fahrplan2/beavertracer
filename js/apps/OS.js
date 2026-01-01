//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { IPForwarder } from "../devices/IPForwarder.js";
import { HelloWorldApp } from "./HalloWeltApp.js";
import { AboutApp } from "./AboutApp.js";
import { IPv4ConfigApp } from "./IPv4ConfigApp.js";
import { UDPEchoApp } from "./UDPEchoApp.js";

export class OS {
    name;
    ipforwarder;

    /** @type {HTMLElement} */
    root = document.createElement("div");

    /** @type {Array<GenericProcess>} */
    runningApps = [];
    focusID = 0;

    mountedPid = 0;

    /** @type {Array<MenuItem>} */
    _menuItems = [];

    /** @type {HTMLElement|null} */
    host = null;

    /**
     * 
     * @param {string} name 
     */
    constructor(name = "LOS") {
        this.name = name;
        this.ipforwarder = new IPForwarder(1, name);
        this.root.classList.add("os-root");
        this._init();
        this._requestRender();
    }

    _init() {
        this.registerMenuItem("Hallo Welt",this.exec(HelloWorldApp));
        this.registerMenuItem("About",this.exec(AboutApp));
        this.registerMenuItem("IPv4Config",this.exec(IPv4ConfigApp));
        this.registerMenuItem("UDPEchoApp",this.exec(UDPEchoApp));
    }


    /**
     * creats a new application and launches it
     * @param {new (...args: any[]) => any} ClassName
     * @param {...any} params
     */
    exec(ClassName, ...params) {
        const app = new ClassName(this, ...params);
        this.runningApps.push(app);
        app.run();
        this._requestRender();
        return app.pid;
    }

    /**
     * terminates an application
     * @param {Number} pid 
     */
    exit(pid) {
        const app = this.runningApps.find(a => a.pid == pid);
        if (!app) {
            return;
        }

        if (this.mountedPid == pid) {
            app.onUnmount();
            this.mountedPid = 0;
        }

        if (this.focusID == pid) {
            this.focusID = 0;
        }

        this.runningApps = this.runningApps.filter(a => a.pid != pid);
        app.destroy();
        this._requestRender();
    }

    /**
     * unfocuses an application
     */
    unfocus() {
        this.focusID = 0;
        this._requestRender();
    }

    /**
     * focuses an application
     * @param {number} pid 
     */
    focus(pid) {
        this.focusID = pid;
        this._requestRender();
    }

    /**
     * @returns {{ ui: HTMLElement, appRoot: HTMLElement|null, pid: number }}
     */
    _getActiveView() {
        if (this.focusID === 0) {
            return { ui: this._renderMenu(), appRoot: null, pid: 0 };
        }

        const app = this._getFocusedApp();
        if (!app) {
            this.focusID = 0;
            return { ui: this._renderMenu(), appRoot: null, pid: 0 };
        }

        const appRoot = app.render();
        const ui = this._wrapWithFrame(appRoot);
        return { ui, appRoot, pid: app.pid };
    }

    /**
     * we are now in foreground
     * @param {HTMLElement|null} host 
     */

    mount(host) {
        this.host = host;
        if (host) {
            host.replaceChildren(this.root);
        }
    }

    _requestRender() {
        const nextPid = this.focusID;

        if (this.mountedPid !== 0 && this.mountedPid !== nextPid) {
            const prevApp = this.runningApps.find(a => a.pid === this.mountedPid);
            prevApp?.onUnmount();
        }

        const view = this._getActiveView();
        this.root.replaceChildren(view.ui);

        if (view.pid !== 0) {
            const app = this._getFocusedApp();
            if (app && view.appRoot) {
                app.onMount(view.appRoot);   // ✅ App bekommt ihr eigenes Root
            }
        }

        this.mountedPid = nextPid;
    }
    /**
     * 
     * @returns {HTMLElement}
     */
    render() {
        return this.root;
    }

    /**
     * renders the menu
     * @returns {HTMLElement}
     */

    _renderMenu() {
        const el = document.createElement("div");
        el.classList.add("menu");

        const title = document.createElement("h3");
        title.textContent = this.name;
        el.appendChild(title);

        for (const item of this._menuItems) {
            const btn = document.createElement("button");
            btn.textContent = item.title;
            btn.onclick = () => this.focus(item.pid);
            el.appendChild(btn);
        }

        return el;
    }

    /**
     * 
     * @param {HTMLElement} appRoot 
     * @returns 
     */

    _wrapWithFrame(appRoot) {
        const frame = document.createElement("div");

        const bar = document.createElement("div");
        const back = document.createElement("button");
        back.textContent = "← Menü";
        back.onclick = () => this.unfocus();
        bar.appendChild(back);

        frame.appendChild(bar);
        frame.appendChild(appRoot);

        return frame;
    }

    /**
     * 
     * @param {string} title 
     * @param {number} pid 
     */

    registerMenuItem(title, pid) {
        this._menuItems.push(new MenuItem({ title, pid }));
        if (this.focusID === 0) this._requestRender();
    }

    _getFocusedApp() {
        return this.runningApps.find(a => a.pid === this.focusID) ?? null;
    }
}

class MenuItem {

    /**@type {string} */
    title;
    /**@type {number} */
    pid = 0;

    /**
     * 
     * @param {Object} [opts] 
     * @param {string} [opts.title]
     * @param {new (...args: any[]) => any} [opts.ClassName]
     * @param {number} [opts.pid]
     */

    constructor(opts = {}) {
        this.title = (opts.title ?? 'No Title');
        this.pid = (opts.pid ?? 0);
    }
}
