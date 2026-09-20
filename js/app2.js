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
  // 文本变换类命令的统一前置：当前视图没有编辑器时，按能力表说明原因
  // （以前这里各自写提示、withBlock/moveLines 甚至静默 return —— 统一成一处，口径与菜单置灰一致）
  function needEditor(cap) {
    const d = SN.activeDoc();
    const ed = d && d.editor ? d.editor : null;
    if (!ed) { setMsg(d ? SN.caps.reason(cap || "edit", d) : "没有活动文本文档"); return null; }
    return { d, ed };
  }

  function mutateDocText(fn, caret) {
    const c = needEditor("edit");
    if (!c) return false;
    const d = c.d, ed = c.ed;
    ed.pushUndo();
    const r = fn(ed.text) || {};
    const nv = typeof r === "string" ? r : r.text;
    d.content = nv;
    ed.setText(nv, r.sel || caret || [0, 0]);
    SN.docContentTouched(d);
    ed.focus();
    return true;
  }

  function runWholeOrSelection(transform) {
    return mutateDocText((v) => {
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
    // 未执行（当前视图没有编辑器）时保留 needEditor 写的原因，别覆盖成"已完成"
    if (!mutateDocText((v) => SN.normalizeEol(v, eol))) return;
    d.eol = eol;
    SN.$("#eolSel").value = eol;
    setMsg("行尾已转为 " + eol.toUpperCase());
  };

  cmd.blankOp = function (mode) {
    const ok = runWholeOrSelection((txt) => txt.split("\n").map(l => {
      if (mode === "head") return l.replace(/^[ \t]+/, "");
      if (mode === "end") return l.replace(/[ \t]+$/, "");
      return l.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    }).join("\n"));
    if (!ok) return;
    setMsg("空白清理完成");
  };

  cmd.tabOp = function (mode) {
    if (!mutateDocText((v) => edApi.convertSpace(v, app.settings.tabWidth || 4, mode))) return;
    setMsg(mode === "tab2space" ? "TAB 已转为空格" : "空格已转为 TAB");
  };

  cmd.caseOp = function (type) {
    const names = { upper: "UPPERCASE", lower: "lowercase", proper: "Proper Case", properB: "Proper Case", sentence: "Sentence case", invert: "Invert Case", random: "Random Case" };
    if (!runWholeOrSelection((t) => edApi.caseText(t, type))) return;
    setMsg("大小写转换完成: " + (names[type] || type));
  };

  // ---------- 行操作 ----------
  function linesOf(v) { return v === "" ? [""] : v.split("\n"); }
  function linesJoin(arr, endsNL) { return arr.join("\n") + (endsNL ? "\n" : ""); }

  function withBlock(fn, mode) {
    const c = needEditor("edit");
    if (!c) return false;
    const d = c.d, ed = c.ed;
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
    if (nv === v) { ed.focus(); return true; }   // 执行了但内容没变
    // 防止破坏尾部空行
    d.content = nv;
    ed.setText(nv, [bs, bs]);
    SN.docContentTouched(d);
    ed.focus();
    return true;
  }

  cmd.lineOp = function (op) {
    if (op === "up" || op === "down") return moveLines(op);
    const ok = withBlock((arr) => {
      if (op === "dup") return arr.concat(arr);
      if (op === "delDupConsec") return edApi.removeDupLines(arr, true);
      if (op === "delDupAll") return edApi.removeDupLines(arr, false);
      if (op === "delEmpty") return edApi.removeEmpty(arr, false);
      if (op === "delEmptyWs") return edApi.removeEmpty(arr, true);
      if (op === "reverse") return arr.slice().reverse();
      if (op === "split") return edApi.splitLongLines(arr, 100);
      return arr;
    });
    if (!ok) return;
    setMsg("行操作完成: " + op);
  };

  function moveLines(dir) {
    const c = needEditor("edit");
    if (!c) return;
    const d = c.d, ed = c.ed;
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
    if (!withBlock(arr => edApi.sortLines(arr, mode), "doc")) return;
    setMsg("排序完成");
  };

  cmd.edStatus = function () {
    // 行列定位由视图适配器上报：大文件/Hex 没实现 status() → 按能力表说明原因，不再静默
    SN.views.invoke("statusPos", "status", SN.activeDoc());
  };

  // ============ 视图开关 ============
  // 开关是全局设置，广播到所有已打开文档：不支持的视图静默跳过（不逐个刷提示），
  // 活动文档再单独走一次"不实现就提示原因"的调用
  function viewForAll() {
    app.docs.forEach(d => SN.views.invoke("view", "applyView", d, [], true));
    SN.views.invoke("view", "applyView", SN.activeDoc());
  }

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
    else app.docs.forEach(d => SN.views.invoke("view", "setWebRanges", d, [[]], true));
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
      const li = el("li", { "data-id": d.id, class: d.id === app.activeId ? "cur" : "", text: (d.dirty ? "* " : "") + d.name + SN.views.of(d).listTag });
      li.addEventListener("click", () => SN.activateDoc(d.id));
      ul.appendChild(li);
    }
  }

  // ============ 缩放 ============
  cmd.zoom = function (delta) {
    app.zoomPct = Math.max(50, Math.min(250, (app.zoomPct || 100) + delta));
    const pct = app.zoomPct;
    // 广播到所有文档（切换标签后缩放一致）；不支持的视图静默跳过，活动文档单独提示
    app.docs.forEach(d => SN.views.invoke("zoom", "setZoom", d, [pct], true));
    SN.views.invoke("zoom", "setZoom", SN.activeDoc(), [pct]);
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
    if (!d) return;
    if (!SN.caps.can("encoding", d)) { setMsg(SN.caps.reason("encoding", d)); return; }
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
    if (!d) return;
    if (!SN.caps.can("encoding", d)) { setMsg(SN.caps.reason("encoding", d)); return; }
    if (!SN.codeById(code).writable) {
      setMsg("浏览器不支持写出 " + SN.codeById(code).name + "，请在「另存为」时改存 UTF-8/UTF-16");
      return;
    }
    d.enc = code;
    SN.docContentTouched(d);
    updateStatusLabel();
    setMsg("编码标记已切换为 " + SN.codeById(code).name + "（保存时生效）");
  };
  // 重新打开为指定视图（三种视图互相切换）。打开入口统一成「打开…」+ 自动识别之后，
  // 需要强制视图时都走这里：重新取源字节 → 复用 app.js 的 applyBytesToDoc 判定/解码 → 重建页面。
  cmd.reloadAs = async function (docId, kind) {
    const d = SN.docById(docId);
    if (!d) return;
    const target = kind;   // "text" / "big" / "hex"
    if (target !== "text" && target !== "big" && target !== "hex") { setMsg("不支持的视图类型"); return; }
    // 能否切回可编辑文本由能力表决定（见 js/viewcaps.js；三种视图现在都支持，留着是为了口径统一）
    if (target === "text" && !SN.caps.can("reloadAsText", d)) { setMsg(SN.caps.reason("reloadAsText", d)); return; }
    if (SN.caps.kindOf(d) === target) { setMsg("当前已经是" + SN.caps.label({ kind: target }) + "视图"); return; }
    // 切到只读视图会用磁盘字节替换正文：有未保存修改时先确认，别让改动无声消失
    if (d.dirty && target !== "text") {
      if (!confirm("“" + d.name + "”有未保存的修改，切到" + SN.caps.label({ kind: target }) +
        "视图会丢弃这些修改（原文件不变）。继续？")) { setMsg("已取消切换视图"); return; }
    }
    // 切回可编辑文本对大文件是重操作（整篇解码 + 可编辑 textarea）：二次确认
    if (target === "text" && (d.size || 0) > SN.bigLimitBytes()) {
      if (!confirm("“" + d.name + "”共 " + SN.fmtSize(d.size) + "，切回可编辑文本需要整篇解码，可能较慢。继续？")) {
        setMsg("已取消切回文本模式"); return;
      }
    }
    const bytes = await SN.sourceBytesOf(d);
    if (!bytes) {
      setMsg(d.newFile
        ? "新文档还没有对应文件，无法「重新打开为」其他视图；先保存，或用「打开…」选择文件"
        : "未保留原始字节，无法重新打开为" + SN.caps.label({ kind: target }) + "；请用「打开…」重新选择该文件");
      return;
    }
    try {
      SN.applyBytesToDoc(d, bytes, target, bytes.length || d.size || 0);
      SN.docMarkClean(d);
      SN.rebuildDocPage(d);
      if (SN.updateTabTags) SN.updateTabTags();
      if (SN.updateFileList) SN.updateFileList();
      const view = SN.views.byKind(d.kind);
      setMsg("已重新打开为" + SN.caps.label(d) + "（" + SN.fmtSize(d.size) + "，" + SN.codeById(d.enc).name + view.open.note + "）");
    } catch (e) {
      setMsg("重新打开失败：" + (e && e.message ? e.message : e));
    }
  };
  // Hex 视图适配器：渲染、导出原始字节、切回可编辑文本都由 app2.js 实现
  SN.views.define("hex", {
    tabTag: "⛭", listTag: " ⛭", modeTag: "HexReadOnly", persistBody: false,
    // 二进制视图：不解码正文，保留原始字节，编码栏用 utf8 占位
    open: { readOnly: true, keepRawBytes: true, decodeMode: "none", fallbackEnc: "utf8" },
    render: (doc, page) => { page.appendChild(buildHexView(doc)); return true; },
    exportBytes: (doc) => { SN.download(doc.name + ".hex", new Blob([doc.raw])); },
    // 右键菜单：Hex 视图只支持导出原始字节 / 切回可编辑文本 / 重命名（见 js/viewcaps.js）
    contextMenu: (doc) => [
      { label: "导出原始文件", requires: "exportBytes", action: () => SN.cmd.downloadDoc(doc.id) },
      { label: "以文本模式重载", requires: "reloadAsText", action: () => SN.cmd.reloadAs(doc.id, "text") },
      { label: "重命名…", requires: "rename", action: () => SN.cmd.renameDoc(doc.id) }
    ]
  });
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
      // Web 地址高亮是编辑器渲染特性（与换行/空白同属 view 能力）：
      // 范围在这里算，落到视图上仍走适配器（不支持的视图静默跳过）
      if (!SN.caps.can("view", d)) return;
      if (!app.settings.webAddrHighlight) { SN.views.invoke("view", "setWebRanges", d, [[]], true); return; }
      const marks = [];
      let m;
      const re = new RegExp(URL_RE.source, "gi");
      while ((m = re.exec(d.content || ""))) marks.push({ start: m.index, end: m.index + m[0].length, color: "#BBDEFB" });
      SN.views.invoke("view", "setWebRanges", d, [marks], true);
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
    const d = SN.activeDoc();
    if (!d) { setMsg("没有活动文本文档"); return false; }
    // 各视图的标记方式不同（编辑器标记记录 / 大文件持久标记），由适配器实现；此处只做能力判断与转发
    const ad = SN.views.of(d);
    if (!ad.markSelection) { setMsg(SN.caps.reason("mark", d)); return false; }
    return ad.markSelection(d, app.curMarkColor, app.findOpt);
  };
  // ============ 文本视图适配器：编辑器专有能力都在这里登记 ============
  // 目的：命令层不再直接拿 activeEditor()，一律走 SN.views.invoke("能力", "方法", doc)。
  // 这样将来给大文件视图补同一能力（例如 findStep），只需在这里之外再加一份实现，命令层不用改；
  // 而当前视图没实现时会得到与菜单置灰同一句原因，不会"菜单亮了但点了没反应"。
  function edOf(d) { return d && d.editor ? d.editor : null; }
  SN.views.define("text", {
    // ---- 标记（编辑器提供多关键字标记记录） ----
    clearMarks: (d) => { if (d.editor) d.editor.clearPersistentMarks(); },
    markSelection: (d, color, findOpt) => {
      const ed = d.editor;
      if (!ed) { setMsg("没有活动文本文档"); return false; }
      let kw = ed.hasSelection() ? ed.selectedText().trim() : "";
      if (!kw && findOpt && findOpt.keyword) kw = findOpt.keyword;
      if (!kw) { setMsg("请先双击/选中要高亮的文本，或先输入查找关键字"); return false; }
      const count = ed.upsertMarkRecord(kw, color, { case: false, whole: false, regex: false });
      ed.focus();
      setMsg("已用颜色高亮 “" + kw + "”：共 " + count + " 处（可继续选其它词/颜色叠加）");
      return true;
    },
    // 查找面板的「全部标记」：以面板关键字为准（避免误用编辑器旧选区）
    markKeyword: (d, kw) => {
      const ed = edOf(d);
      if (!ed || !kw) return false;
      const count = ed.upsertMarkRecord(kw, app.curMarkColor, app.findOpt);
      setMsg("标记完成：共 " + count + " 处（“" + kw + "”+" + app.curMarkColor + "）");
      return true;
    },
    // 双击取词高亮
    wordHighlight: (d, word) => {
      const ed = edOf(d);
      if (!ed) return false;
      let kw = word;
      if (!kw) kw = ed.wordAtSelection();
      if (!kw) { setMsg("请选择要高亮的文本"); return false; }
      const ms = findMatches(ed.text, kw, { case: true, whole: true, regex: false });
      ed.setWordRanges(ms.map(m => ({ start: m.start, end: m.end, color: "#B3E5FC" })));
      setMsg("高亮 “" + kw + "”：共 " + ms.length + " 处");
      return true;
    },
    // ---- 撤销/重做（编辑器自管撤销栈） ----
    undo: (d) => { const ed = edOf(d); if (!ed) return false; ed.undo(); return true; },
    redo: (d) => { const ed = edOf(d); if (!ed) return false; ed.redo(); return true; },
    // ---- 剪贴板：textarea 才有的原生 execCommand 路径 ----
    clipboard: (d, action) => {
      const ed = edOf(d);
      if (!ed) return false;
      ed.ta.focus();
      // 非安全上下文/无 execCommand 的环境（例如 smoke 的 DOM 桩）不要抛，按"未执行"返回
      if (typeof document.execCommand !== "function") return false;
      document.execCommand(action);
      if (action === "cut" || action === "paste") {
        setTimeout(() => { if (ed.onChange) ed.onChange(ed.text, ed); }, 0);
      }
      return true;
    },
    // ---- 查找步进（F3/F4、查找对话框的"下一个/上一个"）----
    findStep: (d, forward) => {
      const ed = edOf(d);
      if (!ed) return false;
      const kw = app.findOpt.keyword;
      if (!kw) return false;                    // 没关键字时由命令层去打开查找对话框
      const ms = findMatches(ed.text, kw, app.findOpt);
      if (!ms.length) { setMsg("未找到：" + kw); return false; }
      const caret = ed.caret();
      let idx = ms.findIndex(m => forward ? m.end > caret : m.start < caret);
      if (idx < 0) idx = forward ? 0 : ms.length - 1;
      const hit = ms[idx];
      ed._setTextWithSel(ed.text, hit.start, hit.end);
      ed.scrollToPos(hit.start);
      ed.focus();
      ed.setFindRanges(ms.map(x => ({ start: x.start, end: x.end, color: "#FFF59D" })));
      setMsg("第 " + (idx + 1) + "/" + ms.length + " 处（行 " + hit.line + "）");
      return true;
    },
    // ---- 状态栏行列（编辑器通过 onStatus 回调上报） ----
    status: (d) => { const ed = edOf(d); if (!ed) return false; ed._reportStatus(); return true; },
    // ---- 视图开关：自动换行 / 显示空白 / 显示行尾 ----
    applyView: (d) => {
      const ed = edOf(d);
      if (!ed) return false;
      ed.setWrap(app.settings.wrap);
      ed.setShowSpaces(app.settings.showSpaces);
      ed.setShowEol(app.settings.showEol);
      return true;
    },
    // Web 地址高亮：范围由调用方算好，这里只负责落到编辑器
    setWebRanges: (d, ranges) => { const ed = edOf(d); if (!ed) return false; ed.setWebRanges(ranges || []); return true; },
    // ---- 缩放 ----
    setZoom: (d, pct) => { const ed = edOf(d); if (!ed) return false; ed.applyZoom(pct); return true; },
    // ---- 书签 ----
    bookmarkToggle: (d) => {
      const ed = edOf(d);
      if (!ed) return false;
      ed.toggleBookmark(ed.curLine() - 1);
      return true;
    },
    bookmarkGoto: (d, dir) => {
      const ed = edOf(d);
      if (!ed) return false;
      if (!ed.gotoBookmark(dir)) { setMsg("没有书签"); return false; }
      return true;
    },
    bookmarksClear: (d) => { const ed = edOf(d); if (!ed) return false; ed.clearBookmarks(); return true; }
  });
  cmd.markAll = function () {
    const ok = cmd.markSelected();
    if (!ok) setMsg("全部标记：请先选中文本或先执行一次查找");
  };
  // 查找面板内“全部标记”：以面板关键字为准（避免误用编辑器旧选区）
  cmd.markKeyword = function () {
    const kw = app.findOpt.keyword;
    if (!kw) { setMsg("请输入要标记的关键字"); return false; }
    return SN.views.invoke("mark", "markKeyword", SN.activeDoc(), [kw]);
  };
  cmd.clearMarksAll = function () {
    app.docs.forEach(d => {
      const ad = SN.views.of(d);
      if (ad.clearMarks) ad.clearMarks(d);
    });
    setMsg("已清除全部标记");
  };
  cmd.wordHighlight = function (word) {
    SN.views.invoke("mark", "wordHighlight", SN.activeDoc(), [word]);
  };

  cmd.toggleBookmark = function () {
    SN.views.invoke("bookmark", "bookmarkToggle", SN.activeDoc());
  };
  cmd.gotoBookmark = function (dir) {
    SN.views.invoke("bookmark", "bookmarkGoto", SN.activeDoc(), [dir]);
  };
  cmd.clearBookmarks = function () {
    SN.views.invoke("bookmark", "bookmarksClear", SN.activeDoc());
  };

  // ============ 查找对话框 ============
  // 统一查找入口：不再区分「查找…」与「在打开的文档中查找…」，
  // 都在同一个对话框里输入关键字，再用两个按钮选择作用域：
  //   当前文件中查找 / 查找所有打开文件
  // opts: { scope: "doc"(默认) | "docs", replace: true 表示从「替换…」进入 }
  dlg.find = function (opts) {
    const o = typeof opts === "string" ? { scope: opts === "opendocs" ? "docs" : "doc" } : (opts || {});
    const ed = SN.activeEditor();
    const d = SN.activeDoc();
    const scope = o.scope === "docs" ? "docs" : "doc";
    const canFindHere = !!d && SN.caps.can("find", d);
    if (ed && !app.findOpt.keyword && ed.hasSelection()) app.findOpt.keyword = ed.selectedText().slice(0, 200);
    const m = SN.openModal({
      title: o.replace ? "查找 / 替换" : "查找",
      width: "560px",
      onOpen(body) {
        const rows = [];
        rows.push(frow("关键字", textIn("findKey", app.findOpt.keyword)));
        // 查找选项只对文本视图有效：大文件按分块流式检索（忽略大小写、不支持正则/全词），
        // 此时改为一行说明，避免勾了却没效果的误导
        if (ed) {
          rows.push(optrow([chk("caseOpt", "区分大小写", app.findOpt.case), chk("wholeOpt", "全词匹配", app.findOpt.whole), chk("reOpt", "正则", app.findOpt.regex)]));
        } else if (canFindHere) {
          rows.push(el("div", { class: "hint", text: "当前视图按分块流式检索：忽略大小写，不支持正则/全词" }));
        } else {
          rows.push(el("div", { class: "hint", text: (d ? SN.caps.reason("find", d) : "没有活动文档") + "，仍可查找其它打开的文档" }));
        }
        // 主按钮：作用域二选一（当前文件 / 所有打开文件）
        const scopeBtns = el("div", { class: "btn-group" });
        mk(scopeBtns, "当前文件中查找", () => findAllAndShow("doc"), { primary: scope === "doc", disabled: !canFindHere, title: canFindHere ? "" : (d ? SN.caps.reason("find", d) : "没有活动文档") });
        mk(scopeBtns, "查找所有打开文件", () => findAllAndShow("docs"), { primary: scope === "docs" });
        // 次级按钮：仅文本视图（需要光标/可写）
        const subBtns = el("div", { class: "btn-group" });
        // 无编辑器（大文件/二进制视图）时没有「当前光标」概念，逐条跳转不适用
        if (ed) {
          mk(subBtns, "查找下一个", () => doFindNext(true));
          mk(subBtns, "查找上一个", () => doFindNext(false));
          mk(subBtns, "全部标记", () => { collectOpts(); cmd.markKeyword(); });
          mk(subBtns, "替换全部", () => doReplaceAll());
        }
        body.appendChild(fieldset("", rows, scopeBtns));
        if (subBtns.children.length) body.appendChild(el("div", { class: "findrow", style: "margin-top:6px" }, [subBtns]));
        const kv = $("#findKey");
        kv.focus(); kv.select();
        // 回车 = 执行主作用域（Ctrl+Shift+F 进来时默认就是「所有打开文件」）
        kv.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          collectOpts();
          if (scope === "docs") findAllAndShow("docs");
          else if (canFindHere) findAllAndShow("doc");
          else setMsg(d ? SN.caps.reason("find", d) : "没有活动文档");
        });
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
        function mk(cont, label, fn, bopts) {
          const b = el("button", { text: label, title: (bopts && bopts.title) || null });
          const bo = bopts || {};
          if (bo.primary) b.style.background = "var(--accent)";
          if (bo.disabled) b.disabled = true;
          else b.addEventListener("click", fn);
          cont.appendChild(b);
        }
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
          // 跨文档查找覆盖所有「支持查找」的文档（能力表判定，Hex 自动排除）
          const docList = sc === "docs" ? app.docs.filter(x => SN.caps.can("find", x)) : [d];
          for (const dd of docList) {
            const ad = SN.views.of(dd);
            // 大文本：正文未整篇解码，必须走适配器的分块流式检索（只占临时内存）
            if (ad.search) {
              const msg = SN.$("#msgLabel");
              const rows = await ad.search(dd, app.findOpt.keyword, (pct, n) => {
                if (msg) msg.textContent = "正在检索 " + dd.name + " " + pct + "% · 已找到 " + n + " 处";
              });
              for (const row of rows) res.push({ docId: dd.id, file: dd.name, line: row.line, content: row.snippet });
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
          // 当前文件作用域下，若该视图没有光标（大文件只读），自动定位到第一处命中，
          // 便于立即看到上下文；结果面板仍可点击跳到其它命中
          if (sc === "doc" && !SN.activeEditor() && res.length) {
            const ad = SN.views.of(d);
            if (ad.jumpToLine) ad.jumpToLine(d, res[0].line);
          }
          setMsg("共找到 " + res.length + " 处（查找范围：" + (sc === "docs" ? "所有打开文件" : "当前文件") + "）");
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
    // 步进查找要"光标"这个概念：命令层只管"有没有关键字/该不该开对话框"，
    // 具体怎么在当前视图里步进由适配器实现（大文件视图补 findStep 时命令层不用改）
    if (!app.findOpt.keyword) { dlg.find({ scope: "doc" }); return; }
    SN.views.invoke("findStep", "findStep", SN.activeDoc(), [forward]);
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
      // 一个文件一组：单击文件名可折叠该文件的结果（与大文件搜索共用同一结构）
      const g = SN.resultGroup(file, groups[file].length);
      for (const r of groups[file]) {
        const row = el("div", { class: "res-row" });
        row.appendChild(el("span", { class: "lnn", text: "行 " + r.line + ":" }));
        row.appendChild(el("span", { text: r.content.slice(0, 160) }));
        row.dataset.doc = r.docId;
        row.dataset.start = r.start;
        row.dataset.end = r.end;
        row.dataset.line = r.line;
        row.addEventListener("click", () => jumpResultRow(row));
        g.body.appendChild(row);
      }
      view.appendChild(g.group);
    }
  }
  cmd.copyResultDock = function () {
    const t = $("#resultView").textContent;
    if (!t.trim()) { setMsg("没有可复制的查找结果"); return; }
    navigator.clipboard.writeText(t).then(() => setMsg("已复制查找结果"));
  };

  // ============ 查找结果右键菜单（#resultView 上的统一委托） ============
  // 行内跳转逻辑与左键点击同源：jumpResultRow 同时服务 click 与右键「跳转到该行」
  function jumpResultRow(row) {
    const docId = SN.menu.dataOf(row, "doc");
    const start = SN.menu.dataOf(row, "start");
    const end = SN.menu.dataOf(row, "end");
    const line = parseInt(SN.menu.dataOf(row, "line"), 10);
    SN.activateDoc(docId);
    const ad = SN.activeDoc();
    const ed = SN.activeEditor();
    // 无编辑器（大文本只读）：交给该视图适配器定位到命中行
    if (!ed && ad && line) { const view = SN.views.of(ad); if (view.jumpToLine) { view.jumpToLine(ad, line); return; } }
    if (!ed) return;
    if (start !== undefined && end !== undefined && start !== null && start !== "") {
      ed._setTextWithSel(ed.text, +start, +end); ed.scrollToPos(+start);
    } else if (line) {
      ed.gotoLine(line);
    }
    ed.focus();
  }
  // 结果行里除行号（.lnn）之外的那段文本，就是命中内容
  function resultRowText(row) {
    for (const c of (row.children || [])) {
      if (!SN.menu.hasClass(c, "lnn")) return c.textContent || "";
    }
    return row.textContent || "";
  }
  SN.menu.register("#resultView", {
    match: (n) => SN.menu.hasClass(n, "res-row") || SN.menu.hasClass(n, "res-sec"),
    items: (n) => {
      if (SN.menu.hasClass(n, "res-row")) {
        const line = parseInt(SN.menu.dataOf(n, "line"), 10) || 0;
        const text = resultRowText(n);
        return [
          { label: "跳转到该行", action: () => jumpResultRow(n) },
          "-",
          { label: "复制该行文本", action: () => SN.menu.copyText(text).then(ok => setMsg(ok ? "已复制该行" : "浏览器未允许写入剪贴板")) },
          { label: "复制行号+文本", action: () => SN.menu.copyText("行 " + line + ": " + text).then(ok => setMsg(ok ? "已复制" : "浏览器未允许写入剪贴板")) },
          { label: "复制全部结果", action: () => cmd.copyResultDock() }
        ];
      }
      // 分组头：折叠/展开该组（复用 resultGroup 里的同一个开关）+ 复制该文件结果
      const group = SN.menu.upFrom(n, x => SN.menu.hasClass(x, "res-group"));
      const body = group ? SN.menu.firstDescendant(group, x => SN.menu.hasClass(x, "res-body")) : null;
      return [
        { label: "折叠/展开该组", disabled: !(n && n._toggleGroup), action: () => { if (n._toggleGroup) n._toggleGroup(); } },
        { label: "复制该文件结果", disabled: !body, action: () => {
          const t = body ? (body.textContent || "") : "";
          if (!t.trim()) { setMsg("没有可复制的结果"); return; }
          SN.menu.copyText(t).then(ok => setMsg(ok ? "已复制该文件结果" : "浏览器未允许写入剪贴板"));
        } }
      ];
    },
    ctx: () => ({ doc: SN.activeDoc() })
  });

  // ============ 其它对话框 ============
  dlg.gotoLine = function () {
    const ed = SN.activeEditor();
    if (!ed) {
      // 无编辑器（大文本只读）：Ctrl+G 走定位行模态，实际定位交给视图适配器
      const ad = SN.activeDoc();
      const view = ad ? SN.views.of(ad) : null;
      if (ad && view && view.jumpToLine) {
        SN.openModal({
          title: "定位行（大文件）",
          buttons: [{
            label: "跳转", primary: true, action: () => {
              const n = parseInt($("#bigGotoLineNum").value, 10);
              if (n > 0) { view.jumpToLine(ad, n); if (SN.activateDoc) SN.activateDoc(ad.id); }
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
                if (n > 0) { view.jumpToLine(ad, n); if (SN.activateDoc) SN.activateDoc(ad.id); SN.closeModal(); }
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
    const canRename = SN.caps.can("rename", d);
    SN.openModal({
      title: "重命名" + (canRename ? "" : "（" + SN.caps.label(d) + "视图不支持改名）"),
      buttons: [{
        label: "确定", primary: true, action: () => {
          const name = $("#rnName").value.trim();
          if (!name) return false;
          if (!canRename) { setMsg(SN.caps.reason("rename", d)); return false; }
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
    const ed = d && d.editor ? d.editor : null;
    // 与第一段同口径：没有编辑器就按能力表说明原因（调用方已各自前置检查，这里只是兜底）
    if (!ed) { setMsg(d ? SN.caps.reason("edit", d) : "没有活动文本文档"); return false; }
    ed.pushUndo();
    const r = fn(ed.text) || {};
    const nv = typeof r === "string" ? r : r.text;
    d.content = nv;
    ed.setText(nv, r.sel || caret || [0, 0]);
    SN.docContentTouched(d);
    ed.focus();
    return true;
  }

  // ================= 工具 =================
  tool.format = function (kind) {
    const ed = SN.activeEditor();
    if (!ed) { setMsg(SN.caps.reason("format", SN.activeDoc())); return; }
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
    // 选中文本哈希依赖编辑器：大文件/Hex 没有编辑器，原先会静默取空串，
    // 算出一个「格式正常但内容错误」的哈希值——这里禁用该按钮并写明原因（calc 内再兜底一次）。
    const selWhy = SN.caps ? SN.caps.reason("hashSelection", SN.activeDoc()) : "";
    SN.openModal({
      title: "MD5 / SHA 计算",
      width: "600px",
      buttons: [
        { label: "选择文件…", action: () => $("#hashFile").click() },
        { label: "计算选中文本", primary: true, disabled: !!selWhy, title: selWhy, action: () => calc("sel") },
        { label: "关闭", action: () => { } }
      ],
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
            if (!ed) {
              const why = SN.caps ? SN.caps.reason("hashSelection", SN.activeDoc()) : "当前视图不支持选中文本哈希";
              $("#hashOut").value = why + "；请用「选择文件…」对文件计算。";
              setMsg(why);
              return;
            }
            data = new TextEncoder().encode(ed.selectedText() || ed.text);
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
          if (!SN.caps.can("encoding", d)) return;
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
      if (!ed) { setMsg(SN.caps.reason("plugin", SN.activeDoc())); return; }
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
          "15 套主题（编辑区 + 界面配色一体）",
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

  // ================= 视图能力表（关于 → 视图能力表…） =================
  // 只读展示：三种视图对各功能的支持情况，与菜单/快捷键置灰同源（js/viewcaps.js）
  dlg.caps = function () {
    const kinds = ["text", "big", "hex"];
    const cur = SN.caps.kindOf(SN.activeDoc());
    SN.openModal({
      title: "视图能力表",
      width: "560px",
      buttons: [{ label: "关闭", action: () => { } }],
      onOpen(b) {
        b.appendChild(el("div", { class: "hint", text: "三种视图支持哪些功能（只读展示）。菜单、工具栏与快捷键按本表置灰；当前视图：" + SN.caps.label(SN.activeDoc()) }));
        const tbl = el("table", { class: "tbl captbl" });
        const head = el("tr");
        head.appendChild(el("th", { text: "功能" }));
        kinds.forEach(k => head.appendChild(el("th", { text: SN.caps.MATRIX[k].label + (k === cur ? "（当前）" : "") })));
        tbl.appendChild(head);
        SN.caps.DISPLAY.forEach(([cap, name]) => {
          const tr = el("tr");
          tr.appendChild(el("td", { text: name }));
          kinds.forEach(k => tr.appendChild(el("td", {
            class: "capcell" + (SN.caps.can(cap, { kind: k }) ? " yes" : " no"),
            text: SN.caps.can(cap, { kind: k }) ? "✓" : "—"
          })));
          tbl.appendChild(tr);
        });
        b.appendChild(tbl);
        b.appendChild(el("div", { class: "hint", text: "✓ 支持　— 不支持　（定义见 js/viewcaps.js）" }));
      }
    });
  };

  // ================= 选项 =================
  dlg.options = function () {
        let saveAllFn, revertFn, saved = false;
SN.openModal({
      title: "选项",
      width: "620px",
      buttons: [{ label: "保存", primary: true, action: () => saveAllFn() }, { label: "取消", action: () => { } }],
      // × / Esc / 点遮罩关闭也走还原：选项里的下拉是即时预览的，关掉对话框不该留在预览态
      onClose: () => revertFn(),
      onOpen(b) {
        const s = app.settings;
        // 下拉是即时预览的，记下打开时的选择，取消时好还原
        const keepTheme = s.editorTheme;
        const themeSel = sel("themeSel", SN.EDITOR_THEMES.map(t => [t.id, t.name]), s.editorTheme);
        // 显式同步当前值（确保重新打开时下拉框反映已保存的设置）
        themeSel.value = s.editorTheme;
        themeSel.addEventListener("change", () => { SN.applyEditorTheme(themeSel.value); });
        b.appendChild(el("div", { class: "formrow" }, [el("label", { text: "主题" }), themeSel]));
        b.appendChild(el("div", { class: "hint", text: "一套主题同时决定编辑区与界面配色（菜单栏/工具栏/标签栏/状态栏/对话框），不支持混搭；下拉即时预览，取消则还原。" }));
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
        b.appendChild(el("div", { class: "hint", text: "超过该阈值（默认 2MB）会自动用“大文本只读/虚拟滚动”打开：只渲染可视区域行，流畅浏览大日志且不 OOM。若确实需要编辑，打开后右键标签选「重新打开为 → 文本编辑」（会二次确认，大文件较慢）。" }));
        function sel(id, opts, val) { const s2 = el("select", { id }); opts.forEach(o => s2.appendChild(el("option", { value: o[0], text: o[1], selected: o[0] === val }))); return s2; }
        function numIn(id, val, min, max) { return el("input", { type: "number", id, value: val, min, max, style: "width:90px" }); }
        function chk(id, label, v) { return el("label", {}, [el("input", { type: "checkbox", id, checked: v }), " " + label]); }
        saveAllFn = function () {
          const s2 = app.settings;
          s2.editorTheme = $("#themeSel").value;
          s2.tabWidth = parseInt($("#optTab").value, 10) || 4;
          s2.expandTab = !!$("#optExpand") && $("#optExpand").checked;
          s2.restoreSession = !!$("#optRestore") && $("#optRestore").checked;
          s2.autoSave = !!$("#optAuto") && $("#optAuto").checked;
          s2.wordDblHighlight = !!$("#optWord") && $("#optWord").checked;
          s2.bigThresholdMB = parseInt($("#optBig").value, 10) || 2;
          SN.applyEditorTheme(s2.editorTheme);
          SN.saveSettings();
          SN.refreshMenus();
          setMsg("选项已保存");
          saved = true;
        }
        revertFn = function () {
          if (saved) return;   // 已保存就不还原（保存后 closeModal 也会触发 onClose）
          SN.applyEditorTheme(keepTheme);
        };
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
            // 同步进 app.settings，否则「点了卡片」只改了预览、没有真正落盘
            app.settings.editorTheme = t.id;
            app.docs.forEach(dd => { if (dd.editor) dd.editor.render(); });
            SN.saveSettings();
          });
          grid.appendChild(card);
        }
        b.appendChild(grid);
      }
    });
  };

  dlg.shortcuts = function () {
    SN.openModal({
      title: "快捷键一览",
      buttons: [{ label: "关闭", action: () => { } }],
      onOpen(b) {
        // 直接渲染统一快捷键表：与菜单提示、实际按键响应同源，改键后此处自动跟随
        SN.shortcuts.groups().forEach(g => {
          b.appendChild(el("div", { class: "about-sec", text: g.name }));
          const tbl = el("table", { class: "tbl" });
          const tr0 = el("tr");
          tr0.appendChild(el("th", { text: "功能" }));
          tr0.appendChild(el("th", { text: "快捷键" }));
          tbl.appendChild(tr0);
          g.items.forEach(it => {
            const tr = el("tr");
            tr.appendChild(el("td", { text: it.label }));
            // 标出当前视图下不可用的键（能力来自 js/viewcaps.js），与菜单置灰同一判据
            const why = SN.shortcuts.blockedReason(it, SN.activeDoc());
            tr.appendChild(el("td", { text: (it.accel || "—") + (why ? "（" + why + "）" : "") }));
            tbl.appendChild(tr);
          });
          b.appendChild(tbl);
        });
        b.appendChild(el("div", { class: "hint", text: "本表来自 js/shortcuts.js：菜单右侧提示、实际按键响应与此处一览同源，改键后三处一起变。撤销/重做在文本域内也按本表判定；剪切/复制/粘贴/全选为浏览器原生行为；缩放用工具栏 ＋/－；自动缩进等编辑细节由浏览器文本域原生行为承担。" }));
      }
    });
  };

  // ================= 列块编辑 =================
  dlg.columnEdit = function () {
    const ed = SN.activeEditor();
    if (!ed) { setMsg(SN.caps.reason("columnEdit", SN.activeDoc())); return; }
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
