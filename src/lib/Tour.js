//@ts-check

import { SimDialog } from './SimDialog.js';
import { Computer } from '../sim/Computer.js';
import { Switch } from '../sim/Switch.js';
import { Link } from '../sim/Link.js';
import { IPv4ConfigApp } from '../apps/IPv4ConfigApp.js';
import { TerminalApp } from '../apps/TerminalApp.js';
import { t } from '../i18n/index.js';

function getTourSim() { return /** @type {any} */ ({
    '_info': 'Beaver Tracer Tour',
    'version': 5,
    'tick': 40,
    'objects': [
        {
            'kind': 'Computer',
            'id': 20,
            'name': `${t('computer.title')} 2`,
            'x': 460, 'y': 100,
            'px': 220, 'py': 120,
            'panelOpen': false,
            'net': {
                'name': t('computer.title'),
                'forwarding': false,
                'interfaces': [
                    { 'name': 'eth0', 'ip': '192.168.0.12', 'prefixLength': 24, 'ip6': null, 'prefixLength6': 0, 'ip6LL': 'fe80::c0a8:c' }
                ],
                'routes': [
                    { 'dst': '0.0.0.0', 'prefixLength': 0, 'interf': 0, 'nexthop': '192.168.0.1' }
                ]
            },
            'fs': {
                'type': 'dir', 'name': '', 'ctime': 1000000, 'mtime': 1000000,
                'children': [
                    { 'type': 'dir', 'name': 'etc',  'ctime': 1000000, 'mtime': 1000000, 'children': [] },
                    { 'type': 'dir', 'name': 'home', 'ctime': 1000000, 'mtime': 1000000, 'children': [] },
                    { 'type': 'dir', 'name': 'bin',  'ctime': 1000000, 'mtime': 1000000, 'children': [] },
                    { 'type': 'dir', 'name': 'var',  'ctime': 1000000, 'mtime': 1000000, 'children': [
                        { 'type': 'dir', 'name': 'www', 'ctime': 1000000, 'mtime': 1000000, 'children': [] }
                    ]}
                ]
            },
            'dns': null
        },
        {
            'kind': 'Switch',
            'id': 10,
            'name': 'Switch 1',
            'x': 280, 'y': 230,
            'px': 220, 'py': 120,
            'panelOpen': false,
            'vlanEnabled': false,
            'stpEnabled': false,
            'vlanPorts': Array.from({ length: 8 }, () => ({ 'vlanMode': 'untagged', 'pvid': 1, 'allowedVlans': [1] }))
        },
        {
            'kind': 'Link',
            'id': 30,
            'a': 20,
            'b': 10,
            'portA': 'eth0',
            'portB': 'sw0'
        }
    ]
}); }

/**
 * @typedef {{
 *   target: () => Element | null,
 *   title: string,
 *   text: string,
 *   action: string,
 *   modeRole?: string,
 *   toolSelector?: string,
 *   appSelector?: string,
 *   bodySelector?: string,
 *   clickSelector?: string,
 *   expectedIp?: string,
 *   minNodes?: number,
 *   minLinks?: number,
 *   fallback?: () => void
 * }} TourStep
 */

/**
 * Builds the step list with a closure over sim so targets can find dynamic objects.
 * @param {any} sim
 * @returns {TourStep[]}
 */
