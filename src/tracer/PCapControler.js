//@ts-check

import { LoggedFrame } from "./loggedFrame";
import { Pcap } from "./Pcap";
import { PCapViewer } from "./PCapViewer";

/** @typedef {import("../net/EthernetPort.js").EthernetPort} EthernetPort */

/**
 * @typedef {{
 *   port: EthernetPort;
 *   observer: { update(): void };
 *   debounceTimer: number;
 *   lastWrittenSeq: number;
 * }} SessionMeta
 */

export class PCapController {

    /** @type {Map<string, SessionMeta>} */
    #sessions = new Map();

    /** @type {string|null} */
    #activeName = null;

    /**
     * @param {PCapViewer} pcapviewer
     */
    constructor(pcapviewer) {
        this.pcapviewer = pcapviewer;
    }

    /**
     * Register or update a session. Idempotent — safe to call multiple times.
     * @param {string} ifName
     * @param {EthernetPort} port
     */
    addIf(ifName, port) {
        if (this.#sessions.has(ifName)) {
            const existing = this.#sessions.get(ifName);
            if (existing) existing.port = port;
            return;
        }

        /** @type {SessionMeta} */
        const meta = {
            port,
            observer: { update: () => this.#scheduleUpdate(ifName) },
            debounceTimer: 0,
            lastWrittenSeq: 0,
        };
        this.#sessions.set(ifName, meta);
        this.pcapviewer.newSession(ifName);
    }

    /**
     * Called by PCapViewer's onActiveTabChange callback.
     * Unsubscribes the old active port, subscribes the new one and triggers a full load.
     * @param {string|null} name
     */
    setActive(name) {
        if (this.#activeName === name) return;

        if (this.#activeName) this.#unsubscribe(this.#activeName);
        this.#activeName = name;
        if (name) this.#subscribe(name);
    }

    /**
     * Removes an interface: unsubscribes if active, closes the viewer session.
     * @param {string} ifName
     */
    removeIf(ifName) {
        if (this.#activeName === ifName) {
            this.#unsubscribe(ifName);
            this.#activeName = null;
        }
        this.#sessions.delete(ifName);
        this.pcapviewer.closeSession(ifName);
    }

    // -------------------------------------------------------------------------

    /** @param {string} name */
    #subscribe(name) {
        const meta = this.#sessions.get(name);
        if (!meta) return;
        meta.lastWrittenSeq = 0; // force full reload on next update
        meta.port.subscribe(meta.observer);
        this.#doFullLoad(name);
    }

    /** @param {string} name */
    #unsubscribe(name) {
        const meta = this.#sessions.get(name);
        if (!meta) return;
        meta.port.unsubscribe(meta.observer);
        window.clearTimeout(meta.debounceTimer);
        meta.debounceTimer = 0;
    }

    /** @param {string} name */
    #scheduleUpdate(name) {
        const meta = this.#sessions.get(name);
        if (!meta) return;
        window.clearTimeout(meta.debounceTimer);
        meta.debounceTimer = window.setTimeout(() => this.#doUpdate(name), 250);
    }

    /** @param {string} name */
    #doUpdate(name) {
        const meta = this.#sessions.get(name);
        if (!meta) return;

        const newCount = meta.port.frameSeq - meta.lastWrittenSeq;
        if (newCount <= 0) return;

        // Ring buffer overflow between updates → full reload
        if (newCount > meta.port.loggedFrames.length) {
            this.#doFullLoad(name);
            return;
        }

        // Snapshot only the new frames (copy to avoid race with simulator)
        const newFrames = meta.port.loggedFrames.slice(meta.port.loggedFrames.length - newCount);
        meta.lastWrittenSeq = meta.port.frameSeq;

        const recordBytes = this.#framesToRecordBytes(newFrames);
        this.pcapviewer.appendRecords(name, recordBytes);
    }

    /** @param {string} name */
    #doFullLoad(name) {
        const meta = this.#sessions.get(name);
        if (!meta) return;

        // Snapshot the whole ring buffer (copy to avoid race with simulator)
        const snapshot = meta.port.loggedFrames.slice();
        meta.lastWrittenSeq = meta.port.frameSeq;

        const pcap = new Pcap(snapshot, name);
        this.pcapviewer.loadBytes(name, pcap.generateBytes());
    }

    /**
     * @param {LoggedFrame[]} frames
     * @returns {Uint8Array}
     */
    #framesToRecordBytes(frames) {
        const chunks = frames.map(f => Pcap.record(f));
        let total = 0;
        for (const c of chunks) total += c.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }
}
