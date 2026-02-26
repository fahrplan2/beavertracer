//@ts-check

export class IPAddress {
  /** @type {4|6} */
  _version = 4;

  /** @type {number} */
  _numberv4 = 0; // uint32

  /** @type {Uint8Array} */
  _numberv6 = new Uint8Array(16); // 16 bytes

  /**
   * @param {4|6} version
   * @param {number|Uint8Array} number
   */
  constructor(version, number) {
    if (version === 4) {
      if (typeof number !== "number" || !Number.isFinite(number)) {
        throw new TypeError("IPv4 number must be a finite number (uint32).");
      }
      const n = number >>> 0; // force uint32
      this._version = 4;
      this._numberv4 = n;
    } else if (version === 6) {
      if (!(number instanceof Uint8Array) || number.length !== 16) {
        throw new TypeError("IPv6 number must be a Uint8Array(16).");
      }
      this._version = 6;
      this._numberv6 = new Uint8Array(number); // copy
    } else {
      throw new TypeError("version must be 4 or 6");
    }
  }

  /** @returns {number|Uint8Array} */
  getNumber() {
    return this._version === 4 ? this._numberv4 : new Uint8Array(this._numberv6);
  }

  /** @returns {boolean} */
  isV4() {
    return this._version === 4;
  }

  /** @returns {boolean} */
  isV6() {
    return this._version === 6;
  }

  /** @returns {Uint8Array} */
  toUInt8() {
    if (this._version === 4) {
      const n = this._numberv4 >>> 0;
      return new Uint8Array([
        (n >>> 24) & 0xff,
        (n >>> 16) & 0xff,
        (n >>> 8) & 0xff,
        n & 0xff,
      ]);
    }
    return new Uint8Array(this._numberv6);
  }

  /** @returns {string} */
  toString() {
    if (this._version === 4) {
      const b = this.toUInt8();
      return `${b[0]}.${b[1]}.${b[2]}.${b[3]}`;
    }
    return IPAddress._ipv6BytesToString(this._numberv6);
  }

  /**
   * Parse IPv4 ("1.2.3.4") or IPv6 (with :: compression, optional IPv4 tail).
   * @param {string} s
   * @returns {IPAddress}
   */
  static fromString(s) {
    const str = s.trim();
    if (str.includes(":")) {
      const bytes = IPAddress._parseIPv6(str);
      return new IPAddress(6, bytes);
    }
    const n = IPAddress._parseIPv4ToUint32(str);
    return new IPAddress(4, n);
  }

  /**
   * @param {Uint8Array} bytes
   * @returns {IPAddress}
   */
  static fromUInt8(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 4) {
      throw new TypeError("fromUInt8 expects Uint8Array(4) for IPv4");
    }
    const n = (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
    return new IPAddress(4, n);
  }

  // ---------- helpers ----------

