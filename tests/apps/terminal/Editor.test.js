//@ts-check
import { describe, it, expect, vi } from 'vitest';
import { Editor } from '../../../src/apps/terminal/Editor.js';

/**
 * @param {string} key
 * @param {{ ctrl?: boolean }} [opts]
 */
function keyEv(key, opts = {}) {
  return /** @type {any} */ ({ key, ctrlKey: !!opts.ctrl, metaKey: false, preventDefault() {} });
}

/** In-memory fs stub — only `resolve`/`writeFile` are used by Editor itself. */
function makeFs() {
  /** @type {Map<string,string>} */
  const files = new Map();
  return {
    resolve: (/** @type {string} */ cwd, /** @type {string} */ p) =>
      p.startsWith('/') ? p : `${cwd}/${p}`.replace(/\/+/g, '/'),
    writeFile: (/** @type {string} */ p, /** @type {string} */ data) => { files.set(p, data); },
    files,
  };
}

/**
 * @param {Partial<{ path: string|null, content: string, rows: number, cols: number, onExit: () => void }>} [overrides]
 */
function makeEditor(overrides = {}) {
  const fs = makeFs();
  const onExit = overrides.onExit ?? vi.fn();
  const editor = new Editor({
    fs,
    cwd: '/home',
    path: 'path' in overrides ? overrides.path ?? null : '/home/x.txt',
    content: overrides.content ?? '',
    rows: overrides.rows ?? 10,
    cols: overrides.cols ?? 20,
    onExit,
  });
  return { editor, fs, onExit };
}

describe('Editor: buffer construction', () => {
  it('splits content into lines, empty content yields a single empty line', () => {
    expect(makeEditor({ content: 'a\nb\nc' }).editor.lines).toEqual(['a', 'b', 'c']);
    expect(makeEditor({ content: '' }).editor.lines).toEqual(['']);
  });

  it('shows a "new file" message only when opened without a path', () => {
    expect(makeEditor({ path: null }).editor.message).not.toBe('');
    expect(makeEditor({ path: '/home/x.txt' }).editor.message).toBe('');
  });
});

describe('Editor: text editing', () => {
  it('inserts printable characters at the cursor', () => {
    const { editor } = makeEditor();
    editor.handleKey(keyEv('h'));
    editor.handleKey(keyEv('i'));
    expect(editor.lines).toEqual(['hi']);
    expect(editor.col).toBe(2);
    expect(editor.modified).toBe(true);
  });

  it('Enter splits the current line at the cursor', () => {
    const { editor } = makeEditor({ content: 'hello' });
    editor.col = 2; // "he|llo"
    editor.handleKey(keyEv('Enter'));
    expect(editor.lines).toEqual(['he', 'llo']);
    expect(editor.row).toBe(1);
    expect(editor.col).toBe(0);
  });

  it('Backspace at column 0 merges with the previous line', () => {
    const { editor } = makeEditor({ content: 'foo\nbar' });
    editor.row = 1; editor.col = 0;
    editor.handleKey(keyEv('Backspace'));
    expect(editor.lines).toEqual(['foobar']);
    expect(editor.row).toBe(0);
    expect(editor.col).toBe(3);
  });

  it('Backspace mid-line removes the previous character', () => {
    const { editor } = makeEditor({ content: 'abc' });
    editor.col = 2;
    editor.handleKey(keyEv('Backspace'));
    expect(editor.lines).toEqual(['ac']);
    expect(editor.col).toBe(1);
  });

  it('Delete at end-of-line merges with the next line', () => {
    const { editor } = makeEditor({ content: 'foo\nbar' });
    editor.col = 3; // end of "foo"
    editor.handleKey(keyEv('Delete'));
    expect(editor.lines).toEqual(['foobar']);
    expect(editor.row).toBe(0);
    expect(editor.col).toBe(3);
  });

  it('Tab inserts four spaces', () => {
    const { editor } = makeEditor();
    editor.handleKey(keyEv('Tab'));
    expect(editor.lines).toEqual(['    ']);
  });
});

describe('Editor: cursor movement across line boundaries', () => {
  it('ArrowLeft at column 0 moves to the end of the previous line', () => {
    const { editor } = makeEditor({ content: 'foo\nbar' });
    editor.row = 1; editor.col = 0;
    editor.handleKey(keyEv('ArrowLeft'));
    expect(editor.row).toBe(0);
    expect(editor.col).toBe(3);
  });

  it('ArrowRight at end-of-line moves to the start of the next line', () => {
    const { editor } = makeEditor({ content: 'foo\nbar' });
    editor.col = 3;
    editor.handleKey(keyEv('ArrowRight'));
    expect(editor.row).toBe(1);
    expect(editor.col).toBe(0);
  });

  it('ArrowUp/ArrowDown clamp the column to the shorter line\'s length', () => {
    const { editor } = makeEditor({ content: 'longline\nhi' });
    editor.col = 8;
    editor.handleKey(keyEv('ArrowDown'));
    expect(editor.row).toBe(1);
    expect(editor.col).toBe(2); // clamped to "hi".length
  });

  it('Home/End move to the start/end of the current line', () => {
    const { editor } = makeEditor({ content: 'hello' });
    editor.col = 2;
    editor.handleKey(keyEv('End'));
    expect(editor.col).toBe(5);
    editor.handleKey(keyEv('Home'));
    expect(editor.col).toBe(0);
  });
});

