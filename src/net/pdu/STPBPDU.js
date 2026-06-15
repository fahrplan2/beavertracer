//@ts-check

import { assertLenU8 } from "../../lib/helpers.js";
import { read16BE, read32BE, write16BE, write32BE } from "../util/byteUtils.js";

/**
 * RSTP flags byte bits (IEEE 802.1w / 802.1D-2004, bpduType 0x02, protocolVersion 2).
 * Bit 0  – TC (Topology Change)
 * Bit 1  – Proposal
 * Bits 2-3 – Port Role: 00=Unknown 01=Alt/Backup 10=Root 11=Designated
 * Bit 4  – Learning
 * Bit 5  – Forwarding
 * Bit 6  – Agreement
 * Bit 7  – TCA (legacy STP compat, unused in pure RSTP)
 */
export const RSTP_FLAG_TC        = 0x01;
export const RSTP_FLAG_PROPOSAL  = 0x02;
export const RSTP_FLAG_LEARNING  = 0x10;
export const RSTP_FLAG_FORWARDING = 0x20;
export const RSTP_FLAG_AGREEMENT = 0x40;
export const RSTP_FLAG_TCA       = 0x80;

/** Port-role encoding for bits 2-3 of RSTP flags byte. */
export const RSTP_PORT_ROLE = Object.freeze({
    UNKNOWN:     0, // 00
    ALT_BACKUP:  1, // 01
    ROOT:        2, // 10
    DESIGNATED:  3, // 11
});

/**
 * IEEE 802.1D / 802.1w Spanning Tree BPDU (BPDU payload, no Ethernet/LLC header).
 *
 * Common BPDU types:
 *  - 0x00  Configuration BPDU (classic STP, protocolVersion 0)
 *  - 0x80  TCN BPDU (Topology Change Notification, classic STP)
 *  - 0x02  RST BPDU (Rapid Spanning Tree, protocolVersion 2)
 *
 * Time fields are in 1/256 seconds (as in 802.1D).
 */
export class STPBPDU {

  protocolId;     // 2 bytes (usually 0x0000)
  protocolVersion; // 1 byte (0 for 802.1D)
  bpduType;       // 1 byte (0x00 config, 0x80 TCN)
  flags;          // 1 byte

  // --- Configuration BPDU fields (present when bpduType == 0x00) ---
  /** @type {Uint8Array} */ rootId;     // 8 bytes: root bridge ID (priority+sysidext + MAC)
  rootPathCost;                        // 4 bytes
  /** @type {Uint8Array} */ bridgeId;   // 8 bytes: sender bridge ID
  portId;                              // 2 bytes

  messageAge;    // 2 bytes (1/256 sec)
  maxAge;        // 2 bytes (1/256 sec)
  helloTime;     // 2 bytes (1/256 sec)
  forwardDelay;  // 2 bytes (1/256 sec)

  /**
   * @param {object} [opts]
   * @param {number} [opts.protocolId] default 0x0000
   * @param {number} [opts.protocolVersion] default 0
   * @param {number} [opts.bpduType] default 0x00 (Configuration BPDU)
   * @param {number} [opts.flags] default 0
   *
   * @param {Uint8Array} [opts.rootId] length 8 (only for config)
   * @param {number} [opts.rootPathCost] 32-bit (only for config)
   * @param {Uint8Array} [opts.bridgeId] length 8 (only for config)
   * @param {number} [opts.portId] 16-bit (only for config)
   *
   * @param {number} [opts.messageAge] 16-bit ticks (1/256 sec)
   * @param {number} [opts.maxAge] 16-bit ticks (1/256 sec)
   * @param {number} [opts.helloTime] 16-bit ticks (1/256 sec)
   * @param {number} [opts.forwardDelay] 16-bit ticks (1/256 sec)
   */
  constructor(opts = {}) {
    this.protocolId = (opts.protocolId ?? 0x0000) & 0xffff;
    this.protocolVersion = (opts.protocolVersion ?? 0) & 0xff;
    this.bpduType = (opts.bpduType ?? 0x00) & 0xff;
    this.flags = (opts.flags ?? 0) & 0xff;

    // Defaults for Configuration BPDU
    this.rootId = opts.rootId ? assertLenU8(opts.rootId, 8, "rootId") : new Uint8Array(8);
    this.rootPathCost = (opts.rootPathCost ?? 0) >>> 0;
    this.bridgeId = opts.bridgeId ? assertLenU8(opts.bridgeId, 8, "bridgeId") : new Uint8Array(8);
    this.portId = (opts.portId ?? 0) & 0xffff;

    this.messageAge = (opts.messageAge ?? 0) & 0xffff;
    this.maxAge = (opts.maxAge ?? (20 * 256)) & 0xffff;       // default 20s
    this.helloTime = (opts.helloTime ?? (2 * 256)) & 0xffff;  // default 2s
    this.forwardDelay = (opts.forwardDelay ?? (15 * 256)) & 0xffff; // default 15s

    this._validate();
  }

