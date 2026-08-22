//@ts-check

/**
 * CertMigration — v5→v6 save-file repair for TlsCertificate's TBS layout
 * change (Validity field added, see TlsCertificate._buildTbsBytes()).
 *
 * Old certSignatures were computed over the old (shorter) TBS bytes and no
 * longer verify against the new ones. migrateCertSignatures() re-signs
 * whatever it can using private keys found elsewhere in the same save file.
 */
import { describe, it, expect } from 'vitest';
import { migrateCertSignatures } from '../../src/lib/CertMigration.js';
import { TlsCertificate } from '../../src/net/models/TlsCertificate.js';

/**
 * Builds a minimal VFS-shaped file node the way VirtualFileSystem.toJSON()
 * would, holding a cert's toSaveData() JSON as its string content.
 * @param {string} name @param {any} json
 */
function certFile(name, json) {
  return { type: 'file', name, data: JSON.stringify(json), binary: false, ctime: 0, mtime: 0 };
}

/**
 * Simulates "signing under the old TBS layout" by tampering the stored
 * signature so it no longer matches the (now-current) TBS bytes — exactly
 * the situation a pre-migration save file is in.
 * @param {any} json
 */
function withStaleSignature(json) {
  return { ...json, certSignatureHex: '00'.repeat(64) };
}

describe('migrateCertSignatures', () => {
  it('is a no-op when the save file has no certificate files', async () => {
    const state = { objects: [{ fs: { type: 'dir', name: '/', children: [] } }] };
    const result = await migrateCertSignatures(state);
    expect(result.fixed).toBe(0);
    expect(result.unresolved).toBe(0);
  });

  it('re-signs a self-signed certificate using its own embedded private key', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const json = withStaleSignature(await cert.toSaveData());
    const file = certFile('server.local.cert.json', json);
    const state = { objects: [{ fs: { type: 'dir', name: '/', children: [
      { type: 'dir', name: 'certs', children: [file] },
    ] } }] };

    const result = await migrateCertSignatures(state);
    expect(result.fixed).toBe(1);
    expect(result.unresolved).toBe(0);

    // The file's data was rewritten with a signature that verifies against
    // the current TBS bytes.
    const fixedJson = JSON.parse(file.data);
    const fixedCert = await TlsCertificate.fromJSON(fixedJson);
    const tbs = /** @type {Uint8Array<ArrayBuffer>} */ (fixedCert._buildTbsBytes());
    const sig = hexToBytes(fixedJson.certSignatureHex);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      /** @type {CryptoKey} */ (fixedCert.publicKey),
      /** @type {Uint8Array<ArrayBuffer>} */ (sig),
      tbs,
    );
    expect(valid).toBe(true);
  });

  it('re-signs a CA-issued certificate using the CA private key found elsewhere in the file', async () => {
    const ca = await TlsCertificate.generate('Test CA', null, { isCA: true });
    const leaf = await TlsCertificate.generate('server.local', ca);

    const caJson = withStaleSignature(await ca.toSaveData());
    const leafJson = withStaleSignature(await leaf.toSaveData());

    const caFile = certFile('ca.cert.json', caJson);
    const leafFile = certFile('server.local.cert.json', leafJson);
    const state = { objects: [{ fs: { type: 'dir', name: '/', children: [
      { type: 'dir', name: 'certs', children: [caFile, leafFile] },
    ] } }] };

    const result = await migrateCertSignatures(state);
    expect(result.fixed).toBe(2);
    expect(result.unresolved).toBe(0);

    const fixedLeaf = await TlsCertificate.fromJSON(JSON.parse(leafFile.data));
    const fixedCa   = await TlsCertificate.fromJSON(JSON.parse(caFile.data));
    const tbs = /** @type {Uint8Array<ArrayBuffer>} */ (fixedLeaf._buildTbsBytes());
    const sig = hexToBytes(JSON.parse(leafFile.data).certSignatureHex);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      /** @type {CryptoKey} */ (fixedCa.publicKey),
      /** @type {Uint8Array<ArrayBuffer>} */ (sig),
      tbs,
    );
    expect(valid).toBe(true);
  });

  it('leaves a CA-issued certificate unresolved when the CA private key is not in the file', async () => {
    const ca = await TlsCertificate.generate('Test CA', null, { isCA: true });
    const leaf = await TlsCertificate.generate('server.local', ca);

    const leafJson = withStaleSignature(await leaf.toSaveData());
    const staleSig = leafJson.certSignatureHex;
    const leafFile = certFile('server.local.cert.json', leafJson);
    // The CA itself is NOT present anywhere in this save file.
    const state = { objects: [{ fs: { type: 'dir', name: '/', children: [
      { type: 'dir', name: 'certs', children: [leafFile] },
    ] } }] };

    const result = await migrateCertSignatures(state);
    expect(result.fixed).toBe(0);
    expect(result.unresolved).toBe(1);
    // Left untouched.
    expect(JSON.parse(leafFile.data).certSignatureHex).toBe(staleSig);
  });

  it('does not touch files that only look similar but are not certificates', async () => {
    const notACert = certFile('notes.json', { subject: 'hi', issuer: 'me' }); // missing notBefore/certSignatureHex
    const plainText = certFile('readme.txt', 'not json at all { ');
    const state = { objects: [{ fs: { type: 'dir', name: '/', children: [notACert, plainText] } }] };

    const result = await migrateCertSignatures(state);
    expect(result.fixed).toBe(0);
    expect(result.unresolved).toBe(0);
  });
});

/** @param {string} hex */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
