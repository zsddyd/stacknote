"use strict";
(function () {
  const SN = window.SN;
  const el = SN.el;

  const ROW_H = 22;         // 与编辑器行高一致
  const OVERSCAN = 16;
  const MAX_INDEX_LINES = 3 * 1000 * 1000; // 行数索引上限
  const ROW_SLICE_CAP = 1024 * 1024;       // 单行解码上限（超长行截断展示）
  const CHUNK = 4 * 1024 * 1024;           // 建索引分块大小

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
  function showBigResults(doc, rows, total, kw) {
    const dock = SN.$("#bottomDock");
    if (dock) dock.classList.remove("hidden");
    const split = SN.$("#dockSplit");
    if (split) split.classList.remove("hidden");
    const view = SN.$("#resultView");
    if (!view) return;
    view.textContent = "";
    view.appendChild(el("div", { class: "res-sec", text: doc.name + "（“" + kw + "”共 " + total + " 处，已全部列出 " + rows.length + " 条）" }));
    // 分批渲染全部结果，避免一次性建大量 DOM 卡顿
    const BATCH = 3000;
    let cursor = 0;
    function feed() {
      const frag = document.createDocumentFragment();
      const end = Math.min(rows.length, cursor + BATCH);
      for (; cursor < end; cursor++) {
        const r = rows[cursor];
        const row = el("div", { class: "res-row" });
        row.appendChild(el("span", { class: "lnn", text: "行 " + r.line + ": " }));
        row.appendChild(document.createTextNode(r.snippet || ""));
        row.addEventListener("click", () => {
          if (doc._bigJump) doc._bigJump(r.line);
          if (SN.activateDoc) SN.activateDoc(doc.id);
        });
        frag.appendChild(row);
      }
      view.appendChild(frag);
      if (cursor < rows.length) requestAnimationFrame(feed);
    }
    feed();
  }
  // 应用内关键字输入框（替代浏览器原生 prompt，避免被拦截/无反应）
  function askBigKeyword(prefill) {
    return new Promise((resolve) => {
      SN.openModal({
        title: "在大文件中查找",
        buttons: [
          { label: "取消", action: () => { resolve(null); } },
          { label: "搜索", primary: true, action: () => {
            const v = (SN.$("#bigFindKw") || { value: "" }).value || "";
            resolve(v.trim() || null);
          } }
        ],
        onOpen(b) {
          const inp = el("input", {
            type: "text", id: "bigFindKw", value: prefill || "",
            style: "width:100%", placeholder: "输入要查找的字符串（忽略大小写），结果将列在下方“结果”栏…"
          });
          b.appendChild(inp);
          const ok = () => {
            const v = (inp.value || "").trim();
            if (v) { resolve(v); SN.closeModal(); }
          };
          inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } });
          inp.focus();
          inp.select();
        }
      });
    });
  }

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
          ent.code.textContent = lineTxt(i);
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
    doc._bigJump = gotoLine;
    doc.bigFind = () => doFind();
    async function doFind() {
      const kw = await askBigKeyword(doc.bigSearchKw || "");
      if (!kw) return;
      doc.bigSearchKw = kw;
      if (doc._searchRun) doc._searchRun.abort = true;   // 再次点击 = 取消上一次
      const run = { abort: false };
      doc._searchRun = run;
      setBigStatus("正在检索 “" + kw + "”…");
      await new Promise(r => setTimeout(r, 20));
      const t0 = performance.now();
      // —— 统一分块流式搜索（下方旧实现保留为不可达回退）——
      try {
        const r = await chunkSearchFile(doc, kw, (pct, n) => {
          setBigStatus("正在检索 “" + kw + "” " + pct + "% · 已找到 " + n + " 处");
        }, run);
        const cost = Math.max(1, Math.round(performance.now() - t0));
        if (run.abort || r.aborted) { setBigStatus("已取消搜索 “" + kw + "”"); return; }
        doc._searchRun = null;
        const msg = SN.$("#msgLabel");
        if (!r.total) {
          const s = "未找到 “" + kw + "”（用时 " + cost + "ms）";
          setBigStatus(s);
          if (msg) msg.textContent = s;
          return;
        }
        const first = r.rows[0] || { line: 1 };
        doc.bigSearchLine = first.line - 1;
        gotoLine(first.line);
        showBigResults(doc, r.rows, r.total, kw);
        const s = "找到 " + r.total + " 处，已定位到第 " + first.line + " 行（用时 " + cost + "ms），点击下方结果可跳转";
        if (msg) msg.textContent = s;
        setBigStatus("找到 " + r.total + " 处");
        return;
      } catch (err) {
        setBigStatus("查找出错：" + (err && err.message ? err.message : err));
        return;
      }
      try {
        const bytes = doc.raw;
        const CH = 8 * 1024 * 1024;
        const src = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const dec = new TextDecoder(codec(doc));
        let carry = "";
        let doneLines = 0;          // 已消费换行总数（行号基准）
        const rows = [];
        const MAX_SHOW = 2000;
        let total = 0;
        const len = bytes.length;
        for (let i = 0; i < len; i += CH) {
          if (run.abort) { setBigStatus("已取消搜索 “" + kw + "”"); return; }
          const last = i + CH >= len;
          let piece;
          try { piece = dec.decode(bytes.subarray(i, i + CH), { stream: !last }); }
          catch (e) { piece = ""; }
          const cLen = carry.length;      // carry 区已在上一个块统计过，避免重复计数
          const text = carry + piece;
          const baseLine = doneLines + 1;
          const nlpos = [];
          for (let k = 0; k < text.length; k++) if (text[k] === "\n") nlpos.push(k);
          const re = new RegExp(src, "gi");
          let m;
          while ((m = re.exec(text))) {
            if (m.index < cLen && m.end <= cLen) continue;   // 上一块已统计的整段命中
            total++;
            if (rows.length < MAX_SHOW) {
              const idx = m.index;
              const line = baseLine + countLE(nlpos, idx);
              let ls = 0;
              let lo = -1, hi = nlpos.length - 1;
              while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (nlpos[mid] < idx) lo = mid; else hi = mid - 1;
              }
              if (lo >= 0) ls = nlpos[lo] + 1;
              let le = text.length;
              for (const np of nlpos) if (np > idx) { le = np; break; }
              let snippet = text.slice(ls, le).replace(/\r$/, "");
              if (snippet.length > 180) snippet = snippet.slice(0, 180) + "…";
              rows.push({ line, snippet });
            }
            if (re.lastIndex === m.index) re.lastIndex++;
          }
          doneLines += nlpos.length;
          // 只保留“半个未结束行”用于跨块衔接，避免尾部越滚越大
          const lastNL = text.lastIndexOf("\n");
          carry = lastNL >= 0 ? text.slice(lastNL + 1) : "";
          if (carry.length > 1024 * 1024) carry = carry.slice(-1024 * 1024);
          // 每块都刷新进度，并用双 rAF 等真实重绘，避免进度被连续同步扫描“吞掉”
          const pct = Math.min(100, Math.round(((i + CH) / len) * 100));
          setBigStatus("正在检索 “" + kw + "” " + pct + "% · 已找到 " + total + " 处");
          await allowPaint();
        }
        const cost = Math.max(1, Math.round(performance.now() - t0));
        if (run.abort) return;
        doc._searchRun = null;
        const msg = SN.$("#msgLabel");
        if (!total) {
          const s = "未找到 “" + kw + "”（用时 " + cost + "ms）";
          setBigStatus(s);
          if (msg) msg.textContent = s;
          return;
        }
        doc.bigSearchLine = rows[0].line - 1;
        gotoLine(rows[0].line);
        showBigResults(doc, rows, total, kw);
        const s = "找到 " + total + " 处，已定位到第 " + rows[0].line + " 行（用时 " + cost + "ms），点击下方结果可跳转";
        if (msg) msg.textContent = s;
        setBigStatus("找到 " + total + " 处");
      } catch (err) {
        setBigStatus("查找出错：" + (err && err.message ? err.message : err));
      }
    }

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
})();
