//@ts-check

/**
 * OSI layer (1–7) or layer range [from, to] per top-level Wireshark dissector
 * filter name. BeaverTracer only ever emits traffic from its own closed protocol
 * set (src/net/pdu, src/apps), so this table doesn't need to cover arbitrary
 * real-world captures.
 *
 * Several protocols don't map 1:1 onto OSI — these are deliberate (didactic)
 * judgment calls, not bugs:
 *  - "frame" (Wireshark's synthetic capture-metadata node) → L1: it describes the
 *    frame as bits on the wire ("103 bytes on wire (824 bits)"), even though
 *    BeaverTracer doesn't simulate the physical layer itself.
 *  - ARP → 2/3: no IP header, but resolves IP addresses for L2 delivery.
 *  - TLS → 4/5: sits on top of TCP and manages a secured session.
 *  - Application protocols carried inside TLS (HTTPS, …) → 5–7, the classic
 *    DoD application layer — see osiLayersFor().
 *  - ICMPv4/v6, IGMP, GRE → L3, they ride directly as an IP payload.
 *  - Routing protocols follow one consistent rule: encapsulated directly in IP (no L4
 *    header) → L3 (OSPF, VRRP); riding inside TCP/UDP like any other app → L7 (BGP, RIP,
 *    RIPng). This produces the slightly surprising but structurally honest result that
 *    OSPF and BGP land on different layers despite both being "routing protocols".
 *  - "data" (undissected payload — MCHAT, echo servers, raw TCP) is Anwendungsschicht
 *    (L7) by the same rule as above: whatever's left after all lower-layer processing
 *    is, by definition, application data. The same holds for the body of an HTTP
 *    message, which Wireshark shows as its own node ("Line-based text data",
 *    images, JSON, …).
 *  - QUIC → 4/5 like TLS: a transport protocol (on UDP) with TLS 1.3 built in. The
 *    HTTP/3 it carries is encrypted; Wireshark only sees it with the keys.
 *  - Wireshark's "[n Reassembled TCP Segments]" node has no filter name — see
 *    osiLayersFor() for the label-based fallback (→ L4, it is TCP's own work).
 * @type {Record<string, number|[number, number]>}
 */
const OSI_LAYER_BY_FILTER = {
  // Bitübertragungsschicht (L1)
  frame: 1,
  // Sicherungsschicht (L2)
  eth: 2, vlan: 2, stp: 2, lldp: 2, lacp: 2,
  arp: [2, 3],
  // Vermittlungsschicht (L3)
  ip: 3, ipv4: 3, ipv6: 3, icmp: 3, icmpv6: 3, igmp: 3, gre: 3,
  ospf: 3, vrrp: 3,
  // Transportschicht (L4)
  tcp: 4, udp: 4,
  tls: [4, 5], ssl: [4, 5],
  // QUIC: transport with built-in TLS 1.3, carried in UDP
  quic: [4, 5],
  // Anwendungsschicht (L7)
  dns: 7, dhcp: 7, bootp: 7, dhcpv6: 7, http: 7, http2: 7, http3: 7,
  smtp: 7, pop: 7, imap: 7, irc: 7, bitcoin: 7, rip: 7, ripng: 7, bgp: 7,
  ntp: 7, data: 7,
  // HTTP message bodies, shown by Wireshark as separate nodes after "http"
  "data-text-lines": 7, media: 7, png: 7, "image-gif": 7, "image-jfif": 7,
  json: 7, xml: 7, "urlencoded-form": 7,
};

/**
 * OSI layer range of one top-level protocol node, or null if unmapped.
 * @param {string} filter dissector filter name, e.g. "eth"
 * @param {boolean} insideTls an earlier sibling in the same packet was TLS
 * @param {string} [label] the node's text — fallback for nodes without a filter name
 * @returns {[number, number]|null}
 */
export function osiLayersFor(filter, insideTls, label = "") {
  // "[3 Reassembled TCP Segments (2608 bytes): #2(1000), …]" carries no filter
  // name; TCP put those bytes back together, so it belongs to L4
  if (!filter && /Reassembled TCP Segments/i.test(label)) return [4, 4];
  const entry = OSI_LAYER_BY_FILTER[filter.toLowerCase()];
  if (entry === undefined) return null;
  const range = /** @type {[number, number]} */ (Array.isArray(entry) ? entry : [entry, entry]);
  if (insideTls && range[0] === 7) return [5, 7];
  return range;
}

/** @param {[number, number]} range e.g. [3,3] → "3", [2,3] → "2/3", [5,7] → "5–7" */
export function formatOsiLayers([from, to]) {
  if (from === to) return String(from);
  return to - from === 1 ? `${from}/${to}` : `${from}–${to}`;
}
