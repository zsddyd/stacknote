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

  function fmtSize(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(2) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
  }
  // UUID v4：优先 WebCrypto，兼容非安全上下文（http/file）或旧浏览器则用 Math.random 兜底
  function uuid() {
    const c = window.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;   // version 4
    b[8] = (b[8] & 0x3f) | 0x80;   // variant 10xx
    const h = Array.prototype.map.call(b, x => (x < 16 ? "0" : "") + x.toString(16)).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function countLines(text) {
    if (!text) return 1;
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
    return n;
  }

  function readAsBytes(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(new Uint8Array(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

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
  SN.uid = uid; SN.uuid = uuid;
  SN.fmtSize = fmtSize; SN.countLines = countLines;
  SN.readAsBytes = readAsBytes; SN.download = download;
  SN.on = on; SN.off = off; SN.emit = emit;
  SN.toast = function (msg, ms) {
    const box = SN.$("#toasts");
    const t = SN.el("div", { class: "toast", text: msg });
    box.appendChild(t);
    setTimeout(() => t.remove(), ms || 3200);
  };
})();
