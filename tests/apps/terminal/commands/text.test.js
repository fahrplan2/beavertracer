//@ts-check

import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../../../../src/apps/lib/VirtualFileSystem.js';
import { grep } from '../../../../src/apps/terminal/commands/text/grep.js';
import { head } from '../../../../src/apps/terminal/commands/text/head.js';
import { tail } from '../../../../src/apps/terminal/commands/text/tail.js';
import { wc } from '../../../../src/apps/terminal/commands/text/wc.js';
import { sort } from '../../../../src/apps/terminal/commands/text/sort.js';
import { uniq } from '../../../../src/apps/terminal/commands/text/uniq.js';
import { cut } from '../../../../src/apps/terminal/commands/text/cut.js';
import { tr } from '../../../../src/apps/terminal/commands/text/tr.js';
import { tee } from '../../../../src/apps/terminal/commands/text/tee.js';
import { seq } from '../../../../src/apps/terminal/commands/text/seq.js';
import { CommandError } from '../../../../src/apps/terminal/commands/lib/errors.js';

/** @param {string} text one-shot Reader pre-loaded with `text`, matching ShellContext.stdin's shape */
function makeReader(text) {
  const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
  let i = 0;
  return {
    async readLine() { return i < lines.length ? lines[i++] : null; },
    async readAll() { return lines.slice(i).join('\n'); },
  };
}

/**
 * @param {VirtualFileSystem} fs
 * @param {string|null} [stdinText]
 */
function makeCtx(fs, stdinText = null) {
  return /** @type {any} */ ({
    os: { fs },
    cwd: '/home',
    env: {},
    stdin: stdinText === null ? null : makeReader(stdinText),
  });
}