function buildSteps(sim) {
    /** @returns {any | undefined} */
    const pc1 = () => sim.simobjects.find((/** @type {any} */ o) => o instanceof Computer && o.id !== 20);

    return [
        // ── Step 0: Mode overview ──────────────────────────────────────────────
        {
            target: () => document.querySelector('[data-role="mode-edit"]')?.closest('.sim-toolbar-group') ?? null,
            title: t('tour.step.modes.title'),
            text: t('tour.step.modes.text'),
            action: 'observe-click',
            clickSelector: '[data-role="mode-edit"]',
        },

        // ── Step 1a: Select PC tool ────────────────────────────────────────────
        {
            target: () => document.querySelector('[data-role="tool-place-computer"]'),
            title: t('tour.step.add-computer-tool.title'),
            text: t('tour.step.add-computer-tool.text'),
            action: 'observe-tool-active',
            toolSelector: '[data-role="tool-place-computer"]',
            fallback: () => { /** @type {HTMLElement|null} */ (document.querySelector('[data-role="tool-place-computer"]'))?.click(); },
        },

        // ── Step 1b: Place PC on canvas ────────────────────────────────────────
        {
            target: () => document.querySelector('.sim-nodes'),
            title: t('tour.step.place-computer.title'),
            text: t('tour.step.place-computer.text'),
            action: 'observe-node',
            minNodes: 3,
            fallback: () => {
                const pc = new Computer(`${t('computer.title')} 1`);
                pc.x = 80; pc.y = 100;
                sim.addObject(pc);
            },
        },

        // ── Step 2a: Select link tool ──────────────────────────────────────────
        {
            target: () => document.querySelector('[data-role="tool-link"]'),
            title: t('tour.step.link-tool.title'),
            text: t('tour.step.link-tool.text'),
            action: 'observe-tool-active',
            toolSelector: '[data-role="tool-link"]',
            fallback: () => { /** @type {HTMLElement|null} */ (document.querySelector('[data-role="tool-link"]'))?.click(); },
        },

        // ── Step 2b: Click PC1 to start the link ──────────────────────────────
        {
            target: () => {
                const p = pc1();
                return p ? document.querySelector(`.sim-node[data-objid="${p.id}"]`) : null;
            },
            title: t('tour.step.link-start.title'),
            text: t('tour.step.link-start.text'),
            action: 'observe-ghost-link',
            fallback: () => {
                const p = pc1();
                if (!p) return;
                const port = sim._getPorts(p).find((/** @type {any} */ d) => sim._isPortFree(d.port));
                if (!port) return;
                sim._linkStart = p;
                sim._linkStartKey = port.key;
                sim._ensureGhostLink();
            },
        },

        // ── Step 2c: Click Switch ──────────────────────────────────────────────
        {
            target: () => {
                const sw = sim.simobjects.find((/** @type {any} */ o) => o instanceof Switch);
                return sw ? document.querySelector(`.sim-node[data-objid="${sw.id}"]`) : null;
            },
            title: t('tour.step.link-switch.title'),
            text: t('tour.step.link-switch.text'),
            action: 'observe-port-picker',
            fallback: () => {
                const sw = sim.simobjects.find((/** @type {any} */ o) => o instanceof Switch);
                if (!sw) return;
                const swEl = document.querySelector(`.sim-node[data-objid="${sw.id}"]`);
                if (!swEl) return;
                const rect = swEl.getBoundingClientRect();
                swEl.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true, cancelable: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2,
                    button: 0, buttons: 1, isPrimary: true,
                }));
            },
        },

        // ── Step 2d: Select free port ──────────────────────────────────────────
        {
            target: () => document.querySelector('.sim-port-picker'),
            title: t('tour.step.link-port.title'),
            text: t('tour.step.link-port.text'),
            action: 'observe-link',
            minLinks: 2,
            fallback: () => {
                document.querySelector('.sim-port-picker')?.remove();
                if (sim._ghostLink) { sim._ghostLink.remove(); sim._ghostLink = null; }
                sim._linkStart = null;
                sim._linkStartKey = null;
                const p = pc1();
                const sw = sim.simobjects.find((/** @type {any} */ o) => o instanceof Switch);
                if (!p || !sw) return;
                const pcPort = sim._getPorts(p).find((/** @type {any} */ d) => sim._isPortFree(d.port));
                const swPort = sim._getPorts(sw).find((/** @type {any} */ d) => sim._isPortFree(d.port));
                if (!pcPort || !swPort) return;
                sim.addObject(new Link(p, pcPort.port, pcPort.key, sw, swPort.port, swPort.key, sim));
            },
        },

        // ── Step 3: Switch to Run mode ─────────────────────────────────────────
        {
            target: () => document.querySelector('[data-role="mode-run"]'),
            title: t('tour.step.run-mode.title'),
            text: t('tour.step.run-mode.text'),
            action: 'observe-mode',
            modeRole: 'mode-run',
            fallback: () => { /** @type {HTMLElement|null} */ (document.querySelector('[data-role="mode-run"]'))?.click(); },
        },

        // ── Step 4: Click PC 1 to open its panel ──────────────────────────────
        {
            target: () => {
                const p = pc1();
                if (!p) return null;
                return document.querySelector(`.sim-node[data-objid="${p.id}"]`);
            },
            title: t('tour.step.open-computer.title'),
            text: t('tour.step.open-computer.text'),
            action: 'observe-panel',
            fallback: () => {
                const p = pc1();
                if (p) p.setPanelOpen(true);
            },
        },

        // ── Step 5: Navigate to IP settings inside the panel ──────────────────
        {
            target: () => {
                const p = pc1();
                if (!p?.panelEl) return null;
                return p.panelEl.querySelector('.menu .fa-gear')?.closest('button') ?? null;
            },
            title: t('tour.step.open-ip.title'),
            text: t('tour.step.open-ip.text'),
            action: 'observe-app',
            appSelector: '.app-ipv4',
            fallback: () => {
                const p = pc1();
                if (!p) return;
                p.setPanelOpen(true);
                const app = p.os.runningApps.find((/** @type {any} */ a) => a instanceof IPv4ConfigApp);
                if (app) p.os.focus(app.pid);
            },
        },

        // ── Step 6: Enter IP address ───────────────────────────────────────────
        {
            target: () => {
                const p = pc1();
                if (!p?.panelEl) return null;
                return p.panelEl.querySelector('.app-ipv4') ?? null;
            },
            title: t('tour.step.set-ip.title'),
            text: t('tour.step.set-ip.text'),
            action: 'observe-interface-ip',
            expectedIp: '192.168.0.11',
            fallback: () => {
                const p = pc1();
                if (p) p.net.configureInterface(0, { ip: '192.168.0.11', prefixLength: 24 });
            },
        },

        // ── Step 7a: Back to menu ──────────────────────────────────────────────
        {
            target: () => {
                const p = pc1();
                if (!p?.panelEl) return null;
                return p.panelEl.querySelector('.os-button-back') ?? null;
            },
            title: t('tour.step.back-menu.title'),
            text: t('tour.step.back-menu.text'),
            action: 'observe-app',
            appSelector: '.menu',
            fallback: () => {
                const p = pc1();
                if (p) p.os.unfocus();
            },
        },

        // ── Step 7b: Open terminal ─────────────────────────────────────────────
        {
            target: () => {
                const p = pc1();
                if (!p?.panelEl) return null;
                return p.panelEl.querySelector('.menu .fa-terminal')?.closest('button') ?? null;
            },
            title: t('tour.step.open-terminal.title'),
            text: t('tour.step.open-terminal.text'),
            action: 'observe-app',
            appSelector: '.app-terminal',
            fallback: () => {
                const p = pc1();
                if (!p) return;
                p.setPanelOpen(true);
                const app = p.os.runningApps.find((/** @type {any} */ a) => a instanceof TerminalApp);
                if (app) p.os.focus(app.pid);
            },
        },

        // ── Step 7b: Run ping ──────────────────────────────────────────────────
        {
            target: () => {
                const p = pc1();
                if (!p?.panelEl) return null;
                return p.panelEl.querySelector('.app-terminal') ?? null;
            },
            title: t('tour.step.ping.title'),
            text: t('tour.step.ping.text'),
            action: 'next',
            fallback: () => {
                const p = pc1();
                if (!p) return;
                p.setPanelOpen(true);
                const app = /** @type {any} */ (p.os.runningApps.find((/** @type {any} */ a) => a instanceof TerminalApp));
                if (!app) return;
                p.os.focus(app.pid);
                app.lineBuffer = 'ping 192.168.0.12';
                app._commitLine();
            },
        },

        // ── Step 9: Switch to Trace mode ───────────────────────────────────────
        {
            target: () => document.querySelector('[data-role="mode-trace"]'),
            title: t('tour.step.trace-mode.title'),
            text: t('tour.step.trace-mode.text'),
            action: 'observe-mode',
            modeRole: 'mode-trace',
            fallback: () => { /** @type {HTMLElement|null} */ (document.querySelector('[data-role="mode-trace"]'))?.click(); },
        },

        // ── Step 10a: Click "+" to open trace picker ───────────────────────────
        {
            target: () => document.querySelector('.pcapviewer-tab--plus'),
            title: t('tour.step.trace-open.title'),
            text: t('tour.step.trace-open.text'),
            action: 'observe-body-element',
            bodySelector: '.pcapviewer-tabpicker2',
            fallback: () => { /** @type {HTMLElement|null} */ (document.querySelector('.pcapviewer-tab--plus'))?.click(); },
        },

        // ── Step 10b: Select device + port ────────────────────────────────────
        {
            target: () => document.querySelector('.pcapviewer-tabpicker2'),
            title: t('tour.step.trace-select.title'),
            text: t('tour.step.trace-select.text'),
            action: 'observe-body-element',
            bodySelector: '.pcapviewer-tab:not(.pcapviewer-tab--plus)',
            fallback: () => {
                document.querySelector('.pcapviewer-tabpicker2')?.remove();
                const p = pc1();
                if (p) sim.pcapViewer.switchTab(`${p.id}: eth0`);
            },
        },

        // ── Step 11: See trace packets ─────────────────────────────────────────
        {
            target: () => null,
            title: t('tour.step.trace-packets.title'),
            text: t('tour.step.trace-packets.text'),
            action: 'next',
        },

        // ── Step 12: Finish ────────────────────────────────────────────────────
        {
            target: () => null,
            title: t('tour.step.finish.title'),
            text: t('tour.step.finish.text'),
            action: 'finish',
        },
    ];
}

