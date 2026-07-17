//@ts-check

/** @typedef {{ type: "stdoutOverwrite", path: string }} RedirectStdoutOverwrite */
/** @typedef {{ type: "stdoutAppend", path: string }} RedirectStdoutAppend */
/** @typedef {{ type: "stderrOverwrite", path: string }} RedirectStderrOverwrite */
/** @typedef {{ type: "stderrAppend", path: string }} RedirectStderrAppend */
/** @typedef {{ type: "stderrToStdout" }} RedirectStderrToStdout */
/** @typedef {{ type: "stdin", path: string }} RedirectStdin */
/**
 * @typedef {RedirectStdoutOverwrite|RedirectStdoutAppend|RedirectStderrOverwrite|RedirectStderrAppend|RedirectStderrToStdout|RedirectStdin} Redirect
 */

/**
 * @typedef {{ cmd: string, args: string[], redirects: Redirect[] }} Stage
 */

/**
 * Tokenizes a shell line into words and operator tokens.
 * Supports single/double quotes (no escapes, matching the previous parser).
 * Recognized operators (outside quotes): | >> > < 2>&1 2>> 2>
 * @param {string} line
 * @returns {Array<{ type: "word"|"op", value: string }>}
 */
function tokenize(line) {
  /** @type {Array<{ type: "word"|"op", value: string }>} */
  const tokens = [];
  let cur = "";
  let curHasContent = false;
  /** @type {null | "'" | '"'} */
  let quote = null;

  const flushWord = () => {
    if (curHasContent) {
      tokens.push({ type: "word", value: cur });
      cur = "";
      curHasContent = false;
    }
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      curHasContent = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      curHasContent = true;
      continue;
    }

    if (/\s/.test(ch)) {
      flushWord();
      continue;
    }

    // Operators are only recognized at a token boundary (start of a new word),
    // never in the middle of a word already being accumulated.
    if (!curHasContent) {
      if (ch === "|") { tokens.push({ type: "op", value: "|" }); continue; }

      if (ch === ">") {
        if (line[i + 1] === ">") { tokens.push({ type: "op", value: ">>" }); i++; continue; }
        tokens.push({ type: "op", value: ">" });
        continue;
      }

      if (ch === "<") { tokens.push({ type: "op", value: "<" }); continue; }

      if (ch === "2" && line[i + 1] === ">") {
        if (line[i + 2] === "&" && line[i + 3] === "1") { tokens.push({ type: "op", value: "2>&1" }); i += 3; continue; }
        if (line[i + 2] === ">") { tokens.push({ type: "op", value: "2>>" }); i += 2; continue; }
        tokens.push({ type: "op", value: "2>" });
        i += 1;
        continue;
      }
    }

    cur += ch;
    curHasContent = true;
  }

  flushWord();
  return tokens;
}

/**
 * Parses a raw command line into a pipeline of stages connected by `|`,
 * each carrying its own ordered list of redirects (>, >>, 2>, 2>>, 2>&1, <).
 * A line with no operators degenerates to a single stage with no redirects.
 * @param {string} line
 * @returns {Stage[]}
 */
export function parsePipeline(line) {
  const tokens = tokenize(line);

  /** @type {Stage[]} */
  const stages = [];

  /** @type {string[]} */
  let words = [];
  /** @type {Redirect[]} */
  let redirects = [];

  const pushStage = () => {
    const cmd = words[0] ?? "";
    const args = words.slice(1);
    stages.push({ cmd, args, redirects });
    words = [];
    redirects = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === "word") {
      words.push(tok.value);
      continue;
    }

    // operator token
    switch (tok.value) {
      case "|":
        pushStage();
        break;

      case "2>&1":
        redirects.push({ type: "stderrToStdout" });
        break;

      case ">":
      case ">>":
      case "2>":
      case "2>>":
      case "<": {
        const next = tokens[i + 1];
        const path = next && next.type === "word" ? next.value : "";
        if (next && next.type === "word") i++;

        if (tok.value === ">") redirects.push({ type: "stdoutOverwrite", path });
        else if (tok.value === ">>") redirects.push({ type: "stdoutAppend", path });
        else if (tok.value === "2>") redirects.push({ type: "stderrOverwrite", path });
        else if (tok.value === "2>>") redirects.push({ type: "stderrAppend", path });
        else redirects.push({ type: "stdin", path });
        break;
      }
    }
  }

  pushStage();

  return stages;
}

export {};
