//@ts-check

const CHAIN_OPERATORS = new Set(["|", ";", "&&", "||"]);

/**
 * Quote-aware (no escaping/expansion) word scanner for the text before the
 * cursor: returns the word currently being typed (possibly empty) plus every
 * complete word before it - enough to decide whether we're at a command
 * position (start of a stage) or an argument/path position.
 * @param {string} head
 * @returns {{ typed: string, priorWords: string[] }}
 */
export function scanWords(head) {
  /** @type {string[]} */
  const words = [];
  let cur = "";
  let has = false;
  /** @type {null | "'" | '"'} */
  let quote = null;

  for (const ch of head) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      has = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (has) {
        words.push(cur);
        cur = "";
        has = false;
      }
      continue;
    }

    cur += ch;
    has = true;
  }

  return { typed: cur, priorWords: words };
}

/**
 * @param {string[]} names
 * @returns {string}
 */
export function longestCommonPrefix(names) {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/**
 * @typedef {{
 *   resolve: (cwd: string, path: string) => string,
 *   exists: (path: string) => boolean,
 *   stat: (path: string) => { type: "file"|"dir" },
 *   readdir: (path: string) => string[],
 * }} CompletionFs
 */

/**
 * Computes tab-completion candidates for the text before the cursor.
 * Returns null when there's nothing sensible to complete (empty command
 * prefix, missing directory, ...).
 * @param {string} head text before the cursor
 * @param {{ commandNames: string[], cwd: string, fs: CompletionFs|null|undefined }} ctx
 * @returns {{ prefix: string, names: string[], trailingFor: (name: string) => string } | null}
 */
export function computeCompletions(head, { commandNames, cwd, fs }) {
  const { typed, priorWords } = scanWords(head);
  const lastPrior = priorWords[priorWords.length - 1];
  const atCommandPosition = priorWords.length === 0 || CHAIN_OPERATORS.has(lastPrior);

  if (atCommandPosition) {
    if (!typed) return null;
    const names = commandNames.filter((n) => n.startsWith(typed)).sort();
    if (names.length === 0) return null;
    return { prefix: typed, names, trailingFor: () => " " };
  }

  if (!fs) return null;

  const slash = typed.lastIndexOf("/");
  const dirPart = slash >= 0 ? typed.slice(0, slash + 1) : "";
  const basePart = slash >= 0 ? typed.slice(slash + 1) : typed;

  const absDir = fs.resolve(cwd, dirPart || ".");
  if (!fs.exists(absDir) || fs.stat(absDir).type !== "dir") return null;

  const showHidden = basePart.startsWith(".");

  /** @type {Map<string, boolean>} */
  const isDirByName = new Map();
  for (const name of fs.readdir(absDir)) {
    if (!showHidden && name.startsWith(".")) continue;
    if (!name.startsWith(basePart)) continue;

    let isDir = false;
    try { isDir = fs.stat(fs.resolve(absDir, name)).type === "dir"; } catch { /* broken entry */ }
    isDirByName.set(name, isDir);
  }

  const names = [...isDirByName.keys()];
  if (names.length === 0) return null;

  return {
    prefix: basePart,
    names,
    trailingFor: (name) => (isDirByName.get(name) ? "/" : " "),
  };
}

export {};
