//@ts-check

import { describe, it, expect, vi, afterEach } from 'vitest';
import { figlet, renderFiglet } from '../../../../src/apps/terminal/commands/misc/figlet.js';
import { sl, renderSlFrame } from '../../../../src/apps/terminal/commands/misc/sl.js';

/** @param {string} text */
function makeReader(text) {
  return {
    async readLine() { return null; },
    async readAll() { return text; },
  };
}

describe('figlet (easter egg)', () => {
  it('is hidden and has no man entry', () => {
    expect(figlet.hidden).toBe(true);
    expect(figlet.tldr).toBeUndefined();
  });

  it('renders the standard font with smushing like real figlet', async () => {
    const out = await figlet.run(/** @type {any} */ ({ app: { cols: 80 } }), ['Hello']);
    expect(out).toBe([
      ' _   _      _ _',
      '| | | | ___| | | ___',
      '| |_| |/ _ \\ | |/ _ \\',
      '|  _  |  __/ | | (_) |',
      '|_| |_|\\___|_|_|\\___/',
      '',
    ].join('\n'));
  });

  it('supports German umlauts', () => {
    const [umlaut] = renderFiglet('Ö', 80);
    const [plain] = renderFiglet('O', 80);
    expect(umlaut[1]).toContain('(_)'); // the dots
    expect(umlaut).not.toEqual(plain);
  });

  it('wraps words at -w width', async () => {
    const out = /** @type {string} */ (await figlet.run(/** @type {any} */ ({ app: { cols: 80 } }), ['-w', '30', 'ping', 'pong']));
    const lines = out.split('\n');
    expect(lines.length).toBe(12); // two 6-row blocks
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(30);
  });

  it('reads piped stdin when given no arguments', async () => {
    const piped = await figlet.run(/** @type {any} */ ({ app: { cols: 80 }, stdin: makeReader('Hi\n') }), []);
    const direct = await figlet.run(/** @type {any} */ ({ app: { cols: 80 } }), ['Hi']);
    expect(piped).toBe(direct);
  });
});

describe('sl (easter egg)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is hidden and has no man entry', () => {
    expect(sl.hidden).toBe(true);
    expect(sl.tldr).toBeUndefined();
  });

  it('draws the locomotive into a frame of the requested size', () => {
    const rows = renderSlFrame(80, 24, 5, 0, { little: false, fly: false }, []);
    expect(rows).toHaveLength(24);
    for (const r of rows) expect(r).toHaveLength(80);
    expect(rows.join('\n')).toContain('_D _|  |_______/');
  });

  it('clips the train at the screen edges', () => {
    const rows = renderSlFrame(20, 24, -10, 0, { little: false, fly: false }, []);
    for (const r of rows) expect(r).toHaveLength(20);
  });

  it('runs the animation, swallows keys, and restores the screen afterwards', async () => {
    vi.useFakeTimers();
    const screen = ['user@host:~$ sl'.padEnd(40), ' '.repeat(40)];
    const app = {
      cols: 40, rows: 2,
      screen: screen.slice(), screenColor: ['0'.repeat(40), '0'.repeat(40)],
      outX: 0, outY: 1,
      /** @type {any} */ rawKeyHandler: null,
      _renderScreen: vi.fn(),
    };
    const done = sl.run(/** @type {any} */ ({ app }), []);
    expect(app.rawKeyHandler).toBeTypeOf('function');
    await vi.runAllTimersAsync();
    await done;
    expect(app.rawKeyHandler).toBeNull();
    expect(app.screen).toEqual(screen);
    expect(app.outY).toBe(1);
    expect(app._renderScreen.mock.calls.length).toBeGreaterThan(40);
  });
});