export class Tour {
    /** @param {import('../SimControl.js').SimControl} sim */
    static async start(sim) {
        if (sim._isDirty && !await SimDialog.confirm(t('tour.confirm.discard'))) return;
        sim.restore(getTourSim());
        new Tour(sim)._init();
    }

    /** @param {import('../SimControl.js').SimControl} sim */
    constructor(sim) {
        this._sim = sim;
        this._steps = buildSteps(sim);
        this._stepIndex = 0;
        /** @type {MutationObserver[]} */
        this._observers = [];
        /** @type {(() => void)[]} */
        this._cleanupFns = [];
        /** @type {HTMLElement | null} */
        this._overlay = null;
        /** @type {HTMLElement | null} */
        this._spotlight = null;
        /** @type {HTMLElement | null} */
        this._tooltip = null;
        /** @type {ResizeObserver | null} */
        this._resizeObs = null;
        /** @type {HTMLStyleElement | null} */
        this._panelStyle = null;
        /** @type {((ev: KeyboardEvent) => void) | null} */
        this._onKey = null;
        this._onResize = () => this._reposition();
    }

    _init() {
        this._sim._activeTour = this;
        this._buildDOM();
        this._injectPanelStyle();
        this._showStep(0);

        window.addEventListener('resize', this._onResize);
        this._resizeObs = new ResizeObserver(() => this._reposition());
        this._resizeObs.observe(document.body);

        this._onKey = (ev) => { if (ev.key === 'Escape') this._finish(); };
        document.addEventListener('keydown', this._onKey);

        // Continuously reposition spotlight so dynamic targets (e.g. port picker) are tracked.
        const pollSpotlight = () => {
            if (!this._overlay?.isConnected) return;
            const s = this._steps[this._stepIndex];
            if (s) this._positionSpotlight(s.target());
            requestAnimationFrame(pollSpotlight);
        };
        requestAnimationFrame(pollSpotlight);
    }

