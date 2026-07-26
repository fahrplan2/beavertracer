//@ts-check

import { describe, it, expect } from 'vitest';
import { parsePipeline, splitCommandList } from '../../../src/apps/terminal/Parser.js';
import { VirtualFileSystem } from '../../../src/apps/lib/VirtualFileSystem.js';

describe('parsePipeline', () => {
  it('parses a plain command with no operators', () => {
    const stages = parsePipeline('ls -la /home');
    expect(stages).toEqual([{ cmd: 'ls', args: ['-la', '/home'], redirects: [] }]);
  });

  it('respects single and double quotes', () => {
    const stages = parsePipeline(`echo "hello world" 'foo bar'`);
    expect(stages).toEqual([{ cmd: 'echo', args: ['hello world', 'foo bar'], redirects: [] }]);
  });

  it('escapes the next character unquoted', () => {
    const stages = parsePipeline(String.raw`echo eins\ zwei \$USER`);
    expect(stages).toEqual([{ cmd: 'echo', args: ['eins zwei', '$USER'], redirects: [] }]);
  });

  it('escapes ", \\ and $ inside double quotes, leaves other backslashes literal', () => {
    const stages = parsePipeline(String.raw`echo "a\"b\\c\$d \n"`);
    expect(stages).toEqual([{ cmd: 'echo', args: ['a"b\\c$d \\n'], redirects: [] }]);
  });

  it('does not escape anything inside single quotes', () => {
    const stages = parsePipeline(String.raw`echo 'a\ b'`);
    expect(stages).toEqual([{ cmd: 'echo', args: ['a\\ b'], redirects: [] }]);
  });

  it('expands $VAR and ${VAR} when unquoted or double-quoted', () => {
    const env = { USER: 'alice', HOST: 'box1' };
    expect(parsePipeline('echo $USER on ${HOST}', env)).toEqual([
      { cmd: 'echo', args: ['alice', 'on', 'box1'], redirects: [] },
    ]);
    expect(parsePipeline('echo "hi $USER on ${HOST}!"', env)).toEqual([
      { cmd: 'echo', args: ['hi alice on box1!'], redirects: [] },
    ]);
  });

  it('does not expand variables inside single quotes', () => {
    const stages = parsePipeline("echo 'no $USER here'", { USER: 'alice' });
    expect(stages).toEqual([{ cmd: 'echo', args: ['no $USER here'], redirects: [] }]);
  });

  describe('unquoted expansion field splitting', () => {
    it('word-splits an unquoted multi-word variable into separate args', () => {
      const stages = parsePipeline('echo $x', { x: 'a b' });
      expect(stages).toEqual([{ cmd: 'echo', args: ['a', 'b'], redirects: [] }]);
    });

    it('glues the first/last split field onto adjacent literal text', () => {
      const stages = parsePipeline('echo pre${x}post', { x: 'a b' });
      expect(stages).toEqual([{ cmd: 'echo', args: ['prea', 'bpost'], redirects: [] }]);
    });

    it('drops a purely-whitespace boundary at the start/end of the expansion (no stray empty field)', () => {
      const stages = parsePipeline('echo [${x}]', { x: ' a b ' });
      expect(stages).toEqual([{ cmd: 'echo', args: ['[', 'a', 'b', ']'], redirects: [] }]);
    });

    it('does not split a double-quoted expansion', () => {
      const stages = parsePipeline('echo "$x"', { x: 'a b' });
      expect(stages).toEqual([{ cmd: 'echo', args: ['a b'], redirects: [] }]);
    });

    it('does not split a single-word (no internal whitespace) expansion, matching prior behavior', () => {
      const stages = parsePipeline('echo $x', { x: 'solo' });
      expect(stages).toEqual([{ cmd: 'echo', args: ['solo'], redirects: [] }]);
    });
  });

  it('expands unset/unknown variables to an empty string', () => {
    const stages = parsePipeline('echo [$NOPE]', {});
    expect(stages).toEqual([{ cmd: 'echo', args: ['[]'], redirects: [] }]);
  });

  it('treats $ as literal when not followed by an identifier or malformed ${', () => {
    const stages = parsePipeline('echo $ ${');
    expect(stages).toEqual([{ cmd: 'echo', args: ['$', '${'], redirects: [] }]);
  });

  it('splits stages on |', () => {
    const stages = parsePipeline('ping 1.1.1.1 | cat | cat');
    expect(stages).toHaveLength(3);
    expect(stages[0]).toEqual({ cmd: 'ping', args: ['1.1.1.1'], redirects: [] });
    expect(stages[1]).toEqual({ cmd: 'cat', args: [], redirects: [] });
    expect(stages[2]).toEqual({ cmd: 'cat', args: [], redirects: [] });
  });

  it('parses stdout overwrite and append', () => {
    expect(parsePipeline('echo hi > out.txt')).toEqual([
      { cmd: 'echo', args: ['hi'], redirects: [{ type: 'stdoutOverwrite', path: 'out.txt' }] },
    ]);
    expect(parsePipeline('echo hi >> out.txt')).toEqual([
      { cmd: 'echo', args: ['hi'], redirects: [{ type: 'stdoutAppend', path: 'out.txt' }] },
    ]);
  });

  it('parses stderr overwrite, append and merge', () => {
    expect(parsePipeline('cat nope 2> err.txt')).toEqual([
      { cmd: 'cat', args: ['nope'], redirects: [{ type: 'stderrOverwrite', path: 'err.txt' }] },
    ]);
    expect(parsePipeline('cat nope 2>> err.txt')).toEqual([
      { cmd: 'cat', args: ['nope'], redirects: [{ type: 'stderrAppend', path: 'err.txt' }] },
    ]);
    expect(parsePipeline('cat nope 2>&1')).toEqual([
      { cmd: 'cat', args: ['nope'], redirects: [{ type: 'stderrToStdout' }] },
    ]);
  });

  it('parses input redirection', () => {
    expect(parsePipeline('cat < in.txt')).toEqual([
      { cmd: 'cat', args: [], redirects: [{ type: 'stdin', path: 'in.txt' }] },
    ]);
  });

  it('preserves redirect ordering (matters for 2>&1)', () => {
    const before = parsePipeline('cmd 2>&1 > out.txt');
    expect(before[0].redirects).toEqual([
      { type: 'stderrToStdout' },
      { type: 'stdoutOverwrite', path: 'out.txt' },
    ]);

    const after = parsePipeline('cmd > out.txt 2>&1');
    expect(after[0].redirects).toEqual([
      { type: 'stdoutOverwrite', path: 'out.txt' },
      { type: 'stderrToStdout' },
    ]);
  });

  it('combines pipes and redirects on individual stages', () => {
    const stages = parsePipeline('ping 8.8.8.8 2> err.txt | cat > out.txt');
    expect(stages).toEqual([
      { cmd: 'ping', args: ['8.8.8.8'], redirects: [{ type: 'stderrOverwrite', path: 'err.txt' }] },
      { cmd: 'cat', args: [], redirects: [{ type: 'stdoutOverwrite', path: 'out.txt' }] },
    ]);
  });

  it('handles an empty line', () => {
    expect(parsePipeline('')).toEqual([{ cmd: '', args: [], redirects: [] }]);
  });

  it('returns only the first pipeline when the line has ;/&&/||', () => {
    const stages = parsePipeline('echo a && echo b');
    expect(stages).toEqual([{ cmd: 'echo', args: ['a'], redirects: [] }]);
  });
});

