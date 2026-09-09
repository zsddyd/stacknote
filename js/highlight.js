"use strict";
(function () {
  const SN = window.SN;

  const WORD = /[A-Za-z0-9_$\u00c0-\uffff]/;
  const ID_START = /[A-Za-z_$\u00c0-\uffff]/;

  function ensureSets(cfg) {
    if (!cfg._set) {
      const kw = cfg.kw || [];
      cfg._set = new Set(kw);
      cfg._ci = !!cfg.ci;
      if (cfg.ci) {
        const s = new Set();
        kw.forEach(w => s.add(w.toLowerCase()));
        cfg._ciSet = s;
      }
    }
  }
  function isKeyword(cfg, word) {
    ensureSets(cfg);
    return cfg._ci ? cfg._ciSet.has(word.toLowerCase()) : cfg._set.has(word);
  }

  // 语言自定义覆盖配置（供 app.js 合并用户设置）
  const LINE = (l) => (Array.isArray(l.line) ? l.line : l.line ? [l.line] : []);
  function tokenize(text, cfg) {
    const toks = [];
    const n = text.length;
    const blocks = cfg.block ? (Array.isArray(cfg.block) && cfg.block.length === 2 ? [cfg.block] : [cfg.block]) : [];
    // 允许扩展块注释
    const blockList = cfg.block === null || cfg.block === undefined ? [] : [cfg.block];
    const lineCmt = cfg.line === null || cfg.line === undefined ? [] : LINE(cfg);
    const quotes = cfg.str || ['"', "'"];
    const tq = cfg.tri || false;
    const isTagLang = !!cfg.tag;
    const isDiff = !!cfg.diff;

    let i = 0;
    const add = (s, e, t) => { if (e > s) toks.push([s, e, t]); };

    if (isDiff) {
      let ls = 0;
      for (let k = 0; k <= n; k++) {
        if (k === n || text[k] === "\n") {
          const ch = text[ls];
          if (ch === "+") add(ls, k, "diff-add");
          else if (ch === "-") add(ls, k, "diff-del");
          else if (ch === "@") add(ls, k, "diff-meta");
          ls = k + 1;
        }
      }
      return toks;
    }

    let tagMode = 0; // 0 无,1 开标签内,2 关标签内
    while (i < n) {
      // 块注释
      let matched = false;
      for (const bl of blockList) {
        if (text.startsWith(bl[0], i)) {
          let end = text.indexOf(bl[1], i + bl[0].length);
          if (end < 0) end = n;
          else end += bl[1].length;
          add(i, end, "com");
          i = end; matched = true; break;
        }
      }
      if (matched) continue;
      // 行注释
      let hit = false;
      for (const lm of lineCmt) {
        if (lm && text.startsWith(lm, i)) {
          let end = text.indexOf("\n", i);
          if (end < 0) end = n;
          add(i, end, "com");
          i = end; hit = true; break;
        }
      }
      if (hit) continue;

      const ch = text[i];

      // 字符串
      if (quotes.indexOf(ch) >= 0) {
        let j = i + 1, triple = false;
        if (tq && text.startsWith(ch + ch + ch, i)) { triple = true; j = i + 3; }
        while (j < n) {
          if (text[j] === "\\") { j += 2; continue; }
          if (triple ? text.startsWith(ch + ch + ch, j) : text[j] === ch) {
            j += triple ? 3 : 1; break;
          }
          j++;
        }
        add(i, Math.min(j, n), "str");
        i = Math.min(j, n);
        continue;
      }

      // HTML 标签状态
      if (isTagLang && ch === "<" && i + 1 < n && (ID_START.test(text[i + 1]) || text[i + 1] === "/")) {
        tagMode = text[i + 1] === "/" ? 2 : 1;
        i++;
        continue;
      }
      if (isTagLang && ch === ">" && tagMode) { tagMode = 0; i++; continue; }
      if (isTagLang && ch === "/" && text[i + 1] === ">") { tagMode = 0; i += 2; continue; }

      // 数字
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] || ""))) {
        let j = i + 1;
        while (j < n && /[0-9a-fA-FxXoObB_.,%eE+-]/.test(text[j])) {
          // 不要吞掉运算符 + - 后跟空格/字母边界
          const nx = text[j];
          if ((nx === "+" || nx === "-" || nx === "e" || nx === "E") && !/[0-9]/.test(text[j + 1] || "")) break;
          j++;
        }
        add(i, j, "num");
        i = j;
        continue;
      }

      if (ID_START.test(ch)) {
        let j = i + 1;
        while (j < n && WORD.test(text[j])) j++;
        const word = text.slice(i, j);
        let type = "def";
        if (isKeyword(cfg, word)) type = "key";
        else if (isTagLang && tagMode) {
          // 标签内：第一个词是标签名，其后是属性
          const prev = text.slice(Math.max(0, i - 40), i);
          const afterOpen = prev.lastIndexOf("<") > prev.lastIndexOf(">");
          const inClose = prev.lastIndexOf("</") > prev.lastIndexOf(">");
          if (!afterOpen || (inClose && word === text.slice(prev.lastIndexOf("</") + 2).split(/[\s>]/)[0])) type = "tag";
          else type = "attr";
        } else if (isTagLang && word === "script" || isTagLang && word === "style") { type = "tag"; }
        else {
          // 函数名：后随 '('
          let k = j;
          while (k < n && /\s/.test(text[k])) k++;
          if (text[k] === "(") type = "fn";
        }
        add(i, j, type);
        i = j;
        continue;
      }
      i++;
    }
    return toks;
  }

  function render(text, langId, marks) {
    const cfg = SN.langById(langId);
    const toks = tokenize(text, cfg);
    const ms = (marks || []).slice().sort((a, b) => a.start - b.start || a.end - b.end);
    const esc = SN.escapeHtml;

    function wrap(txt, cls) { return cls ? '<span class="c-' + cls + '">' + txt + "</span>" : txt; }
    function sliceHtml(s, e, cls) {
      if (e <= s) return "";
      let cur = s, out = "";
      for (const m of ms) {
        if (m.start >= e) break;
        if (m.end <= cur) continue;
        if (m.end <= s) continue;
        const a = Math.max(cur, m.start), b = Math.min(e, m.end);
        if (a > cur) out += wrap(esc(text.slice(cur, a)), cls);
        out += '<mark style="--hlw:' + (m.color || "#FFEB3B") + '">' + esc(text.slice(a, b)) + "</mark>";
        cur = b;
        if (cur >= e) break;
      }
      if (cur < e) out += wrap(esc(text.slice(cur, e)), cls);
      return out;
    }

    let html = "", pos = 0;
    for (const [s, e, t] of toks) {
      if (s > pos) html += sliceHtml(pos, s, null);
      html += sliceHtml(s, e, t);
      pos = e;
    }
    if (pos < text.length) html += sliceHtml(pos, text.length, null);
    return html || "";
  }

  // 渲染纯文本（无高亮），但保留 mark
  function renderPlain(text, marks) {
    const ms = (marks || []).slice().sort((a, b) => a.start - b.start);
    const esc = SN.escapeHtml;
    let out = "", cur = 0;
    for (const m of ms) {
      if (m.start > cur) out += esc(text.slice(cur, m.start));
      out += '<mark style="--hlw:' + (m.color || "#FFEB3B") + '">' + esc(text.slice(m.start, m.end)) + "</mark>";
      cur = m.end;
    }
    if (cur < text.length) out += esc(text.slice(cur));
    return out;
  }

  SN.highlightTokenize = tokenize;
  SN.highlightRender = render;
  SN.renderPlain = renderPlain;
})();
