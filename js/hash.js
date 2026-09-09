"use strict";
(function () {
  const SN = window.SN;

  function hexOf(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }

  // ---------- MD5 ----------
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = new Array(64).fill(0).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

  function md5(bytes) {
    const n = bytes.length;
    const ml = n * 8;
    const nbt = ((n + 8) >> 6) + 1;
    const buf = new Uint8Array(nbt * 64);
    buf.set(bytes);
    buf[n] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32((nbt * 64) - 8, ml >>> 0, true);
    dv.setUint32((nbt * 64) - 4, Math.floor(ml / 0x100000000), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const rotl = (x, c) => (x << c) | (x >>> (32 - c));
    for (let off = 0; off < buf.length; off += 64) {
      const M = new Array(16);
      for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, S[i])) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16);
    const od = new DataView(out.buffer);
    od.setUint32(0, a0, true); od.setUint32(4, b0, true); od.setUint32(8, c0, true); od.setUint32(12, d0, true);
    return hexOf(out);
  }

  async function sha(bytes, algo) {
    const b = await crypto.subtle.digest(algo, bytes);
    return hexOf(new Uint8Array(b));
  }

  const ALGOS = {
    md4: "MD4（WebCrypto 不支持）", md5: "md5", sha1: "SHA-1", sha256: "SHA-256", sha512: "SHA-512", sha3_256: "SHA3-256（WebCrypto 不支持）"
  };

  async function hashAlgo(data, algo) {
    if (algo === "md5") return md5(data);
    const map = { sha1: "SHA-1", sha256: "SHA-256", sha512: "SHA-512" };
    if (map[algo]) return sha(data, map[algo]);
    throw new Error(ALGOS[algo] || "不支持");
  }

  SN.md5 = md5;
  SN.sha = sha;
  SN.hashAlgo = hashAlgo;
  SN.HASH_ALGOS = ["md5", "sha1", "sha256", "sha512"];
})();
