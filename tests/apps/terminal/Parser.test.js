//@ts-check

import { describe, it, expect } from 'vitest';
import { parsePipeline } from '../../../src/apps/terminal/Parser.js';

describe('parsePipeline', () => {
  it('parses a plain command with no operators', () => {
    const stages = parsePipeline('ls -la /home');
    expect(stages).toEqual([{ cmd: 'ls', args: ['-la', '/home'], redirects: [] }]);
  });

  it('respects single and double quotes, no escapes', () => {
    const stages = parsePipeline(`echo "hello world" 'foo bar'`);
    expect(stages).toEqual([{ cmd: 'echo', args: ['hello world', 'foo bar'], redirects: [] }]);
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
});