describe('Editor: viewport scrolling', () => {
  it('vertical scroll follows the cursor once it leaves the visible content area', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const { editor } = makeEditor({ content: lines, rows: 8 }); // contentHeight = 5
    for (let i = 0; i < 6; i++) editor.handleKey(keyEv('ArrowDown'));
    expect(editor.row).toBe(6);
    expect(editor.topLine).toBe(2); // row 6 must be the last visible line: topLine + 5 - 1 = 6
  });

  it('PageDown/PageUp jump by one content page and clamp at the buffer edges', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const { editor } = makeEditor({ content: lines, rows: 8 }); // contentHeight = 5
    editor.handleKey(keyEv('PageDown'));
    expect(editor.row).toBe(5);
    editor.handleKey(keyEv('PageDown'));
    editor.handleKey(keyEv('PageDown'));
    editor.handleKey(keyEv('PageDown'));
    editor.handleKey(keyEv('PageDown'));
    editor.handleKey(keyEv('PageDown'));
    expect(editor.row).toBe(29); // clamped to the last line
    editor.handleKey(keyEv('PageUp'));
    expect(editor.row).toBe(24);
  });

  it('horizontal scroll follows the cursor past the right edge', () => {
    const { editor } = makeEditor({ content: 'x'.repeat(50), cols: 10 });
    for (let i = 0; i < 15; i++) editor.handleKey(keyEv('ArrowRight'));
    expect(editor.col).toBe(15);
    expect(editor.leftCol).toBe(6); // col - cols + 1
  });
});

describe('Editor: save / exit flow', () => {
  it('Ctrl+X on an unmodified buffer exits immediately without prompting', () => {
    const { editor, onExit } = makeEditor();
    editor.handleKey(keyEv('x', { ctrl: true }));
    expect(onExit).toHaveBeenCalledOnce();
    expect(editor.mode).toBe('edit');
  });

  it('Ctrl+X on a modified buffer opens the exit prompt instead of exiting', () => {
    const { editor, onExit } = makeEditor();
    editor.handleKey(keyEv('a'));
    editor.handleKey(keyEv('x', { ctrl: true }));
    expect(editor.mode).toBe('prompt-exit');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('exit prompt "n" discards changes and exits without writing', () => {
    const { editor, fs, onExit } = makeEditor();
    editor.handleKey(keyEv('a'));
    editor.handleKey(keyEv('x', { ctrl: true }));
    editor.handleKey(keyEv('n'));
    expect(onExit).toHaveBeenCalledOnce();
    expect(fs.files.size).toBe(0);
  });

  it('exit prompt "y" with a known path writes then exits', () => {
    const { editor, fs, onExit } = makeEditor({ path: '/home/x.txt' });
    editor.handleKey(keyEv('a'));
    editor.handleKey(keyEv('x', { ctrl: true }));
    editor.handleKey(keyEv('y'));
    expect(fs.files.get('/home/x.txt')).toBe('a');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('exit prompt "y" without a path falls into the save prompt, then exits after Enter', () => {
    const { editor, fs, onExit } = makeEditor({ path: null });
    editor.handleKey(keyEv('a'));
    editor.handleKey(keyEv('x', { ctrl: true }));
    editor.handleKey(keyEv('y'));
    expect(editor.mode).toBe('prompt-save');
    for (const ch of '/home/new.txt') editor.handleKey(keyEv(ch));
    editor.handleKey(keyEv('Enter'));
    expect(fs.files.get('/home/new.txt')).toBe('a');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('exit prompt Escape cancels and returns to editing', () => {
    const { editor, onExit } = makeEditor();
    editor.handleKey(keyEv('a'));
    editor.handleKey(keyEv('x', { ctrl: true }));
    editor.handleKey(keyEv('Escape'));
    expect(editor.mode).toBe('edit');
    expect(editor.modified).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+O saves without exiting, clearing the modified flag', () => {
    const { editor, fs, onExit } = makeEditor({ path: '/home/x.txt' });
    editor.handleKey(keyEv('a'));
    editor.handleKey(keyEv('o', { ctrl: true }));
    editor.handleKey(keyEv('Enter'));
    expect(fs.files.get('/home/x.txt')).toBe('a');
    expect(editor.modified).toBe(false);
    expect(editor.mode).toBe('edit');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+O prompt Escape cancels without writing', () => {
    const { editor, fs } = makeEditor({ path: '/home/x.txt' });
    editor.handleKey(keyEv('a'));
    editor.handleKey(keyEv('o', { ctrl: true }));
    editor.handleKey(keyEv('Escape'));
    expect(editor.mode).toBe('edit');
    expect(fs.files.size).toBe(0);
    expect(editor.modified).toBe(true);
  });

  it('render() fills every row to the exact column width', () => {
    const { editor } = makeEditor({ content: 'hi', rows: 6, cols: 12 });
    const screen = Array.from({ length: 6 }, () => ' '.repeat(12));
    const color = Array.from({ length: 6 }, () => '0'.repeat(12));
    editor.render(screen, color);
    expect(screen).toHaveLength(6);
    for (const row of screen) expect(row.length).toBe(12);
    for (const row of color) expect(row.length).toBe(12);
    expect(color[0]).toBe('2'.repeat(12)); // title bar is the inverted color
  });
});
