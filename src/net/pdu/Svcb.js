//@ts-check

/**
 * SVCB / HTTPS resource records (RFC 9460): wire format and the presentation
 * format used by dig and zone files, e.g. `1 . alpn="h3,h2" port=443`.
 *
 * Data model:
 *   { priority: number,        // 0 = AliasMode, >= 1 = ServiceMode
 *     target: string,          // "." = the owner name itself
 *     params: { alpn?: string[], "no-default-alpn"?: true, port?: number,
 *               ipv4hint?: string[], ipv6hint?: string[], mandatory?: string[],
 *               ech?: Uint8Array, [key: `key${number}`]: Uint8Array } }
 */

import { IPAddress } from "../models/IPAddress.js";

/** SvcParamKeys (RFC 9460 §14.3.2). */
export const SVC_KEY = Object.freeze({
  mandatory: 0, alpn: 1, "no-default-alpn": 2, port: 3, ipv4hint: 4, ech: 5, ipv6hint: 6,
});

/** @param {number} k */
function keyName(k) {
  return Object.entries(SVC_KEY).find(([, v]) => v === k)?.[0] ?? `key${k}`;
}

/** @param {string} name */
function keyNumber(name) {
  if (name in SVC_KEY) return SVC_KEY[/** @type {keyof typeof SVC_KEY} */ (name)];
  const m = /^key(\d{1,5})$/.exec(name);
  if (m && Number(m[1]) <= 65535) return Number(m[1]);
  throw new Error(`unknown SvcParamKey "${name}"`);
}

/**
 * @typedef {{ priority: number, target: string, params: Record<string, any> }} SvcbData
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** @param {number} v */
const u16 = (v) => Uint8Array.of((v >>> 8) & 0xff, v & 0xff);

/** @param {Uint8Array[]} parts */
function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Encode RDATA. The target name is never compressed (§2.2).
 * @param {SvcbData} d
 * @param {(name: string) => Uint8Array} writeName DNS name encoder ("" = root)
 */
export function encodeSvcb(d, writeName) {
  const priority = Number(d.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 65535) throw new Error("SVCB priority must be 0..65535");
  const target = String(d.target ?? ".").replace(/\.$/, "");
  /** @type {Array<[number, Uint8Array]>} */
  const params = [];
  for (const [name, value] of Object.entries(d.params ?? {})) {
    const key = keyNumber(name);
    /** @type {Uint8Array} */
    let v;
    switch (key) {
      case SVC_KEY.mandatory:
        v = concat(/** @type {string[]} */ (value).map(k => u16(keyNumber(k))));
        break;
      case SVC_KEY.alpn:
        v = concat(/** @type {string[]} */ (value).map(id => {
          const b = enc.encode(id);
          if (b.length < 1 || b.length > 255) throw new Error("alpn id length must be 1..255");
          return concat([Uint8Array.of(b.length), b]);
        }));
        break;
      case SVC_KEY["no-default-alpn"]: v = new Uint8Array(0); break;
      case SVC_KEY.port: v = u16(Number(value)); break;
      case SVC_KEY.ipv4hint:
      case SVC_KEY.ipv6hint: {
        const fam = key === SVC_KEY.ipv4hint ? 4 : 6;
        v = concat(/** @type {string[]} */ (value).map(a => {
          const ip = IPAddress.fromString(a);
          if ((fam === 4) !== ip.isV4()) throw new Error(`${keyName(key)}: wrong address family ${a}`);
          return ip.toUInt8();
        }));
        break;
      }
      default:
        v = value instanceof Uint8Array ? value : enc.encode(String(value));
    }
    params.push([key, v]);
  }
  // SvcParams in strictly increasing key order (§2.2)
  params.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < params.length; i++) if (params[i][0] === params[i - 1][0]) throw new Error("duplicate SvcParamKey");
  if (priority === 0 && params.length) throw new Error("AliasMode (priority 0) carries no SvcParams");
  return concat([u16(priority), writeName(target), ...params.flatMap(([k, v]) => [u16(k), u16(v.length), v])]);
}

/**
 * Decode RDATA.
 * @param {Uint8Array} rdata
 * @param {(bytes: Uint8Array, offset: number) => { name: string, nextOffset: number }} readName
 * @returns {SvcbData}
 */
