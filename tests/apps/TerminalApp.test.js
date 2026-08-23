//@ts-check

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalApp } from '../../src/apps/TerminalApp.js';
import { VirtualFileSystem } from '../../src/apps/lib/VirtualFileSystem.js';

// ── Minimal DOM stub ──────────────────────────────────────────────────────────
// Unlike the other App tests' inert stub, _paintRows()/_renderScreen() actually
// need appendChild/replaceChildren to track children so we can assert on the
// rendered <span class="term-stderr"> runs.

/** @param {string} tag */
function makeFakeEl(tag) {
  /** @type {any} */
  const el = {
    tagName: tag,
    className: '',
    textContent: '',
    style: {},
    children: /** @type {any[]} */ ([]),
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    remove() {},
    contains() { return false; },
    appendChild(/** @type {any} */ child) { el.children.push(child); return child; },
    replaceChildren(/** @type {any[]} */ ...nodes) {
      /** @type {any[]} */
      const flat = [];
      for (const n of nodes) {
        if (n && n.__fragment) flat.push(...n.children);
        else flat.push(n);
      }
      el.children = flat;
    },
    get scrollTop() { return 0; },
    set scrollTop(_v) {},
    get scrollHeight() { return 0; },
  };
  return el;
}

if (!globalThis.document) {
  // @ts-ignore
  globalThis.document = {
    createElement: (/** @type {string} */ tag) => makeFakeEl(tag),
    createTextNode: (/** @type {string} */ text) => ({ nodeType: 3, textContent: text }),
    createDocumentFragment: () => ({ __fragment: true, children: /** @type {any[]} */ ([]), appendChild(/** @type {any} */ child) { this.children.push(child); } }),
    documentElement: { lang: '' },
  };
}
if (!globalThis.window) {
  // @ts-ignore
  globalThis.window = { matchMedia: () => ({ matches: false }), getSelection: () => ({ isCollapsed: true, toString: () => '' }) };
}

/**
 * Flattens outEl's rendered children into plain text, wrapping stderr runs
 * (spans with class "term-stderr") in <<>> markers so tests can assert on
 * which parts of the output were colored red without a real DOM. The
 * underlying screen is a fixed rows×cols grid space-padded to full width,
 * so trailing padding/blank rows are trimmed to compare against what a
 * user would actually perceive.
 * @param {any} outEl
 */
