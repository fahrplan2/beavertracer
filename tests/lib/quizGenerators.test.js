import { describe, it, expect } from "vitest";
import {
  GENERATORS, intToIp, ipToInt, prefixToMask, hostCount, networkOf, broadcastOf, toBin8, normalizeAnswer, ipv6Short, ipv6Full,
} from "../../src/lib/quizGenerators.js";

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const field = (task, key) => task.fields.find((f) => f.key === key).answer;

describe("IPv4 helpers", () => {
  it("converts between dotted and integer form", () => {
    expect(intToIp(ipToInt("192.168.178.1"))).toBe("192.168.178.1");
    expect(ipToInt("0.0.0.1")).toBe(1);
    expect(intToIp(0xffffffff)).toBe("255.255.255.255");
  });

  it("computes masks and host counts", () => {
    expect(prefixToMask(8)).toBe("255.0.0.0");
    expect(prefixToMask(22)).toBe("255.255.252.0");
    expect(prefixToMask(27)).toBe("255.255.255.224");
    expect(hostCount(24)).toBe(254);
    expect(hostCount(30)).toBe(2);
  });

  it("matches the worked examples from the course material", () => {
    // 09 IP, S. 14: 194.9.190.12/27
    expect(networkOf("194.9.190.12", 27)).toBe("194.9.190.0");
    expect(broadcastOf("194.9.190.12", 27)).toBe("194.9.190.31");
    // 09 IP, Aufgabe 13 (Class A = /8)
    expect(networkOf("10.25.8.4", 8)).toBe("10.0.0.0");
    expect(broadcastOf("10.25.8.4", 8)).toBe("10.255.255.255");
    // 10 Subnetting: 10.16.0.0/12 → first /15
    expect(broadcastOf("10.16.0.0", 15)).toBe("10.17.255.255");
  });

  it("formats 8-bit binary", () => {
    expect(toBin8(5)).toBe("00000101");
    expect(toBin8(192)).toBe("11000000");
  });
});

describe("normalizeAnswer", () => {
  it("accepts IPs with leading zeros and spaces", () => {
    expect(normalizeAnswer("ip", " 192.168.001.010 ")).toBe("192.168.1.10");
  });
  it("accepts binary with spaces or without leading zeros", () => {
    expect(normalizeAnswer("bin", "1100 0000")).toBe("11000000");
    expect(normalizeAnswer("bin", "101")).toBe("00000101");
  });
  it("accepts numbers with separators and a leading slash", () => {
    expect(normalizeAnswer("num", "16.777.214")).toBe("16777214");
    expect(normalizeAnswer("num", "/24")).toBe("24");
  });
});

describe("generators", () => {
  it("every generator produces answerable tasks in de and en", () => {
    for (const [name, gen] of Object.entries(GENERATORS)) {
      for (const lang of ["de", "en"]) {
        const task = gen(rng(name.length), lang);
        expect(task.text.length, name).toBeGreaterThan(10);
        expect(task.text, name).not.toMatch(/\{\w+\}/);
        for (const f of task.fields) {
          expect(f.answer, `${name}.${f.key}`).not.toBe("");
          if (f.kind === "choice") expect(f.options, name).toContain(f.answer);
        }
      }
    }
  });

  it("bin2dec / dec2bin answers are consistent", () => {
    for (let s = 1; s < 50; s++) {
      const t1 = GENERATORS.bin2dec(rng(s), "de");
      const bin = t1.text.match(/[01]{8}/)[0];
      expect(Number(field(t1, "dec"))).toBe(parseInt(bin, 2));
      const t2 = GENERATORS.dec2bin(rng(s), "de");
      const dec = Number(t2.text.match(/\d+/)[0]);
      expect(parseInt(field(t2, "bin"), 2)).toBe(dec);
    }
  });

  it("netbcast: network ≤ first < last ≤ broadcast, host count matches", () => {
    for (let s = 1; s < 200; s++) {
      const t = GENERATORS.netbcast(rng(s), "de");
      const [, ip, prefix] = t.text.match(/(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
      const net = ipToInt(field(t, "network")), bc = ipToInt(field(t, "broadcast"));
      expect(net).toBeLessThanOrEqual(ipToInt(ip));
      expect(bc).toBeGreaterThanOrEqual(ipToInt(ip));
      expect(ipToInt(field(t, "first"))).toBe(net + 1);
      expect(ipToInt(field(t, "last"))).toBe(bc - 1);
      expect(Number(field(t, "hosts"))).toBe(bc - net - 1);
      expect(networkOf(ip, Number(prefix))).toBe(field(t, "network"));
    }
  });

  it("samenet: answer matches a real network comparison, both outcomes occur", () => {
    const seen = new Set();
    for (let s = 1; s < 200; s++) {
      const t = GENERATORS.samenet(rng(s), "de");
      const [, ip, prefix, target] = t.text.match(/(\d+\.\d+\.\d+\.\d+)\/(\d+) und will (\d+\.\d+\.\d+\.\d+)/);
      const same = networkOf(ip, Number(prefix)) === networkOf(target, Number(prefix));
      expect(field(t, "how")).toBe(same ? "direkt" : "über das Gateway");
      seen.add(same);
    }
    expect(seen.size).toBe(2);
  });

  it("subnet: subnets are contiguous, equally sized and cover the original network", () => {
    for (let s = 1; s < 200; s++) {
      const t = GENERATORS.subnet(rng(s), "de");
      const [, net, prefix, count] = t.text.match(/(\d+\.\d+\.\d+\.\d+)\/(\d+) in (\d+)/).map((x, i) => (i === 1 ? x : Number(x)));
      const newPrefix = Number(field(t, "prefix"));
      expect(newPrefix).toBe(prefix + Math.log2(count));
      expect(field(t, "mask")).toBe(prefixToMask(newPrefix));
      expect(field(t, "net0")).toBe(net);
      expect(field(t, `bc${count - 1}`)).toBe(broadcastOf(net, prefix));
      for (let i = 1; i < count; i++) {
        expect(ipToInt(field(t, `net${i}`))).toBe(ipToInt(field(t, `bc${i - 1}`)) + 1);
      }
    }
  });
});

describe("IPv6", () => {
  it("shortens according to RFC 5952", () => {
    expect(ipv6Short([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])).toBe("2001:db8::1");
    expect(ipv6Short([0xfe80, 0, 0, 0, 0xa828, 0x39ff, 0xfee2, 0x4182])).toBe("fe80::a828:39ff:fee2:4182");
    expect(ipv6Short([0x2001, 0xdb8, 0, 1, 0, 0, 0, 1])).toBe("2001:db8:0:1::1"); // single 0 group stays
    expect(ipv6Short([0, 0, 0, 0, 0, 0, 0, 1])).toBe("::1");
  });

  it("writes out all eight groups with four digits", () => {
    expect(ipv6Full([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
  });

  it("ipv6short / ipv6expand are inverse to each other", () => {
    for (let s = 1; s < 100; s++) {
      const t1 = GENERATORS.ipv6short(rng(s), "de");
      const full = t1.text.match(/[0-9a-f:]{39}/)[0];
      expect(full.split(":").length).toBe(8);
      expect(field(t1, "short")).toContain("::");
      const t2 = GENERATORS.ipv6expand(rng(s), "de");
      expect(field(t2, "full")).toMatch(/^([0-9a-f]{4}:){7}[0-9a-f]{4}$/);
    }
  });
});
