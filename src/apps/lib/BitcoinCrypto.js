//@ts-check

/**
 * Wallet cryptography for the simulated Bitcoin client.
 *
 * Real Bitcoin uses ECDSA on secp256k1, which WebCrypto does not offer.
 * We use ECDSA on P-256 instead — same idea (private key signs, public key
 * verifies, address = hash of the public key), different curve.
 *
 * Address format (like a Bitcoin P2PKH address):
 *   Base58Check( 0x00 ‖ SHA-256(pubkey)[0..20] )   → always starts with "1"
 * (Bitcoin uses RIPEMD-160(SHA-256(pubkey)); WebCrypto has no RIPEMD-160.)
 */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SIGN  = { name: "ECDSA", hash: "SHA-256" };

/** @param {Uint8Array} b */
const buf = b => /** @type {Uint8Array<ArrayBuffer>} */ (b);

/** @param {Uint8Array} data @returns {Promise<Uint8Array>} */
export async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf(data)));
}

/** @param {Uint8Array} bytes @returns {string} */
export function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

/** @param {string} s @returns {Uint8Array|null} */
export function base58Decode(s) {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

/** @param {Uint8Array} payload @returns {Promise<string>} */
async function base58Check(payload) {
  const check = (await sha256(await sha256(payload))).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload); full.set(check, payload.length);
  return base58Encode(full);
}

/** Address from a raw (65-byte, uncompressed) public key. @param {Uint8Array} pubRaw */
export async function addressFromPubkey(pubRaw) {
  const h = (await sha256(pubRaw)).slice(0, 20);
  const payload = new Uint8Array(21);
  payload.set(h, 1);                       // version byte 0x00 → "1…"
  return base58Check(payload);
}

/**
 * Checks format and checksum – a typo in an address is detected
 * before money is sent to nowhere.
 * @param {string} addr @returns {Promise<boolean>}
 */
export async function isValidAddress(addr) {
  const b = base58Decode(addr);
  if (!b || b.length !== 25 || b[0] !== 0) return false;
  const check = (await sha256(await sha256(b.slice(0, 21)))).slice(0, 4);
  return check.every((v, i) => v === b[21 + i]);
}

/**
 * @typedef {{ privateKey: CryptoKey, pubRaw: Uint8Array, address: string, jwk: JsonWebKey }} Wallet
 */

/** @returns {Promise<Wallet>} */
export async function generateWallet() {
  const kp = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]));
  return importWallet(await crypto.subtle.exportKey("jwk", kp.privateKey));
}

/** @param {JsonWebKey} jwk @returns {Promise<Wallet>} */
export async function importWallet(jwk) {
  const privateKey = await crypto.subtle.importKey("jwk", jwk, ECDSA, true, ["sign"]);
  const pubKey = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, ECDSA, true, ["verify"]);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pubKey));
  return { privateKey, pubRaw, address: await addressFromPubkey(pubRaw), jwk };
}

/** 64-byte signature (r ‖ s). @param {CryptoKey} privateKey @param {Uint8Array} data */
export async function sign(privateKey, data) {
  return new Uint8Array(await crypto.subtle.sign(SIGN, privateKey, buf(data)));
}

/** @param {Uint8Array} pubRaw @param {Uint8Array} sig @param {Uint8Array} data @returns {Promise<boolean>} */
export async function verify(pubRaw, sig, data) {
  try {
    const key = await crypto.subtle.importKey("raw", buf(pubRaw), ECDSA, false, ["verify"]);
    return await crypto.subtle.verify(SIGN, key, buf(sig), buf(data));
  } catch { return false; }
}
