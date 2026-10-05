import { describe, it, expect } from "vitest";
import { parseSeq, renderSeqDiagram, normalizeFlags } from "../../lessons-seq-diagram.mjs";

const HANDSHAKE = `
Client -> Server: SYN
Server -> Client: SYN, ACK
Client -> Server: ACK
`;

/** @param {string} src */
const nums = (src) => parseSeq(src).messages.map((m) => [m.seq, m.ack]);

describe(":::seq numbering", () => {
  it("handshake: SYN consumes one sequence number on each side", () => {
    expect(nums(HANDSHAKE)).toEqual([[0, null], [0, 1], [1, 1]]);
  });

  it("data advances SEQ by its length, the reply ACKs it", () => {
    const { messages } = parseSeq(HANDSHAKE + `
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK
`);
    expect(messages[3]).toMatchObject({ seq: 1, ack: 1, len: 11 });
    expect(messages[4]).toMatchObject({ seq: 1, ack: 12 });
  });

  it("FIN consumes one number; the four-way close", () => {
    expect(nums(HANDSHAKE + `
Client -> Server: FIN, ACK
Server -> Client: ACK
Server -> Client: FIN, ACK
Client -> Server: ACK
`).slice(3)).toEqual([[1, 1], [1, 2], [1, 2], [2, 2]]);
  });

  it("a lost segment isn't acknowledged until it's retransmitted", () => {
    const { messages } = parseSeq(HANDSHAKE + `
Client -> Server: PSH, ACK "aaaaa"
Client -x Server: PSH, ACK "bbbbb"
Client -> Server: PSH, ACK "ccccc"
Server -> Client: ACK
Client -> Server: PSH, ACK "bbbbb" seq=6
Server -> Client: ACK
`);
    expect(messages[4]).toMatchObject({ lost: true, seq: 6 });
    expect(messages[5].seq).toBe(11);
    expect(messages[6].ack).toBe(6);    // still waiting for byte 6
    expect(messages[8].ack).toBe(16);   // gap filled: everything at once
  });

  it("counters: the sender's SEQ at the start, the receiver's own counter at the end", () => {
    const { messages } = parseSeq(HANDSHAKE);
    expect(messages.map((m) => [m.counterFrom, m.counterTo])).toEqual([[0, 0], [0, 1], [1, 1]]);
  });

  it("keeps the flags as written for display", () => {
    expect(parseSeq(HANDSHAKE).messages[1].label).toBe("SYN, ACK");
    expect(normalizeFlags("ack, syn")).toBe(normalizeFlags("SYN+ACK"));
  });

  it("rejects a third participant and unreadable lines", () => {
    expect(() => parseSeq(HANDSHAKE + "Client -> Proxy: ACK")).toThrow(/third/);
    expect(() => parseSeq("Client to Server")).toThrow(/can't read/);
  });
});

describe(":::quiz seq", () => {
  it("turns ? into answer fields with the computed values", () => {
    const html = renderSeqDiagram(`
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
`, { quiz: true, id: "q1" });
    expect(html).toContain('data-type="fill"');
    expect(html).toMatch(/data-answers="\[&quot;ack,syn&quot;\]" data-kind="flags"/);
    expect(html).toMatch(/data-answers="\[&quot;1&quot;\]"/);
  });

  it("shows no fields outside quiz blocks", () => {
    expect(renderSeqDiagram(HANDSHAKE + "Client -> Server: PSH, ACK \"x\" seq=?")).not.toContain("quiz-gap-input");
  });
});

describe(":::seq mode: text", () => {
  const SRC = `
mode: text
PC -> DHCP-Server: DHCP Discover | Broadcast
DHCP-Server -> PC: DHCP Offer | 192.168.0.100
`;
  it("keeps free labels as written and computes no numbers", () => {
    const { messages, textMode } = parseSeq(SRC);
    expect(textMode).toBe(true);
    expect(messages.map((m) => [m.label, m.sub])).toEqual([["DHCP Discover", "Broadcast"], ["DHCP Offer", "192.168.0.100"]]);
    const html = renderSeqDiagram(SRC);
    expect(html).toContain("DHCP Discover");
    expect(html).not.toContain("SEQ=");
    expect(html).not.toContain("seq-counter");
  });

  it("asks for a label in quiz mode", () => {
    const html = renderSeqDiagram(SRC.replace("PC: DHCP Offer", "PC: ? DHCP Offer"), { quiz: true, id: "q1" });
    expect(html).toMatch(/data-answers="\[&quot;dhcp offer&quot;\]"/);
  });
});