describe('splitCommandList', () => {
  it('splits on ; with op null for the first entry, raw text only - no expansion', () => {
    // Operators (`;` included) are only recognized at a token boundary, same
    // simplification as `|`/`>`/etc. - so a space is needed before them.
    const entries = splitCommandList('echo $USER ; echo b ; echo c');
    expect(entries).toEqual([
      { text: 'echo $USER', op: null },
      { text: 'echo b', op: ';' },
      { text: 'echo c', op: ';' },
    ]);
  });

  it('splits on && and ||', () => {
    const entries = splitCommandList('mkdir x && cd x || echo failed');
    expect(entries).toEqual([
      { text: 'mkdir x', op: null },
      { text: 'cd x', op: '&&' },
      { text: 'echo failed', op: '||' },
    ]);
  });

  it('keeps pipes and redirects within one entry (raw, untouched)', () => {
    const entries = splitCommandList('ls | grep foo > out.txt && cat out.txt');
    expect(entries).toEqual([
      { text: 'ls | grep foo > out.txt', op: null },
      { text: 'cat out.txt', op: '&&' },
    ]);
  });

  it('a quoted ;/&&/|| does not split the entry', () => {
    const entries = splitCommandList('echo "a ; b && c" ; echo done');
    expect(entries).toEqual([
      { text: 'echo "a ; b && c"', op: null },
      { text: 'echo done', op: ';' },
    ]);
  });

  it('degenerates to a single null-op entry with no ;/&&/||', () => {
    expect(splitCommandList('echo hi')).toEqual([{ text: 'echo hi', op: null }]);
  });

  it('does not split on a ;/&&/|| that is actually inside $(...)', () => {
    // $(...) is swallowed whole (unexpanded) by the tokenizer - without
    // that, "&&"/";" inside the substitution would look like real top-level
    // operators and wrongly split the line.
    expect(splitCommandList('echo $(cd /etc && pwd)')).toEqual([
      { text: 'echo $(cd /etc && pwd)', op: null },
    ]);
    expect(splitCommandList('echo $(echo a; echo b) && echo done')).toEqual([
      { text: 'echo $(echo a; echo b)', op: null },
      { text: 'echo done', op: '&&' },
    ]);
  });
});

