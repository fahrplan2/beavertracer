//@ts-check

import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../../../src/apps/lib/VirtualFileSystem.js';
import { scanWords, longestCommonPrefix, computeCompletions } from '../../../src/apps/terminal/Completion.js';

describe('scanWords', () => {
  it('splits plain whitespace-separated words', () => {
    expect(scanWords('ls -la /ho')).toEqual({ typed: '/ho', priorWords: ['ls', '-la'] });
  });

  it('returns an empty typed word right after a trailing space', () => {
    expect(scanWords('ls ')).toEqual({ typed: '', priorWords: ['ls'] });
  });

  it('keeps spaces inside quotes as part of one word', () => {
    expect(scanWords('cat "some fi')).toEqual({ typed: 'some fi', priorWords: ['cat'] });
  });

  it('treats a chain operator as its own prior word', () => {
    expect(scanWords('ls -l | gr')).toEqual({ typed: 'gr', priorWords: ['ls', '-l', '|'] });
    expect(scanWords('mkdir x && c')).toEqual({ typed: 'c', priorWords: ['mkdir', 'x', '&&'] });
  });

  it('handles an empty line', () => {
    expect(scanWords('')).toEqual({ typed: '', priorWords: [] });
  });
});

describe('longestCommonPrefix', () => {
  it('returns "" for an empty list', () => {
    expect(longestCommonPrefix([])).toBe('');
  });

  it('returns the single name unchanged for a one-element list', () => {
    expect(longestCommonPrefix(['grep'])).toBe('grep');
  });

  it('finds the shared prefix across names', () => {
    expect(longestCommonPrefix(['grep', 'green', 'gray'])).toBe('gr');
  });

  it('returns "" when there is no shared prefix', () => {
    expect(longestCommonPrefix(['ls', 'cat'])).toBe('');
  });
});

describe('computeCompletions - command position', () => {
  const commandNames = ['ls', 'ln', 'cat', 'cd', 'cp'];

  it('resolves a unique command match', () => {
    const res = computeCompletions('ca', { commandNames, cwd: '/home', fs: null });
    expect(res).toEqual({ prefix: 'ca', names: ['cat'], trailingFor: expect.any(Function) });
    expect(res?.trailingFor('cat')).toBe(' ');
  });

  it('resolves ambiguous matches sorted, with a shared prefix', () => {
    const res = computeCompletions('l', { commandNames, cwd: '/home', fs: null });
    expect(res?.names).toEqual(['ln', 'ls']);
  });

  it('returns null for an empty prefix (start of line)', () => {
    expect(computeCompletions('', { commandNames, cwd: '/home', fs: null })).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(computeCompletions('zz', { commandNames, cwd: '/home', fs: null })).toBeNull();
  });

  it('treats the word right after a chain operator as a command position', () => {
    const res = computeCompletions('cat foo | c', { commandNames, cwd: '/home', fs: null });
    expect(res?.names).toEqual(['cat', 'cd', 'cp']);
  });
});

describe('computeCompletions - path position', () => {
  /** @returns {VirtualFileSystem} */
  function makeFs() {
    const fs = new VirtualFileSystem();
    fs.mkdir('/home/project', { recursive: true });
    fs.writeFile('/home/project/readme.txt', 'hi');
    fs.writeFile('/home/project/report.txt', 'hi');
    fs.writeFile('/home/.secret', 'shh');
    return fs;
  }

  it('completes a unique file with a trailing space', () => {
    const fs = makeFs();
    const res = computeCompletions('cat project/rea', { commandNames: [], cwd: '/home', fs });
    expect(res?.names).toEqual(['readme.txt']);
    expect(res?.trailingFor('readme.txt')).toBe(' ');
  });

  it('completes a unique directory with a trailing slash', () => {
    const fs = makeFs();
    const res = computeCompletions('cd proj', { commandNames: [], cwd: '/home', fs });
    expect(res?.names).toEqual(['project']);
    expect(res?.trailingFor('project')).toBe('/');
  });

  it('lists ambiguous entries under a nested path', () => {
    const fs = makeFs();
    const res = computeCompletions('ls project/re', { commandNames: [], cwd: '/home', fs });
    expect(res?.prefix).toBe('re');
    expect(res?.names.sort()).toEqual(['readme.txt', 'report.txt']);
  });

  it('hides dotfiles unless the typed prefix starts with a dot', () => {
    const fs = makeFs();
    expect(computeCompletions('cat .se', { commandNames: [], cwd: '/home', fs })?.names).toEqual(['.secret']);

    // "cat " (typed word after "cat" is empty) - path position with no prefix
    // at all: lists everything in cwd except dotfiles. VirtualFileSystem
    // seeds /home/notes.txt by default, alongside the /home/project dir
    // created above.
    const res = computeCompletions('cat ', { commandNames: [], cwd: '/home', fs });
    expect(res?.names.sort()).toEqual(['notes.txt', 'project']);
  });

  it('returns null for a non-existent directory', () => {
    const fs = makeFs();
    expect(computeCompletions('cat nope/x', { commandNames: [], cwd: '/home', fs })).toBeNull();
  });

  it('returns null when there is no filesystem', () => {
    expect(computeCompletions('foo bar/x', { commandNames: [], cwd: '/home', fs: null })).toBeNull();
  });
});
