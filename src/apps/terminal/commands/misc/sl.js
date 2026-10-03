//@ts-check

// Easter egg: homage to sl(1) - "Steam Locomotive", the punishment for
// mistyping `ls`. Hidden (no help/man/completion entry). Like the
// original, Ctrl+C won't stop the train.
//
// The locomotive, coal tender and little-train ASCII art are taken from
// sl, which carries this notice:
//
//   Copyright 1993,1998,2014 Toyoda Masashi (mtoyoda@acm.org)
//
//   Everyone is permitted to do anything on this program including
//   copying, modifying, and improving, unless you try to pretend that
//   you wrote it.  i.e., the above copyright notice has to appear in
//   all copies.
//   THE AUTHOR DISCLAIMS ANY RESPONSIBILITY WITH REGARD TO THIS SOFTWARE.
//
// Animation code and smoke are a reimplementation for this terminal.
//
//   sl      the D51 with its coal tender
//   sl -F   it flies
//   sl -l   a little one

const D51_BODY = [
  "      ====        ________                ___________ ",
  "  _D _|  |_______/        \\__I_I_____===__|_________| ",
  "   |(_)---  |   H\\________/ |   |        =|___ ___|   ",
  "   /     |  |   H  |  |     |   |         ||_| |_||   ",
  "  |      |  |   H  |__--------------------| [___] |   ",
  "  | ________|___H__/__|_____/[][]~\\_______|       |   ",
  "  |/ |   |-----------I_____I [][] []  D   |=======|__ ",
];

/** Six wheel phases - the coupling rod goes round. */
const D51_WHEELS = [
  ["__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
   " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
   "  \\_/      \\O=====O=====O=====O_/      \\_/            "],
  ["__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
   " |/-=|___|=O=====O=====O=====O   |_____/~\\___/        ",
   "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            "],
  ["__/ =| o |=-O=====O=====O=====O \\ ____Y___________|__ ",
   " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
   "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            "],
  ["__/ =| o |=-~O=====O=====O=====O\\ ____Y___________|__ ",
   " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
   "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            "],
  ["__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
   " |/-=|___|=   O=====O=====O=====O|_____/~\\___/        ",
   "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            "],
  ["__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
   " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
   "  \\_/      \\_O=====O=====O=====O/      \\_/            "],
];

const COAL = [
  "                              ",
  "                              ",
  "    _________________         ",
  "   _|                \\_____A  ",
  " =|                        |  ",
  " -|                        |  ",
  "__|________________________|_ ",
  "|__________________________|_ ",
  "   |_D__D__D_|  |_D__D__D_|   ",
  "    \\_/   \\_/    \\_/   \\_/    ",
];

const LOGO_BODY = [
  "     ++      +------ ",
  "     ||      |+-+ |  ",
  "   /---------|| | |  ",
  "  + ========  +-+ |  ",
];

const LOGO_WHEELS = [
  [" _|--O========O~\\-+  ", "//// \\_/      \\_/    "],
  [" _|--/O========O\\-+  ", "//// \\_/      \\_/    "],
  [" _|--/~O========O-+  ", "//// \\_/      \\_/    "],
  [" _|--/~\\------/~\\-+  ", "//// \\_O========O    "],
  [" _|--/~\\------/~\\-+  ", "//// \\O========O/    "],
  [" _|--/~\\------/~\\-+  ", "//// O========O_/    "],
];

const LOGO_COAL = [
  "____                 ",
  "|   \\@@@@@@@@@@@     ",
  "|    \\@@@@@@@@@@@@@_ ",
  "|                  | ",
  "|__________________| ",
  "   (O)       (O)     ",
];

/** Smoke puffs, from fresh (big) to dissipated, drifting up and back. */
const PUFFS = ["(@@@)", "(@@)", "(@)", "()", "O", "o", "."];

/**
 * Builds one animation frame of the train with its left edge at column `x`.
 * @param {number} frame
 * @param {{ little: boolean, fly: boolean }} opts
 * @returns {{ sprite: string[], funnelX: number }}
 */
