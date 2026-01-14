//@ts-check
import { ss } from "./ss.js";

/** @type {import("../types.js").Command} */
export const netstat = {
  name: "netstat",
  run: (ctx, args) => ss.run(ctx, args),
};
