// Sequence ("ladder") diagrams for lessons — ":::seq" / ":::quiz seq".
//
// Two lifelines, one diagonal arrow per segment, labelled with the flags,
// SEQ/ACK numbers and an abstract DATA marker; each host's own (relative)
// sequence counter runs along its lifeline. Numbers are computed from the
// flags and payloads, so a diagram can't contain arithmetic mistakes:
//
//   :::seq
//   Client -> Server: SYN
//   Server -> Client: SYN, ACK
//   Client -> Server: ACK
//   Client -> Server: PSH, ACK "Hello World"
//   Client -x Server: PSH, ACK "lost"          ← -x = segment gets lost
//   Client -> Server: PSH, ACK "lost" seq=12   ← seq=/ack=/len= override
//   :::
//
// ":::quiz seq" turns "?" (flags, seq=?, ack=?) into answer fields that are
// evaluated like a fill quiz. An option line "hide: counters, seq, ack,
// flags" hides/asks those parts everywhere.
//
// Rendered at build time as HTML + inline SVG on a fixed 600-unit grid; the
// HTML labels are positioned in % and sized in container units, so the
// whole diagram scales like one picture (see .seq-diagram in the CSS).

const W = 600;
const X = [150, 450];          // lifelines
const HEAD = 44;               // participant boxes
const PITCH = 70;              // vertical distance between arrows
const DROP = 26;               // how far an arrow descends (transit time)
const LOST_AT = 0.8;           // lost arrows end here (fraction of the way)

/** @param {string} s */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Canonical form of a flag list: "ack, syn" / "SYN+ACK" → "ACK,SYN". @param {string} s */
export function normalizeFlags(s) {
  return String(s).toUpperCase().split(/[\s,+/]+/).filter(Boolean).sort().join(",");
}

/**
 * @typedef {{ from: number, to: number, lost: boolean, flags: string, label: string, askFlags: boolean,
 *   data: string|null, len: number, seq: number, ack: number|null, askSeq: boolean, askAck: boolean,
 *   counterFrom: number, counterTo: number|null }} SeqMessage
 */

/**
 * Parses the block and computes all numbers.
 * @param {string} content
 * @returns {{ names: string[], messages: SeqMessage[], hide: Set<string> }}
 */
export function parseSeq(content) {
  /** @type {string[]} */
  const names = [];
  const hide = new Set();
  /** @type {SeqMessage[]} */
  const messages = [];
  const next = [0, 0];                 // own next sequence number
  /** @type {(number|null)[]} */
  const expect = [null, null];         // next byte expected from the other side
  /** @type {{seq: number, end: number}[][]} */
  const ooo = [[], []];                // received out of order, per receiver

  const idx = (/** @type {string} */ name) => {
    let i = names.indexOf(name);
    if (i < 0) {
      if (names.length >= 2) throw new Error(`:::seq supports two participants, got a third: "${name}"`);
      names.push(name);
      i = names.length - 1;
    }
    return i;
  };

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const opt = line.match(/^hide\s*:\s*(.+)$/i);
    if (opt) { for (const h of opt[1].split(/[\s,]+/)) if (h) hide.add(h.toLowerCase()); continue; }
    const m = line.match(/^(.+?)\s*(->|-x)\s*(.+?)\s*:\s*(.*)$/);
    if (!m) throw new Error(`:::seq: can't read line "${line}"`);
    const from = idx(m[1]), to = idx(m[3]);
    if (from === to) throw new Error(`:::seq: arrow from "${m[1]}" to itself`);
    let rest = m[4];

    let data = null;
    rest = rest.replace(/"((?:[^"\\]|\\.)*)"/, (_, d) => { data = d.replace(/\\(.)/g, "$1"); return " "; });
    /** @type {Record<string, string>} */
    const kv = {};
    rest = rest.replace(/\b(seq|ack|len)\s*=\s*(\?|\d+)/gi, (_, k, v) => { kv[k.toLowerCase()] = v; return " "; });
    const flagText = rest.trim();
    const askFlags = flagText === "?";
    const flags = askFlags ? "" : normalizeFlags(flagText);
    // shown as written ("SYN, ACK" like Wireshark), compared normalized
    const label = flagText.toUpperCase().split(/[\s,+/]+/).filter(Boolean).join(", ");
    if (askFlags) throw new Error(`:::seq: "?" for the flags needs the real flags too, e.g. "? SYN, ACK"`);

    const flagList = flags.split(",");
    const syn = flagList.includes("SYN"), fin = flagList.includes("FIN"), hasAck = flagList.includes("ACK");
    const len = kv.len && kv.len !== "?" ? Number(kv.len) : (data != null ? new TextEncoder().encode(data).length : 0);
    const seq = kv.seq && kv.seq !== "?" ? Number(kv.seq) : next[from];
    const ack = hasAck ? (kv.ack && kv.ack !== "?" ? Number(kv.ack) : (expect[from] ?? 0)) : null;
    const consumes = len + (syn ? 1 : 0) + (fin ? 1 : 0);
    next[from] = Math.max(next[from], seq + consumes);

    const lost = m[2] === "-x";
    if (!lost) {
      if (syn && expect[to] == null) expect[to] = seq;
      if (expect[to] != null) {
        if (seq === expect[to]) {
          expect[to] = seq + consumes;
          // drain segments that arrived earlier, out of order
          let progressed = true;
          while (progressed) {
            progressed = false;
            for (const [i, b] of ooo[to].entries()) {
              if (b.seq <= /** @type {number} */ (expect[to])) {
                expect[to] = Math.max(/** @type {number} */ (expect[to]), b.end);
                ooo[to].splice(i, 1);
                progressed = true;
                break;
              }
            }
          }
        } else if (seq > expect[to]) {
          ooo[to].push({ seq, end: seq + consumes });
        }
      }
    }

    messages.push({
      from, to, lost, flags, label, askFlags: false, data, len, seq, ack,
      askSeq: kv.seq === "?", askAck: kv.ack === "?",
      counterFrom: seq,
      counterTo: lost ? null : next[to],
    });
  }
  if (names.length < 2) throw new Error(":::seq needs arrows between two participants");
  return { names, messages, hide };
}

