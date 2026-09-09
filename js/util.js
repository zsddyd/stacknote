"use strict";
(function () {
  const SN = (window.SN = window.SN || {});

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k === "html") e.innerHTML = v;
        else if (k === "style") e.style.cssText = v;
        else if (k === "value") e.value = v;
        else if (k === "checked") e.checked = !!v;
        else if (k === "disabled") e.disabled = !!v;
        else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    if (kids) for (const c of [].concat(kids)) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(c) : c);
    }
    return e;
  }

  const escMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, m => escMap[m]); }

  function uid() { return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function debounce(fn, ms) {
    let t = null;
    const g = function () { const a = arguments, s = this; clearTimeout(t); t = setTimeout(() => fn.apply(s, a), ms); };
    g.cancel = () => clearTimeout(t);
    return g;
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function fmtSize(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(2) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
  }

  function splitLinesKeep(text) {
    // 按行拆分，保留行内容(不含换行)，返回 {lines, ends}
    const lines = [], ends = [];
    let cur = "", i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\r") {
        if (text[i + 1] === "\n") { ends.push("crlf"); lines.push(cur); cur = ""; i += 2; }
        else { ends.push("cr"); lines.push(cur); cur = ""; i += 1; }
      } else if (ch === "\n") { ends.push("lf"); lines.push(cur); cur = ""; i += 1; }
      else { cur += ch; i += 1; }
    }
    lines.push(cur);
    return { lines, ends };
  }

  function countLines(text) {
    if (!text) return 1;
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
    return n;
  }

  function lineAt(text, target) { // target 为 0 基行号
    let start = 0, line = 0;
    while (line < target) {
      const nl = text.indexOf("\n", start);
      if (nl < 0) break;
      start = nl + 1; line++;
    }
    return start;
  }

  function positionToLineCol(text, pos) {
    let line = 0, last = -1, i = 0;
    for (; i < pos && i < text.length; i++) {
      if (text[i] === "\n") { line++; last = i; }
    }
    return { line, col: pos - (last + 1) };
  }

  function readAsBytes(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(new Uint8Array(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  function readAsTextBytes(file) { return readAsBytes(file); }

  function download(filename, blob) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  // 轻量事件总线
  const bus = document.createElement("div");
  function on(name, fn) { bus.addEventListener(name, fn); }
  function off(name, fn) { bus.removeEventListener(name, fn); }
  function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }

  SN.$ = $; SN.$$ = $$; SN.el = el; SN.escapeHtml = escapeHtml;
  SN.uid = uid; SN.debounce = debounce; SN.clamp = clamp;
  SN.fmtSize = fmtSize; SN.splitLinesKeep = splitLinesKeep;
  SN.countLines = countLines; SN.lineAt = lineAt; SN.positionToLineCol = positionToLineCol;
  SN.readAsBytes = readAsBytes; SN.readAsTextBytes = readAsTextBytes; SN.download = download;
  SN.on = on; SN.off = off; SN.emit = emit;
  SN.toast = function (msg, ms) {
    const box = SN.$("#toasts");
    const t = SN.el("div", { class: "toast", text: msg });
    box.appendChild(t);
    setTimeout(() => t.remove(), ms || 3200);
  };
})();
