//@ts-check

import { t } from "../../../../i18n/index.js";
import { CommandError } from "../lib/errors.js";
import { Editor } from "../../Editor.js";

/**
 * Runs the full-screen editor until the user exits (Ctrl+X). Shared by
 * `nano` and `pico` - same engine, different program name shown in the
 * title bar and different tldr text.
 * @param {import("../types.js").ShellContext} ctx
 * @param {string[]} args
 * @param {string} programName
 */
async function runEditor(ctx, args, programName) {
  const fs = ctx.os.fs;
  if (!fs) throw new CommandError(t("app.terminal.commands.nano.err.noFilesystem"));

  const arg = args[0];
  /** @type {string|null} */
  let abs = null;
  let content = "";

  if (arg) {
    abs = fs.resolve(ctx.cwd, arg);
    if (fs.exists(abs)) {
      if (fs.stat(abs).type === "dir") {
        throw new CommandError(t("app.terminal.commands.nano.err.isDirectory", { path: abs }));
      }
      content = fs.readFile(abs);
    }
  }

  const app = ctx.app;

  // Alternate-screen behaviour: snapshot the current screen, restore it on
  // exit - the prior shell output reappears exactly as it was, like a real
  // terminal switching back from a full-screen program.
  const savedScreen = app.screen.slice();
  const savedScreenColor = app.screenColor.slice();
  const savedOutX = app.outX;
  const savedOutY = app.outY;

  /** @type {(() => void) | null} */
  let resolveDone = null;
  const done = new Promise((resolve) => { resolveDone = /** @type {any} */ (resolve); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    app.rawKeyHandler = null;
    app.rawFocusHandler = null;
    app.screen = savedScreen;
    app.screenColor = savedScreenColor;
    app.outX = savedOutX;
    app.outY = savedOutY;
    app._renderScreen();
    resolveDone?.();
  };

  const editor = new Editor({
    fs,
    cwd: ctx.cwd,
    path: abs,
    content,
    rows: app.rows,
    cols: app.cols,
    programName,
    onExit: close,
  });

  // Ctrl+C → same as Ctrl+X: exits outright if there's nothing unsaved,
  // otherwise asks first instead of discarding changes. A reflexive Ctrl+C
  // (common beginner muscle memory from other programs) shouldn't silently
  // throw away unsaved work the way telnet's/nc's Ctrl+C-closes-the-
  // connection convention does.
  ctx.onInterrupt(() => {
    if (closed) return;
    editor.promptExit();
    if (closed) return; // exited immediately (nothing unsaved) - screen is already restored
    editor.render(app.screen, app.screenColor, app.hasFocus);
    app._renderScreen();
  });

  app.rawKeyHandler = (ev) => {
    if (closed) return;
    editor.handleKey(ev);
    // handleKey() may have triggered onExit()/close() synchronously (e.g.
    // Ctrl+X on an unmodified buffer) - close() already restored and
    // repainted the screen, so re-rendering the (now stale) editor here
    // would clobber that restoration right back.
    if (closed) return;
    editor.render(app.screen, app.screenColor, app.hasFocus);
    app._renderScreen();
  };

  // Companion to rawKeyHandler: TerminalApp calls this when this terminal
  // gains/loses focus, so the cursor switches between the solid (focused)
  // and hollow (unfocused) glyph without waiting for the next keystroke.
  app.rawFocusHandler = () => {
    if (closed) return;
    editor.render(app.screen, app.screenColor, app.hasFocus);
  };

  editor.render(app.screen, app.screenColor, app.hasFocus);
  app._renderScreen();

  await done;
}

/** @type {import("../types.js").Command} */
export const nano = {
  name: "nano",
  category: /** @type {"fs"} */ ("fs"),
  tldr: {
    descKey: "app.terminal.commands.nano.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.nano.tldr.ex.basic", cmd: "nano datei.txt" },
      { labelKey: "app.terminal.commands.nano.tldr.ex.new",   cmd: "nano" },
    ],
  },
  run: (ctx, args) => runEditor(ctx, args, "nano"),
};

/** @type {import("../types.js").Command} */
export const pico = {
  ...nano,
  name: "pico",
  tldr: {
    descKey: "app.terminal.commands.pico.tldr.desc",
    examples: [
      { labelKey: "app.terminal.commands.pico.tldr.ex.basic", cmd: "pico datei.txt" },
    ],
  },
  run: (ctx, args) => runEditor(ctx, args, "pico"),
};
