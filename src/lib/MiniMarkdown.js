//@ts-check

export class MiniMarkdown {
  /** Escape HTML so users cannot inject tags/scripts. */
  static escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /**
   * Inline mini-markdown (single line / cell):
   * - `code`
   * - **bold**
   * - *italic* / _italic_
   *
   * NOTE: Does NOT convert newlines; caller decides.
   */
  static renderInline(md) {
    let s = MiniMarkdown.escapeHtml(md);

    // code first
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");

    // bold
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // italic: *text* (avoid matching **bold**)
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

    // italic: _text_
    s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");

    return s;
  }

  /* -------------------- Headings -------------------- */

  static _headingLevel(line) {
    // Allow up to 3 leading spaces; support #, ##, ### only
    const m = /^\s{0,3}(#{1,3})\s+\S/.exec(String(line));
    if (!m) return 0;
    return m[1].length;
  }

  static _parseHeading(block) {
    const lines = String(block).split(/\r?\n/);
    const first = lines[0] ?? "";
    const level = MiniMarkdown._headingLevel(first);
    const title = first.replace(/^\s{0,3}#{1,3}\s+/, "").trimEnd();
    const rest = lines.slice(1).join("\n").trim();
    return { level, title, rest };
  }

  /* -------------------- Lists -------------------- */

  static _isUlItemLine(line) {
    // "- item" or "* item" (CommonMark-ish, no nesting)
    return /^\s{0,3}[-*]\s+\S/.test(String(line));
  }

  static _looksLikeUl(block) {
    const lines = String(block)
      .split(/\r?\n/)
      .map(l => l.trimEnd())
      .filter(l => l.trim().length > 0);

    if (lines.length === 0) return false;

    // All non-empty lines must be list items (keep it "mini")
    return lines.every(l => MiniMarkdown._isUlItemLine(l));
  }

  static _parseUl(block) {
    const lines = String(block)
      .split(/\r?\n/)
      .map(l => l.trimEnd())
      .filter(l => l.trim().length > 0);

    return lines.map(l => l.replace(/^\s{0,3}[-*]\s+/, ""));
  }

  static renderUl(block) {
    const items = MiniMarkdown._parseUl(block);
    const lis = items
      .map(item => `<li class="minimarkdown-li">${MiniMarkdown.renderInline(item)}</li>`)
      .join("");
    return `<ul class="minimarkdown-ul">${lis}</ul>`;
  }

  /* -------------------- Tables -------------------- */

  static _normalizeTableLine(line) {
    let s = String(line).trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.trim();
  }

  static _splitRow(line) {
    const s = MiniMarkdown._normalizeTableLine(line);
    return s.split("|").map(c => c.trim());
  }

  static _isSepLine(line) {
    // ignore separator lines like ---|---|--- or :---|---:
    return /^[\-\s\|:]+$/.test(line) && line.includes("|");
  }

  /**
   * Table heuristic for a block:
   * - at least 2 non-empty lines
   * - ignore separator lines (---|---)
   * - remaining lines: all contain '|'
   * - first 2 content lines have >=2 columns
   */
  static looksLikePipeTable(block) {
    const lines = String(block)
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length < 2) return false;

    const content = lines.filter(l => !MiniMarkdown._isSepLine(l));
    if (content.length < 2) return false;

    if (!content.every(l => l.includes("|"))) return false;

    const a = MiniMarkdown._splitRow(content[0]);
    const b = MiniMarkdown._splitRow(content[1]);
    return a.length >= 2 && b.length >= 2;
  }

  static parsePipeTable(block) {
    const lines = String(block)
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const content = lines.filter(l => !MiniMarkdown._isSepLine(l));
    return content.map(MiniMarkdown._splitRow);
  }

  /**
   * Renders a pipe table block as HTML, applying inline markdown per cell.
   * @param {string} block
   */
  static renderTable(block) {
    const rows = MiniMarkdown.parsePipeTable(block);
    if (rows.length < 2) {
      // fallback
      return `<div class="minimarkdown-paragraph">${
        MiniMarkdown.renderInline(block).replace(/\r?\n/g, "<br>")
      }</div>`;
    }

    const head = rows[0] ?? [];
    const bodyRows = rows.slice(1);

    const maxCols = Math.max(0, ...rows.map(r => r.length));
    const pad = (r) => {
      const out = r.slice();
      while (out.length < maxCols) out.push("");
      return out;
    };

    const ths = pad(head).map(c => `<th>${MiniMarkdown.renderInline(c)}</th>`).join("");

    const trs = bodyRows.map(r => {
      const tds = pad(r).map(c => `<td>${MiniMarkdown.renderInline(c)}</td>`).join("");
      return `<tr>${tds}</tr>`;
    }).join("");

    return `
      <table class="minimarkdown-table">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    `;
  }

  /* -------------------- Full Render -------------------- */

  static _renderParagraph(block) {
    return `<div class="minimarkdown-paragraph">${
      MiniMarkdown.renderInline(block).replace(/\r?\n/g, "<br>")
    }</div>`;
  }

  static _renderHeading(level, title) {
    const cls = level === 1 ? "minimarkdown-h1" : level === 2 ? "minimarkdown-h2" : "minimarkdown-h3";
    const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
    return `<${tag} class="${cls}">${MiniMarkdown.renderInline(title)}</${tag}>`;
  }

  static _renderBlock(block) {
    const firstLine = String(block).split(/\r?\n/, 1)[0] ?? "";

    // Headings (#, ##, ###)
    const level = MiniMarkdown._headingLevel(firstLine);
    if (level >= 1 && level <= 3) {
      const { title, rest } = MiniMarkdown._parseHeading(block);
      const h = MiniMarkdown._renderHeading(level, title);
      if (!rest) return h;
      // Render the rest with the full renderer so it can become list/table/etc.
      return h + MiniMarkdown.render(rest);
    }

    // Unordered list
    if (MiniMarkdown._looksLikeUl(block)) return MiniMarkdown.renderUl(block);

    // Table
    if (MiniMarkdown.looksLikePipeTable(block)) return MiniMarkdown.renderTable(block);

    // Paragraph fallback
    return MiniMarkdown._renderParagraph(block);
  }

  /**
   * Full renderer supporting mixed text + multiple tables + headings + ul lists.
   * Splits by blank lines into blocks.
   *
   * @param {string} text
   * @returns {string} HTML
   */
  static render(text) {
    const blocks = String(text)
      .split(/\n\s*\n/g) // blank line separator
      .map(b => b.trim())
      .filter(b => b.length > 0);

    return blocks.map(MiniMarkdown._renderBlock).join("");
  }
}
