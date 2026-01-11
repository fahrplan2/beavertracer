//@ts-check

/** @param {string} s */
export function ipStringToNumber(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  const a = m.slice(1).map((x) => Number(x));
  if (a.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return (((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0);
}

/** @param {number} n */
export function ipNumberToString(n) {
  const a = (n >>> 24) & 255;
  const b = (n >>> 16) & 255;
  const c = (n >>> 8) & 255;
  const d = n & 255;
  return `${a}.${b}.${c}.${d}`;
}