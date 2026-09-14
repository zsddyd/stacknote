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

  // 编码探测的分档阈值：不超过 SAMPLE_LIMIT 的文件仍整篇校验（毫秒级，结果与旧实现完全一致）；
  // 超过则只取头/中/尾三段窗口（合计约 512KB）判定，避免打开大文件时把主线程冻结 1~3 秒。
  const SAMPLE_LIMIT = 1024 * 1024;
  const SAMPLE_TOTAL = 512 * 1024;
  const SAMPLE_WINDOW = Math.floor(SAMPLE_TOTAL / 3);

  // 采样窗口：小文件返回整篇（等价旧行为）；大文件返回头/中/尾三段并合并重叠
  function sampleWindows(bytes) {
    const n = bytes.length;
    if (n <= SAMPLE_LIMIT) return [{ start: 0, end: n }];
    const w = Math.min(SAMPLE_WINDOW, n);
    const mid = Math.max(0, Math.min(n - w, Math.floor((n - w) / 2)));
    const ranges = [{ start: 0, end: w }, { start: mid, end: mid + w }, { start: n - w, end: n }];
    ranges.sort((a, b) => a.start - b.start);
    const out = [];
    for (const r of ranges) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else out.push({ start: r.start, end: r.end });
    }
    return out;
  }

  // 窗口对齐（关键）：窗口起点/终点若正好切在多字节字符中间，
  // 严格校验会把「被截断的字符」误判成非法编码，因此校验前先按字符边界收缩窗口。
  // UTF-8：起点跳过续字节（0b10xxxxxx），终点回退到最后一个完整序列之后。
  function alignUtf8Start(bytes, s, e) {
    let a = s, guard = 0;
    while (a < e && guard++ < 4 && (bytes[a] & 0xc0) === 0x80) a++;
    return a;
  }
  function alignUtf8End(bytes, s, e) {
    let p = e - 1, guard = 0;
    while (p > s && guard++ < 4 && (bytes[p] & 0xc0) === 0x80) p--;   // 回退到最后一个字符的前导字节
    if (p < s) return e;                                              // 异常（全是续字节）：原样返回
    const lead = bytes[p];
    const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    return (p + need <= e) ? e : p;   // 完整则不动；被窗口截断则截到该字符之前
  }
  // GBK：起点若落在双字节中间（前一字节是前导字节）则跳掉续字节；末尾只剩前导字节则丢掉
  function alignGbkStart(bytes, s, e) {
    if (s > 0 && s < e && bytes[s - 1] >= 0x81 && bytes[s - 1] <= 0xfe) return s + 1;
    return s;
  }
  // GBK 结构校验：前导字节 0x81–0xFE 必须紧跟合法续字节（0x40–0xFE 且 ≠0x7F）。
  // 不用 TextDecoder 的 fatal 校验，是因为 GBK 的前导/续字节范围重叠，
  // 窗口末尾"少半个字"会被误判为非法。返回 -1 表示合法，否则返回首个非法位置。
  // allowTruncatedTail：仅当 e 是「采样窗口的人为边界」时才容忍末尾少半个字；
  // 若 e 就是文件真实结尾，说明文件本身结尾残缺，应判为非法（与全量校验行为一致）。
  function gbkScanError(bytes, s, e, allowTruncatedTail) {
    let i = s;
    while (i < e) {
      const b = bytes[i];
      if (b < 0x80) { i++; continue; }
      if (b === 0x80 || b === 0xff) return i;
      if (b >= 0x81 && b <= 0xfe) {
        if (i + 1 >= e) return allowTruncatedTail ? -1 : i;
        const t = bytes[i + 1];
        if (!(t >= 0x40 && t <= 0xfe && t !== 0x7f)) return i;
        i += 2; continue;
      }
      return i;
    }
    return -1;
  }
  function tryDecode(bytes, s, e, label) {
    if (e - s <= 0) return true;             // 窗口被对齐收缩到空 → 无证据，视为通过
    try {
      new TextDecoder(label, { fatal: true }).decode(bytes.subarray(s, e));
      return true;
    } catch (err) { return false; }
  }

  function detect(bytes) {
    const n = bytes.length;
    const windows = sampleWindows(bytes);
    const sampled = n > SAMPLE_LIMIT;
    let scanned = 0;
    for (const w of windows) scanned += w.end - w.start;
    const meta = { sampled, sampledBytes: scanned };
    const done = (id, skip) => Object.assign({ id, skip }, meta);

    // BOM 只看文件开头（精确判定，与文件大小无关）
    if (n >= 3 && bytesStartWith(bytes, [0xef, 0xbb, 0xbf], 0)) return done("utf8bom", 3);
    if (n >= 2 && bytesStartWith(bytes, [0xff, 0xfe], 0)) return done("utf16le", 2);
    if (n >= 2 && bytesStartWith(bytes, [0xfe, 0xff], 0)) return done("utf16be", 2);
    // 含大量 0x00：大概率 UTF-16（奇偶必须按**绝对偏移**判，否则中间/尾部窗口会把 LE/BE 判反）
    if (scanned > 4) {
      let even0 = 0, odd0 = 0;
      for (const w of windows) {
        for (let i = w.start; i < w.end; i++) {
          if (bytes[i] === 0) { if (i % 2 === 0) even0++; else odd0++; }
        }
      }
      if (even0 > scanned / 8 && even0 > odd0) return done("utf16be", 0);
      if (odd0 > scanned / 8) return done("utf16le", 0);
    }
    // 合法 UTF-8？（逐窗口校验；只有"窗口的人为边界"才做字符对齐，
    // 文件真实首尾不做对齐 —— 否则会把结尾残缺的文件误判为合法 UTF-8）
    const bad = [];
    for (const w of windows) {
      const trueStart = w.start === 0, trueEnd = w.end === n;
      const a = trueStart ? w.start : alignUtf8Start(bytes, w.start, w.end);
      const b = trueEnd ? w.end : alignUtf8End(bytes, a, w.end);
      if (!tryDecode(bytes, a, b, "utf-8")) bad.push({ w, trueStart, trueEnd });
    }
    if (!bad.length) return done("utf8", 0);
    // 只在「判为非法 UTF-8」的那些窗口上试 GBK：ASCII 头 + GBK 尾的文件因此仍能判对，
    // 而结构上连 GBK 都不合法的文件（如含孤立 0x80）仍与旧实现一样落到 unknown
    for (const item of bad) {
      const w = item.w;
      const a = item.trueStart ? w.start : alignGbkStart(bytes, w.start, w.end);
      if (gbkScanError(bytes, a, w.end, !item.trueEnd) >= 0) return done("unknown", 0);
    }
    return done("gbk", 0);
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