describe('parsePipeline - $? and $$', () => {
  it('expands $? from opts.lastExitCode, defaulting to 0', () => {
    expect(parsePipeline('echo $?', {}, { lastExitCode: 1 })).toEqual([
      { cmd: 'echo', args: ['1'], redirects: [] },
    ]);
    expect(parsePipeline('echo $?')).toEqual([{ cmd: 'echo', args: ['0'], redirects: [] }]);
  });

  it('expands $$ from opts.pid, defaulting to 0', () => {
    expect(parsePipeline('echo $$', {}, { pid: 42 })).toEqual([
      { cmd: 'echo', args: ['42'], redirects: [] },
    ]);
  });
});

describe('parsePipeline - positional parameters', () => {
  const opts = { positional: ['alpha', 'beta'], scriptName: 'demo.sh' };

  it('expands $1/$2 and leaves unset ones empty', () => {
    expect(parsePipeline('echo $1 $2 $3', {}, opts)).toEqual([
      { cmd: 'echo', args: ['alpha', 'beta', ''], redirects: [] },
    ]);
  });

  it('expands $@ and $* to all positional params, space-joined', () => {
    expect(parsePipeline('echo $@', {}, opts)).toEqual([{ cmd: 'echo', args: ['alpha', 'beta'], redirects: [] }]);
    expect(parsePipeline('echo $*', {}, opts)).toEqual([{ cmd: 'echo', args: ['alpha', 'beta'], redirects: [] }]);
  });

  it('expands $# to the count and $0 to the script name', () => {
    expect(parsePipeline('echo $#', {}, opts)).toEqual([{ cmd: 'echo', args: ['2'], redirects: [] }]);
    expect(parsePipeline('echo $0', {}, opts)).toEqual([{ cmd: 'echo', args: ['demo.sh'], redirects: [] }]);
  });

  it('defaults to empty/zero/"sh" without opts', () => {
    expect(parsePipeline('echo $1 $# $0')).toEqual([{ cmd: 'echo', args: ['', '0', 'sh'], redirects: [] }]);
  });
});

