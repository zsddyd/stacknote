"use strict";
(function () {
  const SN = window.SN;
  const el = SN.el;

  // 超长文本不再做整篇高亮（保护性能）
  const MAX_HL = 1536 * 1024;       // 超过 1.5MB 关闭背景高亮层
  const MAX_GUTTER = 20000;
  const STATUS_THROTTLE_LEN = 2 * 1024 * 1024;

  function countNL(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s[i] === "\n") n++;
    return n;
  }
  // 计算两次文本间新增换行数差值（只扫描差异窗口，避免整篇统计）
  function newlineDelta(oldV, newV) {
    const ol = oldV.length, nl = newV.length;
    let p = 0;
    while (p < ol && p < nl && oldV[p] === newV[p]) p++;
    let s = 0;
    while (s < ol - p && s < nl - p && oldV[ol - 1 - s] === newV[nl - 1 - s]) s++;
    return countNL(newV.slice(p, nl - s)) - countNL(oldV.slice(p, ol - s));
  }

  class Editor {
    constructor(opts) {
      this.onChange = opts.onChange || null;       // (text, ed)
      this.onStatus = opts.onStatus || null;       // ({line,col,total,sel}, ed)
      this.onWordDbl = opts.onWordDbl || null;     // (word, ed)
      this.onActive = opts.onActive || null;       // 获得焦点
      this.tabWidth = opts.tabWidth || 4;
      this.expandTab = opts.expandTab !== false;
      this.langId = opts.langId || "txt";
      this.readOnly = !!opts.readOnly;
      this.wrap = !!opts.wrap;
      this.showSpaces = !!opts.showSpaces;
      this.showEol = !!opts.showEol;
      this.zoom = 100;
      this.markRecords = [];  // 持久标记记录：[{keyword,color,opts}]（同词同色覆盖，不同组共存）
      this.findRanges = [];   // 查找定位临时高亮
      this.wordRanges = [];   // 双击词临时高亮
      this.webRanges = [];    // URL 高亮
      this.bookmarks = new Set();
      this.undoStack = [];
      this.redoStack = [];
      this._batch = null;     // 输入批处理前的快照
      this._batchTimer = null;
      this._fontSize = 14;
      this._lc = null;          // 行数缓存
      this._oldText = "";
      this._lastCaret = -1;
      this._statusTimer = null;
      this._gKey = null;        // 行号窗口 key（防重复渲染）
      this._caretPos = -1;      // 光标行缓存（避免滚动时全量扫描）
      this._caretLine = 0;
      this._lastSel = null;     // 最近一次有效选区 {start,end}：右键菜单/失焦后仍能拿到「刚才选了什么」
      this._marksText = null;   // 已计算标记区间时的文本快照（文本未变则不重复扫描）
      this._build();
      this._lineH = null;
      this._bind();
    }

    _build() {
      const wrap = el("div", { class: "ed-wrap" });
      const gutter = el("div", { class: "ed-gutter" });
      const gInner = el("div", { class: "ed-glines" });
      gutter.appendChild(gInner);
      const main = el("div", { class: "ed-main" });
      const mover = el("div", { class: "ed-mover" });
      const rowhl = el("div", { class: "ed-rowhl" });
      const pre = el("pre", { class: "ed-hl", "aria-hidden": "true" });
      const ta = el("textarea", { class: "ed-input", spellcheck: "false", wrap: this.wrap ? "soft" : "off" });
      if (this.readOnly) ta.readOnly = true;
      mover.appendChild(rowhl);
      mover.appendChild(pre);
      main.appendChild(mover);
      main.appendChild(ta);
      wrap.appendChild(gutter);
      wrap.appendChild(main);
      this.wrapEl = wrap;
      this.gutter = gutter;
      this.gInner = gInner;
      this.main = main;
      this.mover = mover;
      this.rowhl = rowhl;
      this.pre = pre;
      this.ta = ta;
      this.applyZoom(this.zoom);
    }

    _bind() {
      const ta = this.ta;
      ta.addEventListener("beforeinput", (e) => {
        if (this.readOnly) return;
        this._lastSel = null;   // 用户开始改文本：记忆的选区偏移即将失效
        if (this._batch === null) this._batch = this._snap();
        clearTimeout(this._batchTimer);
        this._batchTimer = setTimeout(() => { this._finalize(); }, 800);
      });
      ta.addEventListener("input", () => {
        this._syncLineCacheInput();
        this._afterEdit();
      });
      ta.addEventListener("keydown", (e) => {
        this._onKey(e);
      });
      ta.addEventListener("scroll", () => { this._syncScroll(); }, { passive: true });
      ta.addEventListener("click", () => { this._reportStatus(); });
      // 选区记忆：右键菜单会抢焦点、部分浏览器右键还会把光标折叠，
      // 若只读「当前选区」，菜单里的复制/标记颜色会拿到空选区而静默失效。
      ta.addEventListener("select", () => this.rememberSelection());
      ta.addEventListener("keyup", (e) => {
        // 不带 Shift 的方向/翻页键是「有意挪光标」，此时清掉记忆，避免下次右键误用旧选区
        if (e && !e.shiftKey && /^(Arrow|Home|End|Page)/.test(e.key || "")) this.clearLastSelection();
        else this.rememberSelection();
        this._reportStatus();
      });
      ta.addEventListener("mouseup", (e) => {
        // 只处理左键：右键 mouseup 发生在 contextmenu 之前，不该改写记忆
        if (!e || e.button === undefined || e.button === 0) this.rememberSelection();
        this._reportStatus();
      });
      ta.addEventListener("focus", () => { if (this.onActive) this.onActive(this); this._reportStatus(); });
      ta.addEventListener("dblclick", () => {
        const w = this.wordAtSelection();
        if (w && this.onWordDbl) this.onWordDbl(w);
      });
      window.addEventListener("resize", () => this._syncScroll());
    }

    _onKey(e) {
      const ta = this.ta;
      if (e.isComposing) return;
      // 撤销/重做同样以快捷键表为准（js/shortcuts.js），这样将来改键在文本域内也生效；
      // 万一表不可用，退回内置默认键，避免脚本顺序意外变化导致撤销失效。
      const sc = window.SN && window.SN.shortcuts;
      const mod = e.ctrlKey || e.metaKey;
      const isUndo = sc
        ? sc.matchEvent(e, sc.accelOf("edit.undo"))
        : (mod && (e.key === "z" || e.key === "Z") && !e.shiftKey);
      const isRedo = sc
        ? (sc.matchEvent(e, sc.accelOf("edit.redo")) || sc.matchEvent(e, sc.accelOf("edit.redoAlt")))
        : (mod && (e.key === "y" || e.key === "Y" || (e.key === "z" || e.key === "Z") && e.shiftKey));
      if (isRedo) { e.preventDefault(); this.redo(); return; }
      if (isUndo) { e.preventDefault(); this.undo(); return; }
      if (e.key === "Tab" && !this.readOnly) {
        e.preventDefault();
        this._insertTab(e.shiftKey);
        return;
      }
    }

    _insertTab(unindent) {
      const ta = this.ta;
      const s = ta.selectionStart, e = ta.selectionEnd;
      if (unindent || (s !== e && !this.expandTab)) {
        this.pushUndo();
        if (s === e) {
          // 行首退格
          const ls = ta.value.lastIndexOf("\n", s - 1) + 1;
          let del = Math.min(s - ls, this.tabWidth);
          let k = s - 1;
          while (del > 0 && k >= ls && (ta.value[k] === " " || ta.value[k] === "\t")) { k--; del--; }
          const nv = ta.value.slice(0, k + 1) + ta.value.slice(s);
          this._setTextWithSel(nv, Math.max(0, k + 1));
        } else {
          const sel = ta.value.slice(s, e);
          const out = sel.split("\n").map(l => l.replace(/^( {1,4}|\t)/, "")).join("\n");
          this._setTextWithSel(ta.value.slice(0, s) + out + ta.value.slice(e), s);
        }
        this._afterEdit();
        return;
      }
      const indent = this.expandTab ? " ".repeat(this.tabWidth) : "\t";
      if (s === e) {
        this.pushUndo();
        const nv = ta.value.slice(0, s) + indent + ta.value.slice(e);
        this._setTextWithSel(nv, s + indent.length);
        this._afterEdit();
      } else {
        this.pushUndo();
        const sel = ta.value.slice(s, e);
        const out = sel.split("\n").map(l => indent + l).join("\n");
        this._setTextWithSel(ta.value.slice(0, s) + out + ta.value.slice(e), s + indent.length);
        this._afterEdit();
      }
    }

    _snap() { const t = this.ta; return { t: t.value, s: t.selectionStart, e: t.selectionEnd }; }
    _sameSnap(a, b) { return a && b && a.t === b.t && a.s === b.s && a.e === b.e; }

    _finalize() {
      if (this._batch) {
        const cur = this._snap();
        if (!this._sameSnap(this._batch, cur)) {
          if (!this.undoStack.length || this.undoStack[this.undoStack.length - 1].t !== this._batch.t) {
            this.undoStack.push(this._batch);
          }
          if (this.undoStack.length > 500) this.undoStack.shift();
        }
        this._batch = null;
      }
    }

    // 在程序化修改前调用：提交未决的输入批次，并把当前状态记为“操作前快照”
    pushUndo() {
      this._finalize();
      const cur = this._snap();
      if (!this.undoStack.length || this.undoStack[this.undoStack.length - 1].t !== cur.t) {
        this.undoStack.push(cur);
      }
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack = [];
    }

    undo() {
      this._finalize();
      if (!this.undoStack.length) { SN.toast("没有可撤销的操作"); return; }
      const prev = this.undoStack.pop();
      this.redoStack.push(this._snap());
      this._applySnap(prev);
      this._afterEdit();
    }
    redo() {
      this._finalize();
      if (!this.redoStack.length) { SN.toast("没有可重做的操作"); return; }
      const next = this.redoStack.pop();
      this.undoStack.push(this._snap());
      this._applySnap(next);
      this._afterEdit();
    }
    _applySnap(s) {
      this._setTextWithSel(s.t, s.s, s.e);
    }

    get text() { return this.ta.value; }
    get length() { return this.ta.value.length; }
    lineCount() {
      if (this._lc !== null) return this._lc;
      const v = this.ta.value;
      let n = 1;
      for (let i = 0; i < v.length; i++) if (v[i] === "\n") n++;
      this._lc = n;
      return n;
    }
    get selStart() { return this.ta.selectionStart; }
    get selEnd() { return this.ta.selectionEnd; }
    selectedText() { return this.ta.value.slice(this.selStart, this.selEnd); }
    hasSelection() { return this.selStart !== this.selEnd; }
    caret() { return this.selStart; }

    // ---------- 选区记忆（右键菜单抢焦点/浏览器折叠光标后，仍能拿到「用户刚才选了什么」） ----------
    rememberSelection() {
      const s = this.ta.selectionStart, e = this.ta.selectionEnd;
      this._lastSel = s === e ? null : { start: s, end: e };
    }
    clearLastSelection() { this._lastSel = null; }
    // 当前选区优先；被折叠（右键/失焦）时回退到最近一次有效选区
    effectiveSelection() {
      const s = this.ta.selectionStart, e = this.ta.selectionEnd;
      if (s !== e) return { start: s, end: e };
      const l = this._lastSel;
      if (l && l.start < l.end && l.end <= this.ta.value.length) return { start: l.start, end: l.end };
      return null;
    }
    effectiveSelectedText() {
      const r = this.effectiveSelection();
      return r ? this.ta.value.slice(r.start, r.end) : "";
    }

    setText(t, sel) {
      this._setTextWithSel(t, sel ? sel[0] : this.ta.selectionStart, sel ? sel[1] : this.ta.selectionEnd);
      this._afterEdit(true);
    }
    // 程序化替换选区（自动记录撤销）
    replaceRange(repl, start, end) {
      this.pushUndo();
      const v = this.ta.value;
      const nv = v.slice(0, start) + repl + v.slice(end);
      this._setTextWithSel(nv, start + repl.length);
      this._afterEdit();
    }

    _setTextWithSel(v, s, e) {
      if (s === undefined) s = this.ta.selectionStart;
      if (e === undefined) e = s;
      this.ta.value = v;
      this._lc = null;
      this._oldText = v;
      // 文本变了，旧的选区偏移不再对应同一段内容：清掉记忆，别让右键菜单用过期区间
      this._lastSel = null;
      try { this.ta.setSelectionRange(s, Math.min(e, v.length)); } catch (err) { /* ignore */ }
    }

    // 输入时按最小差异区增量更新行数缓存，避免每次整篇统计
    _syncLineCacheInput() {
      const cur = this.ta.value;
      const old = this._oldText;
      this._oldText = cur;
      if (this._lc === null) return;
      const d = newlineDelta(old, cur);
      if (d !== 0) this._lc = Math.max(1, this._lc + d);
    }

    _afterEdit(silentChange) {
      this._reportStatus();
      if (!silentChange && this.onChange) this.onChange(this.ta.value, this);
      this.scheduleRender();
      this._syncScroll();
    }

    _reportStatus() {
      const caret = this.ta.selectionStart;
      const big = this.ta.value.length > STATUS_THROTTLE_LEN;
      if (big) {
        if (caret === this._lastCaret) return;
        if (this._statusTimer) return;
        this._statusTimer = setTimeout(() => {
          this._statusTimer = null;
          this._lastCaret = caret;
          this._doStatus();
        }, 100);
        return;
      }
      this._lastCaret = caret;
      this._doStatus();
    }
    _doStatus() {
      if (!this.onStatus) return;
      const v = this.ta.value;
      let line = 0, last = -1;
      const pos = this.ta.selectionStart;
      const cap = Math.min(pos, v.length);
      for (let i = 0; i < cap; i++) if (v[i] === "\n") { line++; last = i; }
      this._caretPos = pos;
      this._caretLine = line;
      const totalLines = this.lineCount();
      let selLines = 0;
      if (this.hasSelection()) {
        const s = this.selStart, e = this.selEnd;
        selLines = v.slice(s, e).split("\n").length;
        if (v.slice(s, e).endsWith("\n")) selLines--;
      }
      this.onStatus({ line: line + 1, col: pos - (last + 1) + 1, total: totalLines, selLines, selLen: this.selEnd - this.selStart, chars: v.length }, this);
    }

    wordAtSelection() {
      const v = this.ta.value;
      let s = this.selStart, e = this.selEnd;
      if (s === e) {
        const re = /[A-Za-z0-9_$#@.\-\u00c0-\uffff]/;
        while (s > 0 && re.test(v[s - 1])) s--;
        while (e < v.length && re.test(v[e])) e++;
        if (s === e) return "";
      } else {
        const w = v.slice(s, e).trim();
        if (!w || /\s/.test(w)) return "";
      }
      return v.slice(s, e);
    }

    applyZoom(zoom) {
      this.zoom = zoom;
      const fs = Math.round(14 * zoom / 100);
      this._fontSize = fs;
      const lh = Math.round(fs * 1.55);
      const st = this.ta.style;
      st.fontSize = fs + "px";
      st.lineHeight = lh + "px";
      this.pre.style.fontSize = fs + "px";
      this.pre.style.lineHeight = lh + "px";
      this.gInner.style.fontSize = fs + "px";
      this.gInner.style.lineHeight = lh + "px";
      this.rowhl.style.height = lh + "px";
      this._lineH = lh;
      this._renderGutter();
      this._syncScroll();
    }

    setWrap(on) {
      this.wrap = on;
      this.ta.wrap = on ? "soft" : "off";
      this.pre.style.whiteSpace = on ? "pre-wrap" : "pre";
      this.scheduleRender();
      this._syncScroll();
    }
    setShowSpaces(on) { this.showSpaces = on; this.scheduleRender(); }
    setShowEol(on) { this.showEol = on; this.scheduleRender(); }
    setReadonly(ro) { this.readOnly = ro; this.ta.readOnly = ro; }

    // ---- 多层高亮模型 ----
    _findPlain(text, keyword, opts) {
      const out = [];
      if (!keyword) return out;
      opts = opts || { case: false, whole: false, regex: false };
      let re;
      try {
        const src = opts.regex ? keyword : keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        re = new RegExp(src, (opts.case ? "" : "i") + "g");
      } catch (e) { return out; }
      let m;
      while ((m = re.exec(text))) {
        const s = m.index, e = s + m[0].length;
        if (!opts.whole || !( (s > 0 && /[A-Za-z0-9_$]/.test(text[s - 1])) || (e < text.length && /[A-Za-z0-9_$]/.test(text[e])) )) {
          out.push({ start: s, end: e });
        }
        re.lastIndex = Math.max(e, s + 1);
      }
      return out;
    }
    // 叠加所有层：持久标记(按当前文本实时重算) + 查找/双击词/URL 临时高亮
    combinedRanges() {
      const out = [];
      const text = this.ta.value;
      if (text !== this._marksText) {
        // 文本有变化才重扫（仅一次）；否则直接用缓存区间，改颜色/加临时层都很快
        for (const rec of this.markRecords) rec._ranges = this._findPlain(text, rec.keyword, rec.opts);
        this._marksText = text;
      }
      for (const rec of this.markRecords) {
        for (const r of rec._ranges || []) out.push({ start: r.start, end: r.end, color: rec.color });
      }
      for (const r of this.findRanges) out.push(r);
      for (const r of this.wordRanges) out.push(r);
      for (const r of this.webRanges) out.push(r);
      // 完全重叠的区间只保留“最后设置的颜色”（Map 覆盖后仍保持首插顺序）
      const merged = new Map();
      for (const r of out) merged.set(r.start + ":" + r.end, r);
      return Array.from(merged.values());
    }
    upsertMarkRecord(keyword, color, opts) {
      const o = opts || { case: false, whole: false, regex: false };
      // 直接在此计算一次并缓存，避免稍后 combinedRanges 再扫一遍；
      // 同一关键词改色时直接复用已缓存区间（文本未变场景零扫描）
      const sameKw = this.markRecords.find(r => r.keyword === keyword);
      let ranges;
      if (sameKw && sameKw._ranges && this._marksText === this.ta.value) ranges = sameKw._ranges;
      else ranges = this._findPlain(this.ta.value, keyword, o);
      const idx = this.markRecords.findIndex(r => r.keyword === keyword && r.color === color);
      const rec = { keyword, color, opts: o, _ranges: ranges };
      if (idx >= 0) this.markRecords[idx] = rec;
      else this.markRecords.push(rec);
      this._marksText = this.ta.value;
      this.scheduleRender();
      return ranges.length;
    }
    clearPersistentMarks() {
      this.markRecords = [];
      this.findRanges = [];
      this.wordRanges = [];
      this._marksText = null;
      this.scheduleRender();
    }
    setFindRanges(list) { this.findRanges = list || []; this.scheduleRender(); }
    setWordRanges(list) { this.wordRanges = list || []; this.scheduleRender(); }
    setWebRanges(list) { this.webRanges = list || []; this.scheduleRender(); }

    toggleBookmark(line) {
      if (this.bookmarks.has(line)) this.bookmarks.delete(line);
      else this.bookmarks.add(line);
      this._renderGutter();
    }
    clearBookmarks() { this.bookmarks.clear(); this._renderGutter(); }
    gotoBookmark(dir) {
      const arr = Array.from(this.bookmarks).sort((a, b) => a - b);
      if (!arr.length) return false;
      const cur = this.curLine() - 1;
      let idx = -1;
      if (dir > 0) { for (let i = 0; i < arr.length; i++) if (arr[i] > cur) { idx = i; break; } if (idx < 0) idx = 0; }
      else { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] < cur) { idx = i; break; } if (idx < 0) idx = arr.length - 1; }
      this.gotoLine(arr[idx] + 1);
      return true;
    }

    curLine() {
      let line = 1;
      const p = this.ta.selectionStart;
      for (let i = 0; i < p && i < this.ta.value.length; i++) if (this.ta.value[i] === "\n") line++;
      return line;
    }
    // 滚动等场景使用：光标未变化时直接复用缓存，避免 O(n) 扫描
    _cachedCurLine() {
      const p = this.ta.selectionStart;
      if (p === this._caretPos && this._caretLine >= 0) return this._caretLine + 1;
      return this.curLine();
    }
    gotoLine(n) {
      const v = this.ta.value;
      let pos = 0, line = 1;
      while (line < n && pos < v.length) {
        const k = v.indexOf("\n", pos);
        if (k < 0) break;
        pos = k + 1; line++;
      }
      this.ta.focus();
      this._setTextWithSel(v, pos, pos);
      this._reportStatus();
    }

    // ---------- 渲染 ----------
    scheduleRender() {
      if (this._rt) return;
      this._rt = requestAnimationFrame(() => { this._rt = null; this.render(); });
    }
    // 高亮层关闭（大文件 / 自动换行）时，让 textarea 直接显示可见文字
    _updateInputMode() {
      const plain = this.wrap || this.ta.value.length > MAX_HL;
      this.ta.classList.toggle("solid", plain);
      return plain;
    }
    render() {
      const v = this.ta.value;
      const plain = this._updateInputMode();
      if (plain) {
        // 大文件 / 换行模式：不构建整篇高亮 DOM，避免内存膨胀
        this.pre.innerHTML = "";
      } else {
        let txt = v;
        if (this.showSpaces) txt = txt.replace(/ /g, "\u00b7").replace(/\t/g, "\u00bb");
        if (this.showEol) txt = txt.replace(/\n/g, "\u21b5\n");
        const html = SN.highlightRender(txt, this.langId, this.combinedRanges());
        this.pre.innerHTML = html;
      }
      this._renderGutter();
      this._syncScroll();
    }

    _renderGutter() {
      const lc = this.lineCount();
      this._gutterLines = lc;
      this._gKey = null;               // 行数变化 → 强制重画窗口
      this._renderGutterWindow();
    }

    _syncScroll() {
      const ta = this.ta;
      const x = ta.scrollLeft, y = ta.scrollTop;
      this.mover.style.transform = "translate(" + (-x) + "px," + (-y) + "px)";
      const lh = this._lineH || 22;
      const n = this._gutterLines != null ? this._gutterLines : this.lineCount();
      this._gutterLines = n;
      this.gInner.style.height = (n * lh) + "px";
      this.gInner.style.transform = "translateY(" + (-y) + "px)";
      this._renderGutterWindow();
      // 当前行背景
      const line = this._cachedCurLine() - 1;
      if (!this.wrap) {
        this.rowhl.style.top = (line * lh + 4) + "px";
        this.rowhl.style.display = this.readOnly ? "none" : "block";
      } else this.rowhl.style.display = "none";
      if (this.onScrollCb) this.onScrollCb();
    }

    // 行号列虚拟化：只渲染可视窗口附近的数字，任意大文件都流畅
    _renderGutterWindow() {
      const n = this._gutterLines != null ? this._gutterLines : this.lineCount();
      const lh = this._lineH || 22;
      const viewH = this.gutter.clientHeight || this.ta.clientHeight || 240;
      const y = this.ta.scrollTop || 0;
      const from = Math.max(0, Math.floor(y / lh) - 8);
      const to = Math.min(n - 1, Math.ceil((y + viewH) / lh) + 8);
      if (to < from) return;
      const key = from + ":" + to;
      if (key === this._gKey) return;
      this._gKey = key;
      const g = this.gInner;
      g.textContent = "";
      const frag = document.createDocumentFragment();
      for (let i = from; i <= to; i++) {
        const d = document.createElement("div");
        d.className = "ln" + (this.bookmarks.has(i) ? " bm" : "");
        d.textContent = String(i + 1);
        d.style.position = "absolute";
        d.style.top = (i * lh + 4) + "px";   // 4px 与编辑区上内边距对齐
        d.style.left = "0";
        d.style.right = "0";
        frag.appendChild(d);
      }
      g.appendChild(frag);
    }

    focus() { this.ta.focus(); }
    scrollToPos(pos) {
      const v = this.ta.value;
      let line = 0;
      for (let i = 0; i < pos && i < v.length; i++) if (v[i] === "\n") line++;
      const lh = this._lineH || 22;
      const top = line * lh - 20;
      this.ta.scrollTop = Math.max(0, top);
      this._syncScroll();
    }
  }

  SN.Editor = Editor;
  SN.EDITOR_MAX_HL = MAX_HL;
})();
