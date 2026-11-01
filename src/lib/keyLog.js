//@ts-check

/**
 * TLS key log file on a simulated host: one NSS key log line per session
 * secret (what browsers write when SSLKEYLOGFILE is set). Sparktail writes it
 * when "Log session keys" is on; the PCAP viewer reads it to decrypt
 * TLS/QUIC, like Wireshark's (Pre)-Master-Secret log filename preference.
 */

export const KEYLOG_PATH = "/var/log/sslkeys.log";

/**
 * Append one line to the key log of a host's file system.
 * @param {any} fs VirtualFileSystem
 * @param {string} line
 */
export function appendKeyLogLine(fs, line) {
  if (!fs) return;
  try {
    fs.mkdir("/var/log", { recursive: true });
    const old = fs.exists(KEYLOG_PATH) ? fs.readFile(KEYLOG_PATH) : "";
    fs.writeFile(KEYLOG_PATH, old + line + "\n");
  } catch { /* read-only / full: ignore */ }
}

/**
 * Key log contents of a host ("" if there is none).
 * @param {any} fs
 * @returns {string}
 */
export function readKeyLog(fs) {
  try { return fs?.exists(KEYLOG_PATH) ? String(fs.readFile(KEYLOG_PATH)) : ""; } catch { return ""; }
}