function renderedText(outEl) {
  const raw = outEl.children
    .map((/** @type {any} */ node) => {
      if (node.nodeType === 3) return node.textContent;
      if (node.className === 'term-stderr') return `<<${node.textContent}>>`;
      return node.textContent ?? '';
    })
    .join('');

  return raw
    .split('\n')
    .map((line) => line.replace(/ +$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');
}

describe('TerminalApp (end-to-end through the real command registry)', () => {
  /** @type {TerminalApp} */
  let app;
  /** @type {VirtualFileSystem} */
  let fs;

  beforeEach(() => {
    fs = new VirtualFileSystem();
    const os = /** @type {any} */ ({ name: 'TestOS', fs, exit() {} });

    app = new TerminalApp(os);
    app._registerBuiltins();
    app._resetScreen();
    app.outEl = makeFakeEl('pre');
    app.busy = true; // skip prompt/cursor overlay so rendered output is exactly the command output
  });

  /** @param {string} line */
  async function run(line) {
    app.currentAbort = new AbortController();
    app.interruptHandlers = [];
    await app._handleLine(line);
  }

  it('writes stdout to a file with >, overwriting on repeat', async () => {
    await run('echo hallo > /home/a.txt');
    expect(fs.readFile('/home/a.txt')).toBe('hallo\n');

    await run('echo nochmal > /home/a.txt');
    expect(fs.readFile('/home/a.txt')).toBe('nochmal\n');
  });

  it('appends with >>', async () => {
    await run('echo eins > /home/a.txt');
    await run('echo zwei >> /home/a.txt');
    expect(fs.readFile('/home/a.txt')).toBe('eins\nzwei\n');
  });

  it('does not accumulate a trailing blank line when re-redirecting cat output (ls -l > f; cat f > f2)', async () => {
    await run('ls -l /home > test.txt');
    const first = fs.readFile('/home/test.txt');
    expect(first.endsWith('\n\n')).toBe(false);

    await run('cat test.txt > test2.txt');
    const second = fs.readFile('/home/test2.txt');
    expect(second).toBe(first);
    expect(second.endsWith('\n\n')).toBe(false);

    // Redirecting through cat a third time must stay stable, not compound.
    await run('cat test2.txt > test3.txt');
    expect(fs.readFile('/home/test3.txt')).toBe(first);
  });

  it('renders a real command error in a red span (stderr)', async () => {
    await run('cat /nope');
    const text = renderedText(app.outEl);
    expect(text).toMatch(/^<<.*>>\n?$/s);
  });

  it('clear actually wipes the screen (regression: Script.js used to stub ctx.clear as a no-op)', async () => {
    await run('echo hallo');
    expect(renderedText(app.outEl)).toContain('hallo');

    await run('clear');
    expect(renderedText(app.outEl)).not.toContain('hallo');

    // Same via a `;`-joined chain, which is the path that was actually broken.
    await run('echo again');
    await run('clear; echo done');
    const text = renderedText(app.outEl);
    expect(text).not.toContain('again');
    expect(text).toContain('done');
  });

  it('redirects a real error to a file with 2>, leaving the terminal clean', async () => {
    await run('cat /nope 2> /home/err.txt');
    expect(renderedText(app.outEl)).toBe('');
    expect(fs.readFile('/home/err.txt').length).toBeGreaterThan(0);
  });

  it('pipes real command output end-to-end (cat | cat)', async () => {
    fs.writeFile('/home/a.txt', 'piped content');
    await run('cat /home/a.txt | cat');
    expect(renderedText(app.outEl)).toBe('piped content\n');
  });

  it('reads stdin from a file with < for a real command', async () => {
    fs.writeFile('/home/a.txt', 'from redirect');
    await run('cat < /home/a.txt');
    expect(renderedText(app.outEl)).toBe('from redirect\n');
  });

  it('/dev/null swallows output and never creates a file', async () => {
    await run('echo secret > /dev/null');
    expect(fs.exists('/dev/null')).toBe(false);
    expect(renderedText(app.outEl)).toBe('');
  });

  it('unaffected commands (no operators) still render in the default color', async () => {
    await run('echo plain text');
    const text = renderedText(app.outEl);
    expect(text).toBe('plain text\n');
    expect(text).not.toContain('<<');
  });

  it('filters ls -l output through grep piped end-to-end', async () => {
    fs.writeFile('/home/photo.png', 'x');
    await run('ls -l /home | grep txt');
    const text = renderedText(app.outEl);
    expect(text).toContain('notes.txt'); // pre-existing default VFS file
    expect(text).not.toContain('photo.png');
  });

  it('chains cat | sort | uniq -c into a file redirect', async () => {
    fs.writeFile('/home/words.txt', 'b\na\nb\na\na\n');
    await run('cat words.txt | sort | uniq -c > out.txt');
    expect(fs.readFile('/home/out.txt')).toBe('   3 a\n   2 b\n');
  });

  // ── lazy per-entry expansion: $?, export, cd, glob all see effects from
  // earlier commands in the SAME `;`/`&&`/`||` chain, not just the previous
  // line - this is the whole point of splitting parsing (structural, upfront)
  // from expansion (per entry, right before it runs). ──────────────────────

  it('$? reflects the previous command in the same line, not the previous line', async () => {
    await run('cat /nope ; echo $?');
    const lines = renderedText(app.outEl).split('\n').filter(Boolean);
    expect(lines[lines.length - 1]).toBe('1');
  });

  it('$? is 0 after a successful command in the same line', async () => {
    await run('echo hi ; echo $?');
    const lines = renderedText(app.outEl).split('\n').filter(Boolean);
    expect(lines[lines.length - 1]).toBe('0');
  });

  it('a bare assignment earlier in the same line is visible to a later $VAR use', async () => {
    await run('Test=1 && echo $Test');
    expect(renderedText(app.outEl)).toBe('1\n');
  });

  it('a glob after cd matches relative to the NEW cwd within the same line', async () => {
    await run('cd /etc && ls cert*');
    expect(renderedText(app.outEl)).toBe('trusted\n');
  });

  it('rm *.txt removes every matching file (glob expansion)', async () => {
    fs.writeFile('/home/a.txt', '1');
    fs.writeFile('/home/b.txt', '1');
    await run('rm /home/*.txt');
    expect(fs.exists('/home/a.txt')).toBe(false);
    expect(fs.exists('/home/b.txt')).toBe(false);
  });

  it('cd - returns to OLDPWD, prints the new directory, and updates OLDPWD again', async () => {
    await run('cd /etc ; cd - ; pwd');
    // cd /etc: OLDPWD=/home, cwd=/etc (silent). cd -: reads OLDPWD (/home),
    // sets OLDPWD=/etc, cwd=/home, and prints the new dir. pwd confirms it.
    expect(renderedText(app.outEl)).toBe('/home\n/home\n');
  });

  it('cd - without a prior cd fails with a clear (stderr) error', async () => {
    await run('cd -');
    const text = renderedText(app.outEl);
    expect(text).toMatch(/^<<.*>>\n?$/s);
  });

  it('cd ~ and cat ~/notes.txt resolve against HOME', async () => {
    await run('cd /etc && cd ~ && pwd');
    expect(renderedText(app.outEl)).toBe('/home\n');
  });

  it('cat ~/notes.txt resolves ~ against HOME', async () => {
    await run('cat ~/notes.txt');
    expect(renderedText(app.outEl)).toContain('Welcome to BeaverOS');
  });

  // ── sh / test / command substitution / control flow ─────────────────────

  it('runs an if/elif/else script and picks the right branch', async () => {
    fs.writeFile('/home/branch.sh', [
      'if [ -f /etc/nope ]; then',
      '  echo has-nope',
      'elif [ -d /etc/certs ]; then',
      '  echo has-certs-dir',
      'else',
      '  echo neither',
      'fi',
    ].join('\n'));
    await run('sh branch.sh');
    expect(renderedText(app.outEl)).toBe('has-certs-dir\n');
  });

  it('runs a for loop over a glob', async () => {
    fs.writeFile('/home/list.sh', 'for f in /etc/*; do\n  echo "found: $f"\ndone');
    await run('sh list.sh');
    expect(renderedText(app.outEl)).toBe('found: /etc/certs\n');
  });

  it('runs a while loop with test -f, driven by rm inside the body', async () => {
    fs.writeFile('/home/loop.sh', [
      'touch marker',
      'while [ -f marker ]; do',
      '  echo looping',
      '  rm marker',
      'done',
      'echo done',
    ].join('\n'));
    await run('sh loop.sh');
    expect(renderedText(app.outEl)).toBe('looping\ndone\n');
  });

  it('runs a case statement matching a positional parameter', async () => {
    fs.writeFile('/home/pick.sh', [
      'case $1 in',
      '  foo|bar) echo matched-foo-or-bar ;;',
      '  *) echo default ;;',
      'esac',
    ].join('\n'));
    await run('sh pick.sh bar');
    expect(renderedText(app.outEl)).toBe('matched-foo-or-bar\n');
    app._resetScreen();
    await run('sh pick.sh nope');
    expect(renderedText(app.outEl)).toBe('default\n');
  });

  it('expands command substitution inside a script', async () => {
    fs.writeFile('/home/sub.sh', 'echo "cwd is $(pwd)"');
    await run('sh sub.sh');
    expect(renderedText(app.outEl)).toBe('cwd is /home\n');
  });

  it('evaluates $((...)) arithmetic, interactively and in a counter pattern', async () => {
    await run('i=1; i=$((i+1)); echo $i');
    expect(renderedText(app.outEl)).toBe('2\n');
  });

  it('runs a while loop counting up via $((i+1)) and [ -lt ]', async () => {
    fs.writeFile('/home/count.sh', [
      'i=0',
      'while [ $i -lt 3 ]; do',
      '  echo $i',
      '  i=$((i+1))',
      'done',
    ].join('\n'));
    await run('sh count.sh');
    expect(renderedText(app.outEl)).toBe('0\n1\n2\n');
  });

  it('evaluates $((...)) with grouping and modulo', async () => {
    await run('echo $(( (2+3) * 4 ))');
    expect(renderedText(app.outEl)).toBe('20\n');
    app._resetScreen();
    await run('echo $((7 % 3))');
    expect(renderedText(app.outEl)).toBe('1\n');
  });

  it('reports a translated error for division by zero instead of crashing', async () => {
    await run('echo $((1/0))');
    const text = renderedText(app.outEl);
    expect(text).toMatch(/^<<.*>>\n?$/s);
  });

  it('runs isolated: cd/export inside a script never leak into the interactive session', async () => {
    fs.writeFile('/home/isolate.sh', 'cd /etc\nexport FOO=bar\necho "inside: $FOO $(pwd)"');
    await run('sh isolate.sh');
    expect(renderedText(app.outEl)).toBe('inside: bar /etc\n');
    expect(app.cwd).toBe('/home');
    expect(app.env.FOO).toBeUndefined();
  });

  it('propagates a script failure as a CommandError (stderr, red)', async () => {
    fs.writeFile('/home/fails.sh', 'cat /nope');
    await run('sh fails.sh');
    const text = renderedText(app.outEl);
    // both the failing `cat` and sh's own "script failed" wrapper land on
    // stderr (red spans) - nothing on stdout.
    expect(text).not.toContain('\n\n');
    expect(text.split('\n').filter(Boolean).every((line) => /^<<.*>>$/.test(line))).toBe(true);
  });

  it('a Ctrl+C-style abort stops a running infinite while loop', async () => {
    fs.writeFile('/home/forever.sh', 'while true; do\n  echo tick\ndone');
    app.currentAbort = new AbortController();
    app.interruptHandlers = [];
    const pending = app._handleLine('sh forever.sh');
    await new Promise((r) => setTimeout(r, 20));
    app.currentAbort.abort();
    await pending; // must settle, not hang
    // confirms the loop genuinely ran (not vacuously true because "true"
    // failed to resolve as a command) before being cut off
    expect(renderedText(app.outEl)).toContain('tick');
  });

  it('true/false actually exist as commands (if/while conditions rely on them)', async () => {
    await run('true && echo t-ok');
    await run('false || echo f-ok');
    expect(renderedText(app.outEl)).toBe('t-ok\nf-ok\n');
  });

  it('a bare NAME=value assignment inside a script is visible to later $NAME reads', async () => {
    fs.writeFile('/home/v.sh', 'x=1\necho $x\nx=2\necho $x');
    await run('sh v.sh');
    expect(renderedText(app.outEl)).toBe('1\n2\n');
  });

  it('a var set inside a for-loop body persists across iterations and after the loop', async () => {
    fs.writeFile('/home/v2.sh', 'for c in a b c; do\n  seen="$seen$c"\ndone\necho $seen');
    await run('sh v2.sh');
    expect(renderedText(app.outEl)).toBe('abc\n');
  });

  it('a var set inside an if-body is visible after the if', async () => {
    fs.writeFile('/home/v3.sh', 'if true; then\n  x=hello\nfi\necho $x');
    await run('sh v3.sh');
    expect(renderedText(app.outEl)).toBe('hello\n');
  });

  // ── for/case now apply command substitution + arithmetic expansion, like
  // if/while already did (bugfix - they previously only got plain $VAR/glob
  // via expandWords, with $(...)/$((...)) left completely unexpanded). ────

  it('a for-loop word list expands $(...) command substitution', async () => {
    fs.writeFile('/home/forsub.sh', 'for f in $(echo a b c); do\n  echo "got $f"\ndone');
    await run('sh forsub.sh');
    expect(renderedText(app.outEl)).toBe('got a\ngot b\ngot c\n');
  });

  it('a for-loop word list expands $((...)) arithmetic', async () => {
    await run('for n in 1 $((1+1)) 3; do echo $n; done');
    expect(renderedText(app.outEl)).toBe('1\n2\n3\n');
  });

  it('a case subject expands $(...) command substitution', async () => {
    await run('case $(echo bar) in\nfoo) echo no ;;\nbar) echo yes ;;\nesac');
    expect(renderedText(app.outEl)).toBe('yes\n');
  });

  // ── word-splitting end-to-end (Parser.test.js covers parsePipeline directly;
  // this confirms it actually reaches for-loop iteration through the full
  // interactive path) ──────────────────────────────────────────────────────

  it('an unquoted multi-word variable is field-split into separate for-loop iterations', async () => {
    await run('x="a b c"\nfor w in $x; do echo $w; done');
    expect(renderedText(app.outEl)).toBe('a\nb\nc\n');
  });

  // ── shell functions ───────────────────────────────────────────────────────

  it('defines and calls a function with its own positional params', async () => {
    await run('greet() { echo "hi $1"; }');
    await run('greet world');
    expect(renderedText(app.outEl)).toBe('hi world\n');
  });

  it('also accepts the spaced "name () {" spelling', async () => {
    await run('greet () { echo hi; }');
    await run('greet');
    expect(renderedText(app.outEl)).toBe('hi\n');
  });

  it('a function runs in the current shell, not a subshell: cd/export inside it affect the caller', async () => {
    await run('mkcd() { cd /etc; export FOO=bar; }');
    await run('mkcd');
    expect(app.cwd).toBe('/etc');
    expect(app.env.FOO).toBe('bar');
  });

  it('$? reflects a function\'s own last command, and if/while can branch on calling it', async () => {
    await run('ok() { true; }');
    await run('if ok; then echo yes; else echo no; fi');
    expect(renderedText(app.outEl)).toBe('yes\n');
  });

  it('a function persists across separate interactively-typed commands', async () => {
    await run('greet() { echo "hi $1"; }');
    app._resetScreen();
    await run('greet again');
    expect(renderedText(app.outEl)).toBe('hi again\n');
  });

  it('sh script.sh does not inherit interactively-defined functions (real subshell semantics)', async () => {
    await run('greet() { echo "hi $1"; }');
    fs.writeFile('/home/callit.sh', 'greet world');
    app._resetScreen();
    await run('sh callit.sh');
    const text = renderedText(app.outEl);
    expect(text).toMatch(/^<<.*>>\n?$/s); // "command not found", not "hi world"
  });

  it('a function\'s stdout can be piped into a downstream command', async () => {
    await run('nums() { echo 1; echo 2; echo 3; }');
    await run('nums | grep 2');
    expect(renderedText(app.outEl)).toBe('2\n');
  });

  it('a function can call another already-defined function', async () => {
    await run('inner() { echo from-inner; }\nouter() { inner; echo from-outer; }');
    await run('outer');
    expect(renderedText(app.outEl)).toBe('from-inner\nfrom-outer\n');
  });

  it('redefining a function replaces the previous body', async () => {
    await run('f() { echo one; }');
    await run('f() { echo two; }');
    await run('f');
    expect(renderedText(app.outEl)).toBe('two\n');
  });

  it('a function can shadow a builtin of the same name', async () => {
    await run('ls() { echo overridden; }');
    await run('ls');
    expect(renderedText(app.outEl)).toBe('overridden\n');
  });

  it('a function is callable inside $(...) command substitution', async () => {
    await run('greet() { echo hi; }');
    await run('echo "result: $(greet)"');
    expect(renderedText(app.outEl)).toBe('result: hi\n');
  });

  it('stdin piped into a function call is inherited by its first unredirected command', async () => {
    await run('showin() { cat; }');
    await run('echo piped | showin');
    expect(renderedText(app.outEl)).toBe('piped\n');
  });

  // ── heredocs ──────────────────────────────────────────────────────────────

  it('feeds a <<EOF heredoc body to a command as stdin', async () => {
    await run('cat <<EOF\nhello\nworld\nEOF');
    expect(renderedText(app.outEl)).toBe('hello\nworld\n');
  });

  it('expands $VAR/$(...) in an unquoted-delimiter heredoc body, against the current env', async () => {
    await run('name=world\ncat <<EOF\nhi $name, cwd=$(pwd)\nEOF');
    expect(renderedText(app.outEl)).toBe('hi world, cwd=/home\n');
  });

  it('does not expand a quoted-delimiter heredoc body (literal)', async () => {
    await run('cat <<\'EOF\'\nliteral $name here\nEOF');
    expect(renderedText(app.outEl)).toBe('literal $name here\n');
  });

  it('<<- strips leading tabs from the body and the terminator line', async () => {
    await run('cat <<-EOF\n\thello\n\tEOF');
    expect(renderedText(app.outEl)).toBe('hello\n');
  });

  it('a heredoc works inside a sh script file, driven by a while loop', async () => {
    fs.writeFile('/home/here.sh', 'cat <<EOF\nfrom a script\nEOF');
    await run('sh here.sh');
    expect(renderedText(app.outEl)).toBe('from a script\n');
  });

  // ── sh's own I/O (output pipe-out, stdin pipe-in) ────────────────────────

  it('a sh script\'s own output can be piped into a downstream command', async () => {
    fs.writeFile('/home/nums.sh', 'echo 1\necho 2\necho 3');
    await run('sh nums.sh | grep 2');
    expect(renderedText(app.outEl)).toBe('2\n');
  });

  it('stdin piped into sh script.sh is inherited by its first unredirected command', async () => {
    fs.writeFile('/home/showin.sh', 'cat');
    await run('echo piped | sh showin.sh');
    expect(renderedText(app.outEl)).toBe('piped\n');
  });

  it('a heredoc-fed command can still be piped into a downstream command', async () => {
    await run('cat <<EOF | grep line2\nline1\nline2\nline3\nEOF');
    expect(renderedText(app.outEl)).toBe('line2\n');
  });

  it('a heredoc body is re-expanded against the current env on every loop iteration', async () => {
    await run('for x in a b; do\n  cat <<EOF\nvalue=$x\nEOF\ndone');
    expect(renderedText(app.outEl)).toBe('value=a\nvalue=b\n');
  });

  // ── interactive if/for/while/case, unified with Script.js ────────────────

  it('single-line if/for/while/case now work interactively, not just via sh', async () => {
    await run('if true; then echo hi; fi');
    expect(renderedText(app.outEl)).toBe('hi\n');
  });

  it('multi-line continuation: nothing runs until the closing fi arrives', async () => {
    await run('if true; then');
    expect(renderedText(app.outEl)).toBe('');
    expect(app.pendingInput).not.toBeNull();

    await run('echo hi');
    expect(renderedText(app.outEl)).toBe(''); // still waiting
    expect(app.pendingInput).not.toBeNull();

    await run('fi');
    expect(app.pendingInput).toBeNull();
    expect(renderedText(app.outEl)).toBe('hi\n');
  });

  it('the prompt switches to "> " while a construct is open, and back once closed', async () => {
    expect(app._promptString()).not.toBe('> ');
    await run('while false; do');
    expect(app._promptString()).toBe('> ');
    await run('done');
    expect(app._promptString()).not.toBe('> ');
  });

  it('Ctrl+C cancels an open multi-line construct', async () => {
    await run('if true; then');
    expect(app.pendingInput).not.toBeNull();
    app._interrupt();
    expect(app.pendingInput).toBeNull();
    expect(app._promptString()).not.toBe('> ');
  });

  it('a genuine syntax error during continuation clears pendingInput and reports it (not "need more")', async () => {
    await run('if true; then');
    await run('done'); // "done" doesn't belong here - a real error, not incomplete input
    expect(app.pendingInput).toBeNull();
    expect(renderedText(app.outEl)).toMatch(/^<<.*>>\n?$/s);
  });

  // ── two bugs found while unifying the two engines ────────────────────────

  it('a script that cds can still redirect relative to its own (not the outer) directory', async () => {
    fs.writeFile('/home/cdredirect.sh', 'cd /etc\necho hi > rel.txt');
    await run('sh cdredirect.sh');
    expect(fs.exists('/etc/rel.txt')).toBe(true);
    expect(fs.exists('/home/rel.txt')).toBe(false);
    expect(app.cwd).toBe('/home'); // sh itself stays isolated from the interactive session
  });

  it('command substitution respects && / ; inside $(...) instead of truncating at the first one', async () => {
    await run('echo $(cd /etc && pwd)');
    expect(renderedText(app.outEl)).toBe('/etc\n');
    expect(app.cwd).toBe('/home'); // the substitution's own cd stays isolated
  });
});

describe('test / [ builtins', () => {
  /** @type {TerminalApp} */
  let app;
  /** @type {VirtualFileSystem} */
  let fs;

  beforeEach(() => {
    fs = new VirtualFileSystem();
    const os = /** @type {any} */ ({ name: 'TestOS', fs, exit() {} });
    app = new TerminalApp(os);
    app._registerBuiltins();
    app._resetScreen();
    app.outEl = makeFakeEl('pre');
    app.busy = true;
  });

  /** @param {string} line */
  async function run(line) {
    app.currentAbort = new AbortController();
    app.interruptHandlers = [];
    await app._handleLine(line);
  }

  it('test -f / -d reflect real filesystem state via $?', async () => {
    await run('test -d /etc; echo $?');
    expect(renderedText(app.outEl)).toBe('0\n');
    app._resetScreen();
    await run('test -f /etc; echo $?');
    expect(renderedText(app.outEl)).toBe('1\n');
  });

  it('[ ... ] requires a closing ] and behaves like test', async () => {
    await run('[ -d /etc ] && echo yes');
    expect(renderedText(app.outEl)).toBe('yes\n');
  });

  it('a false test produces no stderr output at all (silent, not an error)', async () => {
    await run('test -d /nope');
    expect(renderedText(app.outEl)).toBe('');
  });

  it('string and numeric comparisons work', async () => {
    await run('test "a" = "a" && echo eq');
    await run('test 3 -lt 5 && echo lt');
    expect(renderedText(app.outEl)).toBe('eq\nlt\n');
  });
});

describe('nano/pico editor (raw key mode through the real command registry)', () => {
  /** @type {TerminalApp} */
  let app;
  /** @type {VirtualFileSystem} */
  let fs;

  beforeEach(() => {
    fs = new VirtualFileSystem();
    const os = /** @type {any} */ ({ name: 'TestOS', fs, exit() {} });
    app = new TerminalApp(os);
    app._registerBuiltins();
    app._resetScreen();
    app.outEl = makeFakeEl('pre');
    app.busy = true;
  });

  /** @param {string} line */
  function run(line) {
    app.currentAbort = new AbortController();
    app.interruptHandlers = [];
    return app._handleLine(line); // intentionally not awaited by callers until the editor exits
  }

  /**
   * @param {string} key
   * @param {{ ctrl?: boolean }} [opts]
   */
  function keyEv(key, opts = {}) {
    return /** @type {any} */ ({ key, ctrlKey: !!opts.ctrl, metaKey: false, preventDefault() {} });
  }

  /** @param {string} text */
  function type(text) {
    for (const ch of text) app._onKeyDown(keyEv(ch));
  }

  /** Waits until `nano`'s synchronous setup (up to its `await done`) has run. */
  async function untilEditorOpen() {
    for (let i = 0; i < 20 && !app.rawKeyHandler; i++) await Promise.resolve();
  }

  it('opens into raw key mode and takes over rendering', async () => {
    const done = run('nano /home/new.txt');
    await untilEditorOpen();
    expect(app.rawKeyHandler).toBeTypeOf('function');
    expect(app.busy).toBe(true);

    app._onKeyDown(keyEv('x', { ctrl: true })); // unmodified -> exits immediately
    await done;
    expect(app.rawKeyHandler).toBeNull();
  });

  it('restores the prior screen content on exit instead of leaving editor leftovers behind (regression)', async () => {
    await run('echo before-nano');
    expect(renderedText(app.outEl)).toBe('before-nano\n');

    const done = run('nano /home/x.txt');
    await untilEditorOpen();
    app._onKeyDown(keyEv('x', { ctrl: true })); // unmodified -> exits immediately, synchronously inside handleKey
    await done;
    app.busy = false;
    app._renderScreen();

    const text = renderedText(app.outEl);
    expect(text).toContain('before-nano');
    expect(text).not.toContain('^O'); // no leftover footer/title bar from the editor
  });

  it('typing then Ctrl+O, Enter writes the buffer to the given path', async () => {
    const done = run('nano /home/new.txt');
    await untilEditorOpen();

    type('hallo beaver');
    app._onKeyDown(keyEv('o', { ctrl: true }));   // Ctrl+O: save prompt, prefilled with /home/new.txt
    app._onKeyDown(keyEv('Enter'));               // confirm

    expect(fs.readFile('/home/new.txt')).toBe('hallo beaver');

    app._onKeyDown(keyEv('x', { ctrl: true }));   // now unmodified -> exits immediately
    await done;
  });

  it('Ctrl+X on a modified, unnamed buffer prompts, then routes "y" through the save prompt', async () => {
    const done = run('nano'); // no path yet
    await untilEditorOpen();

    type('draft');
    app._onKeyDown(keyEv('x', { ctrl: true })); // modified -> asks Y/N/Esc
    app._onKeyDown(keyEv('y'));                 // yes, save -> no path yet -> falls into the save prompt
    type('/home/draft.txt');
    app._onKeyDown(keyEv('Enter'));

    expect(fs.readFile('/home/draft.txt')).toBe('draft');
    await done; // save-then-exit resolves the pipeline on its own
    expect(app.rawKeyHandler).toBeNull();
  });

  it('Ctrl+X "n" discards changes without writing anything', async () => {
    fs.writeFile('/home/existing.txt', 'original');
    const done = run('nano /home/existing.txt');
    await untilEditorOpen();

    type('!!!');
    app._onKeyDown(keyEv('x', { ctrl: true }));
    app._onKeyDown(keyEv('n'));
    await done;

    expect(fs.readFile('/home/existing.txt')).toBe('original');
    expect(app.rawKeyHandler).toBeNull();
  });

  it('opening an existing file preloads its content, editable via arrow/backspace', async () => {
    fs.writeFile('/home/existing.txt', 'abc');
    const done = run('nano /home/existing.txt');
    await untilEditorOpen();

    app._onKeyDown(keyEv('ArrowRight'));
    app._onKeyDown(keyEv('ArrowRight'));
    app._onKeyDown(keyEv('Backspace')); // "abc" -> "ac", cursor between a and c
    app._onKeyDown(keyEv('o', { ctrl: true }));
    app._onKeyDown(keyEv('Enter'));

    expect(fs.readFile('/home/existing.txt')).toBe('ac');

    app._onKeyDown(keyEv('x', { ctrl: true }));
    await done;
  });

  it('Ctrl+C on an unmodified buffer exits immediately, like Ctrl+X', async () => {
    const done = run('nano /home/new.txt');
    await untilEditorOpen();

    app._onKeyDown(keyEv('c', { ctrl: true })); // global interrupt
    await done;

    expect(app.rawKeyHandler).toBeNull();
    expect(fs.exists('/home/new.txt')).toBe(false);
  });

  it('Ctrl+C on a modified buffer asks first instead of discarding it outright (regression: used to abandon like telnet)', async () => {
    const done = run('nano /home/new.txt');
    await untilEditorOpen();

    type('unsaved');
    app._onKeyDown(keyEv('c', { ctrl: true })); // must NOT exit yet - would lose unsaved work
    expect(app.rawKeyHandler).toBeTypeOf('function');
    expect(fs.exists('/home/new.txt')).toBe(false);
    expect(renderedText(app.outEl)).toContain('exitConfirm'); // the exit-prompt row, not gone

    app._onKeyDown(keyEv('y')); // confirm save -> path is known -> saves and exits
    await done;

    expect(fs.readFile('/home/new.txt')).toBe('unsaved');
    expect(app.rawKeyHandler).toBeNull();
  });

  it('Ctrl+C, then "n" at the exit prompt discards the changes and exits', async () => {
    fs.writeFile('/home/existing2.txt', 'original');
    const done = run('nano /home/existing2.txt');
    await untilEditorOpen();

    type('!!!');
    app._onKeyDown(keyEv('c', { ctrl: true }));
    app._onKeyDown(keyEv('n'));
    await done;

    expect(fs.readFile('/home/existing2.txt')).toBe('original');
    expect(app.rawKeyHandler).toBeNull();
  });

  it('opening a directory is rejected', async () => {
    await run('nano /home');
    expect(renderedText(app.outEl)).toMatch(/^<<.*>>\n?$/s); // CommandError, not the editor
    expect(app.rawKeyHandler).toBeNull();
  });

  it('pico is registered as a separate command using the same editor', async () => {
    expect(app.commands.get('pico')).toBeTruthy();
    const done = run('pico /home/p.txt');
    await untilEditorOpen();
    type('hi');
    app._onKeyDown(keyEv('o', { ctrl: true }));
    app._onKeyDown(keyEv('Enter'));
    expect(fs.readFile('/home/p.txt')).toBe('hi');
    app._onKeyDown(keyEv('x', { ctrl: true }));
    await done;
  });
});

describe('_recalcGeometry (row/col sizing from the real terminal element)', () => {
  it('derives cols and rows from the measured char size and available space, resetting the screen exactly once', () => {
    const fs = new VirtualFileSystem();
    const os = /** @type {any} */ ({ name: 'TestOS', fs, exit() {} });
    const app = new TerminalApp(os);
    app._registerBuiltins();
    app._resetScreen();
    app.outEl = makeFakeEl('pre');
    app.busy = true;

    // Fake char metrics: 8px wide, 21px tall per char/line.
    const realCreateElement = document.createElement;
    document.createElement = (/** @type {string} */ tag) => {
      const el = realCreateElement(tag);
      el.getBoundingClientRect = () => ({ width: 8 * 10, height: 21 });
      return el;
    };
    const realGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = /** @type {any} */ (() => ({ lineHeight: '21px' }));

    let resetCount = 0;
    const originalReset = app._resetScreen.bind(app);
    app._resetScreen = () => { resetCount++; originalReset(); };

    const termEl = /** @type {any} */ ({
      appendChild: (/** @type {any} */ child) => child,
      clientWidth: 8 * 82 + 14,   // -> 82 cols
      clientHeight: 21 * 33 + 14, // -> 33 rows
    });

    try {
      app._recalcGeometry(termEl);
    } finally {
      document.createElement = realCreateElement;
      window.getComputedStyle = realGetComputedStyle;
    }

    expect(app.cols).toBe(82);
    expect(app.rows).toBe(33);
    expect(resetCount).toBe(1); // not twice, even though both cols and rows changed here
  });
});
