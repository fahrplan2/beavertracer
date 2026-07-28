//@ts-check

import { describe, it, expect } from 'vitest';
import { expandCommandSubstitutions } from '../../../src/apps/terminal/CommandSubstitution.js';

/** @param {Record<string,string>} map */
function makeRunner(map) {
  return async (/** @type {string} */ inner) => {
    if (inner in map) return map[inner];
    throw new Error(`unexpected nested command: ${inner}`);
  };
}

describe('expandCommandSubstitutions', () => {
  it('replaces a simple $(...) span with the nested result', async () => {
    const run = makeRunner({ pwd: '/etc' });
    expect(await expandCommandSubstitutions('echo $(pwd)', run)).toBe('echo /etc');
  });

  it('preserves surrounding double quotes so the result stays one word', async () => {
    const run = makeRunner({ 'echo a b': 'a b' });
    expect(await expandCommandSubstitutions('echo "$(echo a b)"', run)).toBe('echo "a b"');
  });

  it('leaves an unquoted substitution to be word-split by the caller', async () => {
    const run = makeRunner({ 'echo a b': 'a b' });
    expect(await expandCommandSubstitutions('echo $(echo a b)', run)).toBe('echo a b');
  });

  it('does not expand inside single quotes', async () => {
    const run = makeRunner({ pwd: '/etc' });
    expect(await expandCommandSubstitutions("echo '$(pwd)'", run)).toBe("echo '$(pwd)'");
  });

  it('handles a paren inside a quoted string within the substitution', async () => {
    const run = makeRunner({ 'echo ")"': ')' });
    expect(await expandCommandSubstitutions('echo $(echo ")")', run)).toBe('echo )');
  });

  it('handles nested $(...) by recursing through runNested', async () => {
    // A runNested stub that itself expands one level of nesting, mimicking
    // TerminalApp._runNestedCapture calling expandCommandSubstitutions again.
    const run = async (/** @type {string} */ inner) => {
      const expanded = await expandCommandSubstitutions(inner, async (deeper) => {
        if (deeper === 'date') return '2026-01-01';
        throw new Error('unexpected: ' + deeper);
      });
      if (expanded === 'echo 2026-01-01') return '2026-01-01';
      throw new Error('unexpected: ' + expanded);
    };
    expect(await expandCommandSubstitutions('echo $(echo $(date))', run)).toBe('echo 2026-01-01');
  });

  it('does not treat an escaped \\$( as a substitution', async () => {
    const run = makeRunner({});
    expect(await expandCommandSubstitutions(String.raw`echo \$(pwd)`, run)).toBe(String.raw`echo \$(pwd)`);
  });

  it('trims trailing newlines from the nested result (handled by the runner, not the scanner)', async () => {
    // expandCommandSubstitutions itself doesn't trim - that's _runNestedCapture's
    // job - but confirm it inserts whatever the runner returns verbatim.
    const run = makeRunner({ 'printf x\\n': 'x\n\n' });
    expect(await expandCommandSubstitutions('echo $(printf x\\n)', run)).toBe('echo x\n\n');
  });

  it('leaves $((...)) arithmetic expansion completely untouched - not a command substitution', async () => {
    const run = async (/** @type {string} */ inner) => {
      throw new Error(`should not be called as a command: ${inner}`);
    };
    expect(await expandCommandSubstitutions('echo $((1+2))', run)).toBe('echo $((1+2))');
  });

  describe('backtick substitution', () => {
    it('replaces a simple `...` span with the nested result', async () => {
      const run = makeRunner({ pwd: '/etc' });
      expect(await expandCommandSubstitutions('echo `pwd`', run)).toBe('echo /etc');
    });

    it('preserves surrounding double quotes so the result stays one word', async () => {
      const run = makeRunner({ 'echo a b': 'a b' });
      expect(await expandCommandSubstitutions('echo "`echo a b`"', run)).toBe('echo "a b"');
    });

    it('does not expand inside single quotes', async () => {
      const run = makeRunner({ pwd: '/etc' });
      expect(await expandCommandSubstitutions("echo '`pwd`'", run)).toBe("echo '`pwd`'");
    });

    it('does not end early on a backtick inside a quoted argument within the span', async () => {
      const run = makeRunner({ 'echo "`"': '`' });
      expect(await expandCommandSubstitutions('echo `echo "\\`"`', run)).toBe('echo `');
    });

    it('honors \\` for a nested backtick (POSIX escaping, unlike $(...) paren-balancing)', async () => {
      const run = async (/** @type {string} */ inner) => {
        const expanded = await expandCommandSubstitutions(inner, async (deeper) => {
          if (deeper === 'date') return '2026-01-01';
          throw new Error('unexpected: ' + deeper);
        });
        if (expanded === 'echo 2026-01-01') return '2026-01-01';
        throw new Error('unexpected: ' + expanded);
      };
      expect(await expandCommandSubstitutions('echo `echo \\`date\\``', run)).toBe('echo 2026-01-01');
    });

    it('does not treat an escaped \\` as a substitution', async () => {
      const run = makeRunner({});
      expect(await expandCommandSubstitutions(String.raw`echo \`pwd\``, run)).toBe(String.raw`echo \`pwd\``);
    });
  });
});