function trainSprite(frame, opts) {
  const phase = frame % 6;
  if (opts.little) {
    const loco = [...LOGO_BODY, ...LOGO_WHEELS[phase]];
    return { sprite: loco.map((row, y) => row + LOGO_COAL[y]), funnelX: 5 };
  }
  const loco = [...D51_BODY, ...D51_WHEELS[phase]];
  return { sprite: loco.map((row, y) => row + COAL[y]), funnelX: 7 };
}

/**
 * Renders a full frame into fresh `rows`×`cols` screen rows.
 * @param {number} cols
 * @param {number} rows
 * @param {number} x       left edge of the train (may be negative)
 * @param {number} frame
 * @param {{ little: boolean, fly: boolean }} opts
 * @param {Array<{x: number, y: number, age: number}>} smoke
 * @returns {string[]}
 */
export function renderSlFrame(cols, rows, x, frame, opts, smoke) {
  const screen = Array.from({ length: rows }, () => Array(cols).fill(" "));
  const { sprite } = trainSprite(frame, opts);
  const height = sprite.length;

  // Ground level: vertically centred; when flying, the train climbs one
  // row every 7 columns of travel (and the tender trails a row lower),
  // as in the original sl.c.
  const baseY = Math.floor((rows - height) / 2) + (opts.fly ? Math.floor((x - cols / 2) / 7) : 0);

  /** @param {number} sx @param {number} sy @param {string} text */
  const put = (sx, sy, text) => {
    if (sy < 0 || sy >= rows) return;
    for (let i = 0; i < text.length; i++) {
      const cx = sx + i;
      if (cx >= 0 && cx < cols && text[i] !== " ") screen[sy][cx] = text[i];
    }
  };

  for (const p of smoke) put(x + p.x, baseY + p.y, PUFFS[Math.min(p.age, PUFFS.length - 1)]);

  const locoWidth = opts.little ? LOGO_BODY[0].length : D51_BODY[0].length;
  sprite.forEach((row, y) => {
    const drop = opts.fly ? 1 : 0;
    put(x, baseY + y, row.slice(0, locoWidth));
    put(x + locoWidth, baseY + y + drop, row.slice(locoWidth));
  });

  return screen.map((r) => r.join(""));
}

/** @type {import("../types.js").Command} */
export const sl = {
  name: "sl",
  hidden: true,
  run: async (ctx, args) => {
    const app = ctx.app;
    const opts = {
      little: args.some((a) => a.startsWith("-") && a.includes("l")),
      fly: args.some((a) => a.startsWith("-") && a.includes("F")),
    };

    // Alternate screen, same as nano: snapshot now, restore when the
    // train has left.
    const savedScreen = app.screen.slice();
    const savedScreenColor = app.screenColor.slice();
    const savedOutX = app.outX;
    const savedOutY = app.outY;

    // Swallow every key while the train passes - including Enter, so
    // nothing typed in the meantime gets executed. (Ctrl+C is handled by
    // the terminal before this; it prints "^C" into the current frame,
    // which the next frame simply paints over.)
    app.rawKeyHandler = (/** @type {KeyboardEvent} */ ev) => ev.preventDefault();
    app.outX = 0;
    app.outY = 0;

    const { sprite, funnelX } = trainSprite(0, opts);
    const trainWidth = sprite[0].length;
    /** @type {Array<{x: number, y: number, age: number}>} */
    let smoke = [];

    try {
      for (let x = app.cols, frame = 0; x > -trainWidth - 12; x--, frame++) {
        // Smoke is anchored to the train (x relative to its left edge),
        // so it drifts backwards as the train moves on.
        if (frame % 4 === 0) smoke.push({ x: funnelX - 1, y: -1, age: 0 });
        smoke = smoke
          .map((p) => (frame % 2 === 0 ? { x: p.x + 1, y: p.y - (p.age % 2 === 0 ? 1 : 0), age: p.age + 1 } : p))
          .filter((p) => p.age < PUFFS.length + 2);

        app.screen = renderSlFrame(app.cols, app.rows, x, frame, opts, smoke);
        app.screenColor = app.screen.map(() => "0".repeat(app.cols));
        app._renderScreen();
        await new Promise((r) => setTimeout(r, 40));
      }
    } finally {
      app.rawKeyHandler = null;
      app.screen = savedScreen;
      app.screenColor = savedScreenColor;
      app.outX = savedOutX;
      app.outY = savedOutY;
      app._renderScreen();
    }
  },
};
