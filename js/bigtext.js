"use strict";
(function () {
  const SN = window.SN;
  const el = SN.el;

  const ROW_H = 22;         // 与编辑器行高一致
  const OVERSCAN = 16;
  const MAX_INDEX_LINES = 3 * 1000 * 1000; // 行数索引上限
  const ROW_SLICE_CAP = 1024 * 1024;       // 单行解码上限（超长行截断展示）
  const CHUNK = 4 * 1024 * 1024;           // 建索引分块大小
  const HL_WORD = "#B3E5FC";                // 双击单词高亮（与普通文档 wordHighlight 同色）

  const codec = (doc) => {
    const c = SN.codeById(doc.enc);
    return c && c.label ? c.label : "utf-8";
  };

  // 逐块扫描换行符，建立“每行起始字节偏移”索引（异步分片避免卡死主线程）
  async function buildIndex(doc, onDone, onProgress) {
    const bytes = doc.raw;
    const n = bytes.length;
    const starts = [0];
    let pos = 0;
    const tick = Math.max(1, Math.floor(CHUNK / 4));
    while (pos < n) {
      const end = Math.min(n, pos + CHUNK);
      for (let i = pos; i < end; i++) {
        if (bytes[i] === 10) {
          starts.push(i + 1);
          if (starts.length > MAX_INDEX_LINES) break;
        }
      }
      pos = end;
      if (onProgress) onProgress(pos / n);
      if (pos < n) await new Promise(r => setTimeout(r, 0));
    }
    if (starts.length > MAX_INDEX_LINES) {
      // 病态文件（极多短行）：回退为固定字节块视图，不显示行号
      doc.bigChunkMode = true;
      doc.bigChunkSize = 256 * 1024;
      doc.bigChunks = Math.ceil(n / doc.bigChunkSize);
      doc.bigLineCount = doc.bigChunks;
      doc.lineStarts = null;
    } else {
      doc.bigChunkMode = false;
      if (starts[starts.length - 1] !== n) starts.push(n);
      doc.lineStarts = starts;
      doc.bigLineCount = starts.length - 1;
    }
    if (onDone) onDone();
  }

  // 复用的行解码器：避免每帧/每行 new TextDecoder；subarray 避免切片拷贝
  function makeLineText(doc) {
    const bytes = doc.raw;
    let dec = null, lastCodec = null;
    const getDec = () => {
      const c = codec(doc);
      if (c !== lastCodec) { dec = new TextDecoder(c); lastCodec = c; }
      return dec;
    };
    return function (i) {
      let s, e;
      if (doc.bigChunkMode) {
        s = i * doc.bigChunkSize;
        e = Math.min(bytes.length, s + doc.bigChunkSize);
      } else {
        const st = doc.lineStarts;
        s = st[i];
        e = i + 1 < st.length ? st[i + 1] : bytes.length;
      }
      const realLen = e - s;
      const len = Math.min(realLen, ROW_SLICE_CAP);
      let txt;
      try { txt = getDec().decode(bytes.subarray(s, s + len)); }
      catch (err) { txt = ""; }
      txt = txt.replace(/\r\n?$|\n$/, "");
      if (realLen > ROW_SLICE_CAP) txt += " …（该行过长，已截断）";
      return txt;
    };
  }

  // ---------- 大文本搜索：分块流式解码，不整篇加载，内存与文件大小无关 ----------
  function countLE(arr, idx) {
    let lo = -1, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }
  // 等待一次真实浏览器重绘（双 rAF），让进度文字能显示出来
  function allowPaint() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  // 大文件分块流式搜索：内存与文件大小无关；返回 {total, rows:[{line,snippet}]}
  async function chunkSearchFile(doc, keyword, onProgress, signal) {
    const bytes = doc.raw;
    const CH = 8 * 1024 * 1024;
    const src = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dec = new TextDecoder(codec(doc));
    let carry = "";
    let doneLines = 0;
    const rows = [];
    const MAX_SHOW = 2000;
    let total = 0;
    const len = bytes.length;
    for (let i = 0; i < len; i += CH) {
      if (signal && signal.abort) return { total, rows, aborted: true };
      const last = i + CH >= len;
      let piece;
      try { piece = dec.decode(bytes.subarray(i, i + CH), { stream: !last }); }
      catch (e) { piece = ""; }
      const cLen = carry.length;
      const text = carry + piece;
      const baseLine = doneLines + 1;
      const nlpos = [];
      for (let k = 0; k < text.length; k++) if (text[k] === "\n") nlpos.push(k);
      const re = new RegExp(src, "gi");
      let m;
      while ((m = re.exec(text))) {
        if (m.index < cLen && m.end <= cLen) continue;
        total++;
        {
          const idx = m.index;
          const line = baseLine + countLE(nlpos, idx);
          let lo = -1, hi = nlpos.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (nlpos[mid] < idx) lo = mid; else hi = mid - 1;
          }
          const ls = lo >= 0 ? nlpos[lo] + 1 : 0;
          let le = text.length;
          for (const np of nlpos) if (np > idx) { le = np; break; }
          let snippet = text.slice(ls, le).replace(/\r$/, "");
          if (snippet.length > 180) snippet = snippet.slice(0, 180) + "…";
          rows.push({ line, snippet });
        }
        if (re.lastIndex === m.index) re.lastIndex++;
      }
      doneLines += nlpos.length;
      const lastNL = text.lastIndexOf("\n");
      carry = lastNL >= 0 ? text.slice(lastNL + 1) : "";
      if (carry.length > 1024 * 1024) carry = carry.slice(-1024 * 1024);
      const pct = Math.min(100, Math.round(((i + CH) / len) * 100));
      if (onProgress) onProgress(pct, total);
      await allowPaint();
    }
    return { total, rows, aborted: false };
  }
  SN.bigSearchFile = chunkSearchFile;

  SN.buildBigTextPage = function (doc) {
    const page = el("div", { class: "bigview page-view", style: "position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ed-bg);color:var(--ed-fg)" });

    // 视口
    const viewport = el("div", { class: "bg-viewport", style: "flex:1;overflow:auto;position:relative;font-family:ui-monospace,Consolas,Menlo,monospace;font-size:14px;line-height:22px" });
    const inner = el("div", { class: "bg-inner", style: "position:relative" });
    viewport.appendChild(inner);
    page.appendChild(viewport);

    let lc = 1;
    let raf = null;
    let lastTop = -1;
    let hlKw = "";                          // 双击选中的单词（临时高亮）
    doc.bigMarks = doc.bigMarks || [];      // 持久标记（查找→标记颜色），[{keyword,color}]
    let bigSel = "";                        // 本视图内最近一次有效选中文本（右键/抢焦点把选区折叠掉也不清空）
    const langHint = SN.langById(doc.lang);
    const lineTxt = makeLineText(doc);

    function size() {
      inner.style.height = (lc * ROW_H) + "px";
      paint();
    }
    function visible() {
      const top = Math.max(0, Math.floor(viewport.scrollTop / ROW_H) - OVERSCAN);
      const rows = Math.ceil(viewport.clientHeight / ROW_H) + OVERSCAN * 2;
      return { from: top, to: Math.min(lc - 1, top + rows) };
    }
    // 行节点池：滚动时只新建/更新进入视口的行，离开视口的行回收复用
    const rowMap = new Map();
    const freeRows = [];
    function makeRow() {
      const row = document.createElement("div");
      row.className = "bg-row";
      row.style.cssText = "position:absolute;left:0;right:0;height:" + ROW_H + "px;white-space:pre;overflow:hidden;box-sizing:border-box;padding-left:4px";
      const no = document.createElement("span");
      no.className = "bg-ln";
      no.style.cssText = "display:inline-block;width:64px;color:var(--ed-line-num);text-align:right;padding-right:8px;user-select:none";
      const code = document.createElement("span");
      row.appendChild(no);
      row.appendChild(code);
      return { row, no, code };
    }
    function invalidateRows() {
      for (const [key, ent] of Array.from(rowMap)) {
        rowMap.delete(key);
        ent.row.remove();
        freeRows.push(ent);
      }
    }
    // 区间叠加：新加入的 [s,e) 颜色在重叠处覆盖旧颜色，输出仍互不重叠
    function overlaySegs(segs, s, e, color) {
      const out = [];
      for (const g of segs) {
        if (e <= g.s || s >= g.e) { out.push(g); continue; }
        if (g.s < s) out.push({ s: g.s, e: s, color: g.color });
        if (e < g.e) out.push({ s: e, e: g.e, color: g.color });
      }
      out.push({ s, e, color });
      return out.sort((a, b) => a.s - b.s);
    }
    // 收集关键字在单行内的匹配区间；whole 时要求整词（避开相邻字母/数字/下划线）
    function addSegs(segs, txt, kw, color, whole) {
      if (!kw || txt.length < kw.length) return segs;
      const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let re;
      try { re = new RegExp(esc, whole ? "g" : "gi"); } catch (e) { return segs; }
      const wc = /[A-Za-z0-9_$]/;
      let m;
      while ((m = re.exec(txt))) {
        const s = m.index, e = s + m[0].length;
        if (whole && ((s > 0 && wc.test(txt[s - 1])) || (e < txt.length && wc.test(txt[e])))) { re.lastIndex = e; continue; }
        segs = overlaySegs(segs, s, e, color);
        re.lastIndex = Math.max(re.lastIndex, m.index + 1);
      }
      return segs;
    }
    // 渲染单行内容：临时单词高亮 + 各颜色持久标记，匹配片段包成 mark
    function renderLine(code, txt) {
      let segs = [];
      if (hlKw) segs = addSegs(segs, txt, hlKw, HL_WORD, true);
      for (const rec of doc.bigMarks) segs = addSegs(segs, txt, rec.keyword, rec.color, false);
      if (!segs.length) { code.textContent = txt; return; }
      code.textContent = "";
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const g of segs) {
        if (g.s > last) frag.appendChild(document.createTextNode(txt.slice(last, g.s)));
        const mk = document.createElement("mark");
        mk.textContent = txt.slice(g.s, g.e);
        mk.style.cssText = "background:" + g.color + ";color:inherit";
        frag.appendChild(mk);
        last = g.e;
      }
      if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
      code.appendChild(frag);
    }
    function paintRows(from, to) {
      for (const key of Array.from(rowMap.keys())) {
        if (key < from || key > to) {
          const ent = rowMap.get(key);
          rowMap.delete(key);
          ent.row.remove();
          freeRows.push(ent);
        }
      }
      for (let i = from; i <= to; i++) {
        let ent = rowMap.get(i);
        if (!ent) {
          ent = freeRows.pop() || makeRow();
          ent.row._i = -1;
          rowMap.set(i, ent);
          inner.appendChild(ent.row);
        }
        if (ent.row._i !== i) {
          ent.row._i = i;
          ent.row.style.top = (i * ROW_H) + "px";
          ent.no.textContent = doc.bigChunkMode ? (i * (doc.bigChunkSize / 1024)) + "K" : String(i + 1);
          renderLine(ent.code, lineTxt(i));
        }
      }
    }
    function paint() {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const top = viewport.scrollTop;
        if (top === lastTop) return;
        lastTop = top;
        const r = visible();
        if (r.to < r.from) return;
        paintRows(r.from, r.to);
      });
    }

    function gotoLine(n) {
      const i = Math.max(0, Math.min(lc - 1, n - 1));
      viewport.scrollTop = i * ROW_H;
      lastTop = -1;
      paint();
    }
    function refreshRows() {
      for (const [key, ent] of rowMap) renderLine(ent.code, lineTxt(key));
    }
    function insidePage(n) {
      while (n) { if (n === page) return true; n = n.parentNode; }
      return false;
    }
    // 记录本视图内的选区（等效于 textarea 失焦仍保留选区）：
    // 关键点——折叠（右键、菜单抢焦点、点空白）**不改写记忆**，否则右键菜单拿到的永远是空选区，
    // 「标记颜色/复制选中内容」会静默失效（提示「请先选中要高亮的文本」）。
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection && window.getSelection();
      if (!sel || !sel.anchorNode || !insidePage(sel.anchorNode)) return;
      if (sel.isCollapsed) return;
      const t = (sel.toString() || "").trim();
      if (t && t.length <= 4096) bigSel = t;
    });
    // 左键点空白处＝有意取消选择，此时才清记忆（右键 mouseup 是 button=2，不动它）
    page.addEventListener("mouseup", (e) => {
      if (e && e.button !== undefined && e.button !== 0) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.isCollapsed) bigSel = "";
    });
    doc.bigSelected = () => bigSel;
    // 右键菜单在打开那一刻把目标固定下来（见下方 contextMenu）：与文本视图「还原选区」等价
    doc.bigSetSelected = (kw) => { bigSel = String(kw == null ? "" : kw).trim().slice(0, 4096); };
    // 右键落点下的词：没选中任何内容时用它兜底，语义与「双击高亮该词」一致
    doc._bigKeywordAt = (ev) => {
      if (bigSel) return bigSel;
      if (!ev) return "";
      const pt = caretPointAt(ev.clientX, ev.clientY);
      if (!pt || !pt.node || pt.node.nodeType !== 3) return "";
      return wordFromTextNode(pt.node, pt.offset, ev.clientX);
    };
    // 从命中位置扩到词边界；额外用 Range 量文字实际左右边界，
    // 避免「点在整行文字右侧的空白区」时误取行尾那个词
    function wordFromTextNode(node, offset, x) {
      const text = node.data || "";
      const re = /[A-Za-z0-9_$#@.\-\u00c0-\uffff]/;
      let s = offset, e = offset;
      while (s > 0 && re.test(text[s - 1])) s--;
      while (e < text.length && re.test(text[e])) e++;
      if (s === e) return "";
      try {
        const r = document.createRange();
        r.setStart(node, 0);
        r.setEnd(node, text.length);
        const rect = r.getBoundingClientRect ? r.getBoundingClientRect() : null;
        if (rect && x !== undefined && x !== null && (x < rect.left - 2 || x > rect.right + 2)) return "";
      } catch (err) { /* 量不出边界就不做这层额外判断 */ }
      return text.slice(s, e).trim();
    }
    function caretPointAt(x, y) {
      if (x === undefined || y === undefined) return null;
      try {
        if (typeof document.caretPositionFromPoint === "function") {
          const p = document.caretPositionFromPoint(x, y);
          if (p) return { node: p.offsetNode, offset: p.offset };
        }
        if (typeof document.caretRangeFromPoint === "function") {
          const r = document.caretRangeFromPoint(x, y);
          if (r) return { node: r.startContainer, offset: r.startOffset };
        }
      } catch (e) { /* 视口外/不支持的浏览器：当作没取到 */ }
      return null;
    }
    doc.bigAddMark = function (kw, color) {
      doc.bigMarks = doc.bigMarks || [];
      const idx = doc.bigMarks.findIndex(r => r.keyword === kw && r.color === color);
      const rec = { keyword: kw, color };
      if (idx >= 0) doc.bigMarks[idx] = rec; else doc.bigMarks.push(rec);
      hlKw = "";
      refreshRows();
    };
    doc.bigClearMarks = function () {
      doc.bigMarks = [];
      hlKw = "";
      refreshRows();
    };
    viewport.addEventListener("dblclick", () => {
      // 等浏览器原生双击选中完成后读取；行为与普通文档“双击单词高亮”一致
      setTimeout(() => {
        const s = SN.app && SN.app.settings;
        if (s && s.wordDblHighlight === false) return;
        const sel = (window.getSelection ? window.getSelection().toString() : "").trim();
        if (!sel || sel.length > 256) {
          if (hlKw) { hlKw = ""; refreshRows(); }
          return;
        }
        hlKw = sel;
        refreshRows();
        setBigStatus("高亮 “" + sel + "”：可视行内匹配项已标出，滚动查看（双击空白处取消）");
      }, 0);
    });
    doc._bigJump = gotoLine;
    function setBigStatus(m) { const bm = SN.$("#msgLabel"); if (bm) bm.textContent = m; }
    function setBottomMeta() {
      const bm = SN.$("#msgLabel");
      if (!bm) return;
      bm.textContent = doc.name + " — 大文本只读(虚拟滚动) · " + SN.fmtSize(doc.raw ? doc.raw.length : 0)
        + " · " + SN.codeById(doc.enc).name
        + (doc.bigChunkMode ? " · 块视图" : " · 约 " + (doc.bigLineCount || lc).toLocaleString() + " 行");
    }


    viewport.addEventListener("scroll", () => paint(), { passive: true });
    window.addEventListener("resize", () => { if (doc.pageEl && document.body.contains(doc.pageEl)) size(); });
    inner.style.height = "1px";
    lc = 1;
    setBigStatus("正在建立行索引…");
    buildIndex(doc, () => {
      lc = doc.bigChunkMode ? doc.bigChunks : doc.bigLineCount || 1;
      doc.bigTotalLines = lc;
      invalidateRows();        // 丢弃索引前画的空行缓存，强制重建（修复首行内容不显示）
      lastTop = -1;
      size();
      setBottomMeta();
    }, (p) => {
      if (!(p < 1)) return;
    });
    return page;
  };

  // 大文本视图适配器：把「大文件该怎么做」集中在这里（渲染/定位行/本视图查找/标记/导出/分块检索），
  // 调用方只写 SN.views.of(doc).xxx()，不再四处 if (doc.kind === "big")
  SN.views.define("big", {
    tabTag: "≫", listTag: " ≫", modeTag: "BigTextRO", persistBody: false,
    // 打开即只读；保留原始字节用于导出与分块检索；只解头部一小段判行尾，避免整篇解码
    open: { readOnly: true, keepRawBytes: true, decodeMode: "head", note: "，大文本只读/虚拟滚动模式" },
    render: (doc, page) => {
      if (!SN.buildBigTextPage) return false;
      page.appendChild(SN.buildBigTextPage(doc));
      return true;
    },
    jumpToLine: (doc, n) => { if (doc._bigJump) doc._bigJump(n); },
    selectionKeyword: (doc) => (doc.bigSelected && doc.bigSelected()) || "",
    clearMarks: (doc) => { if (doc.bigClearMarks) doc.bigClearMarks(); },
    markSelection: (doc, color) => {
      const kw = (doc.bigSelected && doc.bigSelected()) || "";
      if (!kw) { SN.setMsg("请先在大文件视图中选中要高亮的文本"); return false; }
      if (/\r|\n/.test(kw) || kw.length > 4096) { SN.setMsg("大文件标记仅支持单行内且较短的文本"); return false; }
      if (!doc.bigAddMark) { SN.setMsg("大文件标记暂不可用"); return false; }
      doc.bigAddMark(kw, color);
      SN.setMsg("已用颜色高亮 “" + kw + "”：滚动查看（“清除全部标记”可移除）");
      return true;
    },
    exportBytes: (doc) => {
      if (doc.raw) SN.download(doc.name, new Blob([doc.raw]));
      else SN.toast("未保留原始字节");
    },
    // 右键菜单：只给本视图真能做的事（能力表 caps.big：查找/标记/跳转行/导出/重命名）
    contextMenu: (doc, e) => {
      // 打开菜单那一刻把目标定下来：优先已有选区，其次右键点下的词。
      // 定下来后「标记颜色/复制选中内容」都作用于它，不受后续折叠/抢焦点影响。
      const kw = (doc._bigKeywordAt ? doc._bigKeywordAt(e) : "") || "";
      if (kw && doc.bigSetSelected) doc.bigSetSelected(kw);
      const sel = (doc.bigSelected && doc.bigSelected()) || "";
      return [
        // 不给「全部标记」：点颜色就已经标记了当前目标，整体性入口留在查找面板/顶栏菜单
        { label: "清除全部标记", requires: "mark", action: () => SN.cmd.clearMarksAll() },
        { label: "标记颜色", palette: true, requires: "mark" },
        "-",
        { label: "查找…", action: () => SN.dlg.find({ scope: "doc" }) },
        { label: "跳转行…", requires: "gotoLine", action: () => SN.dlg.gotoLine() },
        "-",
        {
          label: "复制选中内容",
          disabled: !sel,
          tip: sel ? "" : "请先在大文件视图里选中要高亮的文本",
          action: () => {
            SN.menu.copyText(sel).then(ok => SN.setMsg(ok ? "已复制 " + sel.length + " 字符" : "浏览器未允许写入剪贴板"));
          }
        },
        "-",
        { label: "导出原始文件", requires: "exportBytes", action: () => SN.cmd.downloadDoc(doc.id) },
        { label: "重命名…", requires: "rename", action: () => SN.cmd.renameDoc(doc.id) }
      ];
    },
    // 跨文档查找用：原始字节走分块流式检索，返回 [{line, snippet}]
    search: async (doc, keyword, onProgress) => {
      let raw = doc.raw;
      if (!raw && doc.handle) {
        try { raw = await SN.readAsBytes(await doc.handle.getFile()); } catch (e) { raw = null; }
      }
      if (!raw) raw = new TextEncoder().encode(doc.content || "");
      const r = await chunkSearchFile({ raw, enc: doc.enc }, keyword, onProgress, { abort: false });
      return r.rows;
    }
  });
})();
