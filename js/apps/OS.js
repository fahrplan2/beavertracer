//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { IPForwarder } from "../devices/IPForwarder.js";
import { AboutApp } from "./AboutApp.js";
import { IPv4ConfigApp } from "./IPv4ConfigApp.js";
import { UDPEchoApp } from "./UDPEchoApp.js";
import { TerminalApp } from "./TerminalApp.js";
import { VirtualFileSystem } from "./lib/VirtualFileSystem.js";
import { TextEditorApp } from "./TextEditorApp.js";
import { t } from "../i18n/index.js";
import { SimpleTCPServerApp } from "./SimpleTCPServerApp.js";
import { SimpleTCPClientApp } from "./SimpleTCPClientApp.js";
import { SparktailHTTPClientApp } from "./SparktailHTTPClientApp.js";
import { SimpleHTTPServerApp } from "./SimpleHTTPServerApp.js";
import { PcapDownloaderApp } from "./PCAPDownloaderApp.js";

export class OS {

    name;
    ipforwarder;
    fs = new VirtualFileSystem();

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

    /** @type {String} title of the current app */
    title;

    /**
     * 
     * @param {string} name 
     */
    constructor(name = "OS") {
        this.name = name;
        this.ipforwarder = new IPForwarder(1, name);
        this.root.classList.add("os-root");
        this._init();
        this._requestRender();
        this.title = "";
    }

    _init() {
        this.registerMenuItem(t("apps.name.terminal"), this.exec(TerminalApp),'terminal');
        this.registerMenuItem(t("apps.name.texteditor"), this.exec(TextEditorApp), 'texteditor');
        this.registerMenuItem(t("apps.name.ipv4config"), this.exec(IPv4ConfigApp), 'settings');
        this.registerMenuItem(t("apps.name.simpletcpserver"), this.exec(SimpleTCPServerApp), 'settings');
        this.registerMenuItem(t("apps.name.simpletcpclient"), this.exec(SimpleTCPClientApp), 'settings');
        this.registerMenuItem(t("apps.name.browser"), this.exec(SparktailHTTPClientApp), 'browser');
        this.registerMenuItem(t("apps.name.httpserver"), this.exec(SimpleHTTPServerApp),'settings');
        this.registerMenuItem(t("apps.name.udpecho"), this.exec(UDPEchoApp), 'settings');
        this.registerMenuItem(t("apps.name.pcapdownloader"), this.exec(PcapDownloaderApp), 'settings');
        this.registerMenuItem(t("apps.name.about"), this.exec(AboutApp), 'about');
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
                app.onMount(view.appRoot);
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

        for (const item of this._menuItems) {
            const btn = document.createElement("button");
            btn.textContent = item.title;
            btn.setAttribute("data-icon",item.dataIcon);
            btn.onclick = () => this.focus(item.pid);
            el.appendChild(btn);
        }

        return el;
    }

    /**
     * wraps a frame and a back button around the app
     * @param {HTMLElement} appRoot 
     * @returns 
     */

    _wrapWithFrame(appRoot) {
        const frame = document.createElement("div");
        frame.classList.add("os-frame");

        const bar = document.createElement("div");
        bar.classList.add("os-frame-bar");


        const back = document.createElement("button");
        back.classList.add("os-button-back");
        back.textContent = "← Menü";
        back.onclick = () => this.unfocus();
        bar.appendChild(back);

        const title = document.createElement("div");
        title.classList.add("os-frame-title");
        title.textContent = (this._getFocusedApp()?.title ?? "Untitled");
        bar.appendChild(title);


        frame.appendChild(bar);
        frame.appendChild(appRoot);

        return frame;
    }

    /**
     * 
     * @param {string} title 
     * @param {number} pid 
     * @param {string} icon
     */

    registerMenuItem(title, pid, icon) {
        this._menuItems.push(new MenuItem({ title, pid, dataIcon:icon }));
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

    /**@type {string} */
    dataIcon;

    /**
     * 
     * @param {Object} [opts] 
     * @param {string} [opts.title]
     * @param {new (...args: any[]) => any} [opts.ClassName]
     * @param {number} [opts.pid]
     * @param {string} [opts.dataIcon]
     */

    constructor(opts = {}) {
        this.title = (opts.title ?? 'No Title');
        this.pid = (opts.pid ?? 0);
        this.dataIcon = (opts.dataIcon ?? 'default')
    }
}
