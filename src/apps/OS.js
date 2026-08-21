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
import { TlsCertificate, TlsTrustStore } from "../net/models/TlsCertificate.js";
import { CertManagerApp } from "./CertManagerApp.js";
import { DNSServerApp } from "./DNSServerApp.js";
import { DNSResolver } from "./lib/DNSResolver.js";
import { NTPServerApp } from "./NTPServerApp.js";
import { SystemClock } from "./lib/SystemClock.js";
import { DHCPServerApp } from "./DHCPServerApp.js";
import { DHCPv6ServerApp } from "./DHCPv6ServerApp.js";
import { SimulatedObject } from "../sim/SimulatedObject.js";
import { SimpleMailServerApp } from "./SimpleMailServerApp.js";
import { MailClientApp } from "./MailClientApp.js";
import { SimpleIRCServerApp } from "./SimpleIRCServerApp.js";
import { SimpleIRCClientApp } from "./SimpleIRCClientApp.js";
import { MulticastChatApp } from "./MulticastChatApp.js";
import { BitcoinNodeApp } from "./BitcoinNodeApp.js";
import { UILib } from "../lib/UILib.js";
import { ExplorerApp } from "./ExplorerApp.js";

/** @typedef {{ id: string, Class: new (...args: any[]) => any, mandatory: boolean, category: string, icon: string, labelKey: string }} AppRegistryEntry */

