//@ts-check

import { GenericProcess } from "./GenericProcess.js";
import { IPStack } from "../net/IPStack.js";
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
import { SimpleHTTPSServerApp } from "./SimpleHTTPSServerApp.js";
import { TlsCertificate, TlsTrustStore } from "../net/models/TlsCertificate.js";
import { CertManagerApp } from "./CertManagerApp.js";
import { DNSServerApp } from "./DNSServerApp.js";
import { DNSResolver } from "./lib/DNSResolver.js";
import { DHCPServerApp } from "./DHCPServerApp.js";
import { DHCPv6ServerApp } from "./DHCPv6ServerApp.js";
import { SimulatedObject } from "../sim/SimulatedObject.js";
import { SimpleMailServerApp } from "./SimpleMailServerApp.js";
import { MailClientApp } from "./MailClientApp.js";
import { SimpleIRCServerApp } from "./SimpleIRCServerApp.js";
import { SimpleIRCClientApp } from "./SimpleIRCClientApp.js";
import { DOMBuilder } from "../lib/DomBuilder.js";

export class OS {

    /**
     * @type {SimulatedObject} Reference to the simulated object
     */
    obj;

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

    /** @type {{ certStore: TlsTrustStore }} */
    tls = { certStore: new TlsTrustStore() };

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
     * @param {SimulatedObject} obj
     * @param {VirtualFileSystem} fs
     * @param {IPStack} net
     */
    constructor(obj, fs, net) {
        this.obj = obj;
        this.name = obj.name;
        this.net = net;
        this.fs = fs;
        this.root.classList.add("os-root");
        this._registerApps();
        this._loadCertStore();
        this.title = "";
        this.render();
    }

    /**
     * helper function to init the OS. Will register and start the apps
     */
    _registerApps() {
        const launchlist =
            [IPv4ConfigApp, TerminalApp, TextEditorApp, SparktailHTTPClientApp, MailClientApp, SimpleIRCClientApp, SimpleTCPClientApp, SimpleTCPServerApp,
            SimpleHTTPServerApp, SimpleHTTPSServerApp, UDPEchoServerApp, DNSServerApp, DHCPServerApp, DHCPv6ServerApp, SimpleMailServerApp,
            SimpleIRCServerApp, CertManagerApp];

        launchlist.forEach((e) => this.exec(e));
    }

    /** Populate tls.certStore from /etc/certs/trusted/*.json */
    async _loadCertStore() {
        this.tls.certStore = new TlsTrustStore();
        try { this.fs.mkdir("/etc/certs",         { recursive: true }); } catch { /* exists */ }
        try { this.fs.mkdir("/etc/certs/trusted", { recursive: true }); } catch { /* exists */ }
        let entries = [];
        try { entries = this.fs.readdir("/etc/certs/trusted"); } catch { return; }
        await Promise.all(entries.filter(n => n.endsWith(".json")).map(async name => {
            try {
                const raw = this.fs.readFile("/etc/certs/trusted/" + name);
                const cert = await TlsCertificate.fromJSON(JSON.parse(raw));
                this.tls.certStore.add(cert);
            } catch { /* skip invalid */ }
        }));
    }

    /** Reload trust store from VFS (call after adding/removing trusted certs). */
    reloadCertStore() {
        this._loadCertStore(); // fire-and-forget; trust store certs have no JWK so resolves instantly
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
            this.render();
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
            const btn = DOMBuilder.iconbutton({
                label: item.title,
                icon: item.icon,
                badge: item.badge,
                onClick: () => {
                    this.focus(item.pid);
                },
            });
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
     * @param {string} icon which icon to use
     * @param {string} [badge] short badge label over the icon
     */

    _registerMenuItem(title, pid, icon, badge = "") {
        this._menuItems.push(new MenuItem({ title, pid, icon, badge }));
        if (this.focusID === 0) this.render();
    }

    refocus() {
        const app = this._getFocusedApp();
        if (app?.focusTarget) {
            setTimeout(() => app.focusTarget?.focus(), 0);
        }
    }

    updateMenu() {
        this._menuItems = [];
        this.runningApps.forEach((app) => {
            this._registerMenuItem(app.title, app.pid, app.icon, app.badge ?? "");
        });
    }

    _getFocusedApp() {
        return this.runningApps.find(a => a.pid === this.focusID) ?? null;
    }

    /** @param {string} name */
    setName(name) {
        this.obj.setName(name);
        this.name=name;
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
    icon;

    /**@type {string} short badge label shown over the icon */
    badge;

    /**
     *
     * @param {Object} [opts]
     * @param {string} [opts.title] title of the entry
     * @param {new (...args: any[]) => any} [opts.ClassName]
     * @param {number} [opts.pid] pid
     * @param {string} [opts.icon] icon
     * @param {string} [opts.badge] badge
     */

    constructor(opts = {}) {
        this.title = (opts.title ?? t("os.notitle"));
        this.pid = (opts.pid ?? 0);
        this.icon = (opts.icon ?? 'fa-gear');
        this.badge = (opts.badge ?? '');
    }
}
