//@ts-check

/**
 * @typedef {import("../../TerminalApp.js").TerminalApp} TerminalApp
 */

/**
 * @typedef {{
 *   print: (text?: string) => void,
 *   println: (text?: string) => void,
 * }} Writer
 */

/**
 * @typedef {{
 *   readLine: () => Promise<string|null>,
 *   readAll: () => Promise<string>,
 * }} Reader
 */

/**
 * @typedef {{
 *   app: TerminalApp,
 *   os: any,
 *   pid: number,
 *   env: Record<string, string>,
 *   cwd: string,
 *   setCwd: (cwd: string) => void,
 *   positional: string[],
 *   setPositional: (values: string[]) => void,
 *   scriptName: string,
 *   functions: Map<string, import("../Script.js").ScriptNode[]>,
 *   println: (text?: string) => void,
 *   stdout: Writer,
 *   stderr: Writer,
 *   stdin: Reader | null,
 *   clear: () => void,
 *   terminate: () => void,
 *   signal: AbortSignal,
 *   onInterrupt: (fn: () => void) => void,
 * }} ShellContext
 */

/**
 * @typedef {{
 *   name: string,
 *   hidden?: boolean,
 *   category?: "net" | "fs" | "misc" | "text",
 *   tldr?: {
 *     descKey: string,
 *     examples: Array<{ labelKey: string, cmd: string }>,
 *   },
 *   run: (ctx: ShellContext, args: string[]) => (string|void|Promise<string|void>)
 * }} Command
 */

export {};
