import { describe, it, expect } from "vitest";
import { EthernetLink } from "../../src/net/EthernetLink.js";
import { EthernetPort } from "../../src/net/EthernetPort.js";

// Raw frame builders — only the bytes carriesTransportData() looks at.
const MACS = new Array(12).fill(0xaa);

/** @param {number} type @param {number[]} payload @param {boolean} [vlan] */
function eth(type, payload, vlan = false) {
  const tag = vlan ? [0x81, 0x00, 0x00, 0x14] : [];
  const bytes = [...MACS, ...tag, type >> 8, type & 0xff, ...payload];
  while (bytes.length < 60) bytes.push(0); // Ethernet minimum-frame padding
  return Uint8Array.from(bytes);
}
/** @param {number} proto @param {number[]} l4 */
function ipv4(proto, l4) {
  const total = 20 + l4.length;
  return [0x45, 0, total >> 8, total & 0xff, 0, 0, 0, 0, 64, proto, 0, 0, 10, 0, 0, 1, 10, 0, 0, 2, ...l4];
}
/** @param {number} next @param {number[]} l4 */
function ipv6(next, l4) {
  return [0x60, 0, 0, 0, l4.length >> 8, l4.length & 0xff, next, 64, ...new Array(32).fill(0), ...l4];
}
/** @param {number} dataLen */
const tcp = (dataLen) => [0, 80, 0xc0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0x50, 0x18, 0xff, 0xff, 0, 0, 0, 0, ...new Array(dataLen).fill(0x41)];
/** @param {number} dataLen */
const udp = (dataLen) => { const len = 8 + dataLen; return [0, 53, 0xc0, 0, len >> 8, len & 0xff, 0, 0, ...new Array(dataLen).fill(0x41)]; };

const ARP = eth(0x0806, new Array(28).fill(1));
const TCP_ACK = eth(0x0800, ipv4(6, tcp(0)));
const TCP_DATA = eth(0x0800, ipv4(6, tcp(5)));

describe("EthernetLink.carriesTransportData", () => {
  it("recognises TCP/UDP with payload over IPv4, IPv6 and 802.1Q", () => {
    expect(EthernetLink.carriesTransportData(TCP_DATA)).toBe(true);
    expect(EthernetLink.carriesTransportData(eth(0x0800, ipv4(17, udp(3))))).toBe(true);
    expect(EthernetLink.carriesTransportData(eth(0x86dd, ipv6(6, tcp(10))))).toBe(true);
    expect(EthernetLink.carriesTransportData(eth(0x0800, ipv4(6, tcp(5)), true))).toBe(true);
  });

  it("ignores bare ACKs (despite frame padding), empty datagrams, ARP and ICMP", () => {
    expect(EthernetLink.carriesTransportData(TCP_ACK)).toBe(false);
    expect(EthernetLink.carriesTransportData(eth(0x0800, ipv4(17, udp(0))))).toBe(false);
    expect(EthernetLink.carriesTransportData(ARP)).toBe(false);
    expect(EthernetLink.carriesTransportData(eth(0x0800, ipv4(1, new Array(8).fill(0))))).toBe(false);
  });
});

describe("EthernetLink drop pattern", () => {
  const makeLink = () => new EthernetLink(new EthernetPort("a"), new EthernetPort("b"));
  /** @param {EthernetLink} link @param {Uint8Array[]} frames @param {"ab"|"ba"} [dir] */
  const delivered = (link, frames, dir = "ab") => frames.map((f) => link._patternDrop(f, dir) !== null);

  it("drops exactly the n-th packet when 'every' is 0", () => {
    const link = makeLink();
    link.setDropPattern({ start: 3, every: 0, dir: "ab", count: "all" });
    expect(delivered(link, new Array(6).fill(TCP_DATA))).toEqual([true, true, false, true, true, true]);
    expect(link.dropStats.ab).toEqual({ counted: 6, dropped: 1 });
  });

  it("drops the n-th and then every k-th packet", () => {
    const link = makeLink();
    link.setDropPattern({ start: 2, every: 3, dir: "ab", count: "all" });
    expect(delivered(link, new Array(8).fill(TCP_DATA))).toEqual([true, false, true, true, false, true, true, false]);
  });

  it("only counts the chosen direction; 'both' keeps one counter per direction", () => {
    const link = makeLink();
    link.setDropPattern({ start: 1, every: 0, dir: "ba", count: "all" });
    expect(delivered(link, [TCP_DATA, TCP_DATA], "ab")).toEqual([true, true]);
    expect(delivered(link, [TCP_DATA, TCP_DATA], "ba")).toEqual([false, true]);

    link.setDropPattern({ start: 2, every: 0, dir: "both", count: "all" });
    expect(delivered(link, [TCP_DATA, TCP_DATA], "ab")).toEqual([true, false]);
    expect(delivered(link, [TCP_DATA, TCP_DATA], "ba")).toEqual([true, false]);
  });

  it("'data' lets ARP and bare ACKs through without counting them", () => {
    const link = makeLink();
    link.setDropPattern({ start: 2, every: 0, dir: "ab", count: "data" });
    expect(delivered(link, [ARP, TCP_ACK, TCP_DATA, TCP_ACK, TCP_DATA, TCP_DATA])).toEqual([true, true, true, true, false, true]);
    expect(link.dropStats.ab).toEqual({ counted: 3, dropped: 1 });
  });

  it("setting a new pattern restarts the counters; null turns it off", () => {
    const link = makeLink();
    link.setDropPattern({ start: 1, every: 0, dir: "ab", count: "all" });
    delivered(link, [TCP_DATA, TCP_DATA]);
    link.setDropPattern({ start: 1, every: 0, dir: "ab", count: "all" });
    expect(delivered(link, [TCP_DATA])).toEqual([false]);
    link.setDropPattern(null);
    expect(delivered(link, [TCP_DATA, TCP_DATA])).toEqual([true, true]);
  });
});
