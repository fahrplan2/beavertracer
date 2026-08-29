//@ts-check

import { describe, it, expect, beforeEach } from 'vitest';
import { parseScript, runScript } from '../../../src/apps/terminal/Script.js';
import { breakCmd } from '../../../src/apps/terminal/commands/misc/break.js';
import { continueCmd } from '../../../src/apps/terminal/commands/misc/continue.js';
import { testCmd, bracketCmd } from '../../../src/apps/terminal/commands/misc/test.js';
import { falseCmd } from '../../../src/apps/terminal/commands/misc/falseCmd.js';
import { trueCmd } from '../../../src/apps/terminal/commands/misc/trueCmd.js';
import { unsetCmd } from '../../../src/apps/terminal/commands/misc/unset.js';
import { shiftCmd } from '../../../src/apps/terminal/commands/misc/shift.js';
import { setCmd } from '../../../src/apps/terminal/commands/misc/set.js';
import { readCmd } from '../../../src/apps/terminal/commands/misc/read.js';
import { returnCmd } from '../../../src/apps/terminal/commands/misc/returnCmd.js';
import { dotCmd, sourceCmd } from '../../../src/apps/terminal/commands/misc/dot.js';
import { printfCmd } from '../../../src/apps/terminal/commands/misc/printf.js';
import { VirtualFileSystem } from '../../../src/apps/lib/VirtualFileSystem.js';
import { pwd } from '../../../src/apps/terminal/commands/misc/pwd.js';
import { cd } from '../../../src/apps/terminal/commands/misc/cd.js';
import { echo } from '../../../src/apps/terminal/commands/misc/echo.js';
import { cat } from '../../../src/apps/terminal/commands/fs/cat.js';
import { sh } from '../../../src/apps/terminal/commands/misc/sh.js';

/**
 * Builds a minimal fake TerminalApp - just enough for `runScript` to execute
 * real command pipelines (echo/break/continue/test) and capture stdout.
 * Modeled on Pipeline.test.js's makeApp().
 */
function makeApp() {
  /** @type {string[]} */
  const stdoutChunks = [];
  const fs = new VirtualFileSystem();

  const app = {
    os: { fs },
    cwd: '/home',
    commands: new Map(),
    currentAbort: new AbortController(),
    interruptHandlers: /** @type {(() => void)[]} */ ([]),
    /** @param {string} text @param {"0"|"1"} [color] */
    print(text, color = '0') {
      if (color === '0') stdoutChunks.push(text);
    },
    /** @param {string} text @param {"0"|"1"} [color] */
    println(text, color = '0') {
      app.print(text + '\n', color);
    },
  };

  app.commands.set(echo.name, echo);
  app.commands.set(cat.name, cat);
  app.commands.set(sh.name, sh);
  app.commands.set(breakCmd.name, breakCmd);
  app.commands.set(continueCmd.name, continueCmd);
  app.commands.set(testCmd.name, testCmd);
  app.commands.set(bracketCmd.name, bracketCmd);
  app.commands.set(falseCmd.name, falseCmd);
  app.commands.set(trueCmd.name, trueCmd);
  app.commands.set(unsetCmd.name, unsetCmd);
  app.commands.set(shiftCmd.name, shiftCmd);
  app.commands.set(setCmd.name, setCmd);
  app.commands.set(readCmd.name, readCmd);
  app.commands.set(returnCmd.name, returnCmd);
  app.commands.set(dotCmd.name, dotCmd);
  app.commands.set(sourceCmd.name, sourceCmd);
  app.commands.set(printfCmd.name, printfCmd);
  app.commands.set(pwd.name, pwd);
  app.commands.set(cd.name, cd);

  return { app, fs, stdout: () => stdoutChunks.join('') };
}

/**
 * @param {ReturnType<typeof makeApp>['app']} app @param {string[]} [positional]
 * @param {ReturnType<typeof parseScript>} [nodes] the parsed script this
 *   state is about to run - only needed when it actually contains a heredoc
 *   (`parseScript` stashes the extracted body/ies on a non-enumerable
 *   `.heredocs` property of the returned array, see Script.js), otherwise
 *   `state.heredocs` stays an empty Map like every other test here already
 *   relied on implicitly.
 */
function makeState(app, positional = [], nodes = undefined) {
  return {
    app,
    env: /** @type {Record<string,string>} */ ({}),
    cwd: app.cwd,
    pid: 1,
    lastExitCode: 0,
    positional,
    scriptName: 'sh',
    signal: app.currentAbort.signal,
    functions: new Map(),
    heredocs: /** @type {any} */ (nodes)?.heredocs ?? new Map(),
  };
}

