//@ts-check

import { describe, it, expect, beforeEach } from 'vitest';
import { runPipeline } from '../../../src/apps/terminal/Pipeline.js';
import { parsePipeline } from '../../../src/apps/terminal/Parser.js';
import { VirtualFileSystem } from '../../../src/apps/lib/VirtualFileSystem.js';

/**
 * Builds a minimal fake TerminalApp: real VirtualFileSystem, a command
 * registry, and terminal output capture split by color ("0"=stdout, "1"=stderr).
 */
function makeApp() {
  const fs = new VirtualFileSystem();

  /** @type {string[]} */
  const stdoutChunks = [];
  /** @type {string[]} */
  const stderrChunks = [];

  const app = {
    os: { fs },
    cwd: '/home',
    commands: new Map(),
    currentAbort: new AbortController(),
    interruptHandlers: /** @type {(() => void)[]} */ ([]),
    /**
     * @param {string} text
     * @param {"0"|"1"} [color]
     */
    print(text, color = '0') {
      (color === '1' ? stderrChunks : stdoutChunks).push(text);
    },
    /**
     * @param {string} text
     * @param {"0"|"1"} [color]
     */
    println(text, color = '0') {
      app.print(text + '\n', color);
    },
  };

  // Shared across every buildCtx() call, like TerminalApp's `this.env` - so a
  // command that mutates ctx.env (export) is visible to later pipeline runs.
  const shellEnv = /** @type {Record<string,string>} */ ({});

  /** @param {Partial<import('../../../src/apps/terminal/commands/types.js').ShellContext>} overrides */
  const buildCtx = (overrides) => /** @type {any} */ ({
    app,
    os: app.os,
    pid: 1,
    env: shellEnv,
    cwd: app.cwd,
    setCwd: (cwd) => { app.cwd = cwd; },
    clear: () => {},
    terminate: () => {},
    signal: app.currentAbort.signal,
    onInterrupt: (fn) => { app.interruptHandlers.push(fn); },
    ...overrides,
  });

  return { app, fs, buildCtx, stdoutChunks, stderrChunks, stdout: () => stdoutChunks.join(''), stderr: () => stderrChunks.join('') };
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

describe('runPipeline', () => {
  /** @type {ReturnType<typeof makeApp>} */
  let env;

  beforeEach(() => {
    env = makeApp();

    env.app.commands.set('echo', {
      name: 'echo',
      run: (ctx, args) => args.join(' '),
    });

    env.app.commands.set('flaky', {
      name: 'flaky',
      run: (ctx) => { ctx.stdout.println('before'); throw new Error('boom'); },
    });

    env.app.commands.set('erroring', {
      name: 'erroring',
      run: (ctx) => { ctx.stdout.println('out-line'); ctx.stderr.println('err-line'); },
    });

    // Reads stdin line by line and uppercases each, printing as it goes.
    env.app.commands.set('upper', {
      name: 'upper',
      run: async (ctx) => {
        if (!ctx.stdin) return '';
        /** @type {string|null} */
        let line;
        while ((line = await ctx.stdin.readLine()) !== null) {
          ctx.stdout.println(line.toUpperCase());
        }
      },
    });

    env.app.commands.set('cat-stdin', {
      name: 'cat-stdin',
      run: async (ctx) => ctx.stdin ? ctx.stdin.readAll() : '',
    });
  });

  it('runs a single command and prints its return value to the terminal', async () => {
    await runPipeline(env.app, parsePipeline('echo hello world'), env.buildCtx);
    expect(env.stdout()).toBe('hello world\n');
    expect(env.stderr()).toBe('');
  });

  it('reports command-not-found on stderr without crashing the pipeline', async () => {
    await runPipeline(env.app, parsePipeline('nope'), env.buildCtx);
    // t() falls back to "[[key]]" when no locale dict is loaded (as in this
    // unit test) - assert on the key/interpolated value, not translated text.
    expect(env.stderr()).toContain('commandNotFound');
    expect(env.stdout()).toBe('');
  });

  it('routes a thrown error to stderr, not stdout', async () => {
    await runPipeline(env.app, parsePipeline('flaky'), env.buildCtx);
    expect(env.stdout()).toBe('before\n');
    expect(env.stderr()).toContain('errorPrefix');
  });

  it('redirects stdout with > (overwrite)', async () => {
    await runPipeline(env.app, parsePipeline('echo hi > out.txt'), env.buildCtx);
    expect(env.stdout()).toBe('');
    expect(env.fs.readFile('/home/out.txt')).toBe('hi\n');
  });

  it('appends with >>', async () => {
    await runPipeline(env.app, parsePipeline('echo one > out.txt'), env.buildCtx);
    await runPipeline(env.app, parsePipeline('echo two >> out.txt'), env.buildCtx);
    expect(env.fs.readFile('/home/out.txt')).toBe('one\ntwo\n');
  });

  it('redirects stderr with 2> without touching stdout', async () => {
    await runPipeline(env.app, parsePipeline('erroring 2> err.txt'), env.buildCtx);
    expect(env.stdout()).toBe('out-line\n');
    expect(env.stderr()).toBe('');
    expect(env.fs.readFile('/home/err.txt')).toBe('err-line\n');
  });

  it('merges stderr into stdout with 2>&1', async () => {
    await runPipeline(env.app, parsePipeline('erroring > out.txt 2>&1'), env.buildCtx);
    expect(env.stdout()).toBe('');
    expect(env.stderr()).toBe('');
    expect(env.fs.readFile('/home/out.txt')).toBe('out-line\nerr-line\n');
  });

  it('honors redirect ordering: 2>&1 before > keeps stderr on the terminal', async () => {
    await runPipeline(env.app, parsePipeline('erroring 2>&1 > out.txt'), env.buildCtx);
    // stderr captured *before* stdout was redirected -> still terminal, colored red
    expect(env.stderr()).toBe('err-line\n');
    expect(env.fs.readFile('/home/out.txt')).toBe('out-line\n');
  });

  it('reads stdin from a file with <', async () => {
    env.fs.writeFile('/home/in.txt', 'hello from file');
    await runPipeline(env.app, parsePipeline('cat-stdin < in.txt'), env.buildCtx);
    expect(env.stdout()).toBe('hello from file\n');
  });

  it('/dev/null is a no-op sink and empty source', async () => {
    await runPipeline(env.app, parsePipeline('echo secret > /dev/null'), env.buildCtx);
    expect(env.fs.exists('/dev/null')).toBe(false);
    expect(env.stdout()).toBe('');
  });

  it('streams pipe output incrementally rather than buffering to the end', async () => {
    /** @type {string[]} */
    const events = [];

    env.app.commands.set('slow-producer', {
      name: 'slow-producer',
      run: async (ctx) => {
        for (let i = 1; i <= 3; i++) {
          ctx.stdout.println('line' + i);
          events.push('produce:' + i);
          await sleep(15);
        }
      },
    });

    env.app.commands.set('tracking-consumer', {
      name: 'tracking-consumer',
      run: async (ctx) => {
        if (!ctx.stdin) return;
        /** @type {string|null} */
        let line;
        while ((line = await ctx.stdin.readLine()) !== null) {
          events.push('consume:' + line);
        }
      },
    });

    await runPipeline(env.app, parsePipeline('slow-producer | tracking-consumer'), env.buildCtx);

    // If piping were buffered-until-completion, every "produce" would precede
    // every "consume". Real streaming interleaves them line by line.
    expect(events).toEqual([
      'produce:1', 'consume:line1',
      'produce:2', 'consume:line2',
      'produce:3', 'consume:line3',
    ]);
  });

  it('pipes stdout through multiple stages end-to-end', async () => {
    await runPipeline(env.app, parsePipeline('echo hello world | upper'), env.buildCtx);
    expect(env.stdout()).toBe('HELLO WORLD\n');
  });

  it('lets downstream stages finish when an upstream stage errors mid-stream', async () => {
    await runPipeline(env.app, parsePipeline('flaky | upper'), env.buildCtx);
    // "before" made it through the pipe and got processed; the error itself
    // goes straight to the terminal's stderr, never through the pipe.
    expect(env.stdout()).toBe('BEFORE\n');
    expect(env.stderr()).toContain('errorPrefix');
  });

  it('keeps downstream stage running (with empty input) when a command is not found', async () => {
    await runPipeline(env.app, parsePipeline('nope | upper'), env.buildCtx);
    expect(env.stdout()).toBe('');
    expect(env.stderr()).toContain('commandNotFound');
  });

  it('aborting the shared signal stops every stage of a pipeline (Ctrl+C)', async () => {
    /** @type {string[]} */
    const events = [];

    // Cooperative long-runner, like ping/traceroute: loops until ctx.signal fires.
    env.app.commands.set('spin', {
      name: 'spin',
      run: async (ctx) => {
        for (let i = 0; !ctx.signal.aborted && i < 1000; i++) {
          ctx.stdout.println('tick' + i);
          events.push('spin:' + i);
          await sleep(5);
        }
      },
    });

    env.app.commands.set('drain', {
      name: 'drain',
      run: async (ctx) => {
        if (!ctx.stdin) return;
        /** @type {string|null} */
        let line;
        while ((line = await ctx.stdin.readLine()) !== null) events.push('drain:' + line);
      },
    });

    const pending = runPipeline(env.app, parsePipeline('spin | drain'), env.buildCtx);

    await sleep(12); // let a couple of ticks through
    env.app.currentAbort.abort();

    await pending; // must settle, not hang, once both stages see the abort

    expect(events.filter((e) => e.startsWith('spin:')).length).toBeLessThan(1000);
    // every produced tick was actually drained - the pipe wasn't left hanging
    const produced = events.filter((e) => e.startsWith('spin:')).length;
    const drained = events.filter((e) => e.startsWith('drain:')).length;
    expect(drained).toBe(produced);
  });

  it('returns true on success and false on command-not-found / thrown error', async () => {
    expect(await runPipeline(env.app, parsePipeline('echo hi'), env.buildCtx)).toBe(true);
    expect(await runPipeline(env.app, parsePipeline('nope'), env.buildCtx)).toBe(false);
    expect(await runPipeline(env.app, parsePipeline('flaky'), env.buildCtx)).toBe(false);
  });

  it('returns the exit status of the last stage in a pipeline', async () => {
    expect(await runPipeline(env.app, parsePipeline('echo hi | upper'), env.buildCtx)).toBe(true);
    expect(await runPipeline(env.app, parsePipeline('echo hi | nope'), env.buildCtx)).toBe(false);
  });

  it('routes a thrown CommandError straight to stderr, with no errorPrefix wrapper', async () => {
    const { CommandError } = await import('../../../src/apps/terminal/commands/lib/errors.js');

    env.app.commands.set('bad-input', {
      name: 'bad-input',
      run: () => { throw new CommandError('bad-input: nope'); },
    });

    const ok = await runPipeline(env.app, parsePipeline('bad-input'), env.buildCtx);

    expect(ok).toBe(false);
    expect(env.stderr()).toBe('bad-input: nope\n');
    expect(env.stderr()).not.toContain('errorPrefix');
  });

  it('a bare NAME=value stage sets an env var without needing export', async () => {
    const { envCmd } = await import('../../../src/apps/terminal/commands/misc/envCmd.js');
    env.app.commands.set('env', envCmd);

    const ok = await runPipeline(env.app, parsePipeline('Test=1'), env.buildCtx);
    expect(ok).toBe(true);

    await runPipeline(env.app, parsePipeline('env'), env.buildCtx);
    expect(env.stdout()).toContain('Test=1');
  });

  it('export persists an env var across pipeline runs, visible to env and later commands', async () => {
    const { exportCmd } = await import('../../../src/apps/terminal/commands/misc/exportCmd.js');
    const { envCmd } = await import('../../../src/apps/terminal/commands/misc/envCmd.js');
    env.app.commands.set('export', exportCmd);
    env.app.commands.set('env', envCmd);

    await runPipeline(env.app, parsePipeline('export FOO=bar'), env.buildCtx);
    await runPipeline(env.app, parsePipeline('env'), env.buildCtx);

    expect(env.stdout()).toContain('FOO=bar');
  });
});
