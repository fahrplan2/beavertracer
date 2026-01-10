// @ts-check

export function version() {
  const v = globalThis["__APP_VERSION__"];
  return (typeof v === "string" && v) || "development";
}