    _buildDOM() {
        this._overlay = document.createElement('div');
        this._overlay.className = 'tour-overlay';

        this._spotlight = document.createElement('div');
        this._spotlight.className = 'tour-spotlight';

        this._tooltip = document.createElement('div');
        this._tooltip.className = 'tour-tooltip';
        this._tooltip.setAttribute('role', 'dialog');
        this._tooltip.setAttribute('aria-modal', 'false');
        this._tooltip.setAttribute('aria-live', 'polite');

        this._overlay.appendChild(this._spotlight);
        this._overlay.appendChild(this._tooltip);
        document.body.appendChild(this._overlay);
    }

    /** Lifts .sim-panel above the tour backdrop so open panels stay readable. */
    _injectPanelStyle() {
        const style = document.createElement('style');
        style.textContent = '.sim-panel { z-index: 5500 !important; }';
        document.head.appendChild(style);
        this._panelStyle = style;
    }

    /** @param {number} index */
    _showStep(index) {
        this._clearObservers();
        const step = this._steps[index];

        this._renderTooltip(step, index);
        this._setupWait(step);

        requestAnimationFrame(() => {
            const target = step.target();
            this._positionSpotlight(target);
            this._positionTooltip(target);
        });
    }

    _reposition() {
        const step = this._steps[this._stepIndex];
        if (!step) return;
        const target = step.target();
        this._positionSpotlight(target);
        this._positionTooltip(target);
    }

