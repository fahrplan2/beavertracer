//@ts-check

import { Link } from "../sim/Link.js";
import { EthernetPort } from "./EthernetPort.js";
import { isTrafficSuppressed } from "../lib/CheckState.js";

/** @typedef {{ start: number, every: number, dir: "ab"|"ba"|"both", count: "all"|"data" }} DropPattern */

/**
 * This class simulates a simple physical link between two ports
 */
export class EthernetLink {

    portA;
    portB;

    /** @type {Link | undefined} */
    link;

    /** Maximum Transmission Unit in bytes (Ethernet default: 1500) */
    mtu = 1500;

    /** When true, no frames are transferred — simulates a broken cable. */
    broken = false;

    /** Fraction (0..1) of frames dropped per direction — simulates a lossy/unreliable link. */
    lossRate = 0;

    /**
     * Deterministic loss (for lessons): drop the `start`-th counted frame and
     * then every `every`-th after it (`every` 0 = only that one). Counted per
     * direction ("ab" = A→B, "ba" = B→A, "both" = each direction on its own
     * counter); `count` "data" only counts TCP/UDP packets carrying payload,
     * so ARP, handshakes, bare ACKs etc. neither count nor get dropped.
     * @type {DropPattern|null}
     */
    dropPattern = null;

    /** Frames counted so far per direction, and how many of them were dropped. */
    dropStats = { ab: { counted: 0, dropped: 0 }, ba: { counted: 0, dropped: 0 } };

    /** @type {*} */
    AtoB;

    /** @type {*} */
    BtoA;

    /**
     * 
     * @param {EthernetPort} A 
     * @param {EthernetPort} B 
     */
    constructor(A,B) {
        if(!(A instanceof EthernetPort)) {
            throw new Error("Link must be connected to a Port")
        } 
        if(!(B instanceof EthernetPort)) {
            throw new Error("Link must be connected to a Port")
        } 

        this.portA = A;
        A.link(this);
        this.portB = B;
        B.link(this);
    }
    
    step1() {
        this._startTransfer();    
    }

    step2() {
        this._endTransfer();
    }

    _startTransfer() {
        if (this.broken) return;
        this.AtoB = this._maybeDrop(this._patternDrop(this.portA.getNextOutgoingFrame(), "ab"));
        this.BtoA = this._maybeDrop(this._patternDrop(this.portB.getNextOutgoingFrame(), "ba"));
    }

    /**
     * Randomly discards a frame according to lossRate, simulating packet
     * loss on an otherwise-working link. The frame has already left the
     * sending port (and is thus visible in its own capture) — it simply
     * never arrives at the other end, just like a real dropped packet.
     * @param {Uint8Array|null} frame
     * @returns {Uint8Array|null}
     */
    _maybeDrop(frame) {
        if (frame == null || this.lossRate <= 0) return frame;
        return Math.random() < this.lossRate ? null : frame;
    }

    /**
     * Sets (or clears) the deterministic drop pattern; restarts the counters.
     * @param {DropPattern|null} pattern
     */
    setDropPattern(pattern) {
        this.dropPattern = pattern;
        this.dropStats = { ab: { counted: 0, dropped: 0 }, ba: { counted: 0, dropped: 0 } };
    }

    /**
     * Applies dropPattern to a frame leaving in direction `dir`. Like
     * _maybeDrop, a dropped frame has already shown up in the sender's
     * capture — it just never arrives.
     * @param {Uint8Array|null} frame
     * @param {"ab"|"ba"} dir
     * @returns {Uint8Array|null}
     */
    _patternDrop(frame, dir) {
        const p = this.dropPattern;
        if (frame == null || !p || (p.dir !== "both" && p.dir !== dir)) return frame;
        // Probe traffic of a ":::task" check neither counts nor gets dropped —
        // checking a task must not shift which packet the lesson loses.
        if (isTrafficSuppressed()) return frame;
        if (p.count === "data" && !EthernetLink.carriesTransportData(frame)) return frame;
        const stats = this.dropStats[dir];
        const n = ++stats.counted;
        const hit = n === p.start || (p.every > 0 && n > p.start && (n - p.start) % p.every === 0);
        if (!hit) return frame;
        stats.dropped++;
        return null;
    }

    /**
     * True if the Ethernet frame holds a TCP segment or UDP datagram with
     * payload (IPv4 or IPv6, optionally 802.1Q-tagged). Lengths come from
     * the IP/UDP headers, not the frame — Ethernet pads short frames.
     * @param {Uint8Array} f
     */
    static carriesTransportData(f) {
        let off = 12;
        let type = (f[off] << 8) | f[off + 1];
        if (type === 0x8100) { off += 4; type = (f[off] << 8) | f[off + 1]; }
        off += 2;
        let proto, l4, l4Len;
        if (type === 0x0800) {
            const ihl = (f[off] & 0x0f) * 4;
            proto = f[off + 9];
            l4 = off + ihl;
            l4Len = ((f[off + 2] << 8) | f[off + 3]) - ihl;
        } else if (type === 0x86dd) {
            proto = f[off + 6];
            l4 = off + 40;
            l4Len = (f[off + 4] << 8) | f[off + 5];
        } else {
            return false;
        }
        if (l4 + 8 > f.length) return false;
        if (proto === 6) return l4Len - (f[l4 + 12] >> 4) * 4 > 0;
        if (proto === 17) return ((f[l4 + 4] << 8) | f[l4 + 5]) - 8 > 0;
        return false;
    }

    _endTransfer() {
        if(this.AtoB != null) {
            this.portB.recieve(this.AtoB);
            this.AtoB = null;
        }
        if(this.BtoA != null) {
            this.portA.recieve(this.BtoA);
            this.BtoA = null;
        }
    }

    destroy() {
        this.portA.unlink();
        this.portB.unlink();
    }
}