"use strict";
(function () {
  const SN = window.SN;
  const el = SN.el;
  const app = {};
  SN.app = app;

  app.settings = null;
  app.docs = [];        // [{id,name,path,kind,content,enc,eol,lang,dirty,readOnly,raw,handle,size}]
  app.activeId = null;
  app.curMarkColor = "#FFEB3B";
  app.MARK_COLORS = ["#FFEB3B", "#A6E22E", "#7EC8FF", "#FF9EF1", "#FFA07A", "#C3A6FF", "#86E7CE", "#F8B500"];
  app.recent = [];
  app.pendingOpenMode = "auto";

  const SETTINGS_DEFAULT = {
    appSkin: "light",
    editorTheme: "default",
    tabWidth: 4,
    expandTab: true,
    wrap: false,
    showSpaces: false,
    showEol: false,
    restoreSession: true,
    autoSave: true,
    bigThresholdMB: 2,        // 超过该大小(默认2MB)打开为“大文本只读/虚拟滚动”
    wordDblHighlight: true,
    webAddrHighlight: false,
    markColorIdx: 0,
    fontSize: 14
  };

  // ============ 基础工具 ============
  function docById(id) { return app.docs.find(d => d.id === id); }
  function activeDoc() { return docById(app.activeId); }
  function activeEditor() {
    const d = activeDoc();
    return d && d.editor ? d.editor : null;
  }
  function setMsg(m) { SN.$("#msgLabel").textContent = m || ""; }
  function toast(msg) { SN.toast(msg); }

  // ============ 菜单/工具栏 ============
  const menubar = SN.$("#menubar");
  const toolbar = SN.$("#toolbar");

  let nestedPop = null, nestedState = null;
  function closeNestedPop() {
    if (nestedPop) { nestedPop.remove(); nestedPop = null; nestedState = null; }
  }
  function openNestedPop(source, anchorRect) {
    closeNestedPop();
    const pop = el("div", { class: "menu-pop" });
    fillDrop(pop, typeof source === "function" ? source() : source);
    document.body.appendChild(pop);
    nestedPop = pop;
    nestedState = { source, rect: anchorRect };
    const r = anchorRect;
    const pw = pop.offsetWidth || Math.min(280, Math.max(180, window.innerWidth - r.right - 20));
    let x = r.right + 2;
    if (x + pw > window.innerWidth - 4) x = Math.max(4, r.left - pw - 2);
    let y = r.top;
    if (y + pop.offsetHeight > window.innerHeight - 6) y = Math.max(4, window.innerHeight - pop.offsetHeight - 6);
    pop.style.left = x + "px";
    pop.style.top = y + "px";
  }
  function rebuildNestedPop() {
    if (nestedState) openNestedPop(nestedState.source, nestedState.rect);
  }
  function closeMenus() {
    closeNestedPop();
    SN.$$(".menu-root.open").forEach(m => m.classList.remove("open"));
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-root") && !e.target.closest(".menu-pop")) closeMenus();
  });

  function buildMenu(specs) {
    menubar.textContent = "";
    for (const spec of specs) {
      const root = el("div", { class: "menu-root" });
      const cap = el("button", { class: "menu-caption", text: spec.label });
      root.appendChild(cap);
      cap.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenus();
        root.classList.toggle("open");
        if (spec.onShow) spec.onShow(dd, spec);
        positionDrop(root);
      });
      const dd = el("div", { class: "dropdown hidden" });
      fillDrop(dd, spec.items || []);
      root.appendChild(dd);
      menubar.appendChild(root);
    }
    const positionDrop = (rootEl) => {
      const dd = rootEl.querySelector(".dropdown");
      if (!rootEl.classList.contains("open")) return;
      dd.classList.remove("hidden");
      const r = rootEl.getBoundingClientRect();
      const avail = window.innerHeight - r.bottom - 10;
      if (dd.offsetHeight > avail) dd.style.maxHeight = Math.max(180, avail) + "px";
      else dd.style.maxHeight = "";
    };
  }

  function fillDrop(dd, items) {
    dd.textContent = "";
    for (const it of items) {
      if (it === "-") { dd.appendChild(el("div", { class: "mi sep" })); continue; }
      if (it.sub || it.palette) {
        const row = el("div", { class: "mi", "data-sub": 1 });
        row.appendChild(el("span", { text: it.label }));
        row.appendChild(el("span", { class: "caret", text: "›" }));
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          const src = it.palette ? () => markColorItems() : it.sub;
          openNestedPop(src, row.getBoundingClientRect());
        });
        dd.appendChild(row);
        continue;
      }
      const mi = el("div", { class: "mi" });
      if (it.disabled) mi.classList.add("disabled");
      if (it.swatch) {
        const sw = el("span", { class: "sw" });
        sw.style.background = it.swatch;
        mi.appendChild(sw);
      }
      if (it.checked !== undefined) {
        mi.appendChild(el("span", { text: it.checked ? "☑" : "☐" }));
      }
      mi.appendChild(el("span", { text: it.label || "" }));
      if (it.accel) mi.appendChild(el("span", { class: "accel", text: it.accel }));
      if (it.tip) mi.title = it.tip;
      if (!it.disabled && it.action) mi.addEventListener("click", (e) => {
        e.stopPropagation();
        if (it.stay) {
          it.action();
          if (it.rebuild) rebuildNestedPop();
        } else {
          closeMenus();
          it.action();
        }
      });
      if (it.id) mi.dataset.id = it.id;
      dd.appendChild(mi);
    }
  }

  // ============ 菜单模型 ============
  function langMenuItems() {
    const groups = {};
    const list = SN.langList();
    for (const l of list) {
      if (l.id === "txt") continue;
      const key = l.name[0] ? l.name[0].toUpperCase() : "?";
      (groups[key] = groups[key] || []).push({
        label: l.name, action: () => setActiveLang(l.id)
      });
    }
    const out = [];
    Object.keys(groups).sort().forEach(g => {
      out.push({ label: g, sub: groups[g] });
    });
    out.push("-");
    out.push({ label: "XML", action: () => setActiveLang("xml") });
    out.push({ label: "YAML", action: () => setActiveLang("yaml") });
    out.push({ label: "TXT", action: () => setActiveLang("txt") });
    out.push({ label: "用户自定义语言…", action: () => cmd.openDefineLang() });
    return out;
  }

  function setActiveLang(langId) {
    const d = activeDoc();
    if (!d || d.kind !== "text") return;
    d.lang = langId;
    const ed = d.editor;
    if (ed) ed.langId = langId;
    if (ed) ed.scheduleRender();
    SN.emit("langchange", { id: d.id, lang: langId });
    refreshMenus();
  }

  function buildAllMenus() {
    const menus = [
      { label: "文件", items: [
        { label: "新建", accel: "Ctrl+T", action: () => cmd.new() },
        { label: "打开…", accel: "Ctrl+O", action: () => cmd.open("auto") },
        { label: "以文本模式打开…", action: () => cmd.open("text") },
        { label: "以二进制(Hex)打开…", action: () => cmd.open("hex") },
        "-",
        { label: "保存", accel: "Ctrl+S", action: () => cmd.save() },
        { label: "全部保存", action: () => cmd.saveAll() },
        { label: "另存为…", accel: "Ctrl+Shift+S", action: () => cmd.saveAs() },
        { label: "重命名…", action: () => cmd.renameActive() },
        "-",
        { label: "关闭标签", accel: "Ctrl+W", action: () => cmd.closeTab() },
        { label: "关闭其它", action: () => cmd.closeOthers() },
        { label: "关闭全部", action: () => cmd.closeAll() },
        "-",
        { label: "清空最近文件", action: () => { app.recent = []; persistRecent(); } },
        { label: "最近文件", sub: recentItems() },
        "-",
        { label: "退出(仅关闭本页标签集)", action: () => persistSession() }
      ]},
      { label: "编辑", items: [
        { label: "撤销", accel: "Ctrl+Z", action: () => edCmd("undo") },
        { label: "重做", accel: "Ctrl+Y", action: () => edCmd("redo") },
        "-",
        { label: "剪切", accel: "Ctrl+X", action: () => execNative("cut") },
        { label: "复制", accel: "Ctrl+C", action: () => execNative("copy") },
        { label: "粘贴", accel: "Ctrl+V", action: () => execNative("paste") },
        "-",
        { label: "全选", accel: "Ctrl+A", action: () => execNative("selectAll") },
        "-",
        { label: "跳转行…", accel: "Ctrl+G", action: () => dlg.gotoLine() },
        "-",
        { label: "换行符转换", sub: [
          { label: "转为 Windows(CR+LF)", action: () => cmd.eolConv("crlf") },
          { label: "转为 Unix(LF)", action: () => cmd.eolConv("lf") },
          { label: "转为 Mac(CR)", action: () => cmd.eolConv("cr") }
        ]},
        { label: "空白字符操作", sub: [
          { label: "移除行首空白", action: () => cmd.blankOp("head") },
          { label: "移除行尾空白", action: () => cmd.blankOp("end") },
          { label: "移除首尾空白", action: () => cmd.blankOp("both") },
          "-",
          { label: "TAB → 空格", action: () => cmd.tabOp("tab2space") },
          { label: "空格 → TAB(全部)", action: () => cmd.tabOp("space2tabAll") },
          { label: "空格 → TAB(行首)", action: () => cmd.tabOp("space2tabLead") }
        ]},
        { label: "大小写转换", sub: caseItems() },
        { label: "行编辑", sub: lineItems() },
        "-",
        { label: "列块编辑…", accel: "Alt+X", action: () => dlg.columnEdit() },
        { label: "列块模式(勾选进行多选)", checked: false, id: "colmode", disabled: true, tip: "浏览器多选区受限，请使用列块编辑对话框" }
      ]},
      { label: "查找", items: findMenuItems() },
      { label: "视图", items: viewItems() },
      { label: "编码", items: encItems() },
      { label: "语言", items: langMenuItems() },
      { label: "设置", items: [
        { label: "选项…", action: () => dlg.options() },
        { label: "主题与语法样式…", action: () => dlg.themeStyle() },
        { label: "自定义语言…", action: () => cmd.openDefineLang() },
        { label: "快捷键查看…", action: () => dlg.shortcuts() },
        "-",
        { label: "界面语言: 中文", checked: true },
        { label: "English(占位，未提供)", disabled: true, tip: "本演示版仅提供中文界面" }
      ]},
      { label: "工具", items: [
        { label: "XML 格式化", action: () => tool.format("xml") },
        { label: "JSON 格式化", action: () => tool.format("json") },
        { label: "MD5/SHA 计算…", action: () => tool.hash() },
        { label: "列块编辑…", action: () => dlg.columnEdit() },
        "-",
        { label: "批量转换编码(打开文档)", action: () => tool.batchEncode() },
        "-",
        { label: "统计选中行/字数", action: () => cmd.edStatus() }
      ]},
      { label: "插件", items: SN.pluginMenuItems() },
      { label: "关于", items: [{ label: "关于 StackNote", action: () => dlg.about() }] }
    ];
    buildMenu(menus);
  }

  function recentItems() {
    if (!app.recent.length) return [{ label: "(空)", disabled: true }];
    return app.recent.slice(0, 12).map((r, i) => ({
      label: (i < 9 ? i + 1 : 0) + ". " + r.name,
      action: () => cmd.openRecent(r)
    }));
  }
  function findMenuItems() {
    return [
      { label: "查找…", accel: "Ctrl+F", action: () => dlg.find("find") },
      { label: "替换…", accel: "Ctrl+H", action: () => dlg.find("replace") },
      { label: "查找下一个", accel: "F3", action: () => dlg.findNext() },
      { label: "查找上一个", accel: "F4", action: () => dlg.findPrev() },
      { label: "在打开的文档中查找…", accel: "Ctrl+Shift+F", action: () => dlg.find("opendocs") },
      "-",
      { label: "全部标记(Mark All)", action: () => cmd.markAll() },
      { label: "清除全部标记", action: () => cmd.clearMarksAll() },
      "-",
      { label: "书签", sub: bookMarkItems() },
      { label: "标记颜色", sub: markColorItems() },
      "-",
      { label: "查找结果面板", checked: !SN.$("#bottomDock").classList.contains("hidden"), action: () => cmd.toggleResultDock() },
      { label: "复制查找结果", action: () => cmd.copyResultDock() }
    ];
  }
  function viewItems() {
    const s = app.settings;
    return [
      { label: "自动换行", checked: s.wrap, action: () => cmd.toggleWrap() },
      { label: "显示空白", checked: s.showSpaces, action: () => cmd.toggleSpaces() },
      { label: "显示行尾", checked: s.showEol, action: () => cmd.toggleEol() },
      "-",
      { label: "高亮 Web 地址", checked: s.webAddrHighlight, action: () => cmd.toggleWeb() },
      { label: "文件列表窗口", checked: !SN.$("#fileDock").classList.contains("hidden"), action: () => cmd.toggleFileDock() },
      { label: "工具栏", checked: !SN.$("#toolbar").classList.contains("hidden"), action: () => cmd.toggleToolbar() }
    ];
  }
  function encItems() {
    return [
      { label: "以编码重新加载", sub: SN.CODES.filter(c => c.id !== "unknown").map(c => ({ label: c.name, action: () => cmd.reloadWith(c.id) })) },
      { label: "转换为编码", sub: SN.CODES.filter(c => c.id !== "unknown").map(c => ({ label: c.name, action: () => cmd.convertTo(c.id) })) },
      "-",
      { label: "批量转换编码…", action: () => tool.batchEncode() }
    ];
  }
  function caseItems() {
    const defs = [
      ["upper", "UPPERCASE"], ["lower", "lowercase"], ["proper", "Proper Case"],
      ["properB", "Proper Case(保留已大写)"], ["sentence", "Sentence case"], ["invert", "Invert Case"], ["random", "Random Case"]
    ];
    return defs.map(([id, l]) => ({ label: l, action: () => cmd.caseOp(id) }));
  }
  function lineItems() {
    return [
      { label: "复制当前行", accel: "Ctrl+D", action: () => cmd.lineOp("dup") },
      { label: "删除行(删除连续重复行)", action: () => cmd.lineOp("delDupConsec") },
      { label: "删除所有重复行", action: () => cmd.lineOp("delDupAll") },
      { label: "拆分长行", action: () => cmd.lineOp("split") },
      "-",
      { label: "上移当前行", action: () => cmd.lineOp("up") },
      { label: "下移当前行", action: () => cmd.lineOp("down") },
      "-",
      { label: "删除空行", action: () => cmd.lineOp("delEmpty") },
      { label: "删除空行(含纯空白行)", action: () => cmd.lineOp("delEmptyWs") },
      "-",
      { label: "反转行序", action: () => cmd.lineOp("reverse") },
      { label: "排序", sub: sortItems() }
    ];
  }
  function sortItems() {
    const ds = [
      ["lex_asc", "字典升序"], ["lex_desc", "字典降序"], ["lexci_asc", "忽略大小写升序"],
      ["lexci_desc", "忽略大小写降序"], ["num_asc", "数值升序"], ["num_desc", "数值降序"]
    ];
    return ds.map(([id, l]) => ({ label: l, action: () => cmd.sortOp(id) }));
  }
  function bookMarkItems() {
    return [
      { label: "设置/移除书签", accel: "Ctrl+F2", action: () => cmd.toggleBookmark() },
      { label: "下一个书签", accel: "F2", action: () => cmd.gotoBookmark(1) },
      { label: "上一个书签", accel: "Shift+F2", action: () => cmd.gotoBookmark(-1) },
      { label: "清除全部书签", action: () => cmd.clearBookmarks() }
    ];
  }
  function markColorItems() {
    return app.MARK_COLORS.map((c, i) => ({
      label: "颜色 " + (i + 1), swatch: c, checked: app.curMarkColor === c,
      stay: true, rebuild: true,
      action: () => {
        app.curMarkColor = c; app.settings.markColorIdx = i; saveSettings();
        const ed = SN.activeEditor();
        if (ed && ed.hasSelection() && ed.selectedText().trim() && SN.cmd.markSelected) {
          SN.cmd.markSelected();
        } else {
          // 大文件视图没有 Editor：用最近在视图内选中的文本标记（连续换色即重新高亮）
          const d = SN.activeDoc();
          if (d && d.kind === "big" && d.bigSelected && d.bigSelected() && SN.cmd.markSelected) {
            SN.cmd.markSelected();
          }
        }
      }
    }));
  }

  // ============ 工具栏 ============
  const TB = {
    new: { t: "新建(Ctrl+T)", g: "✚", a: () => cmd.new() },
    open: { t: "打开", g: "📂", a: () => cmd.open("auto") },
    save: { t: "保存", g: "💾", a: () => cmd.save() },
    saveall: { t: "全部保存", g: "💿", a: () => cmd.saveAll() },
    close: { t: "关闭", g: "✖", a: () => cmd.closeTab() },
    closeall: { t: "关闭全部", g: "🗑", a: () => cmd.closeAll() },
    sep1: "-",
    cut: { t: "剪切", g: "✂", a: () => execNative("cut") },
    copy: { t: "复制", g: "⧉", a: () => execNative("copy") },
    paste: { t: "粘贴", g: "📋", a: () => execNative("paste") },
    sep2: "-",
    undo: { t: "撤销", g: "↩", a: () => edCmd("undo") },
    redo: { t: "重做", g: "↪", a: () => edCmd("redo") },
    sep3: "-",
    find: { t: "查找", g: "🔍", a: () => dlg.find("find") },
    replace: { t: "替换", g: "🔁", a: () => dlg.find("replace") },
    mark: { t: "全部标记", g: "🖍", a: () => cmd.markAll() },
    clearmark: { t: "清除标记", g: "🧹", a: () => cmd.clearMarksAll() },
    sep4: "-",
    zoomin: { t: "放大", g: "＋", a: () => cmd.zoom(10) },
    zoomout: { t: "缩小", g: "－", a: () => cmd.zoom(-10) },
    sep5: "-",
    wrap: { t: "自动换行", g: "⇆", toggle: () => app.settings.wrap, a: () => cmd.toggleWrap() },
    blank: { t: "显示空白/制表符", g: "␣", toggle: () => app.settings.showSpaces, a: () => cmd.toggleSpaces() },
    tail: { t: "（tail/外部监控在纯前端不可用）", g: "⊚", disabled: true }
  };
  function buildToolbar() {
    toolbar.textContent = "";
    for (const key of Object.keys(TB)) {
      const def = TB[key];
      if (def === "-") { toolbar.appendChild(el("div", { class: "tbsep" })); continue; }
      const b = el("button", { class: "iconbt" + (def.toggle && def.toggle() ? " on" : ""), title: def.t, text: def.g });
      if (def.disabled) b.disabled = true;
      if (def.a) b.addEventListener("click", def.a);
      toolbar.appendChild(b);
    }
  }
  function refreshToolbar() {
    const map = { wrap: "wrap", blank: "blank" };
    SN.$$("#toolbar .iconbt").forEach(bt => {
      const key = bt.title && bt.title.length ? bt.title : "";
    });
  }

  // ============ 文档与标签 ============
  const tabstrip = SN.$("#tabstrip");
  const editorZone = SN.$("#editorZone");
  let newIndex = 0;
  app.newIdSeq = function () { return newIndex++; };

  function addDoc(doc) {
    app.docs.push(doc);
    buildPage(doc);
    appendTab(doc);
  }

  function makeTabNode(doc) {
    const tab = el("div", { class: "tab" + (doc.id === app.activeId ? " active" : "") });
    tab.dataset.id = doc.id;
    const title = el("span", { class: "ttitle", text: doc.name });
    const dirty = el("span", { class: "dirty" + (doc.dirty ? "" : " hidden"), text: "*" });
    const mode = doc.kind === "hex" ? "⛭" : doc.kind === "big" ? "≫" : doc.readOnly ? "🔒" : "";
    const x = el("span", { class: "tx", title: "关闭", text: "×" });
    tab.appendChild(dirty);
    tab.appendChild(title);
    if (mode) tab.appendChild(el("span", { text: mode }));
    tab.appendChild(x);
    tab.addEventListener("click", (e) => {
      if (e.target === x) { e.stopPropagation(); cmd.closeTab(doc.id); return; }
      activateDoc(doc.id);
    });
    x.addEventListener("click", (e) => { e.stopPropagation(); cmd.closeTab(doc.id); });
    tab.addEventListener("contextmenu", (e) => { e.preventDefault(); tabMenu(e, doc); });
    return tab;
  }

  function appendTab(doc) {
    tabstrip.appendChild(makeTabNode(doc));
    updateTabNodes();
  }
  function updateTabNodes() {
    SN.$$("#tabstrip .tab").forEach(n => {
      const d = docById(n.dataset.id);
      if (!d) return;
      n.classList.toggle("active", d.id === app.activeId);
      const star = n.querySelector(".dirty");
      if (star) star.classList.toggle("hidden", !d.dirty);
    });
  }

  function tabMenu(e, doc) {
    const html = [
      ["关闭当前文档", () => cmd.closeTab(doc.id)],
      ["关闭其它文档", () => cmd.closeOthers(doc.id)],
      ["关闭全部", () => cmd.closeAll()],
      "-",
      ["另存为…", () => cmd.saveAs(doc.id)],
      ["重命名…", () => cmd.renameDoc(doc.id)],
      ["以文本模式重载", () => reloadAs(doc.id, "text")],
      ["以二进制(Hex)重载", () => reloadAs(doc.id, "hex")],
      "-",
      ["打开所在目录(下载源文件)", () => downloadDoc(doc.id)]
    ];
    showCtx(e.clientX, e.clientY, html);
  }

  function buildPage(doc) {
    const page = el("div", { class: "page" + (doc.id === app.activeId ? " active" : "") });
    page.dataset.doc = doc.id;
    if (doc.kind === "hex") {
      page.appendChild(buildHexView(doc));
    } else if (doc.kind === "big") {
      if (SN.buildBigTextPage) page.appendChild(SN.buildBigTextPage(doc));
      else { page.appendChild(el("div", { text: "大文本视图不可用（bigtext.js 未加载）", class: "hint" })); }
    } else {
      const ed = new SN.Editor({
        readOnly: doc.readOnly || doc.kind === "big",
        wrap: app.settings.wrap,
        showSpaces: app.settings.showSpaces,
        showEol: app.settings.showEol,
        langId: doc.lang,
        onChange: (text, editor) => { onEditorChange(doc, text); },
        onStatus: (info) => onEditorStatus(doc, info),
        onWordDbl: (w) => { if (app.settings.wordDblHighlight) wordHighlight(w); },
        onActive: (ed) => activateDoc(doc.id)
      });
      ed.setText(doc.content || "");
      doc.editor = ed;
      page.appendChild(ed.wrapEl);
    }
    editorZone.appendChild(page);
    doc.pageEl = page;
  }

  function activateDoc(id, skipFocus) {
    const d = docById(id);
    if (!d) return;
    app.activeId = id;
    SN.$$("#editorZone .page").forEach(p => p.classList.toggle("active", p.dataset.doc === id));
    updateTabNodes();
    if (d.kind !== "hex" && d.editor && !skipFocus) d.editor.focus();
    refreshMenus();
    updateStatus();
    if (SN.updateFileList) SN.updateFileList();
    SN.emit("activate", { id });
  }

  function onEditorChange(doc, text) {
    doc.content = text;
    if (!doc.dirty) {
      doc.dirty = true;
      updateTabNodes();
      updateTitle();
      refreshToolbarState();
    }
    scheduleSaveSession();
  }
  function onEditorStatus(doc, info) {
    const d = activeDoc();
    if (d && d.id !== doc.id) return;
    const pos = SN.$("#posLabel");
    pos.textContent = info.selLen > 0
      ? `Ln:${info.line}  Col:${info.col}  已选 ${info.selLines} 行 / ${info.selLen} 字符`
      : `Ln:${info.line}  Col:${info.col}  共 ${info.total} 行 / ${info.chars} 字符`;
  }

  function refreshMenus() {
    buildAllMenus();
    buildToolbar();
    updateStatus();
  }
  function refreshToolbarState() {
    const bt = toolbar.querySelector("button[title='自动换行']");
    if (bt) bt.classList.toggle("on", !!app.settings.wrap);
    const b2 = toolbar.querySelector("button[title='显示空白/制表符']");
    if (b2) b2.classList.toggle("on", !!app.settings.showSpaces);
  }

  function updateTitle() {
    const d = activeDoc();
    const mode = d ? (d.kind === "hex" ? "HexReadOnly" : d.kind === "big" ? "BigTextRO" : d.readOnly ? "RO" : "") : "";
    document.title = (d ? (d.dirty ? "*" : "") + d.name + (mode ? " [" + mode + "]" : "") + " - " : "") + "StackNote";
  }

  function updateStatus() {
    const d = activeDoc();
    if (!d) return;
    const lang = SN.langById(d.lang);
    SN.$("#langLabel").textContent = (lang ? lang.name : "TXT").slice(0, 12).toUpperCase();
    SN.$("#codeLabel").textContent = SN.codeById(d.enc).name;
    const eol = SN.$("#eolSel");
    if (eol.value !== d.eol) eol.value = d.eol;
    updateTitle();
  }

  // ============ 命令集（含占位由 app2 补全） ============
  const cmd = {};
  SN.cmd = cmd;
  const dlg = {};
  SN.dlg = dlg;
  const tool = {};
  SN.tool = tool;

  // ---- 打开 / 保存 / 新建 / 关闭 ----
  function supportedOpen() {
    return !!(window.showOpenFilePicker || document.createElement("input").webkitdirectory !== undefined || true);
  }

  cmd.open = function (mode) {
    app.pendingOpenMode = mode || "auto";
    SN.$("#fileInput").value = "";
    SN.$("#fileInput").click();
  };
  cmd.new = function () {
    const d = makeNewDoc();
    addDoc(d);
    activateDoc(d.id);
    setMsg("新建 " + d.name);
  };
  function makeNewDoc() {
    let n = newIndex++;
    return {
      id: SN.uid(), name: "New" + n, path: "", kind: "text",
      content: "", enc: "utf8", eol: "lf", lang: "txt",
      dirty: false, readOnly: false, newFile: true
    };
  }

  cmd.openRecent = function (r) {
    if (r.handle) {
      reopenHandle(r.handle).catch(() => toast("无法重新打开：" + r.name + "（请通过 打开… 选择文件）"));
    } else {
      toast("浏览器无法直接按路径打开本地文件，请手动选择 " + r.name);
    }
  };

  async function reopenHandle(handle) {
    if (!handle) return;
    if (handle.queryPermission && (await handle.queryPermission({ mode: "read" })) !== "granted") {
      if (handle.requestPermission && (await handle.requestPermission({ mode: "read" })) !== "granted") {
        throw new Error("denied");
      }
    }
    const file = await handle.getFile();
    await importFile(file, "auto", handle);
  }

  async function handleOpenFiles(files) {
    for (const f of Array.from(files)) await importFile(f, app.pendingOpenMode);
    app.pendingOpenMode = "auto";
  }

  async function importFile(file, mode, handle) {
    try {
      const bytes = await SN.readAsBytes(file);
      const size = file.size;
      const det = SN.detectEncode(bytes);
      const hasNul = bytes.slice(0, Math.min(bytes.length, 4096)).some(b => b === 0);
      const bigLimit = Math.max(2, app.settings.bigThresholdMB || 2) * 1024 * 1024;
      const isBig = size > bigLimit;
      let kind = "text";
      if (mode === "hex") kind = "hex";
      else if (mode === "text") kind = "text";               // 用户强制以文本编辑打开
      else if (isBig && !hasNul) kind = "big";               // 自动：大文本 -> 虚拟只读
      else if (hasNul && det.id !== "utf16le" && det.id !== "utf16be") kind = "hex";
      else if (isBig && (det.id === "utf16le" || det.id === "utf16be")) kind = "big";
      console.info("[open]", file.name, "size="+size, "limit="+bigLimit, "mode="+mode, "kind="+kind, "hasNul="+hasNul, "enc="+det.id);

      const d = {
        id: SN.uid(),
        name: file.name,
        path: file.name,
        kind,
        enc: kind === "hex" ? "utf8" : det.id,
        eol: "lf",
        lang: SN.detectLangByName(file.name),
        dirty: false,
        readOnly: kind === "big",
        handle: handle || null,
        size,
        // 仅保留必要原始字节：hex/大文本必须；普通文本只在小文件时保留（用于“按编码重载”）
        raw: kind === "hex" || kind === "big" ? bytes : (size <= 2 * 1024 * 1024 ? bytes : null)
      };
      if (kind === "hex") {
        d.content = "";
      } else {
        if (kind === "big") {
          // 只解码头部一小段做行尾判定，避免整篇解码造成内存翻倍
          const head = bytes.slice(0, Math.min(bytes.length, 512 * 1024));
          d.eol = SN.detectEol(SN.decodeBytes(head, d.enc));
          d.content = "";
        } else {
          let text = SN.decodeBytes(bytes, d.enc);
          d.eol = SN.detectEol(text);
          d.content = SN.normalizeEol(text, "lf");
        }
      }
      addDoc(d);
      activateDoc(d.id);
      if (handle) pushRecent({ name: d.name, handle });
      else pushRecent({ name: d.name });
      setMsg("已打开 " + d.name + "（" + SN.fmtSize(size) + "，" + SN.codeById(d.enc).name +
        (kind === "big" ? "，大文本只读/虚拟滚动模式" : "") + "）");
      scheduleSaveSession();
    } catch (err) {
      toast("打开失败：" + (err && err.message ? err.message : err));
    }
  }

  function pushRecent(r) {
    app.recent = [r].concat(app.recent.filter(x => x.name !== r.name)).slice(0, 30);
    persistRecent();
  }
  function persistRecent() {
    // FileSystemHandle 可结构化克隆，存入 IDB
    SN.store.kvSet("recent", app.recent.filter(r => r.handle || r.name));
  }
  function loadRecent() {
    return SN.store.kvGet("recent", []).then(list => { app.recent = list || []; });
  }

  cmd.save = async function (id) {
    const d = id ? docById(id) : activeDoc();
    if (!d) return;
    if (d.kind !== "text") { toast(d.kind === "hex" ? "Hex 只读视图不能保存" : "大文本只读视图不能保存（请切换为文本编辑）"); return; }
    if (d.newFile || !d.handle) { return cmd.saveAs(d.id); }
    try {
      const bytes = encodeDocContent(d);
      if (d.handle.createWritable) {
        const w = await d.handle.createWritable();
        await w.write(bytes);
        await w.close();
        d.dirty = false;
        toast("已保存 " + d.name);
      } else {
        return cmd.saveAs(d.id);
      }
    } catch (e) {
      toast("保存失败：" + (e.message || e));
      return cmd.saveAs(d.id);
    }
    updateTabNodes();
    scheduleSaveSession();
  };
  cmd.saveAll = async function () {
    for (const d of app.docs) {
      if (d.dirty || d.newFile) await cmd.save(d.id);
    }
  };
  cmd.saveAs = async function (id) {
    const d = id ? docById(id) : activeDoc();
    if (!d) return;
    if (d.kind !== "text") { toast("只读视图不支持另存为；可用标签右键菜单导出原始文件"); return; }
    let bytes;
    try { bytes = encodeDocContent(d); }
    catch (err) {
      if (!confirm(err.message + "\n是否以 UTF-8 保存？")) return;
      d.enc = "utf8";
      bytes = SN.encodeText(d.content || "", "utf8");
    }
    const name = (d.name || "untitled") + (d.name.includes(".") ? "" : extForLang(d.lang));
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName: name });
        const w = await h.createWritable();
        await w.write(bytes);
        await w.close();
        d.handle = h;
        d.path = h.name;
        if (d.newFile) { d.newFile = false; }
        d.name = h.name;
        d.dirty = false;
        pushRecent({ name: d.name, handle: h });
        toast("已另存为 " + d.name);
        updateTabNodes();
        scheduleSaveSession();
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    SN.download(name, new Blob([bytes]));
    if (!d.handle && !d.newFile) {
      // 没有 FS 句柄时下载即为保存
      d.dirty = false;
      updateTabNodes();
    }
    toast("已下载 " + name);
  };
  function encodeDocContent(d) {
    const text = SN.normalizeEol(d.content || "", d.eol);
    return SN.encodeText(text, d.enc);
  }
  function extForLang(lang) {
    const l = SN.langById(lang);
    return (l.ext && l.ext[0]) ? "." + l.ext[0] : ".txt";
  }
  function downloadDoc(id) {
    const d = docById(id);
    if (!d) return;
    if (d.kind === "hex") { SN.download(d.name + ".hex", new Blob([d.raw])); return; }
    if (d.kind === "big") { if (d.raw) SN.download(d.name, new Blob([d.raw])); else toast("未保留原始字节"); return; }
    cmd.saveAs(id);
  }

  cmd.closeTab = async function (id) {
    const d = id ? docById(id) : activeDoc();
    if (!d) return;
    if (d.dirty && !d.newFile) {
      const r = confirm("文档 " + d.name + " 已修改，是否保存？\n确定=保存，取消=放弃");
      if (r === null) return;
      if (r) { const ok = await cmd.save(d.id); if (ok === false) return; }
    }
    removeDoc(d);
  };
  cmd.closeOthers = function (id) {
    const keep = id || app.activeId;
    for (const d of app.docs.slice()) if (d.id !== keep) cmd.closeTab(d.id);
  };
  cmd.closeAll = function () {
    for (const d of app.docs.slice()) cmd.closeTab(d.id);
    if (!app.docs.length) cmd.new();
  };
  function removeDoc(d) {
    const idx = app.docs.indexOf(d);
    app.docs.splice(idx, 1);
    if (d.editor) { SN.store.docDel(d.id); }
    const tab = tabstrip.querySelector('.tab[data-id="' + d.id + '"]');
    if (tab) tab.remove();
    if (d.pageEl) d.pageEl.remove();
    if (app.activeId === d.id) {
      const next = app.docs[Math.min(idx, app.docs.length - 1)];
      if (next) activateDoc(next.id);
      else cmd.new();
    }
    scheduleSaveSession();
  }

  cmd.renameActive = function () { dlg.rename(activeDoc()); };
  cmd.renameDoc = function (id) { dlg.rename(docById(id)); };

  // ============ 会话恢复 ============
  let sessionTimer = null;
  function scheduleSaveSession() {
    if (!app.settings.restoreSession) return;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => persistSession(), 1500);
  }
  function persistSession() {
    SN.store.saveSession({ docs: app.docs, activeId: app.activeId }).then(() => SN.store.docPut("_meta", { activeId: app.activeId }));
  }
  async function restoreSession() {
    const s = await SN.store.loadSession();
    if (!s || !s.docs.length) return false;
    let any = false;
    for (const m of s.docs) {
      // Hex / 大文本只读会话不保存正文，跳过恢复；老会话里的大文件副本也跳过
      if (m.kind === "hex" || m.kind === "big" || m.tooBig || (m.size && m.size > 8 * 1024 * 1024)) continue;
      const d = {
        id: m.id || SN.uid(), name: m.name || "恢复", path: m.path || "", kind: "text",
        enc: m.enc || "utf8", eol: m.eol || "lf", lang: m.lang || SN.detectLangByName(m.name) || "txt",
        dirty: !!m.dirty, content: m.content || "", readOnly: m.kind === "big" || false
      };
      addDoc(d);
      any = true;
    }
    const meta = await SN.store.docGet("_meta");
    const first = app.docs[0];
    if (first) activateDoc((meta && meta.activeId && docById(meta.activeId)) ? meta.activeId : first.id, true);
    return any;
  }

  // ============ 全局快捷键 ============
  function bindShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("#modalHost")) {
        if (e.key === "Escape") closeModal();
        return;
      }
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      if (mod && k === "o") { e.preventDefault(); cmd.open("auto"); return; }
      if (mod && k === "t") { e.preventDefault(); cmd.new(); return; }
      if (mod && k === "s") { e.preventDefault(); shift ? cmd.saveAs() : cmd.save(); return; }
      if (mod && k === "w") { e.preventDefault(); cmd.closeTab(); return; }
      if (mod && k === "f") { e.preventDefault(); dlg.find("find"); return; }
      if (mod && k === "h") { e.preventDefault(); dlg.find("replace"); return; }
      if (mod && k === "g") { e.preventDefault(); dlg.gotoLine(); return; }
      if (mod && k === "z") { /* 编辑器内处理 */ }
      if (k === "f3") { e.preventDefault(); dlg.findNext(); return; }
      if (k === "f4") { e.preventDefault(); dlg.findPrev(); return; }
      if (e.key === "F2") { e.preventDefault(); gotoBookmark(e.shiftKey ? -1 : 1); return; }
      if (e.ctrlKey && e.key === "F2") { e.preventDefault(); toggleBookmark(); return; }
    });
  }

  // ============ 对话框 ============
  let modal = null;
  function openModal(opts) {
    closeModal();
    const host = SN.$("#modalHost");
    host.classList.add("show");
    const mask = el("div", { class: "mask" });
    const dlgEl = el("div", { class: "dialog" });
    if (opts.width) dlgEl.style.width = opts.width;
    const head = el("div", { class: "dhead" });
    head.appendChild(el("span", { text: opts.title || "" }));
    const cx = el("button", { text: "×", title: "关闭" });
    cx.addEventListener("click", closeModal);
    head.appendChild(cx);
    const body = el("div", { class: "dbody" });
    dlgEl.appendChild(head);
    dlgEl.appendChild(body);
    const foot = el("div", { class: "dfoot" });
    if (opts.buttons) {
      for (const b of opts.buttons) {
        const bn = el("button", { text: b.label });
        if (b.primary) bn.style.background = "var(--accent)";
        bn.addEventListener("click", () => { const r = b.action(); if (r !== false) closeModal(); });
        foot.appendChild(bn);
      }
    }
    dlgEl.appendChild(foot);
    mask.appendChild(dlgEl);
    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(); });
    host.appendChild(mask);
    modal = { mask, body, el: dlgEl, host };
    if (opts.onOpen) opts.onOpen(body);
    return modal;
  }
  function closeModal() {
    if (modal) {
      modal.host.classList.remove("show");
      modal.mask.remove();
      modal = null;
    }
  }
  window.closeModal = closeModal;

  function showCtx(x, y, items) {
    const c = SN.$("#ctxmenu");
    c.textContent = "";
    c.classList.remove("hidden");
    for (const it of items) {
      if (it === "-") { c.appendChild(el("div", { class: "mi sep" })); continue; }
      const mi = el("div", { class: "mi", text: it[0] });
      mi.addEventListener("click", () => { c.classList.add("hidden"); it[1](); });
      c.appendChild(mi);
    }
    const w = c.offsetWidth, h = c.offsetHeight;
    c.style.left = Math.min(x, window.innerWidth - w - 4) + "px";
    c.style.top = Math.min(y, window.innerHeight - h - 4) + "px";
    document.addEventListener("click", hideCtx, { once: true });
  }
  function hideCtx() { SN.$("#ctxmenu").classList.add("hidden"); }

  // ============ 简单的编辑命令入口（具体由 app2 补全） ============
  function edCmd(name) {
    const ed = activeEditor();
    if (!ed) return;
    if (name === "undo") ed.undo();
    else if (name === "redo") ed.redo();
  }
  function execNative(cmdName) {
    const ed = activeEditor();
    if (!ed) { return; }
    ed.ta.focus();
    document.execCommand(cmdName);
    if (cmdName === "cut" || cmdName === "paste") {
      setTimeout(() => {
        if (ed.onChange) ed.onChange(ed.text, ed);
      }, 0);
    }
  }

  // 文件/编辑子命令占位，app2 覆盖
  const placeholders = ["eolConv", "blankOp", "tabOp", "caseOp", "lineOp", "sortOp", "edStatus",
    "toggleWrap", "toggleSpaces", "toggleEol", "toggleWeb", "toggleFileDock", "toggleToolbar",
    "toggleResultDock", "isDockVisible", "copyResultDock", "reloadWith", "convertTo", "reloadAs",
    "markAll", "clearMarksAll", "wordHighlight", "toggleBookmark", "gotoBookmark", "clearBookmarks",
    "openDefineLang", "zoom", "setStatusbar", "refreshStatus", "showHexBytes"];
  placeholders.forEach(n => { if (cmd[n] === undefined) cmd[n] = () => toast("该功能在演示版暂不可用：" + n); });

  // ============ Boot ============
  app.boot = async function () {
    const saved = await SN.store.kvGet("settings", null);
    app.settings = Object.assign({}, SETTINGS_DEFAULT, saved || {});
    // 旧版本默认值 100MB 会绕过大文本虚拟视图，自动修正为新默认 2MB
    if (app.settings.bigThresholdMB === 100) app.settings.bigThresholdMB = 2;
    app.curMarkColor = app.MARK_COLORS[app.settings.markColorIdx || 0] || app.MARK_COLORS[0];
    SN.applyAppSkin(app.settings.appSkin);
    SN.applyEditorTheme(app.settings.editorTheme);
    loadUserSettings();

    SN.$("#eolSel").addEventListener("change", (e) => {
      const d = activeDoc();
      if (d && d.kind === "text") { d.eol = e.target.value; docContentTouched(d); setMsg("行尾格式将保存为 " + d.eol.toUpperCase()); }
    });
    SN.$("#fileInput").addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length) handleOpenFiles(e.target.files);
      e.target.value = "";
    });
    SN.$("#fileInput").addEventListener("cancel", () => { app.pendingOpenMode = "auto"; });
    document.addEventListener("dragover", (e) => { e.preventDefault(); });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleOpenFiles(e.dataTransfer.files);
      }
    });
    SN.$("#newTabBt").addEventListener("click", () => cmd.new());
    wireDockSplit();
    SN.$("#fileDock .dockclean").addEventListener("click", () => cmd.toggleFileDock(true));
    SN.$("#bottomDock .dockclean").addEventListener("click", () => cmd.toggleResultDock(true));
    SN.$$("#fileList").forEach(f => f.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (li && li.dataset.id) activateDoc(li.dataset.id);
    }));

    buildAllMenus();
    buildToolbar();
    bindShortcuts();
    await loadRecent();
    applySettingsVisual();

    let restored = false;
    if (app.settings.restoreSession) restored = await restoreSession();
    if (!restored || !app.docs.length) cmd.new();
    else activateDoc(app.activeId && docById(app.activeId) ? app.activeId : app.docs[0].id, true);
    refreshToolbarState();
    SN.emit("booted");
  };

  // 底部结果栏：拖动分隔条调节高度，并记住尺寸
  function wireDockSplit() {
    const split = SN.$("#dockSplit");
    const dock = SN.$("#bottomDock");
    if (!split || !dock) return;
    SN.store.kvGet("resultdockH", 170).then(h => {
      if (h && h >= 90 && dock && !dock.classList.contains("hidden")) dock.style.height = h + "px";
    }).catch(() => {});
    let dragging = false;
    split.addEventListener("pointerdown", (e) => {
      dragging = true;
      split.classList.add("dragging");
      split.setPointerCapture && split.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    const move = (e) => {
      if (!dragging) return;
      const col = SN.$("#editorCol").getBoundingClientRect();
      const h = Math.max(90, Math.min(window.innerHeight - 200, col.bottom - e.clientY - 4));
      dock.style.height = h + "px";
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      split.classList.remove("dragging");
      const h = parseInt(dock.style.height, 10) || 170;
      SN.store.kvSet("resultdockH", h);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }

  // ---- 设置相关（app2 使用） ----
  function saveSettings() {
    SN.store.kvSet("settings", app.settings);
  }
  function loadUserSettings() {
    (app.settings.userlangs || []).forEach(u => {
      SN.registerUserLang({ id: u.id, name: u.name, ext: (u.ext || "").split(/[\s,]+/).filter(Boolean), kw: u.kw || "", line: u.line || "//" });
    });
  }
  function applySettingsVisual() {
    const s = app.settings;
    SN.$$(".ed-input, .ed-hl, .ed-glines").forEach(e2 => { });
  }

  SN.docById = docById;
  SN.activeDoc = activeDoc;
  SN.activeEditor = activeEditor;
  SN.activateDoc = activateDoc;
  SN.setMsg = setMsg;
  SN.openModal = openModal;
  SN.closeModal = closeModal;
  SN.showCtx = showCtx;
  SN.addDoc = addDoc;
  SN.openModal = openModal;
  SN.refreshMenus = refreshMenus;
  SN.saveSettings = saveSettings;
  SN.encodeDocContent = encodeDocContent;
  SN.extForLang = extForLang;
  SN.docContentTouched = function (d) {
    if (!d.dirty) { d.dirty = true; updateTabNodes(); updateTitle(); }
    scheduleSaveSession();
  };
})();
