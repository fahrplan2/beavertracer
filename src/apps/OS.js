//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { IPStack } from "../net/IPStack.js";
import { AboutApp } from "./AboutApp.js";
import { IPv4ConfigApp } from "./IPv4ConfigApp.js";
import { UDPEchoServerApp } from "./UDPEchoServerApp.js";
import { TerminalApp } from "./TerminalApp.js";
import { VirtualFileSystem } from "./lib/VirtualFileSystem.js";
import { TextEditorApp } from "./TextEditorApp.js";
import { t } from "../i18n/index.js";
import { SimpleTCPServerApp } from "./SimpleTCPServerApp.js";
import { SimpleTCPClientApp } from "./SimpleTCPClientApp.js";
import { SparktailHTTPClientApp } from "./SparktailHTTPClientApp.js";
import { SimpleHTTPServerApp } from "./SimpleHTTPServerApp.js";
import { DNSServerApp } from "./DNSServerApp.js";
import { DNSResolver } from "./lib/DNSResolver.js";
import { DHCPServerApp } from "./DHCPServerApp.js";

export class OS {

    /**
     * @type {string} name for the OS. Will act as hostname if dns is not present
     */
    name;

    /**
     * @type {IPStack} a instance of the OS-IP Stack 
     */
    net;

    /**
     * @type {VirtualFileSystem} the filesystem of this system
     */
    fs;

    /** 
     * @type {HTMLElement} Element where everything gets renderd into
     */
    root = document.createElement("div");

    /**
     * @type {DNSResolver} our dns resolver
     */
    dns = new DNSResolver(this,null);

    /** 
     * @type {Array<GenericProcess>} list of all running apps
     */
    runningApps = [];

    /**
     * @type {number} current foreground app
     */
    focusID = 0;
    mountedPid = 0;

    /** @type {Array<MenuItem>} */
    _menuItems = [];

    /** @type {HTMLElement|null} */
    host = null;

    /** @type {String} title of the current app */
    title;

    /**
     * @param {string} name name of the os to use, acts as hostname until DNS is loaded.
     * @param {VirtualFileSystem} fs
     * @param {IPStack} net
     */
    constructor(name = "OS", fs, net) {
        this.name = name;
        this.net = net;
        this.fs = fs;
        this.root.classList.add("os-root");
        this._registerApps();
        this.title = "";
        this.render();
    }

    /**
     * helper function to init the OS. Will register and start the apps
     */
    _registerApps() {
        const launchlist = 
            [IPv4ConfigApp, TerminalApp, TextEditorApp, SimpleTCPClientApp, SimpleTCPServerApp, 
            SimpleHTTPServerApp, SparktailHTTPClientApp, UDPEchoServerApp, DNSServerApp, DHCPServerApp, AboutApp];

        launchlist.forEach((e) => this.exec(e));
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
        this.updateMenu();
        this.render();
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
        this.render();
    }

    /**
     * unfocuses an application
     */
    unfocus() {
        this.focusID = 0;
        this.render();
    }

    /**
     * focuses an application
     * @param {number} pid 
     */
    focus(pid) {
        this.focusID = pid;
        this.render();
    }

    /**
     * returns the active App
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

    /**
     * renders the screen
     * @returns {HTMLElement} Element where everything gets renderd into
     */
    render() {
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

        return this.root;
    }


    /**
     * renders the main menu
     * @returns {HTMLElement} Element where everything gets renderd into
     */

    _renderMenu() {
        const el = document.createElement("div");
        el.classList.add("menu");

        for (const item of this._menuItems) {
            const btn = document.createElement("button");
            btn.textContent = item.title;
            btn.setAttribute("data-icon", item.dataIcon);
            btn.onclick = () => this.focus(item.pid);
            el.appendChild(btn);
        }

        return el;
    }

    /**
     * wraps a frame and a back button around the app
     * @param {HTMLElement} appRoot Element containing the App Root
     * @returns {HTMLElement} Element with frame decorations
     */

    _wrapWithFrame(appRoot) {
        const frame = document.createElement("div");
        frame.classList.add("os-frame");

        const bar = document.createElement("div");
        bar.classList.add("os-frame-bar");


        const back = document.createElement("button");
        back.classList.add("os-button-back");
        back.textContent = t("os.back");
        back.onclick = () => this.unfocus();
        bar.appendChild(back);

        const title = document.createElement("div");
        title.classList.add("os-frame-title");
        title.textContent = (this._getFocusedApp()?.title ?? t("os.untitled"));
        bar.appendChild(title);

        frame.appendChild(bar);
        frame.appendChild(appRoot);

        return frame;
    }

    /**
     * adds an application to the main menu
     * @param {string} title Title to show in the Menu
     * @param {number} pid PID of the process 
     * @param {string} icon which icon to usw
     */

    _registerMenuItem(title, pid, icon) {
        this._menuItems.push(new MenuItem({ title, pid, dataIcon: icon }));
        if (this.focusID === 0) this.render();
    }

    updateMenu() {
        this._menuItems = [];
        this.runningApps.forEach( (app) => {
            this._registerMenuItem(app.title, app.pid, app.icon);
        })
    }

    _getFocusedApp() {
        return this.runningApps.find(a => a.pid === this.focusID) ?? null;
    }
}

/**
 * Helper class to represent a menu item
 */
class MenuItem {

    /**@type {string} Title of the entry */
    title;
    /**@type {number} associated pid */
    pid = 0;

    /**@type {string} icon of the menu item*/
    dataIcon;

    /**
     * 
     * @param {Object} [opts] 
     * @param {string} [opts.title] title of the entry
     * @param {new (...args: any[]) => any} [opts.ClassName]
     * @param {number} [opts.pid] pid
     * @param {string} [opts.dataIcon] icon
     */

    constructor(opts = {}) {
        this.title = (opts.title ?? t("os.notitle"));
        this.pid = (opts.pid ?? 0);
        this.dataIcon = (opts.dataIcon ?? 'default')
    }
}
