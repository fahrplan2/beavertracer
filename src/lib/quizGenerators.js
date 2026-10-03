//@ts-check
// Task generators for ":::quiz random <type>" blocks (see vite-plugin-lessons.mjs
// and QuizInteractions.js). Each generator produces one practice task with
// freshly randomised numbers — "try again" simply asks for new ones — so
// students can practise binary conversion, netmasks and subnetting as often
// as they like.
//
// Pure functions only (no DOM): the runtime renders the returned tasks, the
// unit tests check the answers. Copied next to _quiz.js for the standalone
// lessons site, so it must stay import-free.

/**
 * @typedef {{ key: string, label: string, kind: "ip"|"bin"|"num"|"choice"|"text", answer: string, options?: string[] }} TaskField
 * @typedef {{ head: string[], rows: string[][] }} TaskTable  rows hold a label in column 0, field keys after
 * @typedef {{ text: string, fields: TaskField[], table?: TaskTable }} Task
 * @typedef {() => number} Rng  returns a float in [0, 1)
 */

// ── IPv4 helpers ─────────────────────────────────────────────────────────

/** @param {number} n @returns {string} */
export function intToIp(n) {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

/** @param {string} ip @returns {number} */
export function ipToInt(ip) {
  return ip.split(".").reduce((acc, o) => ((acc << 8) | (Number(o) & 255)) >>> 0, 0) >>> 0;
}

/** @param {number} prefix 0–32 @returns {number} */
export function maskInt(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** @param {number} prefix @returns {string} e.g. 24 → "255.255.255.0" */
export function prefixToMask(prefix) {
  return intToIp(maskInt(prefix));
}

/** @param {number} prefix @returns {number} usable host addresses (2^(32-n) − 2) */
export function hostCount(prefix) {
  return Math.max(0, 2 ** (32 - prefix) - 2);
}

/** @param {string} ip @param {number} prefix */
export function networkOf(ip, prefix) {
  return intToIp((ipToInt(ip) & maskInt(prefix)) >>> 0);
}

/** @param {string} ip @param {number} prefix */
export function broadcastOf(ip, prefix) {
  return intToIp((ipToInt(ip) | (~maskInt(prefix) >>> 0)) >>> 0);
}

/** @param {number} n 0–255 @returns {string} 8-digit binary */
export function toBin8(n) {
  return n.toString(2).padStart(8, "0");
}

// ── IPv6 helpers ─────────────────────────────────────────────────────────

/** @param {number[]} groups eight 16-bit values @returns {string} all eight groups, 4 hex digits each */
export function ipv6Full(groups) {
  return groups.map((g) => g.toString(16).padStart(4, "0")).join(":");
}

/**
 * Canonical short form (RFC 5952): lowercase, no leading zeros, the longest
 * run of two or more zero groups replaced by "::" (first one on a tie).
 * @param {number[]} groups @returns {string}
 */
export function ipv6Short(groups) {
  let bestStart = -1, bestLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] !== 0) continue;
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

// ── Answer normalisation (shared with the runtime) ───────────────────────

/**
 * Normalises a student's answer for comparison: IPs octet-wise (so
 * "192.168.001.1" counts), binary without spaces and leading zeros optional,
 * numbers without thousands separators.
 * @param {TaskField["kind"]} kind @param {string} value
 * @returns {string}
 */
export function normalizeAnswer(kind, value) {
  const v = String(value ?? "").trim().toLowerCase();
  switch (kind) {
    case "ip": {
      const parts = v.split(".");
      if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return v;
      return parts.map(Number).join(".");
    }
    case "bin": {
      const b = v.replace(/\s+/g, "");
      return /^[01]{1,8}$/.test(b) ? b.padStart(8, "0") : b;
    }
    case "num":
      return v.replace(/[\s.']/g, "").replace(/^\/+/, "");
    default:
      return v.replace(/\s+/g, "");
  }
}

// ── Random helpers ───────────────────────────────────────────────────────

/** @param {Rng} rng @param {number} lo @param {number} hi inclusive */
function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** @template T @param {Rng} rng @param {T[]} arr @returns {T} */
function pick(rng, arr) {
  return arr[randInt(rng, 0, arr.length - 1)];
}

/** A plausible host address: private range most of the time, the occasional public one. @param {Rng} rng */
function randomIp(rng) {
  const kind = randInt(rng, 0, 3);
  if (kind === 0) return `10.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
  if (kind === 1) return `172.${randInt(rng, 16, 31)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
  if (kind === 2) return `192.168.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
  return `${randInt(rng, 11, 223)}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
}

// ── Texts ────────────────────────────────────────────────────────────────

/** @type {Record<string, Record<string, string>>} */
const TEXT = {
  de: {
    bin2dec: "Wandle die Dualzahl {bin} in eine Dezimalzahl um.",
    dec2bin: "Wandle die Dezimalzahl {dec} in eine 8-stellige Dualzahl um.",
    cidr2mask: "Wie lautet die Netzmaske zu /{prefix}?",
    mask2cidr: "Welche Präfixlänge gehört zur Netzmaske {mask}?",
    hosts: "Wie viele Hosts kann man in einem /{prefix}-Netz adressieren?",
    netbcast: "Ein Gerät hat die Adresse {ip}/{prefix}.",
    samenet: "Ein PC hat die Adresse {ip}/{prefix} und will {target} erreichen.",
    subnet: "Teile das Netz {net}/{prefix} in {count} gleich große Teilnetze.",
    decimal: "Dezimal",
    binary: "Dual",
    mask: "Netzmaske",
    prefix: "Präfix (/n)",
    hostCount: "Anzahl Hosts",
    network: "Netzadresse",
    broadcast: "Broadcastadresse",
    firstHost: "Erster Host",
    lastHost: "Letzter Host",
    how: "Direkt oder über das Gateway?",
    direct: "direkt",
    gateway: "über das Gateway",
    newPrefix: "Neues Präfix (/n)",
    newMask: "Neue Netzmaske",
    subnetN: "Teilnetz {n}",
    subnetCol: "Teilnetz",
    ipv6short: "Schreibe die IPv6-Adresse {addr} so kurz wie möglich.",
    ipv6expand: "Schreibe die IPv6-Adresse {addr} vollständig aus (8 Blöcke mit je 4 Ziffern).",
    shortForm: "Kurzform",
    fullForm: "Vollständige Form",
  },
  en: {
    bin2dec: "Convert the binary number {bin} to decimal.",
    dec2bin: "Convert the decimal number {dec} to an 8-digit binary number.",
    cidr2mask: "What is the netmask for /{prefix}?",
    mask2cidr: "Which prefix length belongs to the netmask {mask}?",
    hosts: "How many hosts can be addressed in a /{prefix} network?",
    netbcast: "A device has the address {ip}/{prefix}.",
    samenet: "A PC with the address {ip}/{prefix} wants to reach {target}.",
    subnet: "Split the network {net}/{prefix} into {count} subnets of equal size.",
    decimal: "Decimal",
    binary: "Binary",
    mask: "Netmask",
    prefix: "Prefix (/n)",
    hostCount: "Number of hosts",
    network: "Network address",
    broadcast: "Broadcast address",
    firstHost: "First host",
    lastHost: "Last host",
    how: "Directly or via the gateway?",
    direct: "directly",
    gateway: "via the gateway",
    newPrefix: "New prefix (/n)",
    newMask: "New netmask",
    subnetN: "Subnet {n}",
    subnetCol: "Subnet",
    ipv6short: "Write the IPv6 address {addr} as short as possible.",
    ipv6expand: "Write out the IPv6 address {addr} in full (8 groups of 4 digits).",
    shortForm: "Short form",
    fullForm: "Full form",
  },
};

/** @param {string} lang */
function texts(lang) {
  return TEXT[lang] ?? TEXT.en;
}

/** @param {string} tpl @param {Record<string, string|number>} vars */
function fmt(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

// ── Generators ───────────────────────────────────────────────────────────

/**
 * Random IPv6 address with exactly one run of 2–5 zero groups (so the short
 * form is unambiguous) plus groups with leading zeros, like "0db8".
 * @param {Rng} rng @returns {number[]}
 */
function randomIpv6Groups(rng) {
  const runLen = randInt(rng, 2, 5);
  const runStart = randInt(rng, 1, 8 - runLen); // never at the very start, 2001:db8-like prefix stays readable
  /** @type {number[]} */
  const groups = [];
  for (let i = 0; i < 8; i++) {
    if (i >= runStart && i < runStart + runLen) { groups.push(0); continue; }
    if (i === 0) { groups.push(pick(rng, [0x2001, 0x2a02, 0xfe80, 0xfd00, 0x2003])); continue; }
    // mostly non-zero groups, some with leading zeros (e.g. 0db8, 00a1)
    const style = randInt(rng, 0, 3);
    if (style === 0) groups.push(randInt(rng, 0x1, 0xff));        // → 00xx
    else if (style === 1) groups.push(randInt(rng, 0x100, 0xfff)); // → 0xxx
    else groups.push(randInt(rng, 0x1000, 0xffff));
  }
  return groups;
}

/** @type {Record<string, (rng: Rng, lang: string) => Task>} */
export const GENERATORS = {
  bin2dec(rng, lang) {
    const T = texts(lang);
    const n = randInt(rng, 1, 255);
    return { text: fmt(T.bin2dec, { bin: toBin8(n) }), fields: [{ key: "dec", label: T.decimal, kind: "num", answer: String(n) }] };
  },

  dec2bin(rng, lang) {
    const T = texts(lang);
    const n = randInt(rng, 1, 255);
    return { text: fmt(T.dec2bin, { dec: n }), fields: [{ key: "bin", label: T.binary, kind: "bin", answer: toBin8(n) }] };
  },

  cidr2mask(rng, lang) {
    const T = texts(lang);
    const prefix = randInt(rng, 8, 30);
    if (rng() < 0.5) {
      return { text: fmt(T.cidr2mask, { prefix }), fields: [{ key: "mask", label: T.mask, kind: "ip", answer: prefixToMask(prefix) }] };
    }
    return { text: fmt(T.mask2cidr, { mask: prefixToMask(prefix) }), fields: [{ key: "prefix", label: T.prefix, kind: "num", answer: String(prefix) }] };
  },

  hosts(rng, lang) {
    const T = texts(lang);
    const prefix = randInt(rng, 16, 30);
    return { text: fmt(T.hosts, { prefix }), fields: [{ key: "hosts", label: T.hostCount, kind: "num", answer: String(hostCount(prefix)) }] };
  },

  netbcast(rng, lang) {
    const T = texts(lang);
    const prefix = randInt(rng, 8, 30);
    const ip = randomIp(rng);
    const net = ipToInt(networkOf(ip, prefix));
    const bc = ipToInt(broadcastOf(ip, prefix));
    return {
      text: fmt(T.netbcast, { ip, prefix }),
      fields: [
        { key: "network", label: T.network, kind: "ip", answer: intToIp(net) },
        { key: "broadcast", label: T.broadcast, kind: "ip", answer: intToIp(bc) },
        { key: "first", label: T.firstHost, kind: "ip", answer: intToIp(net + 1) },
        { key: "last", label: T.lastHost, kind: "ip", answer: intToIp(bc - 1) },
        { key: "hosts", label: T.hostCount, kind: "num", answer: String(hostCount(prefix)) },
      ],
    };
  },

  samenet(rng, lang) {
    const T = texts(lang);
    const prefix = pick(rng, [8, 16, 24, 24, 25, 26, 27, 28]);
    const ip = randomIp(rng);
    const net = ipToInt(networkOf(ip, prefix));
    const size = 2 ** (32 - prefix);
    // Half the time a target inside the same network, otherwise one just
    // outside it (neighbouring block) — the interesting borderline cases.
    const same = rng() < 0.5;
    let target;
    if (same) {
      target = intToIp(net + randInt(rng, 1, size - 2));
    } else {
      const neighbour = rng() < 0.5 && net >= size ? net - size : net + size;
      target = intToIp(((neighbour >>> 0) + randInt(rng, 1, Math.max(1, size - 2))) >>> 0);
    }
    const isSame = networkOf(target, prefix) === intToIp(net);
    return {
      text: fmt(T.samenet, { ip, prefix, target }),
      fields: [{ key: "how", label: T.how, kind: "choice", options: [T.direct, T.gateway], answer: isSame ? T.direct : T.gateway }],
    };
  },

  ipv6short(rng, lang) {
    const T = texts(lang);
    const g = randomIpv6Groups(rng);
    return { text: fmt(T.ipv6short, { addr: ipv6Full(g) }), fields: [{ key: "short", label: T.shortForm, kind: "text", answer: ipv6Short(g) }] };
  },

  ipv6expand(rng, lang) {
    const T = texts(lang);
    const g = randomIpv6Groups(rng);
    return { text: fmt(T.ipv6expand, { addr: ipv6Short(g) }), fields: [{ key: "full", label: T.fullForm, kind: "text", answer: ipv6Full(g) }] };
  },

  subnet(rng, lang) {
    const T = texts(lang);
    const count = pick(rng, [2, 4, 4, 8]);
    const bits = Math.log2(count);
    const prefix = randInt(rng, 16, 30 - bits);
    const base = ipToInt(networkOf(randomIp(rng), prefix));
    const newPrefix = prefix + bits;
    const size = 2 ** (32 - newPrefix);
    /** @type {TaskField[]} */
    const fields = [
      { key: "prefix", label: T.newPrefix, kind: "num", answer: String(newPrefix) },
      { key: "mask", label: T.newMask, kind: "ip", answer: prefixToMask(newPrefix) },
    ];
    /** @type {string[][]} */
    const rows = [];
    for (let i = 0; i < count; i++) {
      const net = base + i * size;
      const label = fmt(T.subnetN, { n: i + 1 });
      fields.push({ key: `net${i}`, label: `${label}: ${T.network}`, kind: "ip", answer: intToIp(net) });
      fields.push({ key: `bc${i}`, label: `${label}: ${T.broadcast}`, kind: "ip", answer: intToIp(net + size - 1) });
      rows.push([String(i + 1), `net${i}`, `bc${i}`]);
    }
    return {
      text: fmt(T.subnet, { net: intToIp(base), prefix, count }),
      fields,
      table: { head: [T.subnetCol, T.network, T.broadcast], rows },
    };
  },
};
