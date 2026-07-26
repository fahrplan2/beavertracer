//@ts-check

/**
 * Marks an already-localized, expected command failure (bad path, bad
 * argument, missing resource, ...). Pipeline.js prints its message straight
 * to stderr with no extra wrapping - unlike a plain Error/crash, which still
 * gets wrapped in the generic "errorPrefix" translation.
 */
export class CommandError extends Error {}

export {};