describe('text commands', () => {
  it('grep filters piped input and supports -i/-v/-n', async () => {
    const fs = new VirtualFileSystem();
    const input = 'Error: disk full\nok: all good\nERROR: retry\nok again';

    expect(await grep.run(makeCtx(fs, input), ['error'])).toBe('');
    expect(await grep.run(makeCtx(fs, input), ['-i', 'error'])).toBe('Error: disk full\nERROR: retry');
    expect(await grep.run(makeCtx(fs, input), ['-i', '-v', 'error'])).toBe('ok: all good\nok again');
    expect(await grep.run(makeCtx(fs, input), ['-i', '-n', 'error'])).toBe('1:Error: disk full\n3:ERROR: retry');
  });

  it('grep reads from a file when given a path instead of stdin', async () => {
    const fs = new VirtualFileSystem();
    fs.writeFile('/home/log.txt', 'a\nb\nmatch\n');
    expect(await grep.run(makeCtx(fs), ['match', 'log.txt'])).toBe('match');
  });

  it('head supports both -n N and -N shorthand', async () => {
    const fs = new VirtualFileSystem();
    const input = '1\n2\n3\n4\n5';
    expect(await head.run(makeCtx(fs, input), ['-n', '2'])).toBe('1\n2');
    expect(await head.run(makeCtx(fs, input), ['-2'])).toBe('1\n2');
    expect(await head.run(makeCtx(fs, input), [])).toBe('1\n2\n3\n4\n5'); // fewer than default 10
  });

  it('tail returns the last N lines', async () => {
    const fs = new VirtualFileSystem();
    const input = '1\n2\n3\n4\n5';
    expect(await tail.run(makeCtx(fs, input), ['-n', '2'])).toBe('4\n5');
    expect(await tail.run(makeCtx(fs, input), ['-2'])).toBe('4\n5');
  });

  it('wc counts lines, words and chars', async () => {
    const fs = new VirtualFileSystem();
    const input = 'hello world\nfoo';
    expect(await wc.run(makeCtx(fs, input), [])).toBe(`2  3  ${input.length}`);
    expect(await wc.run(makeCtx(fs, input), ['-l'])).toBe('2');
  });

  it('sort orders lines alphabetically and numerically, with -r reversing', async () => {
    const fs = new VirtualFileSystem();
    expect(await sort.run(makeCtx(fs, 'banana\napple\ncherry'), [])).toBe('apple\nbanana\ncherry');
    expect(await sort.run(makeCtx(fs, 'banana\napple\ncherry'), ['-r'])).toBe('cherry\nbanana\napple');
    expect(await sort.run(makeCtx(fs, '10\n2\n1'), ['-n'])).toBe('1\n2\n10');
  });

  it('sort | uniq -c collapses and counts adjacent duplicates', async () => {
    const fs = new VirtualFileSystem();
    const sorted = await sort.run(makeCtx(fs, 'b\na\nb\na\na'), []);
    expect(sorted).toBe('a\na\na\nb\nb');
    const result = await uniq.run(makeCtx(fs, /** @type {string} */ (sorted)), ['-c']);
    expect(result).toBe('   3 a\n   2 b');
  });

  it('uniq without -c just collapses adjacent duplicates', async () => {
    const fs = new VirtualFileSystem();
    expect(await uniq.run(makeCtx(fs, 'a\na\nb\na'), [])).toBe('a\nb\na');
  });

  it('cut extracts fields by delimiter, supporting lists and ranges', async () => {
    const fs = new VirtualFileSystem();
    const input = 'root:x:0:0:root:/root:/bin/bash';
    expect(await cut.run(makeCtx(fs, input), ['-d', ':', '-f', '1,3'])).toBe('root:0');
    expect(await cut.run(makeCtx(fs, input), ['-d', ':', '-f', '1-3'])).toBe('root:x:0');
  });

  it('tr translates character sets and supports -d to delete', async () => {
    const fs = new VirtualFileSystem();
    expect(await tr.run(makeCtx(fs, 'hello'), ['a-z', 'A-Z'])).toBe('HELLO');
    expect(await tr.run(makeCtx(fs, 'a1b2c3'), ['-d', '0-9'])).toBe('abc');
  });

  it('tr without piped input throws a CommandError', async () => {
    const fs = new VirtualFileSystem();
    await expect(tr.run(makeCtx(fs, null), ['a-z', 'A-Z'])).rejects.toBeInstanceOf(CommandError);
  });

  it('tee writes to file(s) and still passes the content through', async () => {
    const fs = new VirtualFileSystem();
    const out = await tee.run(makeCtx(fs, 'line1\nline2'), ['out.txt']);
    expect(out).toBe('line1\nline2');
    expect(fs.readFile('/home/out.txt')).toBe('line1\nline2');
  });

  it('tee -a appends instead of overwriting', async () => {
    const fs = new VirtualFileSystem();
    await tee.run(makeCtx(fs, 'first'), ['out.txt']);
    await tee.run(makeCtx(fs, 'second'), ['-a', 'out.txt']);
    expect(fs.readFile('/home/out.txt')).toBe('firstsecond');
  });

  it('seq with one arg counts 1..LAST', async () => {
    const fs = new VirtualFileSystem();
    expect(await seq.run(makeCtx(fs), ['5'])).toBe('1\n2\n3\n4\n5');
  });

  it('seq with two args counts FIRST..LAST', async () => {
    const fs = new VirtualFileSystem();
    expect(await seq.run(makeCtx(fs), ['3', '6'])).toBe('3\n4\n5\n6');
  });

  it('seq with three args counts FIRST..LAST by INCREMENT, including a negative one', async () => {
    const fs = new VirtualFileSystem();
    expect(await seq.run(makeCtx(fs), ['1', '2', '9'])).toBe('1\n3\n5\n7\n9');
    expect(await seq.run(makeCtx(fs), ['5', '-1', '1'])).toBe('5\n4\n3\n2\n1');
  });

  it('seq prints nothing (not an error) when FIRST is already past LAST', async () => {
    const fs = new VirtualFileSystem();
    expect(await seq.run(makeCtx(fs), ['5', '1'])).toBe('');
  });

  it('seq -s uses a custom separator', async () => {
    const fs = new VirtualFileSystem();
    expect(await seq.run(makeCtx(fs), ['-s', ',', '1', '4'])).toBe('1,2,3,4');
  });

  it('seq -w zero-pads to the widest number', async () => {
    const fs = new VirtualFileSystem();
    expect(await seq.run(makeCtx(fs), ['-w', '8', '11'])).toBe('08\n09\n10\n11');
  });

  it('seq rejects a non-integer argument', () => {
    const fs = new VirtualFileSystem();
    // seq.run is synchronous (throws directly, doesn't return a rejected
    // Promise like the async commands above) - toThrow, not rejects.
    expect(() => seq.run(makeCtx(fs), ['1.5'])).toThrow(CommandError);
  });

  it('seq rejects a zero increment', () => {
    const fs = new VirtualFileSystem();
    expect(() => seq.run(makeCtx(fs), ['1', '0', '5'])).toThrow(CommandError);
  });
});
