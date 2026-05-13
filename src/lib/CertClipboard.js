//@ts-check

/**
 * Global in-memory clipboard for TlsCertificate data.
 * Shared across all CertManagerApp instances (i.e. across devices).
 */
export const CertClipboard = {
  /** Serialized cert data (from toJSON or toSaveData). Null when empty. @type {object|null} */
  data: null,

  /** Whether the clipboard content includes a private key. */
  hasPrivateKey: false,

  /** Display name (CN without prefix) of the stored cert. */
  cn: "",
};
