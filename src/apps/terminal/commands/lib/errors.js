//@ts-check

/**
 * Marks an already-localized, expected command failure (bad path, bad
 * argument, missing resource, ...). Pipeline.js prints its message straight
 * to stderr with no extra wrapping - unlike a plain Error/crash, which still
 * gets wrapped in the generic "errorPrefix" translation.
 */
export class CommandError extends Error {}

/**
 * Common base for a thrown-but-not-really-an-error unwind signal
 * (`LoopControlSignal`, `ReturnSignal`) - lets `Pipeline.js` recognize and
 * let through BOTH kinds (and any future one) with a single `instanceof`
 * check instead of one per subclass.
 */
export class ControlFlowSignal extends Error {}

/**
 * Thrown by the `break`/`continue` builtins (see `commands/misc/break.js`,
 * `commands/misc/continue.js`) to unwind the call stack up to the nearest
 * enclosing loop. Deliberately propagates straight through `Pipeline.js`'s
 * own catch (which special-cases every `ControlFlowSignal`, see there)
 * instead of being swallowed like an ordinary thrown error, and then through
 * any `if`/`case`/function-call frames in between (none of which catch it),
 * so it reaches whichever `runFor`/`runWhile` in Script.js is innermost at
 * the moment it's thrown - matching real shells, where `break`/`continue`
 * inside a function called from within a loop still affects that loop.
 *
 * `level` (from `break N`/`continue N`, default 1) counts how many enclosing
 * loops to unwind: a loop catching this decrements `level` and, if still > 0,
 * rethrows the same kind for the next-outer loop to catch instead - see
 * `runFor`/`runWhile`.
 */
export class LoopControlSignal extends ControlFlowSignal {
  /** @param {"break"|"continue"} kind @param {number} level */
  constructor(kind, level) {
    super(kind);
    this.kind = kind;
    this.level = level;
  }
}

/**
 * Thrown by the `return` builtin (see `commands/misc/returnCmd.js`) to
 * unwind the call stack up to the nearest enclosing shell-function call or
 * `.`/`source` invocation - the only two POSIX-legal targets, both of which
 * run their body via Script.js's `runWithReturnBoundary` instead of plain
 * `runList`/`runScript` specifically so they catch this. Propagates through
 * `Pipeline.js` the same way `LoopControlSignal` does (see there), and
 * through any intervening `if`/`for`/`case` frames - `return` inside a loop
 * inside a function exits the whole function, not just the loop, matching
 * real shells.
 *
 * `status` (from `return N`) is the exit status to report; `null` (bare
 * `return`) means "reuse whatever `$?` already was" - see
 * `runWithReturnBoundary`.
 */
export class ReturnSignal extends ControlFlowSignal {
  /** @param {number|null} status */
  constructor(status) {
    super("return");
    this.status = status;
  }
}

export {};