    /** @param {Element | null} target */
    _positionSpotlight(target) {
        const sp = this._spotlight;
        if (!sp) return;
        if (!target) { sp.style.display = 'none'; return; }

        const r = target.getBoundingClientRect();
        // Element is hidden (collapsed or display:none) — don't show a spotlight
        if (r.width < 4 || r.height < 4) { sp.style.display = 'none'; return; }

        sp.style.display = '';
        const pad = 6;
        sp.style.top    = (r.top    - pad) + 'px';
        sp.style.left   = (r.left   - pad) + 'px';
        sp.style.width  = (r.width  + pad * 2) + 'px';
        sp.style.height = (r.height + pad * 2) + 'px';
    }

    /** @param {Element | null} target */
    _positionTooltip(target) {
        const tip = this._tooltip;
        if (!tip) return;
        const margin = 14;

        if (!target || target.getBoundingClientRect().width < 4) {
            tip.style.top       = '50%';
            tip.style.left      = '50%';
            tip.style.transform = 'translate(-50%, -50%)';
            return;
        }

        tip.style.transform = '';
        const r    = target.getBoundingClientRect();
        const tipW = tip.offsetWidth  || 300;
        const tipH = tip.offsetHeight || 160;

        let top  = r.bottom + margin;
        let left = r.left;
        if (top + tipH > window.innerHeight - margin) top = r.top - tipH - margin;
        if (top < margin) top = margin;
        left = Math.min(left, window.innerWidth - tipW - margin);
        left = Math.max(left, margin);

        tip.style.top  = top  + 'px';
        tip.style.left = left + 'px';
    }

    /**
     * @param {TourStep} step
     * @param {number} index
     */
    _renderTooltip(step, index) {
        const tip = this._tooltip;
        if (!tip) return;
        tip.innerHTML = '';

        const counter = document.createElement('div');
        counter.className = 'tour-step-counter';
        counter.textContent = t('tour.counter', { n: index + 1, total: this._steps.length });

        const title = document.createElement('div');
        title.className = 'tour-step-title';
        title.textContent = step.title;

        const text = document.createElement('p');
        text.className = 'tour-step-text';
        text.textContent = step.text;

        const btns = document.createElement('div');
        btns.className = 'tour-btns';

        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'tour-btn tour-btn-skip';
        skip.textContent = t('tour.btn.skip');
        skip.addEventListener('click', () => this._finish());

        const primary = document.createElement('button');
        primary.type = 'button';
        primary.className = 'tour-btn tour-btn-next';
        primary.textContent = step.action === 'finish' ? t('tour.btn.finish') : t('tour.btn.next');
        primary.addEventListener('click', () => {
            if (step.action === 'finish') this._finish();
            else this._manualAdvance(step);
        });

        btns.appendChild(skip);
        btns.appendChild(primary);

        tip.appendChild(counter);
        tip.appendChild(title);
        tip.appendChild(text);
        tip.appendChild(btns);

        requestAnimationFrame(() => primary.focus());
    }

