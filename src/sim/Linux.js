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
 * - networking isn't auto-configured on boot (matches real hardware — a
 *   freshly booted Linux won't touch the network on its own either); run
 *   `sh /root/networking.sh` after login to load the NIC driver and DHCP/
 *   static-configure eth0
 *
 * Only available in debug mode (?debug=1), like CompanionBridge — this is an
 * experimental, heavyweight node type.
 */
export class Linux extends SimulatedObject {

    kind = "Linux";
    icon = "fa-server";

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

    /**
     * @param {string} [name]
     */
    constructor(name = "Linux") {
        super(name);
        this.root.classList.add("linux-host");
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
        ]).then(([{ V86 }, { Terminal }]) => {
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

            emulator.add_listener("net0-send", (data) => {
                this.port.send(EthernetFrame.fromBytes(data));
            });
            emulator.add_listener("emulator-ready", () => this._setStatus("running"));
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
        const statusEl = UILib.el("span", {
            className: "linux-host-status",
            text: "not booted",
        });
        this._statusEl = statusEl;

        const serialEl = UILib.el("div", { className: "linux-host-serial" });
        this._serialEl = serialEl;

        const hint = UILib.el("p", {
            className: "linux-host-hint",
            text: "Logged in as root automatically. Networking isn't configured on boot — "
                + "run: sh /root/networking.sh",
        });

        body.appendChild(UILib.row("Status", statusEl));
        body.appendChild(serialEl);
        body.appendChild(hint);
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
        const obj = new Linux(n.name ?? "Linux");
        obj._applyBaseJSON(n);
        return obj;
    }

    destroy() {
        this.port.unsubscribe(this);
        this._serialEl = null;
        this._emulator?.destroy();
        this._emulator = null;
        super.destroy();
    }
}