describe('parsePipeline - comments', () => {
  it('drops everything from a # at the start of a word', () => {
    expect(parsePipeline('echo hi # a comment')).toEqual([{ cmd: 'echo', args: ['hi'], redirects: [] }]);
    expect(parsePipeline('# a whole comment line')).toEqual([{ cmd: '', args: [], redirects: [] }]);
  });

  it('keeps a # mid-word literal', () => {
    expect(parsePipeline('echo hi#not-a-comment')).toEqual([{ cmd: 'echo', args: ['hi#not-a-comment'], redirects: [] }]);
  });

  it('keeps a quoted # literal', () => {
    expect(parsePipeline('echo "# not a comment"')).toEqual([{ cmd: 'echo', args: ['# not a comment'], redirects: [] }]);
  });
});

describe('parsePipeline - tilde expansion', () => {
  const env = { HOME: '/home/alice' };

  it('expands a bare ~ and ~/... at the start of a word', () => {
    expect(parsePipeline('cd ~', env)).toEqual([{ cmd: 'cd', args: ['/home/alice'], redirects: [] }]);
    expect(parsePipeline('cat ~/notes.txt', env)).toEqual([
      { cmd: 'cat', args: ['/home/alice/notes.txt'], redirects: [] },
    ]);
  });

  it('does not expand ~ mid-word or inside quotes', () => {
    expect(parsePipeline('echo foo~bar', env)).toEqual([{ cmd: 'echo', args: ['foo~bar'], redirects: [] }]);
    expect(parsePipeline(`echo '~'`, env)).toEqual([{ cmd: 'echo', args: ['~'], redirects: [] }]);
  });
});

describe('parsePipeline - glob expansion', () => {
  /** @returns {VirtualFileSystem} */
  function makeFs() {
    const fs = new VirtualFileSystem();
    fs.mkdir('/work', { recursive: true });
    fs.writeFile('/work/a.txt', '1');
    fs.writeFile('/work/b.txt', '1');
    fs.writeFile('/work/c.log', '1');
    fs.writeFile('/work/.hidden.txt', '1');
    return fs;
  }

  it('expands a unique/ambiguous glob, sorted', () => {
    const fs = makeFs();
    expect(parsePipeline('cat /work/c.l*', {}, { fs, cwd: '/' })).toEqual([
      { cmd: 'cat', args: ['/work/c.log'], redirects: [] },
    ]);
    expect(parsePipeline('cat /work/*.txt', {}, { fs, cwd: '/' })).toEqual([
      { cmd: 'cat', args: ['/work/a.txt', '/work/b.txt'], redirects: [] },
    ]);
  });

  it('leaves a non-matching glob literal (no nullglob)', () => {
    const fs = makeFs();
    expect(parsePipeline('cat /work/*.zzz', {}, { fs, cwd: '/' })).toEqual([
      { cmd: 'cat', args: ['/work/*.zzz'], redirects: [] },
    ]);
  });

  it('hides dotfiles unless the pattern itself starts with a dot', () => {
    const fs = makeFs();
    expect(parsePipeline('cat /work/*', {}, { fs, cwd: '/' })).toEqual([
      { cmd: 'cat', args: ['/work/a.txt', '/work/b.txt', '/work/c.log'], redirects: [] },
    ]);
    expect(parsePipeline('cat /work/.*', {}, { fs, cwd: '/' })).toEqual([
      { cmd: 'cat', args: ['/work/.hidden.txt'], redirects: [] },
    ]);
  });

  it('never globs a quoted or escaped word', () => {
    const fs = makeFs();
    expect(parsePipeline('cat "/work/*.txt"', {}, { fs, cwd: '/' })).toEqual([
      { cmd: 'cat', args: ['/work/*.txt'], redirects: [] },
    ]);
  });

  it('does not glob the command name or without fs in opts', () => {
    const fs = makeFs();
    expect(parsePipeline('/work/*.txt', {}, { fs, cwd: '/' })).toEqual([
      { cmd: '/work/*.txt', args: [], redirects: [] },
    ]);
    expect(parsePipeline('cat /work/*.txt')).toEqual([
      { cmd: 'cat', args: ['/work/*.txt'], redirects: [] },
    ]);
  });
});
