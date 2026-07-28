//@ts-check

import { SimulatedObject } from "./SimulatedObject.js";
import { EthernetPort } from "../net/EthernetPort.js";
import { EthernetFrame } from "../net/pdu/EthernetFrame.js";
import { UILib } from "../lib/UILib.js";

/**
 * A node that boots a real, unmodified Linux kernel inside the browser via v86
 * (x86 emulation compiled to WebAssembly), bridged onto the simulated L2 network.
 *
 * Unlike `Computer` (which runs a from-scratch JS "OS"/IPStack), the network
 * stack here is the real Linux kernel's — frames are exchanged 1:1 with the
 * emulated NIC via v86's message bus ("net0-send" / "net0-receive"), the same
 * way v86's own examples/two_instances.html bridges two VMs together.
 *
 * v1 scope (deliberately simple):
 * - one fixed, bundled boot image: Alpine Linux (public/v86/images/alpine-*),
 *   built via v86's own tools/docker/alpine/ recipe, no upload UI
 * - serial-only console (no VGA framebuffer/keyboard capture)
 * - no VM-state persistence across scene save/load — always boots fresh
 * - the virtio-net driver loads automatically at boot (`/etc/modules`, see
 *   scripts/v86-alpine-image/Dockerfile), so `eth0` is there to `ip addr`/
 *   `ip link` by hand right after login; it isn't IP-configured on its own
 *   though — run `sh /root/networking.sh` for DHCP/static auto-config
 *
 * Only available in debug mode (?debug=1) — this is an experimental,
 * heavyweight node type.
 */
export class Linux extends SimulatedObject {

    kind = "Linux";
    icon = "fa-linux";
    iconStyle = "fab";

    /** @type {EthernetPort} */
    port = new EthernetPort("eth0");

    /** @type {import("v86").V86 | null} */
    _emulator = null;

    /** True while the "v86" module import / V86 construction is in flight. */
    _booting = false;

    /** Frames that arrived before the VM existed yet — flushed once it does. @type {EthernetFrame[]} */
    _pendingFrames = [];

    /** @type {HTMLElement | null} */
    _serialEl = null;

    /** @type {HTMLElement | null} */
    _statusEl = null;

    /** Disconnects the ResizeObserver that keeps the terminal fit to its container. @type {(() => void) | null} */
    _fitCleanup = null;

    /**
     * @param {string} [name]
     */
    constructor(name = "Linux PC") {
        super(name);
        this.root.classList.add("linux-host");
        // A serial console needs real screen real estate to be usable — and
        // unlike the fixed-layout "OS" panels, there's no natural size here,
        // so let users grow it instead of being stuck with the generic default.
        this.panelResizable = true;
        this.panelMinWidth = 480;
        this.panelMinHeight = 320;
        this.port.subscribe(this);
        this.onPanelCreated = (/** @type {HTMLElement} */ body) => this._buildPanelBody(body);
        this.onPanelOpen = () => this._ensureBooted();
    }

    // ── Observable callback — called by EthernetPort when frames arrive ──────

    update() {
        let frame;
        while ((frame = this.port.getNextIncomingFrame()) != null) {
            this._deliverFrame(frame);
        }
    }

    /** @param {EthernetFrame} frame */
    _deliverFrame(frame) {
        if (this._emulator) {
            // `bus` isn't part of v86's published .d.ts (marked "experimental,
            // incomplete") but is the documented way to inject frames — see
            // v86's own examples/two_instances.html.
            /** @type {any} */ (this._emulator).bus.send("net0-receive", frame.pack());
        } else if (this._pendingFrames.length <= 100) {
            // VM not booted yet (or still booting) — queue instead of dropping,
            // matching EthernetPort's own 100-frame backpressure cap.
            this._pendingFrames.push(frame);
        }
    }

    // ── VM lifecycle ──────────────────────────────────────────────────────────

