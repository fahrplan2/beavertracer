//@ts-check

import { describe, it, expect } from 'vitest';
import { parseScript, IncompleteInputError } from '../../../src/apps/terminal/Script.js';
import { CommandError } from '../../../src/apps/terminal/commands/lib/errors.js';

describe('parseScript - plain statements', () => {
  it('merges a run of plain lines into one simple node (split lazily at run time, like an interactive ; chain)', () => {
    const nodes = parseScript('echo a\necho b\n');
    expect(nodes).toEqual([{ type: 'simple', text: 'echo a\necho b' }]);
  });

  it('drops comments and blank lines', () => {
    const nodes = parseScript('# a comment\n\necho hi # trailing\n');
    expect(nodes).toEqual([{ type: 'simple', text: 'echo hi' }]);
  });

  it('keeps a ;/&&/||-chained line as one simple node', () => {
    const nodes = parseScript('mkdir x && cd x; pwd');
    expect(nodes).toEqual([{ type: 'simple', text: 'mkdir x && cd x; pwd' }]);
  });
});

describe('parseScript - if', () => {
  it('parses if/then/fi', () => {
    const nodes = parseScript('if true; then\n  echo yes\nfi');
    expect(nodes).toEqual([
      {
        type: 'if',
        clauses: [{ condText: 'true', body: [{ type: 'simple', text: 'echo yes' }] }],
        elseBody: null,
      },
    ]);
  });

  it('parses if/else/fi', () => {
    const nodes = parseScript('if false; then\n  echo yes\nelse\n  echo no\nfi');
    expect(nodes).toEqual([
      {
        type: 'if',
        clauses: [{ condText: 'false', body: [{ type: 'simple', text: 'echo yes' }] }],
        elseBody: [{ type: 'simple', text: 'echo no' }],
      },
    ]);
  });

  it('parses if/elif/elif/else/fi', () => {
    const nodes = parseScript('if a; then\n  x\nelif b; then\n  y\nelif c; then\n  z\nelse\n  w\nfi');
    const node = /** @type {any} */ (nodes[0]);
    expect(node.type).toBe('if');
    expect(node.clauses).toEqual([
      { condText: 'a', body: [{ type: 'simple', text: 'x' }] },
      { condText: 'b', body: [{ type: 'simple', text: 'y' }] },
      { condText: 'c', body: [{ type: 'simple', text: 'z' }] },
    ]);
    expect(node.elseBody).toEqual([{ type: 'simple', text: 'w' }]);
  });

  it('supports an empty then-body', () => {
    const nodes = parseScript('if true; then\nfi');
    expect(nodes).toEqual([{ type: 'if', clauses: [{ condText: 'true', body: [] }], elseBody: null }]);
  });

  it('supports nested if inside a body', () => {
    const nodes = parseScript('if a; then\n  if b; then\n    echo inner\n  fi\nfi');
    const outer = /** @type {any} */ (nodes[0]);
    expect(outer.clauses[0].body).toEqual([
      { type: 'if', clauses: [{ condText: 'b', body: [{ type: 'simple', text: 'echo inner' }] }], elseBody: null },
    ]);
  });

  it('a missing fi is "incomplete", not a real error - the interactive prompt keeps waiting for it', () => {
    expect(() => parseScript('if true; then\n  echo hi')).toThrow(IncompleteInputError);
  });

  it('an unexpected keyword is a real, immediate error - not "incomplete"', () => {
    // t() falls back to "[[key]]" with no locale dict loaded (as in this
    // unit test) - assert on the key, not the (untranslated here) message.
    expect(() => parseScript('done')).toThrow(CommandError);
    expect(() => parseScript('done')).toThrow(/unexpectedToken/);
  });

  it('a missing "then" reports "expected then, got fi" - not "nested compound commands"', () => {
    expect(() => parseScript('if true; echo Hi; fi')).toThrow(CommandError);
    expect(() => parseScript('if true; echo Hi; fi')).toThrow(/unexpectedGotToken/);
  });

  it('a genuinely nested construct inside a condition still reports "unexpectedInCondition"', () => {
    expect(() => parseScript('if if true; then echo x; fi; then echo y; fi')).toThrow(/unexpectedInCondition/);
  });
});

describe('parseScript - for', () => {
  it('parses for/in/do/done', () => {
    const nodes = parseScript('for f in a b c; do\n  echo $f\ndone');
    expect(nodes).toEqual([
      { type: 'for', varName: 'f', wordsText: 'a b c', body: [{ type: 'simple', text: 'echo $f' }] },
    ]);
  });

  it('requires an explicit "in" (no implicit $@ form)', () => {
    expect(() => parseScript('for f; do echo $f; done')).toThrow();
  });
});

describe('parseScript - while/until', () => {
  it('parses while/do/done', () => {
    const nodes = parseScript('while true; do\n  echo x\ndone');
    expect(nodes).toEqual([
      { type: 'while', condText: 'true', body: [{ type: 'simple', text: 'echo x' }], negate: false },
    ]);
  });

  it('parses until/do/done with negate: true', () => {
    const nodes = parseScript('until false; do\n  echo x\ndone');
    expect(nodes).toEqual([
      { type: 'while', condText: 'false', body: [{ type: 'simple', text: 'echo x' }], negate: true },
    ]);
  });
});

describe('parseScript - case', () => {
  it('parses multiple clauses with alternated patterns', () => {
    const nodes = parseScript('case $1 in\n  foo|bar) echo match ;;\n  *) echo default ;;\nesac');
    expect(nodes).toEqual([
      {
        type: 'case',
        subjectText: '$1',
        clauses: [
          { patterns: ['foo', 'bar'], body: [{ type: 'simple', text: 'echo match' }] },
          { patterns: ['*'], body: [{ type: 'simple', text: 'echo default' }] },
        ],
      },
    ]);
  });

  it('allows the last clause to omit the trailing ;;', () => {
    const nodes = parseScript('case $1 in\n  *) echo default\nesac');
    expect(nodes).toEqual([
      { type: 'case', subjectText: '$1', clauses: [{ patterns: ['*'], body: [{ type: 'simple', text: 'echo default' }] }] },
    ]);
  });

  it('supports an empty case (no clauses)', () => {
    const nodes = parseScript('case $1 in\nesac');
    expect(nodes).toEqual([{ type: 'case', subjectText: '$1', clauses: [] }]);
  });
});
