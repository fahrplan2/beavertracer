//@ts-check

/**
 * @typedef {import("../../TerminalApp.js").TerminalApp} TerminalApp
 */

/**
 * @typedef {{
 *   app: TerminalApp,
 *   os: any,
 *   pid: number,
 *   env: Record<string, string>,
 *   cwd: string,
 *   setCwd: (cwd: string) => void,
 *   println: (text?: string) => void,
 *   clear: () => void,
 *   terminate: () => void,
 *   signal: AbortSignal,
 *   onInterrupt: (fn: () => void) => void,
 * }} ShellContext
 */

/**
 * @typedef {{
 *   name: string,
 *   run: (ctx: ShellContext, args: string[]) => (string|void|Promise<string|void>)
 * }} Command
 */

export {};