describe('break/continue', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('break stops a for loop early', async () => {
    const nodes = parseScript('for i in 1 2 3 4; do test "$i" = 3 && break; echo $i; done');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('1\n2\n');
  });

  it('continue skips one iteration but keeps looping', async () => {
    const nodes = parseScript('for i in 1 2 3; do test "$i" = 2 && continue; echo $i; done');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('1\n3\n');
  });

  it('break stops a while loop early', async () => {
    const nodes = parseScript('i=0\nwhile true; do i=$((i+1)); test "$i" = 3 && break; echo $i; done');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('1\n2\n');
  });

  it('break 2 unwinds two nested for loops', async () => {
    const nodes = parseScript(
      'for i in 1 2; do for j in a b c; do test "$j" = b && break 2; echo $i$j; done; done',
    );
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('1a\n');
  });

  it('continue 2 skips the rest of the inner AND outer loop iteration', async () => {
    const nodes = parseScript(
      'for i in 1 2; do for j in a b; do test "$j" = a && continue 2; echo $i$j; done; echo after$i; done',
    );
    await runScript(nodes, makeState(env.app));
    // "after$i" and the inner "1b"/"2b" are all skipped by the level-2 continue
    // firing on the very first inner iteration of each outer pass.
    expect(env.stdout()).toBe('');
  });

  it('break inside a shell function affects the caller loop (dynamic scoping, like real shells)', async () => {
    const nodes = parseScript('stop() { break; }\nfor i in 1 2 3; do test "$i" = 2 && stop; echo $i; done');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('1\n');
  });

  it('break with a level exceeding the actual nesting targets the outermost loop instead of erroring', async () => {
    const nodes = parseScript('for i in 1 2 3; do test "$i" = 2 && break 5; echo $i; done; echo done');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('1\ndone\n');
  });

  it('a bare break/continue outside any loop fails the script instead of crashing', async () => {
    const nodes = parseScript('break');
    await expect(runScript(nodes, makeState(env.app))).rejects.toThrow();
  });

  it('break/continue set exit status 0, visible via $?', async () => {
    const nodes = parseScript('for i in 1; do false; break; done; echo $?');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('0\n');
  });
});

describe('unset', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('removes a variable', async () => {
    const nodes = parseScript('FOO=bar\necho $FOO\nunset FOO\necho [$FOO]');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('bar\n[]\n');
  });

  it('unsetting an already-absent variable is a no-op, not an error', async () => {
    const nodes = parseScript('unset NOPE\necho ok');
    const ok = await runScript(nodes, makeState(env.app));
    expect(ok).toBe(true);
    expect(env.stdout()).toBe('ok\n');
  });
});

describe('shift', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('drops $1, renumbering the rest', async () => {
    const nodes = parseScript('shift\necho $1 $2 $#');
    await runScript(nodes, makeState(env.app, ['a', 'b', 'c']));
    expect(env.stdout()).toBe('b c 2\n');
  });

  it('accepts a count', async () => {
    const nodes = parseScript('shift 2\necho $1 $#');
    await runScript(nodes, makeState(env.app, ['a', 'b', 'c']));
    expect(env.stdout()).toBe('c 1\n');
  });

  it('fails without shifting past the end', async () => {
    const nodes = parseScript('shift 5');
    const ok = await runScript(nodes, makeState(env.app, ['a']));
    expect(ok).toBe(false);
  });

  it('a while/shift loop consumes every positional parameter', async () => {
    const nodes = parseScript('while [ $# -gt 0 ]; do echo $1; shift; done');
    await runScript(nodes, makeState(env.app, ['x', 'y', 'z']));
    expect(env.stdout()).toBe('x\ny\nz\n');
  });
});

describe('set --', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('replaces the positional parameters', async () => {
    const nodes = parseScript('set -- a b c\necho $1 $2 $3 $#');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('a b c 3\n');
  });

  it('set -- with no further args clears them', async () => {
    const nodes = parseScript('set --\necho [$1]$#');
    await runScript(nodes, makeState(env.app, ['a', 'b']));
    expect(env.stdout()).toBe('[]0\n');
  });

  it('an unsupported option is ignored rather than failing the script', async () => {
    const nodes = parseScript('set -e\necho ok');
    const ok = await runScript(nodes, makeState(env.app));
    expect(ok).toBe(true);
    expect(env.stdout()).toBe('ok\n');
  });
});

describe('read', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('reads one piped line into a single variable', async () => {
    const nodes = parseScript('echo hello world | read line\necho [$line]');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('[hello world]\n');
  });

  it('splits into several variables, last one absorbing the remainder', async () => {
    const nodes = parseScript('echo a b c d | read x y z\necho $x/$y/$z');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('a/b/c d\n');
  });

  it('fails (without crashing the script) when there is no stdin to read', async () => {
    const nodes = parseScript('read x');
    const ok = await runScript(nodes, makeState(env.app));
    expect(ok).toBe(false);
  });
});

describe('return', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('ends a function early, skipping the rest of its body', async () => {
    const nodes = parseScript('f() { echo before; return; echo after; }\nf\necho done');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('before\ndone\n');
  });

  it('return 0 makes the function call succeed; nonzero makes it fail', async () => {
    const nodes = parseScript('ok() { return 0; }\nbad() { return 1; }\nok && echo ok-ran\nbad || echo bad-failed');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('ok-ran\nbad-failed\n');
  });

  it('return inside a loop inside a function exits the whole function, not just the loop', async () => {
    const nodes = parseScript(
      'f() { for i in 1 2 3; do echo $i; test "$i" = 2 && return; done; echo never; }\nf\necho after',
    );
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('1\n2\nafter\n');
  });

  it('a bare return outside any function/sourced script fails the script instead of crashing', async () => {
    const nodes = parseScript('return');
    await expect(runScript(nodes, makeState(env.app))).rejects.toThrow();
  });
});