/**
 * Answer field for a quiz diagram (same markup as a fill-quiz gap).
 * @param {string[]} answers @param {number} size @param {string} [kind]
 */
function gap(answers, size, kind = "") {
  const attr = esc(JSON.stringify(answers.map((a) => a.toLowerCase())));
  return `<span class="quiz-gap"><input type="text" class="quiz-gap-input" data-answers="${attr}"${kind ? ` data-kind="${kind}"` : ""} placeholder="…" size="${size}" autocomplete="off" spellcheck="false"><span class="quiz-feedback" aria-hidden="true"></span></span>`;
}

/**
 * Renders a sequence diagram (or, with quiz=true, its quiz version).
 * @param {string} content block body
 * @param {{ quiz?: boolean, id?: string }} [opts]
 */
export function renderSeqDiagram(content, { quiz = false, id = "" } = {}) {
  // "? SYN, ACK" = ask for these flags (only in quiz blocks)
  const askedFlags = [];
  const prepared = content.split("\n").map((l) => {
    const mm = l.match(/^(.+?(?:->|-x).+?:\s*)\?\s+(.*)$/);
    if (!mm) { askedFlags.push(false); return l; }
    askedFlags.push(true);
    return mm[1] + mm[2];
  });
  const { names, messages, hide } = parseSeq(prepared.join("\n"));
  const lineAsk = askedFlags.filter((_, i) => /(?:->|-x)/.test(prepared[i]) && prepared[i].trim());
  messages.forEach((m, i) => { m.askFlags = quiz && (lineAsk[i] || hide.has("flags")); });
  if (quiz) for (const m of messages) { if (hide.has("seq")) m.askSeq = true; if (hide.has("ack") && m.ack != null) m.askAck = true; }
  if (!quiz) for (const m of messages) { m.askSeq = false; m.askAck = false; }

  const H = HEAD + 30 + messages.length * PITCH + 16;
  const pct = (/** @type {number} */ v, /** @type {number} */ of) => `${((v / of) * 100).toFixed(3)}%`;
  const at = (/** @type {number} */ x, /** @type {number} */ y) => `left:${pct(x, W)};top:${pct(y, H)}`;

  let svg = "";
  let html = "";

  // participants + lifelines
  names.forEach((name, i) => {
    svg += `<line class="seq-life seq-p${i}" x1="${X[i]}" y1="${HEAD}" x2="${X[i]}" y2="${H - 6}"/>`;
    html += `<div class="seq-head seq-p${i}" style="${at(X[i], HEAD / 2)}">${esc(name)}</div>`;
  });

  messages.forEach((m, i) => {
    const y1 = HEAD + 30 + i * PITCH + 18;
    const y2 = y1 + DROP;
    const x1 = X[m.from], xEnd = X[m.to];
    const x2 = m.lost ? x1 + (xEnd - x1) * LOST_AT : xEnd;
    const yEnd = m.lost ? y1 + DROP * LOST_AT : y2;
    const dir = Math.sign(xEnd - x1);
    // arrow line + head (head drawn as a polygon along the line direction)
    const ang = Math.atan2(yEnd - y1, x2 - x1);
    const hx = (/** @type {number} */ d, /** @type {number} */ o) => (x2 - d * Math.cos(ang) + o * Math.sin(ang)).toFixed(1);
    const hy = (/** @type {number} */ d, /** @type {number} */ o) => (yEnd - d * Math.sin(ang) - o * Math.cos(ang)).toFixed(1);
    svg += `<g class="seq-msg seq-from-p${m.from}${m.lost ? " seq-lost" : ""}">`;
    svg += `<line x1="${x1}" y1="${y1}" x2="${m.lost ? x2 : (x2 - 9 * Math.cos(ang)).toFixed(1)}" y2="${m.lost ? yEnd : (yEnd - 9 * Math.sin(ang)).toFixed(1)}"/>`;
    if (m.lost) {
      svg += `<path class="seq-x" d="M${x2 - 7} ${yEnd - 7} L${x2 + 7} ${yEnd + 7} M${x2 + 7} ${yEnd - 7} L${x2 - 7} ${yEnd + 7}"/>`;
    } else {
      svg += `<polygon points="${x2},${yEnd} ${hx(11, 5)},${hy(11, 5)} ${hx(11, -5)},${hy(11, -5)}"/>`;
    }
    svg += `</g>`;

    // label above the arrow's middle
    const flagsHtml = m.askFlags ? gap([m.flags], 9, "flags") : esc(m.label);
    const seqHtml = m.askSeq ? gap([String(m.seq)], 4) : `<span class="seq-num seq-p${m.from}">${m.seq}</span>`;
    const ackHtml = m.ack == null ? "" : ` <span class="seq-field">ACK=${m.askAck ? gap([String(m.ack)], 4) : `<span class="seq-num seq-p${m.to}">${m.ack}</span>`}</span>`;
    const dataHtml = m.len > 0 ? ` <span class="seq-data">DATA</span> <span class="seq-len">Len=${m.len}</span>` : "";
    // Centred on the arrow and tilted with it, the arrow running between
    // the two lines. Leftward arrows tilt the other way so text stays upright.
    const mid = (x1 + xEnd) / 2;
    const tilt = (Math.atan2(DROP, Math.abs(xEnd - x1)) * 180 / Math.PI) * dir;
    html += `<div class="seq-label${m.lost ? " seq-lost" : ""}" style="${at(mid, y1 + DROP / 2)};--seq-tilt:${tilt.toFixed(2)}deg">`
      + `<div class="seq-flags">${flagsHtml}</div>`
      + `<div class="seq-fields"><span class="seq-field">SEQ=${seqHtml}</span>${ackHtml}${dataHtml}</div></div>`;

    // own sequence counters where the arrow meets the lifelines
    if (!hide.has("counters")) {
      const side = (/** @type {number} */ p) => (p === 0 ? "seq-left" : "seq-right");
      html += `<div class="seq-counter seq-p${m.from} ${side(m.from)}" style="${at(X[m.from], y1)}">${m.counterFrom}</div>`;
      if (m.counterTo != null) html += `<div class="seq-counter seq-p${m.to} ${side(m.to)}" style="${at(X[m.to], y2)}">${m.counterTo}</div>`;
    }
  });

  const body = `<div class="seq-diagram" style="aspect-ratio:${W}/${H}">`
    + `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${svg}</svg>${html}</div>`;
  const diagram = `<div class="seq-scroll">${body}</div>`;
  return quiz
    ? `<div class="quiz-block quiz-fill seq-quiz" data-quiz-id="${id}" data-type="fill">${diagram}</div>`
    : diagram;
}