    _ensureBooted() {
        if (this._emulator || this._booting) return;
        this._booting = true;
        this._setStatus("booting");

        // xterm.js is loaded alongside v86 (not the naive `type: "textarea"`
        // serial console): that adapter does `String.fromCharCode(byte)` with
        // no UTF-8 decoding and doesn't interpret ANSI/VT100 escapes at all,
        // so a real shell's line-editing (cursor-movement based backspace,
        // multi-byte UTF-8) renders as garbage. xterm.js is a real terminal
        // emulator and is v86's own documented alternative backend for this.
        Promise.all([
            import("v86"),
            import("@xterm/xterm"),
            import("@xterm/xterm/css/xterm.css"),
            import("@xterm/addon-fit"),
        ]).then(([{ V86 }, { Terminal }, , { FitAddon }]) => {
            this._booting = false;
            // Panel/node may have been closed or destroyed while the module was loading.
            if (!this._serialEl) return;

            const emulator = new V86({
                wasm_path: "/v86/build/v86.wasm",
                memory_size: 128 * 1024 * 1024,
                vga_memory_size: 2 * 1024 * 1024,
                bios: { url: "/v86/bios/seabios.bin" },
                vga_bios: { url: "/v86/bios/vgabios.bin" },
                bzimage_initrd_from_filesystem: true,
                cmdline: "rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose "
                    + "modules=virtio_pci tsc=reliable init_on_free=on console=ttyS0,115200 console=tty0",
                filesystem: {
                    baseurl: "/v86/images/alpine-rootfs-flat",
                    basefs: "/v86/images/alpine-fs.json",
                },
                serial_console: { type: "xtermjs", container: this._serialEl, xterm_lib: Terminal },
                net_device: { type: "virtio" },
                autostart: true,
            });

            // v86's own `wasm_fn(...).then(...)` (loading v86.wasm) is what
            // actually creates `emulator.serial_adapter` — reading it right
            // here, synchronously after `new V86(...)`, is always `undefined`;
            // the WASM fetch hasn't resolved yet. That's why every earlier
            // attempt at styling/fitting the terminal silently no-op'd (`if
            // (term)` was always false) — none of it ever ran. `emulator-ready`
            // fires from inside that same async chain, well after the adapter
            // (and its `term`) exist, so do the one-time setup there instead.
            let serialConsoleReady = false;
            const setUpSerialConsole = () => {
                if (serialConsoleReady) return;
                const term = /** @type {any} */ (emulator).serial_adapter?.term;
                const serialEl = this._serialEl;
                // Panel/node may have been closed or destroyed by now (async).
                if (!term || !serialEl) return;
                serialConsoleReady = true;

                // v86 constructs the xterm.js `Terminal` itself (via
                // `xterm_lib`) with only `{logLevel, convertEol}`, so it always
                // gets xterm's own defaults: a light background and a
                // serif-ish fallback font that matches neither this app's dark
                // terminal look (see .app-terminal in app-terminal.css) nor
                // its --font-mono. `term.options` is a live-updatable
                // xterm.js API (unlike the constructor args, which are
                // already spent) — restyle it after the fact.
                term.options.fontFamily = "Hack, monospace";
                term.options.fontSize = 14;
                term.options.theme = {
                    background: "#202020",
                    foreground: "#00FF20",
                    cursor: "#00FF20",
                };

                // v86 never sizes the terminal to its container (no fit-on-open,
                // no resize handling), so it's stuck at xterm's default 80x24
                // regardless of how big `_serialEl` actually is.
                const fitAddon = new FitAddon();
                term.loadAddon(fitAddon);
                const fit = () => { try { fitAddon.fit(); } catch { /* not open yet */ } };
                fit();

                const resizeObserver = new ResizeObserver(fit);
                resizeObserver.observe(serialEl);
                this._fitCleanup = () => resizeObserver.disconnect();

                // xterm only re-measures cell size on an actual fontFamily
                // *value change* (see onMultipleOptionChange(["fontFamily",
                // ...]) in xterm's source). "Hack" (a custom @font-face, see
                // hack-font/build/web/hack.css) may still be downloading right
                // now, so this first fit measured with the fallback; once Hack
                // is confirmed loaded, toggle the value to force a real
                // remeasure and refit.
                document.fonts.load('14px "Hack"')
                    .then(() => {
                        term.options.fontFamily = "monospace";
                        term.options.fontFamily = "Hack, monospace";
                        fit();
                    })
                    .catch(fit);
            };

            emulator.add_listener("net0-send", (data) => {
                this.port.send(EthernetFrame.fromBytes(data));
            });
            emulator.add_listener("emulator-ready", () => {
                setUpSerialConsole();
                this._setStatus("running");
            });
            emulator.add_listener("download-error", () => this._setStatus("error"));

            this._emulator = emulator;

            for (const frame of this._pendingFrames) {
                /** @type {any} */ (emulator).bus.send("net0-receive", frame.pack());
            }
            this._pendingFrames = [];
        });
    }

    /** @param {boolean} open */
    setPanelOpen(open) {
        super.setPanelOpen(open);
        // Reclaim CPU for VMs the user isn't looking at — matters once several
        // Linux nodes are placed, since each is a full x86 emulation session.
        // Check the resulting state (not the `open` arg): the base class can
        // no-op a requested open (e.g. link tool active, edit-mode reset).
        if (this.panelOpen) this._emulator?.run();
        else this._emulator?.stop();
    }

    /** @param {string} status */
    _setStatus(status) {
        if (this._statusEl) this._statusEl.textContent = status;
    }

    // ── Panel UI ──────────────────────────────────────────────────────────────

    /** @param {HTMLElement} body */
    _buildPanelBody(body) {
        body.classList.add("linux-host-body");

        const statusEl = UILib.el("span", {
            className: "linux-host-status",
            text: "not booted",
        });
        this._statusEl = statusEl;

        const serialEl = UILib.el("div", { className: "linux-host-serial" });
        this._serialEl = serialEl;

        const hint = UILib.el("p", {
            className: "linux-host-hint",
            text: "Logged in as root automatically. eth0 driver is loaded — configure it "
                + "yourself, or run: sh /root/networking.sh",
        });

        const footer = UILib.el("div", {
            className: "linux-host-footer",
            children: [statusEl, hint],
        });

        // Terminal first so it gets the panel's full height; status lives in
        // a slim footer bar underneath instead of a form row above it (a
        // label+value row read like a form field, not a running VM).
        body.appendChild(serialEl);
        body.appendChild(footer);
    }

    // ── Port API ──────────────────────────────────────────────────────────────

    listPorts() {
        return [{ key: "eth0", label: "eth0", port: this.port }];
    }

    /** @param {string} key */
    getPortByKey(key) {
        return key === "eth0" ? this.port : null;
    }

    // ── Serialization ─────────────────────────────────────────────────────────
    // No VM-state persistence in v1 — a reloaded node always boots fresh.

    toJSON() {
        return {
            ...super.toJSON(),
            kind: "Linux",
        };
    }

    /** @param {any} n */
    static fromJSON(n) {
        const obj = new Linux(n.name ?? "Linux PC");
        obj._applyBaseJSON(n);
        return obj;
    }

    destroy() {
        this.port.unsubscribe(this);
        this._serialEl = null;
        this._fitCleanup?.();
        this._fitCleanup = null;
        this._emulator?.destroy();
        this._emulator = null;
        super.destroy();
    }
}