  /**
   * Parse BPDU payload from bytes.
   *
   * @param {Uint8Array} bytes
   * @returns {STPBPDU}
   */
  static fromBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error("fromBytes expects Uint8Array");
    if (bytes.length < 4) throw new Error("BPDU needs at least 4 bytes");

    const protocolId = read16BE(bytes, 0);
    const protocolVersion = bytes[2];
    const bpduType = bytes[3];

    // TCN BPDU (802.1D) is only 4 bytes total (no flags)
    if (bpduType === 0x80) {
      return new STPBPDU({
        protocolId,
        protocolVersion,
        bpduType,
        flags: 0
      });
    }

    // Configuration BPDU minimal length is 35 bytes:
    // 2 + 1 + 1 + 1 + 8 + 4 + 8 + 2 + 2 + 2 + 2 + 2 = 35
    if (bytes.length < 35) throw new Error("Configuration BPDU needs at least 35 bytes");

    const flags = bytes[4];

    const rootId = bytes.slice(5, 13);

    const rootPathCost = read32BE(bytes, 13);

    const bridgeId = bytes.slice(17, 25);

    const portId       = read16BE(bytes, 25);
    const messageAge   = read16BE(bytes, 27);
    const maxAge       = read16BE(bytes, 29);
    const helloTime    = read16BE(bytes, 31);
    const forwardDelay = read16BE(bytes, 33);

    return new STPBPDU({
      protocolId,
      protocolVersion,
      bpduType,
      flags,
      rootId,
      rootPathCost,
      bridgeId,
      portId,
      messageAge,
      maxAge,
      helloTime,
      forwardDelay
    });
  }

  /**
   * Pack BPDU payload into bytes.
   * - For bpduType 0x80 (TCN): 4 bytes
   * - For bpduType 0x00 (Config): 35 bytes
   *
   * @returns {Uint8Array}
   */
  pack() {
    this._validate();

    // TCN BPDU
    if (this.bpduType === 0x80) {
      const out = new Uint8Array(4);
      write16BE(out, 0, this.protocolId);
      out[2] = this.protocolVersion & 0xff;
      out[3] = this.bpduType & 0xff;
      return out;
    }

    // Configuration BPDU
    const out = new Uint8Array(35);

    write16BE(out, 0, this.protocolId);
    out[2] = this.protocolVersion & 0xff;
    out[3] = this.bpduType & 0xff;
    out[4] = this.flags & 0xff;

    out.set(this.rootId, 5);

    write32BE(out, 13, this.rootPathCost);

    out.set(this.bridgeId, 17);

    write16BE(out, 25, this.portId);
    write16BE(out, 27, this.messageAge);
    write16BE(out, 29, this.maxAge);
    write16BE(out, 31, this.helloTime);
    write16BE(out, 33, this.forwardDelay);

    return out;
  }

  // ---- RSTP decoded flag accessors ----
  get isTc()         { return !!(this.flags & RSTP_FLAG_TC); }
  get isProposal()   { return !!(this.flags & RSTP_FLAG_PROPOSAL); }
  get isLearning()   { return !!(this.flags & RSTP_FLAG_LEARNING); }
  get isForwarding() { return !!(this.flags & RSTP_FLAG_FORWARDING); }
  get isAgreement()  { return !!(this.flags & RSTP_FLAG_AGREEMENT); }
  get isTca()        { return !!(this.flags & RSTP_FLAG_TCA); }
  /** Port role code (0–3), see RSTP_PORT_ROLE. */
  get portRoleCode() { return (this.flags >> 2) & 0x03; }

  _validate() {
    if (!Number.isInteger(this.protocolId) || this.protocolId < 0 || this.protocolId > 0xffff) {
      throw new Error("protocolId must be 0..65535");
    }
    if (!Number.isInteger(this.protocolVersion) || this.protocolVersion < 0 || this.protocolVersion > 255) {
      throw new Error("protocolVersion must be 0..255");
    }
    if (!Number.isInteger(this.bpduType) || this.bpduType < 0 || this.bpduType > 255) {
      throw new Error("bpduType must be 0..255");
    }

    if (this.bpduType === 0x80) {
      // TCN BPDU: only base header is meaningful
      return;
    }

    if (!Number.isInteger(this.flags) || this.flags < 0 || this.flags > 255) {
      throw new Error("flags must be 0..255");
    }

    assertLenU8(this.rootId, 8, "rootId");
    assertLenU8(this.bridgeId, 8, "bridgeId");

    if (!Number.isInteger(this.rootPathCost) || this.rootPathCost < 0 || this.rootPathCost > 0xffffffff) {
      throw new Error("rootPathCost must be 0..2^32-1");
    }
    if (!Number.isInteger(this.portId) || this.portId < 0 || this.portId > 0xffff) {
      throw new Error("portId must be 0..65535");
    }

    for (const [name, v] of [
      ["messageAge", this.messageAge],
      ["maxAge", this.maxAge],
      ["helloTime", this.helloTime],
      ["forwardDelay", this.forwardDelay]
    ]) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
        throw new Error(`${name} must be 0..65535 (ticks of 1/256s)`);
      }
    }
  }
}
