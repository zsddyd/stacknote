"use strict";
(function () {
  const SN = window.SN;
  const el = SN.el;
  const app = SN.app;
  const cmd = SN.cmd;
  const dlg = SN.dlg;
  const tool = SN.tool;
  const edApi = SN.textops;
  const $ = SN.$;

  function setMsg(m) { SN.setMsg(m); }

  // ============ 通用编辑辅助 ============
  function mutateDocText(fn, caret) {
    const d = SN.activeDoc();
    const ed = SN.activeEditor();
    if (!d || !ed) { setMsg("没有活动文本文档"); return; }
    ed.pushUndo();
    const r = fn(ed.text) || {};
    const nv = typeof r === "string" ? r : r.text;
    d.content = nv;
    ed.setText(nv, r.sel || caret || [0, 0]);
    SN.docContentTouched(d);
    ed.focus();
  }

  function runWholeOrSelection(transform) {
    mutateDocText((v) => {
      const ed = SN.activeEditor();
      const s = ed.selStart, e = ed.selEnd;
      if (s === e) return transform(v);
      const nv = v.slice(0, s) + transform(v.slice(s, e)) + v.slice(e);
      return { text: nv, sel: [s, e] };
    });
  }

  // ============ 编辑命令 ============
  cmd.eolConv = function (eol) {
    const d = SN.activeDoc();
    if (!d) return;
    mutateDocText((v) => SN.normalizeEol(v, eol));
    d.eol = eol;
    SN.$("#eolSel").value = eol;
    setMsg("行尾已转为 " + eol.toUpperCase());
  };

  cmd.blankOp = function (mode) {
    runWholeOrSelection((txt) => txt.split("\n").map(l => {
      if (mode === "head") return l.replace(/^[ \t]+/, "");
      if (mode === "end") return l.replace(/[ \t]+$/, "");
      return l.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    }).join("\n"));
    setMsg("空白清理完成");
  };

  cmd.tabOp = function (mode) {
    const d = SN.activeDoc();
    mutateDocText((v) => edApi.convertSpace(v, app.settings.tabWidth || 4, mode));
    setMsg(mode === "tab2space" ? "TAB 已转为空格" : "空格已转为 TAB");
  };

  cmd.caseOp = function (type) {
    const names = { upper: "UPPERCASE", lower: "lowercase", proper: "Proper Case", properB: "Proper Case", sentence: "Sentence case", invert: "Invert Case", random: "Random Case" };
    runWholeOrSelection((t) => edApi.caseText(t, type));
    setMsg("大小写转换完成: " + (names[type] || type));
  };

  // ---------- 行操作 ----------
  function linesOf(v) { return v === "" ? [""] : v.split("\n"); }
  function linesJoin(arr, endsNL) { return arr.join("\n") + (endsNL ? "\n" : ""); }

  function withBlock(fn, mode) {
    const d = SN.activeDoc(), ed = SN.activeEditor();
    if (!d || !ed) return;
    ed.pushUndo();
    const v = ed.text;
    const s = ed.selStart, e = ed.selEnd;
    let bs, be;
    if (s === e && mode !== "doc") {
      bs = s === 0 ? 0 : (v.lastIndexOf("\n", s - 1) + 1);
      be = v.indexOf("\n", s); if (be < 0) be = v.length;
    } else if (mode === "doc") {
      bs = 0; be = v.length;
    } else {
      const r = edApi.blockOffsets(v, s, e); bs = r[0]; be = r[1];
    }
    const head = v.slice(0, bs);
    const mid = v.slice(bs, be);
    const tail = v.slice(be);
    const endsNL = mid.endsWith("\n");
    const arr = mid === "" ? [""] : mid.replace(/\n$/, "").split("\n");
    const out = fn(arr, v, bs) || arr;
    let nv = head + linesJoin(out, endsNL) + tail;
    if (nv === v) { ed.focus(); return; }
    // 防止破坏尾部空行
    d.content = nv;
    ed.setText(nv, [bs, bs]);
    SN.docContentTouched(d);
    ed.focus();
  }

  cmd.lineOp = function (op) {
    if (op === "up" || op === "down") return moveLines(op);
    withBlock((arr) => {
      if (op === "dup") return arr.concat(arr);
      if (op === "delDupConsec") return edApi.removeDupLines(arr, true);
      if (op === "delDupAll") return edApi.removeDupLines(arr, false);
      if (op === "delEmpty") return edApi.removeEmpty(arr, false);
      if (op === "delEmptyWs") return edApi.removeEmpty(arr, true);
      if (op === "reverse") return arr.slice().reverse();
      if (op === "split") return edApi.splitLongLines(arr, 100);
      return arr;
    });
    setMsg("行操作完成: " + op);
  };

  function moveLines(dir) {
    const d = SN.activeDoc(), ed = SN.activeEditor();
    if (!d || !ed) return;
    ed.pushUndo();
    const v = ed.text;
    const s = ed.selStart, e = ed.selEnd;
    const r = edApi.blockOffsets(v, s, e);
    const head = v.slice(0, r[0]);
    const mid = v.slice(r[0], r[1]);
    const tail = v.slice(r[1]);
    const arr = linesOf(mid.replace(/\n$/, ""));
    const lines = linesOf(v);
    const startLine = head === "" ? 0 : head.split("\n").length - 1;
    const len = arr.length;
    const target = dir === "up" ? startLine - 1 : startLine + len;
    if (target < 0 || target + len > lines.length) { setMsg("已到文档边界"); return; }
    const block = lines.slice(startLine, startLine + len);
    lines.splice(startLine, len);
    lines.splice(target, 0, ...block);
    const nv = lines.join("\n");
    d.content = nv;
    ed.setText(nv, [0, 0]);
    SN.docContentTouched(d);
    ed.focus();
  }

  cmd.sortOp = function (id) {
    const mode = { lex_asc: "", lex_desc: "desc", lexci_asc: "ci", lexci_desc: "ci_desc", num_asc: "num", num_desc: "num_desc" }[id];
    withBlock(arr => edApi.sortLines(arr, mode), "doc");
    setMsg("排序完成");
  };

  cmd.edStatus = function () {
    const ed = SN.activeEditor();
    if (ed) ed._reportStatus();
  };

  // ============ 视图开关 ============
  function applyEditorView(d) {
    if (!d || d.kind !== "text" || !d.editor) return;
    const ed = d.editor;
    ed.setWrap(app.settings.wrap);
    ed.setShowSpaces(app.settings.showSpaces);
    ed.setShowEol(app.settings.showEol);
  }
  function viewForAll() { app.docs.forEach(d => { if (d.kind === "text") applyEditorView(d); }); }

  cmd.toggleWrap = function () {
    app.settings.wrap = !app.settings.wrap;
    viewForAll(); saveViewState();
    rebuildUi();
  };
  cmd.toggleSpaces = function () {
    app.settings.showSpaces = !app.settings.showSpaces;
    viewForAll(); saveViewState(); rebuildUi();
  };
  cmd.toggleEol = function () {
    app.settings.showEol = !app.settings.showEol;
    viewForAll(); saveViewState(); rebuildUi();
  };
  cmd.toggleWeb = function () {
    app.settings.webAddrHighlight = !app.settings.webAddrHighlight;
    saveViewState(); rebuildUi();
    if (app.settings.webAddrHighlight) applyWebHighlights();
    else app.docs.forEach(d => { if (d.editor) d.editor.setWebRanges([]); });
  };
  function saveViewState() { SN.saveSettings(); }

  cmd.toggleFileDock = function (forceHide) {
    const dock = $("#fileDock");
    const hide = forceHide === true ? true : forceHide === false ? false : dock.classList.contains("hidden");
    dock.classList.toggle("hidden", hide);
    if (!hide) updateFileList();
    rebuildUi();
  };
  cmd.toggleResultDock = function (forceHide) {
    const dock = $("#bottomDock");
    const split = $("#dockSplit");
    const hide = forceHide === true ? true : forceHide === false ? false : dock.classList.contains("hidden");
    dock.classList.toggle("hidden", hide);
    if (split) split.classList.toggle("hidden", hide);
    rebuildUi();
  };
  cmd.toggleToolbar = function () {
    $("#toolbar").classList.toggle("hidden");
    rebuildUi();
  };

  function updateFileList() {
    const ul = $("#fileList");
    ul.textContent = "";
    for (const d of app.docs) {
      const li = el("li", { "data-id": d.id, class: d.id === app.activeId ? "cur" : "", text: (d.dirty ? "* " : "") + d.name + (d.kind === "hex" ? " ⛭" : "") });
      li.addEventListener("click", () => SN.activateDoc(d.id));
      ul.appendChild(li);
    }
  }

  // ============ 缩放 ============
  cmd.zoom = function (delta) {
    app.zoomPct = Math.max(50, Math.min(250, (app.zoomPct || 100) + delta));
    const pct = app.zoomPct;
    app.docs.forEach(d => { if (d.editor) d.editor.applyZoom(pct); });
    $("#zoomLabel").textContent = "Zoom " + pct + "%";
  };

  // ============ 编码 ============
  function bytesFor(doc) {
    if (doc.raw && doc.raw.length) return doc.raw;
    if (doc.handle) return doc.handle.getFile().then(f => SN.readAsBytes(f));
    return null;
  }
  cmd.reloadWith = async function (code) {
    const d = SN.activeDoc();
    if (!d || d.kind !== "text") return;
    let bytes;
    if (d.raw) bytes = d.raw;
    else if (d.handle) bytes = await SN.readAsBytes(await d.handle.getFile());
    if (!bytes) { setMsg("该文档没有保留原始字节，无法按其它编码重新加载"); return; }
    const text = SN.decodeBytes(bytes, code);
    d.enc = code;
    d.content = SN.normalizeEol(text, "lf");
    if (d.editor) { d.editor.pushUndo(); d.editor.setText(d.content, [0, 0]); }
    SN.docContentTouched(d);
    updateStatusLabel();
    setMsg("已按 " + SN.codeById(code).name + " 重新解码");
  };
  cmd.convertTo = function (code) {
    const d = SN.activeDoc();
    if (!d || d.kind !== "text") return;
    if (!SN.codeById(code).writable) {
      setMsg("浏览器不支持写出 " + SN.codeById(code).name + "，请在「另存为」时改存 UTF-8/UTF-16");
      return;
    }
    d.enc = code;
    SN.docContentTouched(d);
    updateStatusLabel();
    setMsg("编码标记已切换为 " + SN.codeById(code).name + "（保存时生效）");
  };
  cmd.reloadAs = function (docId, kind) {
    const d = SN.docById(docId);
    if (!d) return;
    if (kind === "text" && d.kind === "big") { setMsg("大文件不支持强制编辑模式，仅支持只读查看与搜索"); return; }
    if (kind === "text") {
      if (d.kind === "text") { setMsg("当前已是文本模式"); return; }
      if (!d.raw) { setMsg("未保留原始字节，无法切回文本模式"); return; }
      const text = SN.decodeBytes(d.raw, d.enc);
      d.kind = "text";
      d.content = SN.normalizeEol(text, "lf");
      d.eol = SN.detectEol(text);
      d.raw = null;
      d.readOnly = false;
      rebuildPageFor(d);
      setMsg("已切换为文本编辑模式（大文件编辑可能较慢）");
    } else if (kind === "hex") {
      const bytes = d.raw;
      if (!bytes) { setMsg("未保留原始字节，无法转 Hex 视图"); return; }
      d.kind = "hex";
      rebuildPageFor(d);
      setMsg("已切换为 Hex 只读视图");
    } else setMsg("不支持的视图类型");
  };
  function rebuildPageFor(d) {
    if (d.pageEl) d.pageEl.remove();
    const page = el("div", { class: "page active" });
    page.dataset.doc = d.id;
    if (d.kind === "hex") {
      page.appendChild(buildHexView(d));
    } else if (d.kind === "big") {
      if (SN.buildBigTextPage) page.appendChild(SN.buildBigTextPage(d));
      else page.appendChild(el("div", { text: "大文本视图不可用", class: "hint" }));
    } else {
      const ed = new SN.Editor({
        readOnly: d.readOnly,
        wrap: app.settings.wrap,
        showSpaces: app.settings.showSpaces,
        showEol: app.settings.showEol,
        langId: d.lang,
        onChange: (text) => { d.content = text; SN.docContentTouched(d); },
        onStatus: (info) => { const dd = SN.activeDoc(); if (dd && dd.id === d.id) $("#posLabel").textContent = "Ln:" + info.line + "  Col:" + info.col; },
        onActive: () => SN.activateDoc(d.id)
      });
      ed.setText(d.content || "", [0, 0]);
      d.editor = ed;
      page.appendChild(ed.wrapEl);
    }
    SN.$("#editorZone").appendChild(page);
    d.pageEl = page;
    SN.activateDoc(d.id);
  }
  function updateStatusLabel() {
    const d = SN.activeDoc();
    if (d) {
      $("#codeLabel").textContent = SN.codeById(d.enc).name;
      $("#langLabel").textContent = (SN.langById(d.lang) || { name: "TXT" }).name.toUpperCase();
    }
  }

  // ============ 标记 / 高亮 / 书签 ============
  const URL_RE = /(https?:\/\/|ftp:\/\/|www\.)[^\s<>"']+/gi;
  function applyWebHighlights() {
    app.docs.forEach(d => {
      if (d.kind !== "text" || !d.editor) return;
      if (!app.settings.webAddrHighlight) { d.editor.setWebRanges([]); return; }
      const marks = [];
      let m;
      const re = new RegExp(URL_RE.source, "gi");
      while ((m = re.exec(d.content || ""))) marks.push({ start: m.index, end: m.index + m[0].length, color: "#BBDEFB" });
      d.editor.setWebRanges(marks);
    });
  }

  function findMatches(text, keyword, opts) {
    if (!keyword) return [];
    const out = [];
    let re;
    if (opts.regex) {
      try { re = new RegExp(keyword, (opts.case ? "" : "i") + "g"); }
      catch (e) { setMsg("正则表达式错误：" + e.message); return []; }
    } else {
      re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), (opts.case ? "" : "i") + "g");
    }
    let m;
    while ((m = re.exec(text))) {
      const start = m.index, end = m.index + m[0].length;
      if (opts.whole && !isWhole(text, start, end)) { re.lastIndex = end; continue; }
      out.push({ start, end, line: SN.countLines(text.slice(0, start)) });
      if (!opts.regex && start === end) break;
      re.lastIndex = end;
    }
    return out;
  }
  function isWhole(text, s, e) {
    const w = /[A-Za-z0-9_$]/;
    return !((s > 0 && w.test(text[s - 1])) || (e < text.length && w.test(text[e])));
  }

  app.findOpt = { keyword: "", case: false, whole: false, regex: false };

  // 用“当前选中文本”作为关键字做标记（无选中时退回上次查找关键字）
  cmd.markSelected = function () {
    const d = SN.activeDoc(), ed = SN.activeEditor();
    if (!d || !ed || d.kind !== "text") { setMsg("没有活动文本文档"); return false; }
    let kw = ed.hasSelection() ? ed.selectedText().trim() : "";
    if (!kw && app.findOpt.keyword) kw = app.findOpt.keyword;
    if (!kw) { setMsg("请先双击/选中要高亮的文本，或先输入查找关键字"); return false; }
    const opts = { case: false, whole: false, regex: false };
    const count = ed.upsertMarkRecord(kw, app.curMarkColor, opts);
    ed.focus();
    setMsg("已用颜色高亮 “" + kw + "”：共 " + count + " 处（可继续选其它词/颜色叠加）");
    return true;
  };
  cmd.markAll = function () {
    const ok = cmd.markSelected();
    if (!ok) setMsg("全部标记：请先选中文本或先执行一次查找");
  };
  // 查找面板内“全部标记”：以面板关键字为准（避免误用编辑器旧选区）
  cmd.markKeyword = function () {
    const d = SN.activeDoc(), ed = SN.activeEditor();
    if (!d || !ed || d.kind !== "text") { setMsg("没有活动文本文档"); return false; }
    const kw = app.findOpt.keyword;
    if (!kw) { setMsg("请输入要标记的关键字"); return false; }
    const count = ed.upsertMarkRecord(kw, app.curMarkColor, app.findOpt);
    setMsg("标记完成：共 " + count + " 处（“" + kw + "”+" + app.curMarkColor + "）");
    return true;
  };
  cmd.clearMarksAll = function () {
    app.docs.forEach(d => { if (d.editor) d.editor.clearPersistentMarks(); });
    setMsg("已清除全部标记");
  };
  cmd.wordHighlight = function (word) {
    const d = SN.activeDoc(), ed = SN.activeEditor();
    if (!ed) return;
    if (!word) { const w = ed.wordAtSelection(); word = w; }
    if (!word) { setMsg("请选择要高亮的文本"); return; }
    const opts = { case: true, whole: true, regex: false };
    const ms = findMatches(ed.text, word, opts);
    ed.setWordRanges(ms.map(m => ({ start: m.start, end: m.end, color: "#B3E5FC" })));
    setMsg("高亮 “" + word + "”：" + ms.length + " 处");
  };

  cmd.toggleBookmark = function () {
    const ed = SN.activeEditor();
    if (!ed) return;
    ed.toggleBookmark(ed.curLine() - 1);
  };
  cmd.gotoBookmark = function (dir) {
    const ed = SN.activeEditor();
    if (ed && !ed.gotoBookmark(dir)) setMsg("没有书签");
  };
  cmd.clearBookmarks = function () {
    const ed = SN.activeEditor();
    if (ed) ed.clearBookmarks();
  };

  // ============ 查找对话框 ============
  dlg.find = function (mode) {
    const ed = SN.activeEditor();
    if (!ed) {
      // 大文本虚拟只读视图没有编辑器：直接把 Ctrl+F/查找 接到分块搜索
      const ad = SN.activeDoc();
      if (ad && ad.kind === "big" && ad.bigFind) { ad.bigFind(); return; }
      setMsg("没有活动文本文档"); return;
    }
    if (!app.findOpt.keyword && ed.hasSelection()) app.findOpt.keyword = ed.selectedText().slice(0, 200);
    const d = SN.activeDoc();
    const scope = mode === "opendocs" ? "docs" : "doc";
    const m = SN.openModal({
      title: scope === "docs" ? "在打开的文档中查找" : "查找 / 替换",
      width: "560px",
      onOpen(body) {
        const rows = [];
        rows.push(frow("关键字", textIn("findKey", app.findOpt.keyword)));
        rows.push(optrow([chk("caseOpt", "区分大小写", app.findOpt.case), chk("wholeOpt", "全词匹配", app.findOpt.whole), chk("reOpt", "正则", app.findOpt.regex)]));
        const btns = el("div", { class: "btn-group" });
        mk(btns, "查找下一个", () => doFindNext(true));
        mk(btns, "查找上一个", () => doFindNext(false));
        mk(btns, scope === "docs" ? "在所有文档查找" : "全部查找(当前文档)", () => findAllAndShow(scope));
        if (scope === "doc") {
          mk(btns, "全部标记", () => { collectOpts(); cmd.markKeyword(); });
          mk(btns, "替换全部", () => doReplaceAll());
        }
        body.appendChild(fieldset("", rows, btns));
        const kv = $("#findKey");
        kv.focus(); kv.select();
        function frow(label, input) {
          const r = el("div", { class: "findrow" });
          r.appendChild(el("label", { text: label, style: "min-width:70px" }));
          r.appendChild(input);
          return r;
        }
        function optrow(boxes) {
          const r = el("div", { class: "optgrid" });
          boxes.forEach(b => r.appendChild(b));
          return r;
        }
        function chk(id, label, v) { return el("label", {}, [el("input", { type: "checkbox", id, checked: v }), " " + label]); }
        function textIn(id, v) { return el("input", { type: "text", id, value: v, style: "flex:1" }); }
        function mk(cont, label, fn) { const b = el("button", { text: label }); b.addEventListener("click", fn); cont.appendChild(b); }
        function fieldset(title, rws, bt) {
          const f = el("fieldset", { style: "border:1px solid var(--border);padding:8px;margin:0" });
          if (title) f.appendChild(el("legend", { text: title }));
          rws.forEach(r => f.appendChild(r));
          f.appendChild(bt);
          return f;
        }
        function collectOpts() {
          app.findOpt.keyword = ($("#findKey") || { value: "" }).value || "";
          app.findOpt.case = !!$("#caseOpt") && $("#caseOpt").checked;
          app.findOpt.whole = !!$("#wholeOpt") && $("#wholeOpt").checked;
          app.findOpt.regex = !!$("#reOpt") && $("#reOpt").checked;
        }
        function doFindNext(forward) {
          collectOpts();
          const ms = findMatches(ed.text, app.findOpt.keyword, app.findOpt);
          const caret = ed.caret();
          let idx = ms.findIndex(m => forward ? m.end > caret : m.start < caret);
          if (idx < 0) idx = forward ? 0 : ms.length - 1;
          if (!ms.length) { setMsg("未找到"); return; }
          const hit = ms[idx];
          ed._setTextWithSel(ed.text, hit.start, hit.end);
          ed.scrollToPos(hit.start);
          ed.focus();
          ed.setFindRanges(ms.map(x => ({ start: x.start, end: x.end, color: "#FFF59D" })));
          setMsg("第 " + (idx + 1) + "/" + ms.length + " 处（行 " + hit.line + "）");
        }
        async function findAllAndShow(sc) {
          collectOpts();
          const res = [];
          const docList = sc === "docs" ? app.docs.filter(x => x.kind === "text") : [d];
          for (const dd of docList) {
            const isHuge = (dd.content || "").length > 2 * 1024 * 1024;
            if (isHuge && SN.bigSearchFile) {
              let raw = dd.raw;
              if (!raw && dd.handle) {
                try {
                  const f = await dd.handle.getFile();
                  raw = await SN.readAsBytes(f);
                } catch (e) { raw = null; }
              }
              // 无原始字节时用正文重新编码后分块检索（仅临时内存，检索完即释放）
              if (!raw) raw = new TextEncoder().encode(dd.content || "");
              const tmp = { raw, enc: "utf8" };
              const msg = SN.$("#msgLabel");
              const r = await SN.bigSearchFile(tmp, app.findOpt.keyword, (pct, n) => {
                if (msg) msg.textContent = "正在检索 " + dd.name + " " + pct + "% · 已找到 " + n + " 处";
              }, { abort: false });
              for (const row of r.rows) res.push({ docId: dd.id, file: dd.name, line: row.line, content: row.snippet });
              continue;
            }
            const ms = findMatches(dd.content || "", app.findOpt.keyword, app.findOpt);
            for (const mm of ms) {
              const lineStart = dd.content.lastIndexOf("\n", mm.start - 1) + 1;
              const lineEnd = dd.content.indexOf("\n", mm.start);
              res.push({ docId: dd.id, file: dd.name, line: mm.line, start: mm.start, end: mm.end,
                content: dd.content.slice(lineStart, lineEnd < 0 ? undefined : lineEnd) });
            }
          }
          showResults(res, app.findOpt.keyword);
          setMsg("共找到 " + res.length + " 处");
        }
        function doReplaceAll() {
          collectOpts();
          if (app.findOpt.regex && app.findOpt.keyword) {
            const re = new RegExp(app.findOpt.keyword, app.findOpt.case ? "g" : "gi");
            mutateDocText(v => v.replace(re, ""));
            setMsg("正则替换：以空串替换（演示）");
          }
          setMsg("请使用「全部标记」+ 手工编辑，或改为文本模式替换（演示简化）");
        }
      },
      buttons: [{ label: "关闭", action: () => { } }]
    });
    return m;
  };

  function jumpFind(forward) {
    const ed = SN.activeEditor();
    if (!ed) { setMsg("无活动文档"); return; }
    if (!app.findOpt.keyword) { dlg.find("find"); return; }
    const ms = findMatches(ed.text, app.findOpt.keyword, app.findOpt);
    if (!ms.length) { setMsg("未找到：" + app.findOpt.keyword); return; }
    const caret = ed.caret();
    let idx = ms.findIndex(m => forward ? m.end > caret : m.start < caret);
    if (idx < 0) idx = forward ? 0 : ms.length - 1;
    const hit = ms[idx];
    ed._setTextWithSel(ed.text, hit.start, hit.end);
    ed.scrollToPos(hit.start);
    ed.focus();
    ed.setFindRanges(ms.map(x => ({ start: x.start, end: x.end, color: "#FFF59D" })));
    setMsg("第 " + (idx + 1) + "/" + ms.length + " 处（行 " + hit.line + "）");
  }
  dlg.findNext = function () { jumpFind(true); };
  dlg.findPrev = function () { jumpFind(false); };

  // ============ 查找结果 Dock ============
  function showResults(res, kw) {
    $("#bottomDock").classList.remove("hidden");
    const split = $("#dockSplit");
    if (split) split.classList.remove("hidden");
    const view = $("#resultView");
    view.textContent = "";
    const groups = {};
    for (const r of res) (groups[r.file] = groups[r.file] || []).push(r);
    for (const file of Object.keys(groups)) {
      view.appendChild(el("div", { class: "res-sec", text: file + "（" + groups[file].length + "）" }));
      for (const r of groups[file]) {
        const row = el("div", { class: "res-row" });
        row.appendChild(el("span", { class: "lnn", text: "行 " + r.line + ":" }));
        row.appendChild(el("span", { text: r.content.slice(0, 160) }));
        row.dataset.doc = r.docId;
        row.dataset.start = r.start;
        row.dataset.end = r.end;
        row.dataset.line = r.line;
        row.addEventListener("click", () => {
          SN.activateDoc(r.docId);
          const ed = SN.activeEditor();
          if (ed) {
            if (r.start !== undefined && r.end !== undefined && r.start !== null) {
              ed._setTextWithSel(ed.text, r.start, r.end); ed.scrollToPos(r.start);
            } else if (r.line) {
              ed.gotoLine(r.line);
            }
            ed.focus();
          }
        });
        view.appendChild(row);
      }
    }
  }
  cmd.copyResultDock = function () {
    const t = $("#resultView").textContent;
    if (!t.trim()) { setMsg("没有可复制的查找结果"); return; }
    navigator.clipboard.writeText(t).then(() => setMsg("已复制查找结果"));
  };

  // ============ 其它对话框 ============
  dlg.gotoLine = function () {
    const ed = SN.activeEditor();
    if (!ed) {
      // 大文本只读视图：Ctrl+G 走定位行模态
      const ad = SN.activeDoc();
      if (ad && ad.kind === "big" && ad._bigJump) {
        SN.openModal({
          title: "定位行（大文件）",
          buttons: [{
            label: "跳转", primary: true, action: () => {
              const n = parseInt($("#bigGotoLineNum").value, 10);
              if (n > 0) { ad._bigJump(n); if (SN.activateDoc) SN.activateDoc(ad.id); }
            }
          }, { label: "取消", action: () => { } }],
          onOpen(b) {
            const total = ad.bigTotalLines ? ("（共约 " + ad.bigTotalLines + " 行）") : "";
            b.appendChild(el("div", { class: "hint", text: "输入要定位到的行号 " + total }));
            b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "行号" }), el("input", { type: "number", id: "bigGotoLineNum", value: "1", min: 1 })]));
            const i = $("#bigGotoLineNum"); i.focus(); i.select();
            i.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                const n = parseInt(i.value, 10);
                if (n > 0) { ad._bigJump(n); if (SN.activateDoc) SN.activateDoc(ad.id); SN.closeModal(); }
              }
            });
          }
        });
        return;
      }
      setMsg("没有活动文本文档"); return;
    }
    const m = SN.openModal({
      title: "跳转行",
      buttons: [{ label: "跳转", primary: true, action: () => { const n = parseInt($("#goLineNum").value, 10); if (n > 0) ed.gotoLine(n); } }, { label: "取消", action: () => { } }],
      onOpen(b) {
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "行号" }), el("input", { type: "number", id: "goLineNum", value: String(ed.curLine()), min: 1 })]));
        const i = $("#goLineNum"); i.focus(); i.select();
      }
    });
    return m;
  };

  dlg.rename = function (d) {
    if (!d) return;
    SN.openModal({
      title: "重命名" + (d.kind === "text" ? "" : "（Hex 视图不可改）"),
      buttons: [{
        label: "确定", primary: true, action: () => {
          const name = $("#rnName").value.trim();
          if (!name) return false;
          if (d.kind === "hex") return false;
          d.name = name;
          if (d.handle && d.handle.move) {
            d.handle.move(name).catch(() => {});
          }
          SN.refreshMenus(); updateTabListNames();
        }
      }, { label: "取消", action: () => { } }],
      onOpen(b) {
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "新名称" }), el("input", { type: "text", id: "rnName", value: d.name || "" })]));
        $("#rnName").focus(); $("#rnName").select();
      }
    });
    function updateTabListNames() { app.docs.forEach(dd => { }); updateFileList(); updateStatusLabel(); }
  };

  // ============ Hex 视图 ============
  function buildHexView(doc) {
    const page = el("div", { class: "hexviewer", style: "display:flex;flex-direction:column;height:100%" });
    const bar = el("div", { class: "dockhead", style: "flex:0 0 auto" });
    const info = el("span", { text: doc.name + " — " + SN.fmtSize(doc.raw ? doc.raw.length : doc.size || 0) + "（只读，每页 64 行 × 16 字节）" });
    const tools = el("span", {});
    const prevB = el("button", { text: "上一页" });
    const nextB = el("button", { text: "下一页" });
    const gotoB = el("button", { text: "跳转地址…" });
    tools.appendChild(prevB); tools.appendChild(nextB); tools.appendChild(gotoB);
    bar.appendChild(info); bar.appendChild(tools);
    const out = el("div", { class: "hex-view" });
    page.appendChild(bar);
    page.appendChild(out);
    doc.hexOff = 0;
    doc.hexPageSize = 64 * 16;
    function paint() {
      const bytes = doc.raw || new Uint8Array(0);
      const total = bytes.length;
      const start = Math.max(0, Math.min(doc.hexOff, Math.max(0, total - doc.hexPageSize)));
      doc.hexOff = start;
      let html = "";
      for (let r = 0; r < doc.hexPageSize / 16; r++) {
        const rowOff = start + r * 16;
        if (rowOff >= total) break;
        html += '<span class="off">' + pad(rowOff.toString(16), 8) + "</span>  ";
        for (let c = 0; c < 16; c++) {
          const b = rowOff + c < total ? bytes[rowOff + c] : null;
          html += b == null ? "   " : '<span class="hb">' + b.toString(16).padStart(2, "0") + "</span> ";
          if (c === 7) html += " ";
        }
        html += "  ";
        for (let c = 0; c < 16; c++) {
          const b = rowOff + c < total ? bytes[rowOff + c] : 32;
          const ch = b >= 32 && b < 127 ? String.fromCharCode(b) : ".";
          html += '<span class="ha">' + SN.escapeHtml(ch) + "</span>";
        }
        html += "\n";
      }
      out.innerHTML = html;
      info.textContent = doc.name + " — 偏移 0x" + start.toString(16) + " / 0x" + total.toString(16);
      prevB.disabled = start <= 0;
      nextB.disabled = start + doc.hexPageSize >= total;
    }
    prevB.addEventListener("click", () => { doc.hexOff -= doc.hexPageSize; paint(); });
    nextB.addEventListener("click", () => { doc.hexOff += doc.hexPageSize; paint(); });
    gotoB.addEventListener("click", () => {
      const v = prompt("输入十六进制地址（如 1A0）或十进制地址：", "0");
      if (v == null) return;
      const n = /^[0-9a-fA-F]+$/.test(v) && /[a-fA-F]/.test(v) ? parseInt(v, 16) : parseInt(v, 10);
      if (!isNaN(n) && n >= 0) { doc.hexOff = Math.floor(n / 16) * 16; paint(); }
    });
    paint();
    return page;
  }
  function pad(s, n) { while (s.length < n) s = "0" + s; return s; }

  function rebuildUi() {
    SN.refreshMenus();
    SN.$("#toolbar").querySelectorAll(".iconbt").forEach(b => { });
    updateFileList();
  }
  SN.updateFileList = updateFileList;
  SN.updateStatusLabel = updateStatusLabel;
  SN.applyWebHighlights = applyWebHighlights;
  SN.showResults = showResults;
})();