    /** @param {TourStep} step */
    _setupWait(step) {
        if (step.action === 'observe-mode' && step.modeRole) {
            this._waitForMode(step.modeRole, () => this._advance());
        } else if (step.action === 'observe-tool-active' && step.toolSelector) {
            this._waitForToolActive(step.toolSelector, () => this._advance());
        } else if (step.action === 'observe-ghost-link') {
            this._waitForDOMCount('.sim-link-ghost', 1, () => this._advance());
        } else if (step.action === 'observe-port-picker') {
            this._waitForPortPicker(() => this._advance());
        } else if (step.action === 'observe-app' && step.appSelector) {
            this._waitForApp(step.appSelector, () => this._advance());
        } else if (step.action === 'observe-interface-ip' && step.expectedIp) {
            this._waitForInterfaceIP(step.expectedIp, () => this._advance());
        } else if (step.action === 'observe-body-element' && step.bodySelector) {
            this._waitForBodyElement(step.bodySelector, () => this._advance());
        } else if (step.action === 'observe-click' && step.clickSelector) {
            this._waitForClick(step.clickSelector, () => this._advance());
        } else if (step.action === 'observe-node' && step.minNodes != null) {
            this._waitForDOMCount('.sim-node:not(.sim-node-ghost)', step.minNodes, () => this._advance());
        } else if (step.action === 'observe-link' && step.minLinks != null) {
            this._waitForDOMCount('.sim-link:not(.sim-link-ghost)', step.minLinks, () => this._advance());
        } else if (step.action === 'observe-panel') {
            this._waitForPanelOpen(() => this._advance());
        }
    }

    /** @param {string} selector @param {() => void} cb */
    _waitForToolActive(selector, cb) {
        const btn = document.querySelector(selector);
        if (!btn) return;
        if (btn.classList.contains('active')) { cb(); return; }
        const obs = new MutationObserver(() => {
            if (btn.classList.contains('active')) { obs.disconnect(); cb(); }
        });
        obs.observe(btn, { attributes: true, attributeFilter: ['class'] });
        this._observers.push(obs);
    }

