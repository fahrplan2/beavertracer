//@ts-check

import { TlsCertificate } from "../net/models/TlsCertificate.js";

/**
 * v5 → v6 save-file migration: TlsCertificate's signed TBS bytes gained a
 * Validity field (notBefore/notAfter — see TlsCertificate._buildTbsBytes()),
 * so certSignatures computed before that change no longer verify against the
 * (now different) TBS bytes.
 *
 * Best-effort repair: walk the whole save tree for VFS files that look like
 * a saved TlsCertificate (any node with a filesystem can hold one — Computer,
 * Tablet, Router — so this walks generically rather than special-casing each
 * kind) and re-sign each one with whichever private key its issuer resolves
 * to:
 *  - self-signed → its own key
 *  - CA-signed    → the private key of a cert *elsewhere in the same save
 *                    file* whose publicKeyId matches chain[0]
 *
 * Certs whose signing key isn't present anywhere in the file (e.g. the
 * issuing CA was only ever exported without its private key) are left
 * untouched — they'll behave exactly as they did before this migration ran
 * (fail as untrusted/invalid-signature the next time they're actually used)
 * and need a manual re-sign in the Cert Manager.
 *
 * Pure data transform — no DOM/UI side effects; mutates and returns `state`
 * in place, plus how many certs were fixed/left unresolved so the caller can
 * decide how to inform the user.
 *
 * @param {any} state
 * @returns {Promise<{ state: any, fixed: number, unresolved: number }>}
 */
export async function migrateCertSignatures(state) {
  /** @type {{ fileNode: any, json: any }[]} */
  const certFiles = [];

  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "file" && typeof node.data === "string") {
      try {
        const json = JSON.parse(node.data);
        if (json && typeof json.subject === "string" && typeof json.issuer === "string"
          && typeof json.notBefore === "number" && "certSignatureHex" in json) {
          certFiles.push({ fileNode: node, json });
        }
      } catch { /* not JSON, or not a cert file — ignore */ }
      return;
    }
    const children = Array.isArray(node) ? node
      : Array.isArray(node.children) ? node.children
      : Object.values(node);
    for (const child of children) walk(child);
  };
  walk(state);

  if (certFiles.length === 0) return { state, fixed: 0, unresolved: 0 };

  // Import every private key we have, keyed by its cert's publicKeyId.
  /** @type {Map<string, CryptoKey>} */
  const privateKeysById = new Map();
  for (const { json } of certFiles) {
    if (!json.privateKeyJwk || !json.publicKeyId) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk", json.privateKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"],
      );
      privateKeysById.set(json.publicKeyId, key);
    } catch { /* skip unimportable keys */ }
  }

  let fixed = 0, unresolved = 0;
  for (const { fileNode, json } of certFiles) {
    try {
      const cert = await TlsCertificate.fromJSON(json);
      const signerKeyId = cert.selfSigned ? cert.publicKeyId : (cert.chain[0]?.publicKeyId ?? null);
      const signingKey = signerKeyId ? privateKeysById.get(signerKeyId) : undefined;
      if (!signingKey) { unresolved++; continue; }

      await cert.resignWith(signingKey);
      json.certSignatureHex = /** @type {any} */ (cert.toJSON()).certSignatureHex;
      fileNode.data = JSON.stringify(json, null, 2);
      fixed++;
    } catch { unresolved++; }
  }

  return { state, fixed, unresolved };
}