describe('.  /  source', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('runs in the current shell: a variable assignment persists to the caller', async () => {
    env.fs.writeFile('/home/vars.sh', 'FOO=bar\n');
    const nodes = parseScript('. vars.sh\necho $FOO');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('bar\n');
  });

  it('a function defined in the sourced file is callable afterward', async () => {
    env.fs.writeFile('/home/funcs.sh', 'greet() { echo hi $1; }\n');
    const nodes = parseScript('. funcs.sh\ngreet world');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('hi world\n');
  });

  it('a cd inside the sourced script affects the caller (unlike sh script.sh)', async () => {
    env.fs.mkdir('/home/sub');
    env.fs.writeFile('/home/cdto.sh', 'cd sub\n');
    const nodes = parseScript('. cdto.sh\npwd');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('/home/sub\n');
  });

  it('without its own args, inherits and can mutate the caller\'s positional params', async () => {
    env.fs.writeFile('/home/shiftit.sh', 'shift\n');
    const nodes = parseScript('. shiftit.sh\necho $1');
    await runScript(nodes, makeState(env.app, ['a', 'b']));
    expect(env.stdout()).toBe('b\n');
  });

  it('with its own args, sets positional params only for its own duration', async () => {
    env.fs.writeFile('/home/showargs.sh', 'echo $1 $2\n');
    const nodes = parseScript('. showargs.sh x y\necho $1');
    await runScript(nodes, makeState(env.app, ['orig']));
    expect(env.stdout()).toBe('x y\norig\n');
  });

  it('return inside a sourced script ends just that script, not the caller', async () => {
    env.fs.writeFile('/home/early.sh', 'echo one\nreturn\necho never\n');
    const nodes = parseScript('. early.sh\necho after');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('one\nafter\n');
  });

  it('"source" is accepted as an alias for "."', async () => {
    env.fs.writeFile('/home/vars.sh', 'FOO=bar\n');
    const nodes = parseScript('source vars.sh\necho $FOO');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('bar\n');
  });
});

describe('printf', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('substitutes %s/%d and processes format-string escapes, with no auto-appended newline', async () => {
    const nodes = parseScript('printf "%s is %d\\n"  beaver 3');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('beaver is 3\n');
  });

  it('does not append a trailing newline when the format has none', async () => {
    const nodes = parseScript('printf %s hi');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('hi');
  });

  it('reuses the format string when there are more arguments than conversions', async () => {
    const nodes = parseScript('printf "%s\\n" a b c');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('a\nb\nc\n');
  });

  it('supports width and left-justify/zero-pad flags', async () => {
    const nodes = parseScript('printf "[%5s][%-5s][%05d]\\n" ab ab 42');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('[   ab][ab   ][00042]\n');
  });

  it('%% prints a literal percent sign', async () => {
    const nodes = parseScript('printf "100%%\\n"');
    await runScript(nodes, makeState(env.app));
    expect(env.stdout()).toBe('100%\n');
  });
});

describe('sh (multi-command integration)', () => {
  // Not a direct-runScript unit test like everything above: this writes a
  // whole script FILE to the virtual filesystem using real terminal commands
  // (cat + a redirect + a heredoc) and then executes it with a separate
  // `sh <file>` call - the same two-step "create a script, then run it" a
  // student would actually type, exercising cat/redirects/heredocs/sh/
  // if/for/while/functions/arithmetic together in one pass instead of each
  // in isolation.
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => { env = makeApp(); });

  it('writes a script with a function, if/else, for and while via cat+heredoc, then runs it with sh', async () => {
    const script = [
      'greet() {',
      '  echo "hello $1"',
      '}',
      '',
      'for i in 1 2 3; do',
      '  if [ "$i" = 2 ]; then',
      '    echo two',
      '  else',
      '    echo "n:$i"',
      '  fi',
      'done',
      '',
      'count=0',
      'while [ "$count" -lt 3 ]; do',
      '  count=$((count + 1))',
      'done',
      'echo "final:$count"',
      '',
      'greet world',
    ].join('\n');

    // The heredoc's delimiter is quoted ('EOF') so its body - the script
    // text above, itself full of $i/$((...)) - is stored and written out
    // completely literally, not expanded while THIS outer command runs.
    const cmdText = `cat > script.sh <<'EOF'\n${script}\nEOF\nsh script.sh`;

    const nodes = parseScript(cmdText);
    const ok = await runScript(nodes, makeState(env.app, [], nodes));

    expect(ok).toBe(true);
    // cat > script.sh really did create the file with exactly that content.
    expect(env.fs.readFile('/home/script.sh')).toBe(script + '\n');
    // ...and sh actually ran it, exercising every construct in one script.
    expect(env.stdout()).toBe('n:1\ntwo\nn:3\nfinal:3\nhello world\n');
  });
});