export function decodeSvcb(rdata, readName) {
  if (rdata.length < 3) throw new Error("SVCB RDATA truncated");
  const priority = (rdata[0] << 8) | rdata[1];
  const { name, nextOffset } = readName(rdata, 2);
  /** @type {Record<string, any>} */
  const params = {};
  let off = nextOffset;
  let lastKey = -1;
  while (off < rdata.length) {
    if (off + 4 > rdata.length) throw new Error("SvcParam truncated");
    const key = (rdata[off] << 8) | rdata[off + 1];
    const len = (rdata[off + 2] << 8) | rdata[off + 3];
    off += 4;
    if (off + len > rdata.length) throw new Error("SvcParam value truncated");
    if (key <= lastKey) throw new Error("SvcParamKeys not in increasing order");
    lastKey = key;
    const v = rdata.subarray(off, off + len);
    off += len;
    switch (key) {
      case SVC_KEY.mandatory: {
        const keys = [];
        for (let i = 0; i + 1 < v.length; i += 2) keys.push(keyName((v[i] << 8) | v[i + 1]));
        params.mandatory = keys;
        break;
      }
      case SVC_KEY.alpn: {
        const ids = [];
        for (let i = 0; i < v.length;) { const l = v[i]; ids.push(dec.decode(v.subarray(i + 1, i + 1 + l))); i += 1 + l; }
        params.alpn = ids;
        break;
      }
      case SVC_KEY["no-default-alpn"]: params["no-default-alpn"] = true; break;
      case SVC_KEY.port: params.port = (v[0] << 8) | v[1]; break;
      case SVC_KEY.ipv4hint: {
        const out = [];
        for (let i = 0; i + 3 < v.length; i += 4) out.push(`${v[i]}.${v[i + 1]}.${v[i + 2]}.${v[i + 3]}`);
        params.ipv4hint = out;
        break;
      }
      case SVC_KEY.ipv6hint: {
        const out = [];
        for (let i = 0; i + 15 < v.length; i += 16) out.push(IPAddress.fromUInt8(v.slice(i, i + 16)).toString());
        params.ipv6hint = out;
        break;
      }
      default: params[keyName(key)] = v.slice();
    }
  }
  return { priority, target: name === "" ? "." : name, params };
}

/**
 * Presentation format: `1 . alpn="h3,h2" port=443 ipv4hint=192.0.2.1`.
 * @param {SvcbData} d
 */
export function formatSvcb(d) {
  const target = d.target === "." || d.target === "" ? "." : `${d.target.replace(/\.$/, "")}.`;
  const parts = [String(d.priority), target];
  const entries = Object.entries(d.params ?? {}).sort((a, b) => keyNumber(a[0]) - keyNumber(b[0]));
  for (const [k, v] of entries) {
    if (k === "no-default-alpn") parts.push(k);
    else if (k === "alpn") parts.push(`alpn="${v.join(",")}"`);
    else if (Array.isArray(v)) parts.push(`${k}=${v.join(",")}`);
    else if (v instanceof Uint8Array) parts.push(`${k}=0x${Array.from(v, b => b.toString(16).padStart(2, "0")).join("")}`);
    else parts.push(`${k}=${v}`);
  }
  return parts.join(" ");
}

/**
 * Parse the SvcParams part of the presentation format, as typed into the
 * DNS server: `alpn=h3,h2 port=443 ipv4hint=192.0.2.1` (quotes optional).
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parseSvcParams(text) {
  /** @type {Record<string, any>} */
  const params = {};
  for (const tok of String(text ?? "").trim().split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf("=");
    const key = (eq < 0 ? tok : tok.slice(0, eq)).toLowerCase();
    const raw = eq < 0 ? "" : tok.slice(eq + 1).replace(/^"|"$/g, "");
    keyNumber(key); // validates the name
    if (key in params) throw new Error(`duplicate parameter "${key}"`);
    switch (key) {
      case "no-default-alpn": params[key] = true; break;
      case "port": {
        const p = Number(raw);
        if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`invalid port "${raw}"`);
        params.port = p;
        break;
      }
      case "alpn": case "mandatory": case "ipv4hint": case "ipv6hint": {
        const list = raw.split(",").map(s => s.trim()).filter(Boolean);
        if (!list.length) throw new Error(`"${key}" needs a value`);
        if (key === "ipv4hint" || key === "ipv6hint") {
          for (const a of list) {
            let ip;
            try { ip = IPAddress.fromString(a); } catch { throw new Error(`invalid address "${a}"`); }
            if (ip.isV4() !== (key === "ipv4hint")) throw new Error(`${key}: wrong address family ${a}`);
          }
        }
        params[key] = list;
        break;
      }
      default: params[key] = new TextEncoder().encode(raw);
    }
  }
  return params;
}