    /** @param {string} modeRole @param {() => void} cb */
    _waitForMode(modeRole, cb) {
        const toolbar = document.querySelector('.sim-toolbar');
        if (!toolbar) return;
        const isActive = () => toolbar.querySelector(`[data-role="${modeRole}"]`)?.classList.contains('active') ?? false;
        if (isActive()) return;
        const obs = new MutationObserver(() => { if (isActive()) { obs.disconnect(); cb(); } });
        obs.observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['class'] });
        this._observers.push(obs);
    }

    /** @param {string} selector @param {number} minCount @param {() => void} cb */
    _waitForDOMCount(selector, minCount, cb) {
        const layer = document.querySelector('.sim-nodes');
        if (!layer) return;
        const check = () => layer.querySelectorAll(selector).length >= minCount;
        if (check()) { setTimeout(cb, 0); return; }
        const obs = new MutationObserver(() => { if (check()) { obs.disconnect(); cb(); } });
        obs.observe(layer, { childList: true, subtree: true });
        this._observers.push(obs);
    }

    /** @param {string} expectedIp @param {() => void} cb */
    _waitForInterfaceIP(expectedIp, cb) {
        const p = /** @type {any} */ (this._sim.simobjects.find((/** @type {any} */ o) => o instanceof Computer && o.id !== 20));
        if (!p) return;
        const check = () => p.net?.interfaces?.[0]?.ip?.toString() === expectedIp;
        if (check()) { setTimeout(cb, 0); return; }
        const id = setInterval(() => { if (check()) { clearInterval(id); cb(); } }, 150);
        this._cleanupFns.push(() => clearInterval(id));
    }

    /** @param {string} selector @param {() => void} cb */
    _waitForApp(selector, cb) {
        const p = this._sim.simobjects.find((/** @type {any} */ o) => o instanceof Computer && o.id !== 20);
        if (!p?.panelEl) { setTimeout(() => this._waitForApp(selector, cb), 50); return; }
        if (p.panelEl.querySelector(selector)) { setTimeout(cb, 0); return; }
        const obs = new MutationObserver(() => {
            if (p.panelEl?.querySelector(selector)) { obs.disconnect(); cb(); }
        });
        obs.observe(p.panelEl, { childList: true, subtree: true });
        this._observers.push(obs);
    }

    /** @param {string} selector @param {() => void} cb */
    _waitForClick(selector, cb) {
        const btn = document.querySelector(selector);
        if (!btn) return;
        const handler = () => cb();
        btn.addEventListener('click', handler);
        this._cleanupFns.push(() => btn.removeEventListener('click', handler));
    }

    /** @param {string} selector @param {() => void} cb */
    _waitForBodyElement(selector, cb) {
        if (document.querySelector(selector)) { setTimeout(cb, 0); return; }
        const obs = new MutationObserver(() => {
            if (document.querySelector(selector)) { obs.disconnect(); cb(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        this._observers.push(obs);
    }

    /** @param {() => void} cb */
    _waitForPortPicker(cb) {
        if (document.querySelector('.sim-port-picker')) { setTimeout(cb, 0); return; }
        const obs = new MutationObserver(() => {
            if (document.querySelector('.sim-port-picker')) { obs.disconnect(); cb(); }
        });
        obs.observe(document.body, { childList: true });
        this._observers.push(obs);
    }

    /** @param {() => void} cb */
    _waitForPanelOpen(cb) {
        // Poll briefly for the panel element (it may not exist immediately after addObject)
        const tryObserve = () => {
            const p = this._sim.simobjects.find((/** @type {any} */ o) => o instanceof Computer && o.id !== 20);
            if (!p?.panelEl) { setTimeout(tryObserve, 50); return; }

            if (p.panelEl.style.display === 'block') { cb(); return; }

            const obs = new MutationObserver(() => {
                if (p.panelEl?.style.display === 'block') { obs.disconnect(); cb(); }
            });
            obs.observe(p.panelEl, { attributes: true, attributeFilter: ['style'] });
            this._observers.push(obs);
        };
        tryObserve();
    }

    _clearObservers() {
        for (const obs of this._observers) obs.disconnect();
        this._observers = [];
        for (const fn of this._cleanupFns) fn();
        this._cleanupFns = [];
    }

    /** Automatic advance — condition was met by user action. */
    _advance() {
        this._stepIndex++;
        if (this._stepIndex >= this._steps.length) this._finish();
        else this._showStep(this._stepIndex);
    }

    /**
     * Manual advance via "Weiter" — clears observers, runs fallback if user
     * skipped the required action, then advances.
     * @param {TourStep} step
     */
    _manualAdvance(step) {
        this._clearObservers();
        if (step.fallback) step.fallback();
        this._stepIndex++;
        if (this._stepIndex >= this._steps.length) this._finish();
        else this._showStep(this._stepIndex);
    }

    _finish() {
        this._clearObservers();
        window.removeEventListener('resize', this._onResize);
        this._resizeObs?.disconnect();
        this._panelStyle?.remove();
        if (this._onKey) document.removeEventListener('keydown', this._onKey);
        this._overlay?.remove();
        if (this._sim._activeTour === this) this._sim._activeTour = null;
    }
}
