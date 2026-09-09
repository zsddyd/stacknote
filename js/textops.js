"use strict";
(function () {
  const SN = window.SN;
  const RE_WS = /^[ \t]+$/;

  // 返回包含整行的字符区间 [start,end)
  function blockOffsets(text, selStart, selEnd) {
    const start = selStart <= 0 ? 0 : (text.lastIndexOf("\n", selStart - 1) + 1);
    let end = selEnd;
    if (end < text.length && (end === 0 || text[end - 1] !== "\n")) {
      const n = text.indexOf("\n", end);
      end = n < 0 ? text.length : n + 1;
    }
    return [start, end];
  }

  // 在 [start,end) 区间内按行变换（文档内部统一 \n）
  function applyLines(text, start, end, fn) {
    const head = text.slice(0, start);
    const mid = text.slice(start, end);
    const tail = text.slice(end);
    const arr = mid === "" ? [""] : mid.replace(/\n$/, "").split("\n");
    const out = fn(arr) || arr;
    return { text: head + out.join("\n") + (mid.endsWith("\n") ? "\n" : ""), tail };
  }

  // ---------- 大小写 ----------
  function toSentence(s) {
    return s.replace(/(^|[.!?。！？]\s*)(\w)/g, (m, pre, ch) => pre + ch.toUpperCase());
  }
  function caseText(str, type) {
    switch (type) {
      case "upper": return str.toUpperCase();
      case "lower": return str.toLowerCase();
      case "proper":
        return str.replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/([A-Z])([A-Z]+)/g, (m, a, b) => a + b.toLowerCase());
      case "properB":
        return str.replace(/(^|[^A-Za-z])([a-z])/g, (m, a, c) => a + c.toUpperCase());
      case "sentence":
        return toSentence(str);
      case "invert": {
        let out = "";
        for (const ch of str) out += ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch;
        return out;
      }
      case "random": {
        let out = "";
        for (const ch of str) out += /[a-zA-Z]/.test(ch) ? (Math.random() < 0.5 ? ch.toUpperCase() : ch.toLowerCase()) : ch;
        return out;
      }
      default: return str;
    }
  }

  // ---------- 空白 / 制表符 ----------
  function convertSpace(text, tab, mode) {
    const sp = " ".repeat(tab);
    if (mode === "tab2space") return text.replace(/\t/g, sp);
    const toTabLead = (s) => {
      const m = s.match(/^[ \t]*/)[0];
      let out = "", i = 0;
      while (i + tab <= m.length && m[i] === " ") { out += "\t"; i += tab; }
      out += m.slice(i) + s.slice(m.length);
      return out;
    };
    if (mode === "space2tabLead") return text.split("\n").map(toTabLead).join("\n");
    const toTabAll = (s) => s.replace(/ {2,}/g, (ms) => "\t".repeat(Math.floor(ms.length / tab)) + " ".repeat(ms.length % tab));
    return text.split("\n").map(toTabAll).join("\n");
  }

  // ---------- 行集合操作（参数均为不含行尾的数组） ----------
  function removeEmpty(lines, keepWsBlank) {
    return lines.filter(s => keepWsBlank ? s !== "" : (!RE_WS.test(s) && s !== ""));
  }
  function removeDupLines(lines, consecutiveOnly) {
    const seen = new Set();
    const out = [];
    for (const l of lines) {
      if (consecutiveOnly) { if (out.length && out[out.length - 1] === l) continue; }
      else if (seen.has(l)) continue;
      seen.add(l);
      out.push(l);
    }
    return out;
  }
  function splitLongLines(lines, max) {
    const out = [];
    for (const l of lines) {
      if (l.length > max) { for (let i = 0; i < l.length; i += max) out.push(l.slice(i, i + max)); }
      else out.push(l);
    }
    return out;
  }
  function sortLines(lines, mode) {
    const copy = lines.slice();
    if (mode.indexOf("num") >= 0) {
      copy.sort((a, b) => {
        const x = parseFloat(a) || 0, y = parseFloat(b) || 0;
        return x - y;
      });
    } else if (mode.indexOf("ci") >= 0) {
      copy.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    } else {
      copy.sort((a, b) => a.localeCompare(b));
    }
    if (mode.indexOf("desc") >= 0) copy.reverse();
    return copy;
  }

  SN.textops = {
    blockOffsets, applyLines, caseText, convertSpace,
    removeEmpty, removeDupLines, splitLongLines, sortLines
  };
})();