// =====================================================================
//  第二段：工具 / 插件 / 选项 / 主题 / 列块 / 关于 / 启动
// =====================================================================
(function () {
  const SN = window.SN;
  const el = SN.el;
  const app = SN.app;
  const cmd = SN.cmd;
  const dlg = SN.dlg;
  const tool = SN.tool;
  const $ = SN.$;

  function setMsg(m) { SN.setMsg(m); }
  function mutateDocText(fn, caret) {
    const d = SN.activeDoc();
    const ed = SN.activeEditor();
    if (!d || !ed) return;
    ed.pushUndo();
    const r = fn(ed.text) || {};
    const nv = typeof r === "string" ? r : r.text;
    d.content = nv;
    ed.setText(nv, r.sel || caret || [0, 0]);
    SN.docContentTouched(d);
    ed.focus();
  }

  // ================= 工具 =================
  tool.format = function (kind) {
    const ed = SN.activeEditor();
    if (!ed) return;
    const text = ed.selectedText() || ed.text;
    if (kind === "json") {
      try {
        const obj = JSON.parse(text);
        const pretty = JSON.stringify(obj, null, 2);
        if (ed.hasSelection()) ed.replaceRange(pretty, ed.selStart, ed.selEnd);
        else mutateDocText(() => pretty + "\n");
        setMsg("JSON 格式化成功");
      } catch (e) { setMsg("JSON 解析失败：" + e.message); }
    } else {
      try {
        const pretty = prettyXml(text);
        if (ed.hasSelection()) ed.replaceRange(pretty, ed.selStart, ed.selEnd);
        else mutateDocText(() => pretty + "\n");
        setMsg("XML 格式化成功");
      } catch (e) { setMsg("XML 格式化失败：" + e.message); }
    }
  };

  function prettyXml(xml) {
    let out = "", indent = 0, i = 0;
    const tagRe = /<\/?[^>]+>/g;
    let last = 0, m;
    while ((m = tagRe.exec(xml))) {
      const text = xml.slice(last, m.index).trim();
      if (text) out += "  ".repeat(indent) + text + "\n";
      const tag = m[0];
      const closing = tag.startsWith("</");
      const selfClose = tag.endsWith("/>");
      const comment = tag.startsWith("<!--");
      if (comment) { out += "  ".repeat(indent) + tag + "\n"; }
      else if (closing) { indent = Math.max(0, indent - 1); out += "  ".repeat(indent) + tag + "\n"; }
      else { out += "  ".repeat(indent) + tag + "\n"; if (!selfClose) indent++; }
      last = m.index + tag.length;
    }
    const rest = xml.slice(last).trim();
    if (rest) out += "  ".repeat(indent) + rest + "\n";
    return out.replace(/\n+$/g, "");
  }

  tool.hash = function () {
    SN.openModal({
      title: "MD5 / SHA 计算",
      width: "600px",
      buttons: [{ label: "选择文件…", action: () => $("#hashFile").click() }, { label: "计算选中文本", primary: true, action: () => calc("sel") }, { label: "关闭", action: () => { } }],
      onOpen(b) {
        const algo = el("select", { id: "hashAlgo" });
        SN.HASH_ALGOS.forEach(a => algo.appendChild(el("option", { value: a, text: a.toUpperCase() })));
        const fileBt = el("input", { type: "file", id: "hashFile", hidden: true });
        fileBt.addEventListener("change", async (e) => {
          if (e.target.files[0]) { setMsg("计算中…"); const bytes = await SN.readAsBytes(e.target.files[0]); finishHash(bytes); }
        });
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "算法" }), algo]));
        b.appendChild(fileBt);
        b.appendChild(el("textarea", { id: "hashOut", style: "width:100%;height:160px", readonly: true, placeholder: "结果…" }));
        const calc = async (mode) => {
          let data;
          if (mode === "sel") {
            const ed = SN.activeEditor();
            const t = ed ? ed.selectedText() || ed.text : "";
            data = new TextEncoder().encode(t);
          } else data = new Uint8Array(0);
          finishHash(data);
        };
        async function finishHash(bytes) {
          const a = algo.value;
          try {
            const h = await SN.hashAlgo(bytes, a);
            $("#hashOut").value = h;
          } catch (e) { $("#hashOut").value = "不支持：" + e.message; }
        }
      }
    });
  };

  tool.batchEncode = function () {
    SN.openModal({
      title: "批量转换编码（作用于所有打开文本文档）",
      buttons: [{ label: "执行", primary: true, action: () => {
        const code = $("#batchCode").value;
        let n = 0;
        app.docs.forEach(d => {
          if (d.kind !== "text") return;
          if (!SN.codeById(code).writable) return;
          d.enc = code; n++;
        });
        setMsg("已将 " + n + " 个文档标记为 " + SN.codeById(code).name);
        SN.updateStatusLabel();
      } }, { label: "关闭", action: () => { } }],
      onOpen(b) {
        const sel = el("select", { id: "batchCode" });
        SN.CODES.filter(c => c.writable).forEach(c => sel.appendChild(el("option", { value: c.id, text: c.name })));
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "目标编码" }), sel]));
        b.appendChild(el("div", { class: "hint", text: "说明：GBK/Big5/Shift-JIS 等因浏览器无编码器，仅支持“以该编码读取”；写出请使用 UTF-8/UTF-16。" }));
      }
    });
  };

  // ================= 插件 =================
  const BUILTIN_PLUGINS = [
    { id: "b64", name: "Base64 编码", desc: "把选中文本/全文编码为 Base64", code: "text => btoa(unescape(encodeURIComponent(text)))" },
    { id: "b64d", name: "Base64 解码", desc: "把选中文本/全文解码", code: "text => decodeURIComponent(escape(atob(text.trim())))" },
    { id: "url", name: "URL 编码", desc: "encodeURIComponent", code: "text => encodeURIComponent(text)" },
    { id: "urld", name: "URL 解码", desc: "decodeURIComponent", code: "text => decodeURIComponent(text)" },
    { id: "uuid", name: "插入 UUID", desc: "在光标处插入随机 UUID", code: "text => { const u = SN.uuid(); const s = SN.activeEditor().caret(); return text.slice(0,s) + u + text.slice(SN.activeEditor().selEnd); }", insert: true },
    { id: "ts", name: "插入时间戳", desc: "在光标处插入当前时间", code: "text => { const s = new Date().toLocaleString(); const c = SN.activeEditor().caret(); return text.slice(0,c) + s + text.slice(SN.activeEditor().selEnd); }", insert: true }
  ];

  function pluginList() {
    const saved = (app.settings.userPlugins || []).map(p => ({ id: p.id, name: p.name, desc: p.desc || "", code: p.code, user: true }));
    return BUILTIN_PLUGINS.concat(saved);
  }
  function pluginMenuItems() {
    const items = [{ label: "插件管理器…", action: () => dlg.plugins() }];
    const ps = pluginList();
    if (ps.length) {
      items.push("-");
      ps.forEach(p => items.push({ label: p.name, action: () => runPlugin(p) }));
    }
    items.push("-");
    items.push({ label: "说明：插件=内置JS变换脚本；自定义插件用“插件管理器”添加", disabled: true });
    return items;
  }
  function runPlugin(p) {
    try {
      const ed = SN.activeEditor();
      if (!ed) { setMsg("没有活动文档"); return; }
      let fn;
      if (p.code) fn = new Function("SN", "text", "return (" + p.code + ")(text);");
      const start = ed.selStart, end = ed.selEnd;
      if (p.insert) {
        // 插入型插件：基于全文在光标处插入（有选区则替换选区），光标移到插入内容之后
        const out = fn(SN, ed.text);
        if (typeof out !== "string") { setMsg("插件未返回文本"); return; }
        const pos = Math.max(0, start + (out.length - ed.text.length));
        mutateDocText(() => out, [pos, pos]);
        setMsg("插件执行完成：" + p.name);
        return;
      }
      const target = ed.hasSelection() ? ed.selectedText() : ed.text;
      const out = fn(SN, target);
      if (typeof out !== "string") { setMsg("插件未返回文本"); return; }
      if (ed.hasSelection()) { ed.replaceRange(out, start, end); }
      else mutateDocText(() => out);
      setMsg("插件执行完成：" + p.name);
    } catch (e) { setMsg("插件执行失败：" + e.message); }
  }
  dlg.plugins = function () {
    SN.openModal({
      title: "插件管理器",
      width: "680px",
      buttons: [{ label: "添加用户插件…", action: () => addUserPlugin() }, { label: "关闭", action: () => { } }],
      onOpen(b) {
        const tbl = el("table", { class: "tbl" });
        const tr0 = el("tr");
        ["名称", "说明", "类型", "操作"].forEach(h => tr0.appendChild(el("th", { text: h })));
        tbl.appendChild(tr0);
        for (const p of pluginList()) {
          const tr = el("tr");
          tr.appendChild(el("td", { text: p.name }));
          tr.appendChild(el("td", { text: p.desc || "—" }));
          tr.appendChild(el("td", { text: p.insert ? "插入" : "变换" }));
          const td = el("td");
          const runBt = el("button", { text: "运行" });
          runBt.addEventListener("click", () => { SN.closeModal(); runPlugin(p); });
          td.appendChild(runBt);
          if (p.user) {
            const delBt = el("button", { text: "删除" });
            delBt.addEventListener("click", () => {
              app.settings.userPlugins = (app.settings.userPlugins || []).filter(x => x.id !== p.id);
              SN.saveSettings(); SN.refreshMenus();
              SN.closeModal(); dlg.plugins();
            });
            td.appendChild(delBt);
          }
          tr.appendChild(td);
          tbl.appendChild(tr);
        }
        b.appendChild(tbl);
        b.appendChild(el("div", { class: "hint", text: "用户插件以 JS 函数方式运行（new Function），拥有当前页面全部权限，请只运行可信代码。" }));
      }
    });
  };
  function addUserPlugin() {
    SN.openModal({
      title: "添加用户插件",
      width: "620px",
      buttons: [{
        label: "保存", primary: true, action: () => {
          const name = $("#plgName").value.trim();
          const code = $("#plgCode").value;
          if (!name || !code.trim()) { setMsg("名称与代码必填"); return false; }
          app.settings.userPlugins = (app.settings.userPlugins || []).concat([{ id: "u" + Date.now(), name, desc: "用户自定义", code }]);
          SN.saveSettings(); SN.refreshMenus();
          setMsg("插件已添加：" + name);
        }
      }, { label: "取消", action: () => { } }],
      onOpen(b) {
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "名称" }), el("input", { type: "text", id: "plgName", style: "flex:1" })]));
        b.appendChild(el("div", { class: "formrow", style: "align-items:flex-start" }, [el("label", { text: "JS" }), el("textarea", { id: "plgCode", style: "flex:1;height:140px", placeholder: "text => text.replace(...)  // 接收全文/选中文本，返回新文本" })]));
        b.appendChild(el("div", { class: "hint", text: "函数签名：function(SN, text) { return newText }。示例：text => text.split('\\n').map(l=>l.trim()).join('\\n')" }));
      }
    });
  }
  SN.pluginMenuItems = pluginMenuItems;

  // ================= 自定义语言 =================
  cmd.openDefineLang = function () {
    SN.openModal({
      title: "自定义语言（用户语言）",
      width: "620px",
      buttons: [{
        label: "保存并启用", primary: true, action: () => {
          const name = $("#ulName").value.trim();
          const ext = ($("#ulExt").value || "").trim();
          const kw = $("#ulKw").value;
          if (!name) { setMsg("语言名必填"); return false; }
          const id = "user_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
          SN.registerUserLang({ id, name, ext: ext.split(/[\s,]+/).filter(Boolean), kw, line: $("#ulLine").value || "//", block: null });
          app.settings.userlangs = (app.settings.userlangs || []).concat([{ id, name, ext, kw, line: $("#ulLine").value || "//" }]);
          SN.saveSettings(); SN.refreshMenus();
          setMsg("语言 “" + name + "” 已注册，可在 语言 菜单选择");
        }
      }, { label: "取消", action: () => { } }],
      onOpen(b) {
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "语言名" }), el("input", { type: "text", id: "ulName", style: "flex:1" })]));
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "后缀名" }), el("input", { type: "text", id: "ulExt", style: "flex:1", placeholder: "abc, def" })]));
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "行注释" }), el("input", { type: "text", id: "ulLine", style: "flex:1", value: "//" })]));
        b.appendChild(el("div", { class: "formrow", style: "align-items:flex-start" }, [el("label", { text: "关键字" }), el("textarea", { id: "ulKw", style: "flex:1;height:120px", placeholder: "if else while for …（空格分隔）" })]));
      }
    });
  };
  dlg.about = function () {
    SN.openModal({
      title: "关于 StackNote",
      width: "580px",
      buttons: [{ label: "关闭", action: () => { } }],
      onOpen(b) {
        const ver = window.SN_VERSION || "dev";
        const head = el("div", { class: "about-head" });
        head.appendChild(el("span", { class: "about-name", text: "StackNote" }));
        head.appendChild(el("span", { class: "about-ver", text: "版本：" + ver }));
        b.appendChild(head);
        b.appendChild(el("div", { class: "about-desc", text: "零依赖、零构建的纯前端多标签文本编辑器。" }));

        b.appendChild(el("div", { class: "about-sec", text: "功能特性" }));
        const feats = [
          "多标签文本 / Hex 只读 / 大文件只读",
          "编码识别与转码(写)",
          "查找替换 / 正则 / 标记 / 书签",
          "行操作 / 大小写 / 空白",
          "18 套编辑器主题 + 明暗皮肤",
          "会话恢复",
          "MD5/SHA、XML/JSON 格式化",
          "列块编辑、Markdown 预览、插件（JS 脚本）"
        ];
        feats.forEach(t => b.appendChild(el("div", { class: "about-li", text: t })));

        b.appendChild(el("div", { class: "about-sec", text: "浏览器限制" }));
        b.appendChild(el("div", { class: "about-li", text: "无法监控本地文件变化、GBK 写出、系统右键/管理员提权。" }));
        b.appendChild(el("div", { class: "about-li", text: "文件需通过文件选择器/拖拽打开（支持 File System Access 浏览器可直接保存回原文件）。" }));
      }
    });
  };

  // ================= 选项 =================
  dlg.options = function () {
        let saveAllFn;
SN.openModal({
      title: "选项",
      width: "620px",
      buttons: [{ label: "保存", primary: true, action: () => saveAllFn() }, { label: "取消", action: () => { } }],
      onOpen(b) {
        const s = app.settings;
        const skinSel = sel("skinSel", SN.APP_SKINS.map(x => [x.id, x.name]), s.appSkin);
        const themeSel = sel("themeSel", SN.EDITOR_THEMES.map(t => [t.id, t.name]), s.editorTheme);
        // 显式同步当前值（确保重新打开时下拉框反映已保存的设置）
        themeSel.value = s.editorTheme;
        skinSel.value = s.appSkin;
        themeSel.addEventListener("change", () => { SN.applyEditorTheme(themeSel.value); });
        skinSel.addEventListener("change", () => { SN.applyAppSkin(skinSel.value); });
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "界面皮肤" }), skinSel]));
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "编辑器主题" }), themeSel]));
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "Tab 宽度" }), numIn("optTab", s.tabWidth, 1, 16)]));
        const boxes = [
          chk("optExpand", "Tab 使用空格", s.expandTab),
          chk("optRestore", "启动恢复上次会话", s.restoreSession),
          chk("optAuto", "自动保存草稿到浏览器", s.autoSave),
          chk("optWord", "双击单词高亮", s.wordDblHighlight)
        ];
        const grid = el("div", { class: "optgrid" });
        boxes.forEach(x => grid.appendChild(x));
        b.appendChild(grid);
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "大文本虚拟只读阈值(MB)" }), numIn("optBig", s.bigThresholdMB, 2, 500)]));
        b.appendChild(el("div", { class: "hint", text: "超过该阈值（默认 6MB）会自动用“大文本只读/虚拟滚动”打开：只渲染可视区域行，流畅浏览大日志且不 OOM。若确实需要编辑，用“以文本模式打开”强制可编辑（大文件会较慢）。" }));
        function sel(id, opts, val) { const s2 = el("select", { id }); opts.forEach(o => s2.appendChild(el("option", { value: o[0], text: o[1], selected: o[0] === val }))); return s2; }
        function numIn(id, val, min, max) { return el("input", { type: "number", id, value: val, min, max, style: "width:90px" }); }
        function chk(id, label, v) { return el("label", {}, [el("input", { type: "checkbox", id, checked: v }), " " + label]); }
        saveAllFn = function () {
          const s2 = app.settings;
          s2.appSkin = $("#skinSel").value;
          s2.editorTheme = $("#themeSel").value;
          s2.tabWidth = parseInt($("#optTab").value, 10) || 4;
          s2.expandTab = !!$("#optExpand") && $("#optExpand").checked;
          s2.restoreSession = !!$("#optRestore") && $("#optRestore").checked;
          s2.autoSave = !!$("#optAuto") && $("#optAuto").checked;
          s2.wordDblHighlight = !!$("#optWord") && $("#optWord").checked;
          s2.bigThresholdMB = parseInt($("#optBig").value, 10) || 100;
          SN.applyAppSkin(s2.appSkin);
          SN.applyEditorTheme(s2.editorTheme);
          SN.saveSettings();
          SN.refreshMenus();
          setMsg("选项已保存");
        }
      }
    });
  };

  dlg.themeStyle = function () {
    SN.openModal({
      title: "主题与语法样式（预览切换）",
      width: "700px",
      buttons: [{ label: "关闭", action: () => { } }],
      onOpen(b) {
        const grid = el("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:6px" });
        for (const t of SN.EDITOR_THEMES) {
          const card = el("div", { style: "border:1px solid var(--border);border-radius:4px;padding:6px;cursor:pointer;background:" + t.bg + ";color:" + t.fg, "data-id": t.id });
          card.appendChild(el("div", { text: t.name, style: "font-weight:bold;font-size:12px" }));
          card.appendChild(el("div", { text: t.bg + " / " + (t.font || ""), style: "font-size:10px;opacity:.85;font-family:monospace" }));
          card.addEventListener("click", () => {
            SN.applyEditorTheme(t.id);
            app.docs.forEach(dd => { if (dd.editor) dd.editor.render(); });
            SN.saveSettings();
          });
          grid.appendChild(card);
        }
        b.appendChild(grid);
        b.appendChild(el("div", { class: "hint", text: "共 18 套（Default / Blue light / lavender / misty rose / yellow rice 为浅色，其余为深色系）。点击卡片即时生效。" }));
      }
    });
  };

  dlg.shortcuts = function () {
    const rows = [
      ["新建", "Ctrl+T"], ["打开", "Ctrl+O"], ["保存", "Ctrl+S"], ["另存为", "Ctrl+Shift+S"],
      ["关闭标签", "Ctrl+W"], ["查找", "Ctrl+F"], ["替换", "Ctrl+H"], ["目录/打开文档查找", "Ctrl+Shift+F"],
      ["下一个查找", "F3"], ["上一个查找", "F4"], ["跳转行", "Ctrl+G"], ["下一个书签", "F2"],
      ["上一个书签", "Shift+F2"], ["设置书签", "Ctrl+F2"], ["全选", "Ctrl+A"], ["撤销/重做", "Ctrl+Z / Ctrl+Y"],
      ["复制当前行", "Ctrl+D"], ["放大/缩小", "工具栏 ＋/－"]
    ];
    SN.openModal({
      title: "快捷键一览",
      buttons: [{ label: "关闭", action: () => { } }],
      onOpen(b) {
        const tbl = el("table", { class: "tbl" });
        const tr0 = el("tr"); tr0.appendChild(el("th", { text: "功能" })); tr0.appendChild(el("th", { text: "快捷键" })); tbl.appendChild(tr0);
        rows.forEach(r => { const tr = el("tr"); tr.appendChild(el("td", { text: r[0] })); tr.appendChild(el("td", { text: r[1] })); tbl.appendChild(tr); });
        b.appendChild(tbl);
        b.appendChild(el("div", { class: "hint", text: "快捷键为内置固定值；自动缩进等编辑细节由浏览器文本域原生行为承担。" }));
      }
    });
  };

  // ================= 列块编辑 =================
  dlg.columnEdit = function () {
    const ed = SN.activeEditor();
    if (!ed) return;
    SN.openModal({
      title: "列块编辑",
      width: "620px",
      buttons: [{
        label: "应用", primary: true, action: () => {
          const mode = $('input[name="colmode"]:checked').value;
          const text = $("#colText").value;
          const init = parseInt($("#colInit").value, 10) || 0;
          const inc = parseInt($("#colInc").value, 10) || 1;
          const rep = parseInt($("#colRep").value, 10) || 1;
          const radix = parseInt($('input[name="colradix"]:checked').value, 10) || 10;
          const cap = !!$("#colCap") && $("#colCap").checked;
          mutateDocText((v) => columnTransform(v, ed, mode, text, init, inc, rep, radix, cap));
          setMsg("列块编辑完成");
        }
      }, { label: "取消", action: () => { } }],
      onOpen(b) {
        b.appendChild(el("div", { class: "formrow" }, [
          rad("colmode", "text", "文本填充", true), rad("colmode", "num", "数字序列", false), rad("colmode", "prefix", "前缀插入", false)
        ]));
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "内容/前缀" }), el("input", { type: "text", id: "colText", style: "flex:1" })]));
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "初始值" }), num("#colInit", 1), el("label", { text: "增量" }), num("#colInc", 1), el("label", { text: "每行重复" }), num("#colRep", 1)]));
        b.appendChild(el("div", { class: "formrow" }, [
          rad("colradix", "10", "十进制", true), rad("colradix", "16", "十六进制", false), rad("colradix", "8", "八进制", false), rad("colradix", "2", "二进制", false),
          chkL("colCap", "大写", false)
        ]));
        b.appendChild(el("div", { class: "hint", text: "应用于选中行的整行区间；若未选中则以当前光标列为起点应用到当前行。列对齐以插入位置为基准。" }));
        function rad(name, val, label, checked) { return el("label", {}, [el("input", { type: "radio", name, value: val, checked }), " " + label]); }
        function num(id, val) { return el("input", { type: "number", id, value: val, style: "width:80px" }); }
        function chkL(id, label, v) { return el("label", {}, [el("input", { type: "checkbox", id, checked: v }), " " + label]); }
      }
    });
  };
  function columnTransform(v, ed, mode, text, init, inc, rep, radix, cap) {
    const lines = v.split("\n");
    const s = ed.selStart, e = ed.selEnd;
    const curLineStart = s === 0 ? 0 : v.lastIndexOf("\n", s - 1) + 1;
    let startLine = 0, col = 0;
    if (s === e) {
      startLine = curLineStart === 0 ? 0 : v.slice(0, curLineStart - 1).split("\n").length;
      col = s - curLineStart;
    } else {
      startLine = v.slice(0, curLineStart).split("\n").length - 1;
      const colOf = (pos) => { const ls = pos === 0 ? 0 : v.lastIndexOf("\n", pos - 1) + 1; return pos - ls; };
      col = Math.min(colOf(s), colOf(e));
    }
    let idx = 0, val = init;
    for (let i = startLine; i < lines.length; i++) {
      const repN = idx % rep;
      if (repN === 0 && mode === "num") val = init + Math.floor(idx / rep) * inc;
      let ins;
      if (mode === "num") {
        let s2 = val.toString(radix);
        if (cap) s2 = s2.toUpperCase();
        ins = s2;
      } else if (mode === "prefix") ins = text;
      else ins = text;
      const line = lines[i];
      lines[i] = line.slice(0, Math.min(col, line.length)) + ins + line.slice(Math.min(col, line.length));
      idx++;
    }
    return { text: lines.join("\n"), sel: [0, 0] };
  }

  // ================= 启动 =================
  function boot() {
    SN.app.boot().then(() => {
      SN.$("#zoomLabel").textContent = "Zoom 100%";
      SN.emit("booted");
    }).catch(e => console.error(e));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
