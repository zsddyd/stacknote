"use strict";
(function () {
  const SN = window.SN;

  // 编码 ID 列表（子集：浏览器可解码的）
  const CODES = [
    { id: "unknown",  name: "Unknown",   label: null, writable: false },
    { id: "utf8",     name: "UTF-8",     label: "utf-8", bom: null, writable: true },
    { id: "utf8bom",  name: "UTF-8-BOM", label: "utf-8", bom: [0xef, 0xbb, 0xbf], writable: true },
    { id: "utf16le",  name: "UCS-2 LE",  label: "utf-16le", bom: [0xff, 0xfe], writable: true },
    { id: "utf16be",  name: "UCS-2 BE",  label: "utf-16be", bom: [0xfe, 0xff], writable: true },
    { id: "gbk",      name: "GBK",       label: "gbk", writable: false },
    { id: "big5",     name: "Big5",      label: "big5", writable: false },
    { id: "shift_jis",name: "Shift-JIS", label: "shift_jis", writable: false },
    { id: "eucjp",    name: "EUC-JP",    label: "euc-jp", writable: false },
    { id: "euckr",    name: "EUC-KR",    label: "euc-kr", writable: false }
  ];
  const byId = {};
  CODES.forEach(c => byId[c.id] = c);

  function codeById(id) { return byId[id] || byId.utf8; }
  function bytesStartWith(bytes, arr, at) {
    for (let i = 0; i < arr.length; i++) if (bytes[at + i] !== arr[i]) return false;
    return true;
  }

  function detect(bytes) {
    const n = bytes.length;
    if (n >= 3 && bytesStartWith(bytes, [0xef, 0xbb, 0xbf], 0)) return { id: "utf8bom", skip: 3 };
    if (n >= 2 && bytesStartWith(bytes, [0xff, 0xfe], 0)) return { id: "utf16le", skip: 2 };
    if (n >= 2 && bytesStartWith(bytes, [0xfe, 0xff], 0)) return { id: "utf16be", skip: 2 };
    // 含大量 0x00：大概率 UTF-16
    if (n > 4) {
      let even0 = 0, odd0 = 0;
      for (let i = 0; i < n; i++) {
        if (bytes[i] === 0) { if (i % 2 === 0) even0++; else odd0++; }
      }
      if (even0 > n / 8 && even0 > odd0) return { id: "utf16be", skip: 0 };
      if (odd0 > n / 8) return { id: "utf16le", skip: 0 };
    }
    // 合法 UTF-8？
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { id: "utf8", skip: 0 };
    } catch (e) { /* 继续 */ }
    // 尝试 GBK
    try {
      new TextDecoder("gbk", { fatal: true }).decode(bytes);
      return { id: "gbk", skip: 0 };
    } catch (e) { /* 继续 */ }
    // 兜底：latin1
    try {
      new TextDecoder("windows-1252").decode(bytes);
      return { id: "unknown", skip: 0 };
    } catch (e) { return { id: "unknown", skip: 0 }; }
  }

  function decodeBytes(bytes, codeId) {
    const c = codeById(codeId);
    if (!c.label) return new TextDecoder("windows-1252").decode(bytes);
    try {
      return new TextDecoder(c.label, { fatal: false }).decode(bytes);
    } catch (e) {
      // label 不支持时回退
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }

  function utf16Encode(text, little, withBom) {
    const u = [];
    if (withBom) u.push(little ? 0xff : 0xfe, little ? 0xfe : 0xff);
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i);
      if (cp > 0xffff) {
        const cc = [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)];
        for (const x of cc) { if (little) u.push(x & 0xff, x >> 8); else u.push(x >> 8, x & 0xff); }
        i++;
      } else {
        if (little) u.push(cp & 0xff, cp >> 8); else u.push(cp >> 8, cp & 0xff);
      }
    }
    return new Uint8Array(u);
  }

  function encodeText(text, codeId) {
    const c = codeById(codeId);
    if (!c.writable) throw new Error("浏览器无法写出 " + c.name + "，请另存为 UTF-8/UTF-16");
    if (c.id === "utf16le" || c.id === "utf16be") return utf16Encode(text, c.id === "utf16le", c.bom ? true : false);
    const enc = new TextEncoder();
    const body = enc.encode(text);
    if (!c.bom) return body;
    const out = new Uint8Array(body.length + c.bom.length);
    out.set(c.bom, 0); out.set(body, c.bom.length);
    return out;
  }

  function detectEol(text) {
    let crlf = 0, lf = 0, cr = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\r") { if (text[i + 1] === "\n") { crlf++; i++; } else cr++; }
      else if (ch === "\n") lf++;
    }
    if (crlf > lf && crlf > cr) return "crlf";
    if (cr > lf) return "cr";
    return "lf";
  }

  function normalizeEol(text, eol) {
    const nl = eol === "crlf" ? "\r\n" : eol === "cr" ? "\r" : "\n";
    return text.replace(/\r\n|\r|\n/g, nl);
  }

  SN.CODES = CODES;
  SN.codeById = codeById;
  SN.detectEncode = detect;
  SN.decodeBytes = decodeBytes;
  SN.encodeText = encodeText;
  SN.detectEol = detectEol;
  SN.normalizeEol = normalizeEol;
})();