  /**
   * @param {string} s
   * @returns {number} uint32
   */
  static _parseIPv4ToUint32(s) {
    const parts = s.split(".");
    if (parts.length !== 4) throw new Error("Invalid IPv4 address.");
    const bytes = parts.map((p) => {
      if (!/^\d+$/.test(p)) throw new Error("Invalid IPv4 address.");
      const v = Number(p);
      if (v < 0 || v > 255) throw new Error("Invalid IPv4 address.");
      return v;
    });
    // assemble big-endian
    return (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
  }

  /**
   * Very practical IPv6 parser:
   * - supports :: compression
   * - supports IPv4-embedded tail like ::ffff:192.168.0.1
   * - rejects invalid formats
   * @param {string} input
   * @returns {Uint8Array}
   */
  static _parseIPv6(input) {
    let s = input.toLowerCase();

    // Handle IPv4 tail (last part contains dots)
    let ipv4TailBytes = null;
    const lastColon = s.lastIndexOf(":");
    if (lastColon >= 0) {
      const tail = s.slice(lastColon + 1);
      if (tail.includes(".")) {
        const v4 = IPAddress._parseIPv4ToUint32(tail);
        ipv4TailBytes = new Uint8Array([
          (v4 >>> 24) & 0xff,
          (v4 >>> 16) & 0xff,
          (v4 >>> 8) & 0xff,
          v4 & 0xff,
        ]);
        s = s.slice(0, lastColon) + ":ipv4tail";
      }
    }

    const hasDouble = s.includes("::");
    if (hasDouble && s.indexOf("::") !== s.lastIndexOf("::")) {
      throw new Error("Invalid IPv6 address (multiple ::).");
    }

    const [left, right] = hasDouble ? s.split("::") : [s, ""];
    const leftParts = left ? left.split(":").filter(Boolean) : [];
    const rightParts = right ? right.split(":").filter(Boolean) : [];

    // replace marker
    const fixParts = (arr) =>
      arr.map((p) => (p === "ipv4tail" ? "ipv4tail" : p));

    const L = fixParts(leftParts);
    const R = fixParts(rightParts);

    // Count hextets; ipv4tail counts as 2 hextets (4 bytes)
    const countHextets = (arr) =>
      arr.reduce((acc, p) => acc + (p === "ipv4tail" ? 2 : 1), 0);

    const leftCount = countHextets(L);
    const rightCount = countHextets(R);
    const total = leftCount + rightCount;

    if (!hasDouble) {
      if (total !== 8) throw new Error("Invalid IPv6 address.");
    } else {
      if (total > 8) throw new Error("Invalid IPv6 address.");
    }

    const zerosToInsert = hasDouble ? (8 - total) : 0;

    /** @type {number[]} */
    const words = [];

    const pushPart = (p) => {
      if (p === "ipv4tail") {
        if (!ipv4TailBytes) throw new Error("Invalid IPv6 address.");
        const w1 = (ipv4TailBytes[0] << 8) | ipv4TailBytes[1];
        const w2 = (ipv4TailBytes[2] << 8) | ipv4TailBytes[3];
        words.push(w1, w2);
        return;
      }
      if (!/^[0-9a-f]{1,4}$/.test(p)) throw new Error("Invalid IPv6 address.");
      words.push(parseInt(p, 16));
    };

    for (const p of L) pushPart(p);
    for (let i = 0; i < zerosToInsert; i++) words.push(0);
    for (const p of R) pushPart(p);

    if (words.length !== 8) throw new Error("Invalid IPv6 address.");

    const out = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
      out[i * 2] = (words[i] >>> 8) & 0xff;
      out[i * 2 + 1] = words[i] & 0xff;
    }
    return out;
  }

  /**
   * @param {Uint8Array} bytes16
   * @returns {string}
   */
  static _ipv6BytesToString(bytes16) {
    if (!(bytes16 instanceof Uint8Array) || bytes16.length !== 16) {
      throw new TypeError("bytes16 must be Uint8Array(16)");
    }

    // convert to 8 hextets
    /** @type {number[]} */
    const words = [];
    for (let i = 0; i < 16; i += 2) {
      words.push((bytes16[i] << 8) | bytes16[i + 1]);
    }

    // find longest run of zeros for ::
    let bestStart = -1, bestLen = 0;
    for (let i = 0; i < 8;) {
      if (words[i] !== 0) { i++; continue; }
      let j = i;
      while (j < 8 && words[j] === 0) j++;
      const len = j - i;
      if (len > bestLen && len >= 2) {
        bestLen = len; bestStart = i;
      }
      i = j;
    }

    // build string with compression
    const parts = [];
    for (let i = 0; i < 8; i++) {
      if (bestStart !== -1 && i >= bestStart && i < bestStart + bestLen) {
        if (i === bestStart) parts.push(""); // mark ::
        continue;
      }
      parts.push(words[i].toString(16));
    }
    if (bestStart !== -1 && bestStart + bestLen === 8) parts.push(""); // :: at end

    let res = parts.join(":");
    // normalize :::: cases
    if (res.startsWith(":")) res = ":" + res;
    if (res.endsWith(":")) res = res + ":";
    res = res.replace(":::", "::");
    return res;
  }
}