/** @type {AppRegistryEntry[]} */
const APP_REGISTRY = [
    { id: "IPv4ConfigApp",          Class: IPv4ConfigApp,          mandatory: true,  category: "system", icon: "fa-gear",          labelKey: "app.ipv4config.title" },
    { id: "TerminalApp",            Class: TerminalApp,            mandatory: true,  category: "system", icon: "fa-terminal",      labelKey: "app.terminal.title" },
    { id: "ExplorerApp",            Class: ExplorerApp,            mandatory: true,  category: "system", icon: "fa-folder-open",   labelKey: "app.explorer.title" },
    { id: "TextEditorApp",          Class: TextEditorApp,          mandatory: true,  category: "system", icon: "fa-file-pen",      labelKey: "app.texteditor.title" },
    { id: "CertManagerApp",         Class: CertManagerApp,         mandatory: false,  category: "system", icon: "fa-shield-halved", labelKey: "app.certmanager.title" },
    { id: "SparktailHTTPClientApp", Class: SparktailHTTPClientApp, mandatory: false, category: "client", icon: "fa-globe",         labelKey: "app.sparktail.title" },
    { id: "MailClientApp",          Class: MailClientApp,          mandatory: false, category: "client", icon: "fa-envelope-open", labelKey: "app.mailclient.title" },
    { id: "SimpleIRCClientApp",     Class: SimpleIRCClientApp,     mandatory: false, category: "client", icon: "fa-comments",          labelKey: "app.ircclient.title" },
    { id: "MulticastChatApp",       Class: MulticastChatApp,       mandatory: false, category: "client", icon: "fa-tower-broadcast",    labelKey: "app.multicastchat.title" },
    { id: "SimpleTCPClientApp",     Class: SimpleTCPClientApp,     mandatory: false, category: "client", icon: "fa-message",       labelKey: "app.simpletcpclient.title" },
    { id: "SimpleTCPServerApp",     Class: SimpleTCPServerApp,     mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.simpletcpserver.title" },
    { id: "SimpleHTTPServerApp",    Class: SimpleHTTPServerApp,    mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.simplehttpserver.title" },
    { id: "UDPEchoServerApp",       Class: UDPEchoServerApp,       mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.udpechoserver.title" },
    { id: "DNSServerApp",           Class: DNSServerApp,           mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.dnsd.title" },
    { id: "NTPServerApp",           Class: NTPServerApp,           mandatory: false, category: "server", icon: "fa-clock",         labelKey: "app.ntpserver.title" },
    { id: "DHCPServerApp",          Class: DHCPServerApp,          mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.dhcpserver.title" },
    { id: "DHCPv6ServerApp",        Class: DHCPv6ServerApp,        mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.dhcpv6server.title" },
    { id: "SimpleMailServerApp",    Class: SimpleMailServerApp,    mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.simplemailserver.title" },
    { id: "SimpleIRCServerApp",     Class: SimpleIRCServerApp,     mandatory: false, category: "server", icon: "fa-server",        labelKey: "app.ircserver.title" },
    { id: "BitcoinNodeApp",         Class: BitcoinNodeApp,         mandatory: false, category: "server", icon: "fa-coins",         labelKey: "app.bitcoin.title" },
];

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

    /**
     * @type {SystemClock} this host's virtual clock (independent of the real
     * browser clock — see SystemClock.js for why)
     */
    clock = new SystemClock();

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

    /** @type {Set<string>} installed app IDs; empty = all apps (default/legacy) */
    _installedApps = new Set();

    /** @type {boolean} */
    _appEditMode = false;

    /** @type {boolean} */
    _showLibrary = false;

    /** @type {HTMLElement|null} */
    host = null;

    /** @type {String} title of the current app */
    title;

    /**
     * @param {SimulatedObject} obj
     * @param {VirtualFileSystem} fs
     * @param {IPStack} net
     * @param {{ mandatoryOnly?: boolean }} [opts]
     */
    constructor(obj, fs, net, { mandatoryOnly = false } = {}) {
        this.obj = obj;
        this.name = obj.name;
        this.net = net;
        this.fs = fs;
        this.root.classList.add("os-root");
        if (mandatoryOnly) {
            this._installedApps = new Set(APP_REGISTRY.filter(e => e.mandatory).map(e => e.id));
        }
        this._registerApps();
        this._loadCertStore();
        this.title = "";
        this.render();
    }

    /**
     * helper function to init the OS. Will register and start the apps
     */
    _registerApps() {
        const list = this._installedApps.size === 0
            ? APP_REGISTRY
            : APP_REGISTRY.filter(e => e.mandatory || this._installedApps.has(e.id));
        list.forEach(e => this.exec(e.Class));
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
        const entry = APP_REGISTRY.find(e => e.Class === ClassName);
        app._appId = entry?.id ?? null;
        app._mandatory = entry?.mandatory ?? false;
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
        this._menuItems = this._menuItems.filter(item => item.pid !== pid);
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

        if (this._showLibrary && this.focusID === 0) {
            this.root.appendChild(this._renderLibraryOverlay());
        }

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
     * @returns {HTMLElement}
     */
    _renderMenu() {
        const wrapper = document.createElement("div");
        wrapper.classList.add("os-menu-wrapper");

        const gridContainer = document.createElement("div");
        gridContainer.className = "menu-grid-container";
        wrapper.appendChild(gridContainer);

        const grid = document.createElement("div");
        grid.classList.add("menu");
        gridContainer.appendChild(grid);

        for (const item of this._menuItems) {
            const app = this.runningApps.find(a => a.pid === item.pid);
            const isMandatory = app?._mandatory ?? false;

            const btn = UILib.iconbutton({
                label: item.title,
                icon: item.icon,
                badge: item.badge,
                onClick: () => this.focus(item.pid),
            });

            if (this._appEditMode) {
                btn.classList.add("menu-tile-in-edit");
                if (isMandatory) btn.classList.add("menu-tile-locked");
            }

            grid.appendChild(btn);
        }

        if (this._appEditMode) {
            const addTile = UILib.iconbutton({
                label: t("os.apps.library.addlabel"),
                icon: "fa-plus",
                className: "menu-add-tile",
                onClick: () => { this._showLibrary = true; this.render(); },
            });
            grid.appendChild(addTile);

            // Second grid laid over the first — ⊗ remove buttons live here
            // so the tile buttons below are never touched and their ::before layout is intact.
            const overlay = document.createElement("div");
            overlay.className = "menu menu-edit-overlay";
            overlay.setAttribute("aria-hidden", "true");
            gridContainer.appendChild(overlay);

            for (const item of this._menuItems) {
                const app = this.runningApps.find(a => a.pid === item.pid);
                const isMandatory = app?._mandatory ?? false;

                const cell = document.createElement("div");
                cell.className = "menu-edit-cell";

                if (!isMandatory) {
                    const removeBtn = document.createElement("button");
                    removeBtn.className = "menu-remove-btn";
                    removeBtn.setAttribute("aria-label", t("os.apps.remove"));
                    removeBtn.onclick = () => this._uninstallApp(item.pid);
                    cell.appendChild(removeBtn);
                }

                overlay.appendChild(cell);
            }

            // empty cell to cover the [+] add tile position
            const addCell = document.createElement("div");
            addCell.className = "menu-edit-cell";
            overlay.appendChild(addCell);
        }

        const footer = document.createElement("div");
        footer.className = "os-menu-footer";

        if (this._appEditMode) {
            const doneBtn = document.createElement("button");
            doneBtn.className = "menu-manage-btn";
            doneBtn.textContent = t("os.apps.done");
            doneBtn.onclick = () => { this._appEditMode = false; this._showLibrary = false; this.render(); };
            footer.appendChild(doneBtn);
        } else {
            const manageBtn = document.createElement("button");
            manageBtn.className = "menu-manage-btn";
            manageBtn.textContent = t("os.apps.manage");
            manageBtn.onclick = () => { this._appEditMode = true; this.render(); };
            footer.appendChild(manageBtn);
        }

        wrapper.appendChild(footer);

        return wrapper;
    }

    /** @returns {HTMLElement} */
    _renderLibraryOverlay() {
        const installedIds = new Set(this.runningApps.map(a => a._appId).filter(Boolean));

        const overlay = document.createElement("div");
        overlay.className = "app-library-overlay";
        overlay.onclick = (e) => {
            if (e.target === overlay) { this._showLibrary = false; this.render(); }
        };

        const panel = document.createElement("div");
        panel.className = "app-library";

        const header = document.createElement("div");
        header.className = "app-library-header";
        const titleEl = document.createElement("span");
        titleEl.textContent = t("os.apps.library.title");
        const closeBtn = document.createElement("button");
        closeBtn.className = "app-library-close";
        closeBtn.textContent = "✕";
        closeBtn.onclick = () => { this._showLibrary = false; this.render(); };
        header.appendChild(titleEl);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        const categories = [
            { key: "system", label: t("os.apps.category.system") },
            { key: "client", label: t("os.apps.category.client") },
            { key: "server", label: t("os.apps.category.server") },
        ];

        let hasAny = false;
        for (const cat of categories) {
            const apps = APP_REGISTRY.filter(
                e => e.category === cat.key && !e.mandatory && !installedIds.has(e.id)
            );
            if (apps.length === 0) continue;
            hasAny = true;

            const section = document.createElement("div");
            section.className = "app-library-section";

            const heading = document.createElement("div");
            heading.className = "app-library-heading";
            heading.textContent = cat.label;
            section.appendChild(heading);

            const libGrid = document.createElement("div");
            libGrid.className = "app-library-list";

            for (const entry of apps) {
                const row = document.createElement("div");
                row.className = "app-library-row";

                const tile = document.createElement("button");
                tile.className = "app-library-tile";
                tile.onclick = () => this._installApp(entry.id);
                const iconEl = document.createElement("i");
                iconEl.classList.add("fas", entry.icon);
                tile.appendChild(iconEl);
                row.appendChild(tile);

                const nameEl = document.createElement("div");
                nameEl.className = "app-library-name";
                nameEl.textContent = t(entry.labelKey);
                row.appendChild(nameEl);

                const addBtn = document.createElement("button");
                addBtn.className = "app-library-add-btn";
                addBtn.textContent = t("os.apps.library.install");
                addBtn.onclick = () => this._installApp(entry.id);
                row.appendChild(addBtn);

                libGrid.appendChild(row);
            }

            section.appendChild(libGrid);
            panel.appendChild(section);
        }

        if (!hasAny) {
            const empty = document.createElement("div");
            empty.className = "app-library-empty";
            empty.textContent = t("os.apps.library.empty");
            panel.appendChild(empty);
        }

        overlay.appendChild(panel);
        return overlay;
    }

    /** @param {number} pid */
    _uninstallApp(pid) {
        const app = this.runningApps.find(a => a.pid === pid);
        if (!app || app._mandatory) return;
        if (this._installedApps.size === 0) {
            for (const a of this.runningApps) {
                if (a._appId) this._installedApps.add(a._appId);
            }
        }
        if (app._appId) this._installedApps.delete(app._appId);
        this.exit(pid);
    }

    /** @param {string} appId */
    _installApp(appId) {
        const entry = APP_REGISTRY.find(e => e.id === appId);
        if (!entry) return;
        if (this._installedApps.size === 0) {
            for (const a of this.runningApps) {
                if (a._appId) this._installedApps.add(a._appId);
            }
        }
        this._installedApps.add(appId);
        this.exec(entry.Class);
    }

    /** Install every non-mandatory app — used by fromJSON for old files (no installedApps key). */
    _installAllApps() {
        for (const entry of APP_REGISTRY) {
            if (!entry.mandatory && !this.runningApps.some(a => a._appId === entry.id)) {
                this.exec(entry.Class);
            }
        }
        this._installedApps = new Set(); // empty = "all apps" for serialisation compat
    }

    /** @param {string[]} ids */
    _applyInstalledApps(ids) {
        this._installedApps = new Set(ids);
        [...this.runningApps].forEach(app => {
            if (!app._mandatory && app._appId && !this._installedApps.has(app._appId)) {
                this.exit(app.pid);
            }
        });
        for (const id of ids) {
            if (!this.runningApps.some(a => a._appId === id)) {
                const entry = APP_REGISTRY.find(e => e.id === id);
                if (entry && !entry.mandatory) this.exec(entry.Class);
            }
        }
    }

    /** @returns {string[]} */
    getInstalledAppIds() {
        return this._installedApps.size === 0 ? [] : [...this._installedApps];
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

        const content = document.createElement("div");
        content.classList.add("os-frame-content");
        content.appendChild(appRoot);

        frame.appendChild(bar);
        frame.appendChild(content);

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
