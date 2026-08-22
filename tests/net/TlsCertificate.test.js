//@ts-check

/**
 * TlsCertificate — validity period (notBefore/notAfter).
 *
 * Covers the wire-format gap this test guards against: the DER TBSCertificate
 * didn't used to carry a Validity field at all, so a peer's real notAfter
 * never survived a handshake round trip (see TlsSession._parseSingleCertDer()).
 */
import { describe, it, expect } from 'vitest';
import { TlsCertificate } from '../../src/net/models/TlsCertificate.js';

describe('TlsCertificate', () => {
  it('stamps notBefore from Date.now() by default', async () => {
    const before = Date.now();
    const cert = await TlsCertificate.generate('server.local');
    const after = Date.now();
    expect(cert.notBefore).toBeGreaterThanOrEqual(before);
    expect(cert.notBefore).toBeLessThanOrEqual(after);
  });

  it('honors an explicit nowMs for notBefore (e.g. a skewed virtual clock)', async () => {
    const skewedNowMs = Date.UTC(2000, 0, 1);
    const cert = await TlsCertificate.generate('server.local', null, { nowMs: skewedNowMs });
    expect(cert.notBefore).toBe(skewedNowMs);
    expect(cert.notAfter).toBe(skewedNowMs + 365 * 24 * 3600 * 1000);
  });

  it('sign() also honors an explicit nowMs', async () => {
    const ca = await TlsCertificate.generate('Test CA', null, { isCA: true });
    const leaf = await TlsCertificate.generate('server.local');
    const skewedNowMs = Date.UTC(2030, 5, 15);
    const signed = await TlsCertificate.sign(leaf, ca, { nowMs: skewedNowMs });
    expect(signed.notBefore).toBe(skewedNowMs);
  });

  it('validityStatus() classifies valid / expired / not-yet-valid', async () => {
    const cert = await TlsCertificate.generate('server.local', null, { validityDays: 30 });
    expect(cert.validityStatus(cert.notBefore + 1000)).toBe('valid');
    expect(cert.validityStatus(cert.notAfter + 1000)).toBe('expired');
    expect(cert.validityStatus(cert.notBefore - 1000)).toBe('notYetValid');
  });

  it('round-trips notBefore/notAfter through toDer() (the TBS bytes that get signed)', async () => {
    const cert = await TlsCertificate.generate('server.local', null, { nowMs: Date.UTC(2026, 0, 1) });
    const der = cert.toDer();

    // Manually walk the same DER structure TlsSession._parseSingleCertDer() parses:
    // Certificate > TBSCertificate > (serial, algId, issuer, validity, ...)
    /** @param {Uint8Array} data @param {number} offset */
    const nextElement = (data, offset) => {
      let off = offset + 1;
      let len;
      if (data[off] < 0x80) { len = data[off]; off += 1; }
      else if (data[off] === 0x81) { len = data[off + 1]; off += 2; }
      else { len = (data[off + 1] << 8) | data[off + 2]; off += 3; }
      return { start: offset, contentStart: off, end: off + len };
    };
    const outer = nextElement(der, 0);
    const tbs = nextElement(der, outer.contentStart);
    const serial = nextElement(der, tbs.contentStart);
    const algId = nextElement(der, serial.end);
    const issuer = nextElement(der, algId.end);
    const validity = nextElement(der, issuer.end);
    const notBeforeEl = nextElement(der, validity.contentStart);
    const notAfterEl = nextElement(der, notBeforeEl.end);
    const dec = new TextDecoder();
    const notBefore = Number(dec.decode(der.slice(notBeforeEl.contentStart, notBeforeEl.end)));
    const notAfter = Number(dec.decode(der.slice(notAfterEl.contentStart, notAfterEl.end)));

    expect(notBefore).toBe(cert.notBefore);
    expect(notAfter).toBe(cert.notAfter);
  });

  it('validity period is covered by the certificate signature (tampering invalidates it)', async () => {
    const cert = await TlsCertificate.generate('server.local');
    const tamperedNotAfter = cert.notAfter + 100 * 365 * 24 * 3600 * 1000; // "extend" validity by a century

    const originalTbs = cert._buildTbsBytes();
    cert.notAfter = tamperedNotAfter;
    const tamperedTbs = cert._buildTbsBytes();

    expect(Array.from(tamperedTbs)).not.toEqual(Array.from(originalTbs));

    // The stored signature was computed over the original TBS bytes, so
    // verifying it against the tampered TBS bytes must fail.
    const sig = /** @type {Uint8Array} */ (cert.certSignature);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      /** @type {CryptoKey} */ (cert.publicKey),
      /** @type {Uint8Array<ArrayBuffer>} */ (sig),
      /** @type {Uint8Array<ArrayBuffer>} */ (tamperedTbs),
    );
    expect(valid).toBe(false);
  });
});
