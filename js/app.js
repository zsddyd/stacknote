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

  // 顶栏下拉的子菜单/渲染器统一由 js/menu.js 提供（右键菜单共用同一套，不再各写一份）
  function menuCtx() {
    return {
      doc: activeDoc(),
      onClose: closeMenus,
      onRebuild: () => SN.menu.rebuildSub(),
      // palette 项（标记颜色）的来源：颜色列表由本文件提供（app.MARK_COLORS）
      paletteSource: () => markColorItems
    };
  }
  function closeNestedPop() { SN.menu.closeSub(); }
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

  // 下拉/弹层的内容渲染统一走 SN.menu.renderInto（js/menu.js）：
  // 快捷键提示、能力置灰与 tooltip、子菜单、勾选/色块都只有一处实现，右键菜单复用同一份
  function fillDrop(dd, items) {
    SN.menu.renderInto(dd, items, menuCtx());
  }

  // ============ 菜单模型 ============
  function langMenuItems() {
    const groups = {};
    const list = SN.langList();
    for (const l of list) {
      if (l.id === "txt") continue;
      const key = l.name[0] ? l.name[0].toUpperCase() : "?";
      (groups[key] = groups[key] || []).push({
        label: l.name, requires: "lang", action: () => setActiveLang(l.id)
      });
    }
    const out = [];
    Object.keys(groups).sort().forEach(g => {
      out.push({ label: g, sub: groups[g] });
    });
    out.push("-");
    out.push({ label: "XML", requires: "lang", action: () => setActiveLang("xml") });
    out.push({ label: "YAML", requires: "lang", action: () => setActiveLang("yaml") });
    out.push({ label: "TXT", requires: "lang", action: () => setActiveLang("txt") });
    out.push({ label: "用户自定义语言…", action: () => cmd.openDefineLang() });
    return out;
  }

  function setActiveLang(langId) {
    const d = activeDoc();
    if (!d) return;
    if (!SN.caps.can("lang", d)) { setMsg(SN.caps.reason("lang", d)); return; }
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
        { label: "新建", sc: "file.new" },
        // 视图由内容自动识别（见 decideKind）：大文本 → 只读虚拟滚动、二进制 → Hex 只读、其余 → 文本编辑。
        // 需要强制某个视图时，打开后在标签/文件列表上右键「重新打开为 …」，入口只留这一个。
        { label: "打开…", sc: "file.open", tip: "自动识别视图：按大小、编码与 NUL 字节判定 文本编辑 / 大文本只读 / 二进制(Hex) 只读" },
        "-",
        { label: "保存", sc: "file.save", requires: "save" },
        { label: "全部保存", requires: "save", action: () => cmd.saveAll() },
        { label: "另存为…", sc: "file.saveAs", requires: "save" },
        { label: "重命名…", action: () => cmd.renameActive() },
        "-",
        { label: "关闭标签", sc: "file.closeTab" },
        { label: "关闭其它", action: () => cmd.closeOthers() },
        { label: "关闭全部", action: () => cmd.closeAll() },
        "-",
        { label: "清空最近文件", action: () => { app.recent = []; persistRecent(); } },
        { label: "最近文件", sub: recentItems() },
        "-",
        { label: "退出(仅关闭本页标签集)", action: () => persistSession() }
      ]},
      { label: "编辑", items: [
        { label: "撤销", sc: "edit.undo", requires: "undo" },
        { label: "重做", sc: "edit.redo", requires: "undo" },
        "-",
        { label: "剪切", sc: "edit.cut", requires: "clipboard", action: () => execNative("cut") },
        { label: "复制", sc: "edit.copy", requires: "clipboard", action: () => execNative("copy") },
        { label: "粘贴", sc: "edit.paste", requires: "clipboard", action: () => execNative("paste") },
        "-",
        { label: "全选", sc: "edit.selectAll", requires: "clipboard", action: () => execNative("selectAll") },
        "-",
        { label: "跳转行…", sc: "edit.goto" },
        "-",
        { label: "换行符转换", sub: [
          { label: "转为 Windows(CR+LF)", requires: "edit", action: () => cmd.eolConv("crlf") },
          { label: "转为 Unix(LF)", requires: "edit", action: () => cmd.eolConv("lf") },
          { label: "转为 Mac(CR)", requires: "edit", action: () => cmd.eolConv("cr") }
        ]},
        { label: "空白字符操作", sub: [
          { label: "移除行首空白", requires: "edit", action: () => cmd.blankOp("head") },
          { label: "移除行尾空白", requires: "edit", action: () => cmd.blankOp("end") },
          { label: "移除首尾空白", requires: "edit", action: () => cmd.blankOp("both") },
          "-",
          { label: "TAB → 空格", requires: "edit", action: () => cmd.tabOp("tab2space") },
          { label: "空格 → TAB(全部)", requires: "edit", action: () => cmd.tabOp("space2tabAll") },
          { label: "空格 → TAB(行首)", requires: "edit", action: () => cmd.tabOp("space2tabLead") }
        ]},
        { label: "大小写转换", sub: caseItems() },
        { label: "行编辑", sub: lineItems() },
        "-",
        { label: "列块编辑…", sc: "edit.columnEdit", requires: "columnEdit" },
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
        { label: "XML 格式化", requires: "format", action: () => tool.format("xml") },
        { label: "JSON 格式化", requires: "format", action: () => tool.format("json") },
        { label: "MD5/SHA 计算…", action: () => tool.hash() },
        { label: "列块编辑…", requires: "columnEdit", action: () => dlg.columnEdit() },
        "-",
        { label: "批量转换编码(打开文档)", action: () => tool.batchEncode() },
        "-",
        { label: "统计选中行/字数", requires: "statusPos", action: () => cmd.edStatus() }
      ]},
      { label: "插件", items: SN.pluginMenuItems().map(it => (it && it.action ? Object.assign({ requires: "plugin" }, it) : it)) },
      { label: "关于", items: [
        { label: "关于 StackNote", action: () => dlg.about() },
        { label: "视图能力表…", action: () => dlg.caps() }
      ] }
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
      { label: "查找…", sc: "find.open" },
      { label: "查找下一个", sc: "find.next", requires: "findStep" },
      { label: "查找上一个", sc: "find.prev", requires: "findStep" },
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
      { label: "自动换行", checked: s.wrap, requires: "view", action: () => cmd.toggleWrap() },
      { label: "显示空白", checked: s.showSpaces, requires: "view", action: () => cmd.toggleSpaces() },
      { label: "显示行尾", checked: s.showEol, requires: "view", action: () => cmd.toggleEol() },
      "-",
      { label: "高亮 Web 地址", checked: s.webAddrHighlight, requires: "view", action: () => cmd.toggleWeb() },
      { label: "文件列表窗口", checked: !SN.$("#fileDock").classList.contains("hidden"), action: () => cmd.toggleFileDock() },
      { label: "工具栏", checked: !SN.$("#toolbar").classList.contains("hidden"), action: () => cmd.toggleToolbar() }
    ];
  }
  function encItems() {
    return [
      { label: "以编码重新加载", sub: SN.CODES.filter(c => c.id !== "unknown").map(c => ({ label: c.name, requires: "encoding", action: () => cmd.reloadWith(c.id) })) },
      { label: "转换为编码", sub: SN.CODES.filter(c => c.id !== "unknown").map(c => ({ label: c.name, requires: "encoding", action: () => cmd.convertTo(c.id) })) },
      "-",
      { label: "批量转换编码…", action: () => tool.batchEncode() }
    ];
  }
  function caseItems() {
    const defs = [
      ["upper", "UPPERCASE"], ["lower", "lowercase"], ["proper", "Proper Case"],
      ["properB", "Proper Case(保留已大写)"], ["sentence", "Sentence case"], ["invert", "Invert Case"], ["random", "Random Case"]
    ];
    return defs.map(([id, l]) => ({ label: l, requires: "edit", action: () => cmd.caseOp(id) }));
  }
  function lineItems() {
    return [
      { label: "复制当前行", sc: "line.dup", requires: "edit" },
      { label: "删除行(删除连续重复行)", requires: "edit", action: () => cmd.lineOp("delDupConsec") },
      { label: "删除所有重复行", requires: "edit", action: () => cmd.lineOp("delDupAll") },
      { label: "拆分长行", requires: "edit", action: () => cmd.lineOp("split") },
      "-",
      { label: "上移当前行", requires: "edit", action: () => cmd.lineOp("up") },
      { label: "下移当前行", requires: "edit", action: () => cmd.lineOp("down") },
      "-",
      { label: "删除空行", requires: "edit", action: () => cmd.lineOp("delEmpty") },
      { label: "删除空行(含纯空白行)", requires: "edit", action: () => cmd.lineOp("delEmptyWs") },
      "-",
      { label: "反转行序", requires: "edit", action: () => cmd.lineOp("reverse") },
      { label: "排序", sub: sortItems() }
    ];
  }
  function sortItems() {
    const ds = [
      ["lex_asc", "字典升序"], ["lex_desc", "字典降序"], ["lexci_asc", "忽略大小写升序"],
      ["lexci_desc", "忽略大小写降序"], ["num_asc", "数值升序"], ["num_desc", "数值降序"]
    ];
    return ds.map(([id, l]) => ({ label: l, requires: "edit", action: () => cmd.sortOp(id) }));
  }
  function bookMarkItems() {
    return [
      { label: "设置/移除书签", sc: "bookmark.toggle", requires: "bookmark" },
      { label: "下一个书签", sc: "bookmark.next", requires: "bookmark" },
      { label: "上一个书签", sc: "bookmark.prev", requires: "bookmark" },
      { label: "清除全部书签", requires: "bookmark", action: () => cmd.clearBookmarks() }
    ];
  }
  // sel（可选）：右键菜单在打开那一刻捕获的选区 {start,end}。
  // 菜单会抢焦点、部分浏览器右键还会折叠光标，届时「当前选区」已空 ——
  // 所以先把这段选区还原回编辑器，再走与顶栏/工具栏完全一致的高亮路径。
  function markColorItems(sel) {
    return app.MARK_COLORS.map((c, i) => ({
      label: "颜色 " + (i + 1), swatch: c, checked: app.curMarkColor === c,
      stay: true, rebuild: true,
      action: () => {
        app.curMarkColor = c; app.settings.markColorIdx = i; saveSettings();
        const d = SN.activeDoc();
        // 右键菜单：把打开菜单时的选区还给编辑器（只移动选区，不重写文本，O(1)）
        if (sel && d && d.editor) {
          try { d.editor.ta.focus(); d.editor.ta.setSelectionRange(sel.start, sel.end); } catch (e) { /* ignore */ }
        }
        // 有可标记内容就标记；没有则明确说一句，避免「点了没反应」
        const kw = d ? SN.views.of(d).selectionKeyword(d) : "";
        if (kw && SN.cmd.markSelected) { SN.cmd.markSelected(); return; }
        setMsg("标记颜色：请先选中要高亮的内容（双击选词，或拖选一段）");
      }
    }));
  }

  // ============ 工具栏 ============
  const TB = {
    new: { t: "新建(Ctrl+T)", g: "📄", a: () => cmd.new() },
    open: { t: "打开", g: "📂", a: () => cmd.open("auto") },
    save: { t: "保存", g: "💾", requires: "save", a: () => cmd.save() },
    saveall: { t: "全部保存", g: "💿", requires: "save", a: () => cmd.saveAll() },
    close: { t: "关闭", g: "❌", a: () => cmd.closeTab() },
    closeall: { t: "关闭全部", g: "🗑", a: () => cmd.closeAll() },
    sep1: "-",
    cut: { t: "剪切", g: "✂️", requires: "clipboard", a: () => execNative("cut") },
    copy: { t: "复制", g: "📑", requires: "clipboard", a: () => execNative("copy") },
    paste: { t: "粘贴", g: "📋", requires: "clipboard", a: () => execNative("paste") },
    sep2: "-",
    undo: { t: "撤销", g: "↺", requires: "undo", a: () => edCmd("undo") },
    redo: { t: "重做", g: "↻", requires: "undo", a: () => edCmd("redo") },
    sep3: "-",
    find: { t: "查找", g: "🔍", a: () => dlg.find({ scope: "doc" }) },
    mark: { t: "全部标记", g: "🖍️", a: () => cmd.markAll() },
    clearmark: { t: "清除标记", g: "🧹", a: () => cmd.clearMarksAll() },
    sep4: "-",
    zoomin: { t: "放大", g: "➕", requires: "zoom", a: () => cmd.zoom(10) },
    zoomout: { t: "缩小", g: "➖", requires: "zoom", a: () => cmd.zoom(-10) },
    sep5: "-",
    wrap: { t: "自动换行", g: "⇆", requires: "view", toggle: () => app.settings.wrap, a: () => cmd.toggleWrap() },
    blank: { t: "显示空白/制表符", g: "␣", requires: "view", toggle: () => app.settings.showSpaces, a: () => cmd.toggleSpaces() }
  };
  function buildToolbar() {
    toolbar.textContent = "";
    for (const key of Object.keys(TB)) {
      const def = TB[key];
      if (def === "-") { toolbar.appendChild(el("div", { class: "tbsep" })); continue; }
      // 同菜单：当前视图不具备所需能力时置灰并说明原因（不接点击，tooltip 仍可见）
      const why = def.requires && SN.caps ? SN.caps.reason(def.requires, activeDoc()) : "";
      // 图标：优先用内联 SVG（js/iconui.js，Tabler 字形，跟随主题色），模块缺失时退回原来的 emoji 字形
      const svg = SN.uiIcons ? SN.uiIcons.get(key) : "";
      const b = el("button", {
        class: "iconbt" + (def.toggle && def.toggle() ? " on" : "") + (why ? " disabled" : ""),
        // 置灰原因跟在标题后：用全角冒号，不用破折号（破折号是 AI 味最重的排版习惯之一）
        title: why ? (def.t + "：" + why) : def.t,
        html: svg || null,
        text: svg ? null : def.g
      });
      if (why) b.setAttribute("aria-disabled", "true");
      if (def.disabled) b.disabled = true;
      if (def.a && !why) b.addEventListener("click", def.a);
      toolbar.appendChild(b);
    }
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
    // 标签上的模式标记由视图适配器提供（Hex ⛭ / 大文本 ≫ / 只读文本 🔒）；
    // 带上 class 是为了「重新打开为 …」换了视图后能就地刷新（见 updateTabTags）
    const mode = SN.views.of(doc).tabTag || (doc.readOnly ? "🔒" : "");
    const x = el("span", { class: "tx", title: "关闭", text: "×" });
    tab.appendChild(dirty);
    tab.appendChild(title);
    // 标记 span 始终创建（空时隐藏）：否则「重新打开为 …」切到只读视图时没有可更新的节点，
    // 标签会一直不带视图标记（updateTabTags 只能改已有节点）
    tab.appendChild(el("span", { class: "tmod" + (mode ? "" : " hidden"), text: mode }));
    tab.appendChild(x);
    tab.addEventListener("click", (e) => {
      if (e.target === x) { e.stopPropagation(); cmd.closeTab(doc.id); return; }
      activateDoc(doc.id);
    });
    x.addEventListener("click", (e) => { e.stopPropagation(); cmd.closeTab(doc.id); });
    // 标签右键由 #tabstrip 上的统一委托处理（见「右键菜单」段），这里不再逐项挂监听
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
  // 视图变了（重新打开为 …）之后刷新标签上的模式标记，别让标签继续显示旧视图
  function updateTabTags() {
    // 直接遍历 tabstrip 的子节点（等价于 "#tabstrip .tab"，且不依赖 querySelectorAll 的桩实现）
    for (const n of (tabstrip.children || [])) {
      if (!SN.menu.hasClass(n, "tab")) continue;
      const d = docById(n.dataset.id);
      if (!d) continue;
      const tag = SN.views.of(d).tabTag || (d.readOnly ? "🔒" : "");
      // 用 menu.js 的遍历工具找标记 span（真实 DOM 与 smoke 的 DOM 桩都可用）
      const sp = SN.menu.firstDescendant(n, x => SN.menu.hasClass(x, "tmod"));
      if (sp) { sp.textContent = tag; sp.classList.toggle("hidden", !tag); }
    }
  }

  // 文档级右键菜单（标签栏与文件列表共用同一份，避免两处各写一套）
  // 注意 reloadAs 的实现是 cmd.reloadAs（app2.js），此前这里写成裸标识符会抛 ReferenceError
  function docMenuItems(doc) {
    return [
      { label: "关闭当前文档", action: () => cmd.closeTab(doc.id) },
      { label: "关闭其它文档", action: () => cmd.closeOthers(doc.id) },
      { label: "关闭全部", action: () => cmd.closeAll() },
      "-",
      { label: "另存为…", requires: "save", action: () => cmd.saveAs(doc.id) },
      { label: "重命名…", action: () => cmd.renameDoc(doc.id) },
      "-",
      // 打开时不再让用户选视图（统一入口 + 自动识别），改视图放到这里：三个视图互相切换，
      // 需要时重读源字节（handle / File 引用 / 内存 raw），当前所在视图置灰
      { label: "重新打开为（当前：" + SN.caps.label(doc) + "）", sub: [
        { label: "文本编辑", requires: "reloadAsText", disabled: SN.caps.kindOf(doc) === "text", action: () => cmd.reloadAs(doc.id, "text") },
        { label: "大文本只读", disabled: SN.caps.kindOf(doc) === "big", action: () => cmd.reloadAs(doc.id, "big") },
        { label: "二进制(Hex)只读", disabled: SN.caps.kindOf(doc) === "hex", action: () => cmd.reloadAs(doc.id, "hex") }
      ] },
      "-",
      { label: "打开所在目录(下载源文件)", action: () => cmd.downloadDoc(doc.id) }
    ];
  }

  // 文本视图适配器：Editor 的构造依赖本文件内部回调（改动标记、状态栏、双击取词），故在此注册。
  // 大文本/Hex 的渲染分别由 bigtext.js 与 app2.js 注册（它们拥有各自的视图实现）。
  function renderTextPage(doc, page) {
    const ed = new SN.Editor({
      readOnly: doc.readOnly,
      wrap: app.settings.wrap,
      showSpaces: app.settings.showSpaces,
      showEol: app.settings.showEol,
      langId: doc.lang,
      onChange: (text) => { onEditorChange(doc, text); },
      onStatus: (info) => { onEditorStatus(doc, info); },
      onWordDbl: (w) => { if (app.settings.wordDblHighlight) wordHighlight(w); },
      onActive: () => activateDoc(doc.id)
    });
    ed.setText(doc.content || "");
    // 新开的文档沿用当前缩放级别（缩放是全局设置；以前新文档总是回到 100%）
    ed.applyZoom(app.zoomPct || 100);
    doc.editor = ed;
    page.appendChild(ed.wrapEl);
    return true;
  }
  SN.views.define("text", {
    render: renderTextPage,
    jumpToLine: (doc, n) => { if (doc.editor) doc.editor.gotoLine(n); },
    // 「当前选区优先，否则回退最近一次有效选区」：右键菜单抢焦点、浏览器右键折叠光标后仍能标记，
    // 否则「标记颜色」会因为拿到空选区而静默失效（用户观感就是点了没反应）
    selectionKeyword: (doc) => {
      const ed = doc.editor;
      if (!ed) return "";
      if (ed.hasSelection()) return ed.selectedText().trim();
      if (ed.effectiveSelectedText) return ed.effectiveSelectedText().trim();
      return "";
    },
    // 右键菜单由本文件提供（正文与行号栏两个变体）
    contextMenu: (doc, e) => textEditorMenuItems(doc, e)
  });

  // 页面渲染统一入口：具体怎么做交给视图适配器，这里不再出现 if (doc.kind === ...)
  function fillPage(doc, page) {
    const ad = SN.views.of(doc);
    if (ad.render && ad.render(doc, page)) return;
    page.appendChild(el("div", { text: SN.caps.label(doc) + "视图不可用（对应模块未加载）", class: "hint" }));
  }
  function buildPage(doc) {
    const page = el("div", { class: "page" + (doc.id === app.activeId ? " active" : "") });
    page.dataset.doc = doc.id;
    fillPage(doc, page);
    editorZone.appendChild(page);
    doc.pageEl = page;
  }
  // 视图类型切换（文本/大文本/Hex）后重建页面
  SN.rebuildDocPage = function (doc) {
    if (doc.pageEl) doc.pageEl.remove();
    const page = el("div", { class: "page" });
    page.dataset.doc = doc.id;
    fillPage(doc, page);
    editorZone.appendChild(page);
    doc.pageEl = page;
    activateDoc(doc.id);
  };

  function activateDoc(id, skipFocus) {
    const d = docById(id);
    if (!d) return;
    app.activeId = id;
    SN.$$("#editorZone .page").forEach(p => p.classList.toggle("active", p.dataset.doc === id));
    updateTabNodes();
    if (d.editor && !skipFocus) d.editor.focus();
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
    const mode = d ? (SN.views.of(d).modeTag || (d.readOnly ? "RO" : "")) : "";
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
    // 行列定位只由 Editor 上报：大文件/Hex 视图没有 Editor，若不显式改写，
    // 状态栏会一直停留在上一个文档的 Ln/Col（看起来像当前文档的位置）。
    if (SN.caps && !SN.caps.can("statusPos", d)) {
      SN.$("#posLabel").textContent = SN.caps.reason("statusPos", d);
    } else if (SN.views && SN.views.invoke) {
      // 支持行列定位的视图自己写（大文件视图 = 选中起点/视口首行）。
      // 静默调用：视图没实现 status() 时不打扰；值没变时视图内部会跳过 DOM 写入。
      SN.views.invoke("statusPos", "status", d, [], true);
    }
    if (eol) eol.disabled = !!(SN.caps && !SN.caps.can("eolSwitch", d));
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

  // ---- 视图判定 / 解码：打开文件与「重新打开为 …」共用的唯一一处 ----
  function bigLimitBytes() { return Math.max(2, app.settings.bigThresholdMB || 2) * 1024 * 1024; }
  // 自动识别规则（mode 为 "auto" 时）：
  //   >阈值 且 头部 4KB 无 NUL          → 大文本只读（虚拟滚动，不整篇解码）
  //   头部 4KB 有 NUL 且编码非 UTF-16   → 二进制 Hex 只读
  //   其余（小文件、UTF-16 大文件）      → 文本编辑
  // mode 传 "text"/"big"/"hex" 时表示用户明确指定视图，跳过自动判定
  function decideKind(bytes, size, mode) {
    const det = SN.detectEncode(bytes);
    const hasNul = bytes.slice(0, Math.min(bytes.length, 4096)).some(b => b === 0);
    const isBig = size > bigLimitBytes();
    let kind = "text";
    if (mode === "text" || mode === "big" || mode === "hex") kind = mode;
    else if (isBig && !hasNul) kind = "big";
    else if (hasNul && det.id !== "utf16le" && det.id !== "utf16be") kind = "hex";
    else if (isBig && (det.id === "utf16le" || det.id === "utf16be")) kind = "big";
    return { kind, det, hasNul, isBig };
  }
  // 把字节写进一个文档对象（不动 id/name/dirty）：kind/enc/raw/content/eol 全部按视图适配器来
  function applyBytesToDoc(d, bytes, mode, size) {
    const size2 = size || bytes.length;
    const r = decideKind(bytes, size2, mode);
    const view = SN.views.byKind(r.kind);
    d.kind = r.kind;
    d.enc = view.open.fallbackEnc || r.det.id;
    d.readOnly = !!view.open.readOnly;
    d.size = size2;
    // 原始字节保留策略与打开时一致：只读视图必须留；普通文本只在小文件时留（供按编码重载/导回）
    d.raw = (view.open.keepRawBytes || size2 <= 2 * 1024 * 1024) ? bytes : null;
    if (view.open.decodeMode === "none") {
      d.content = "";
    } else if (view.open.decodeMode === "head") {
      // 只解码头部一小段做行尾判定，避免整篇解码造成内存翻倍
      const head = bytes.slice(0, Math.min(bytes.length, 512 * 1024));
      d.eol = SN.detectEol(SN.decodeBytes(head, d.enc));
      d.content = "";
    } else {
      const text = SN.decodeBytes(bytes, d.enc);
      d.eol = SN.detectEol(text);
      d.content = SN.normalizeEol(text, "lf");
    }
    return r;
  }
  // 取一个已打开文档的原始字节（供「重新打开为 …」）：
  // FileSystemHandle（可再授权重读）→ 会话内保留的 File 引用（只是个句柄，不占内存）→ 内存里的 raw
  async function sourceBytesOf(d) {
    if (!d) return null;
    if (d.handle && d.handle.getFile) {
      try { return await SN.readAsBytes(await d.handle.getFile()); } catch (e) { /* 权限/文件已变，继续往下试 */ }
    }
    if (d.file) {
      try { return await SN.readAsBytes(d.file); } catch (e) { /* 同上 */ }
    }
    return d.raw || null;
  }

  async function importFile(file, mode, handle) {
    try {
      const bytes = await SN.readAsBytes(file);
      const size = file.size;
      // 编码探测：大文件走采样（毫秒级），这里记录耗时与是否采样，便于真机诊断打开卡顿
      const clock = (typeof performance !== "undefined" && performance.now) ? () => performance.now() : () => Date.now();
      const tDetect = clock();
      const d = {
        id: SN.uid(),
        name: file.name,
        path: file.name,
        eol: "lf",
        lang: SN.detectLangByName(file.name),
        dirty: false,
        kind: "text",
        enc: "utf8",
        readOnly: false,
        // 保留源文件引用（句柄式引用，不复制字节）：打开后「重新打开为 …」可直接重读原始字节。
        // 注意它不会被写进会话（storage.saveSession 只挑固定字段），所以不会把文件内容塞进 IndexedDB。
        file,
        handle: handle || null,
        size,
        raw: null,
        content: ""
      };
      // 视图判定 + 解码只在这里做一次（与「重新打开为 …」共用同一函数）
      const r = applyBytesToDoc(d, bytes, mode, size);
      const view = SN.views.byKind(d.kind);
      const detectMs = Math.round(clock() - tDetect);
      console.info("[open]", file.name, "size="+size, "limit="+bigLimitBytes(), "mode="+mode, "kind="+d.kind,
        "hasNul="+r.hasNul, "enc="+r.det.id, "sampled="+!!r.det.sampled+"("+r.det.sampledBytes+"B)", "detect="+detectMs+"ms");
      addDoc(d);
      activateDoc(d.id);
      if (handle) pushRecent({ name: d.name, handle });
      else pushRecent({ name: d.name });
      setMsg("已打开 " + d.name + "（" + SN.fmtSize(size) + "，" + SN.codeById(d.enc).name + view.open.note + "）");
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
    // 统一文案：由能力表给出「<视图名>视图不支持保存/另存为」，各视图不再各写一句
    if (!SN.caps.can("save", d)) { toast(SN.caps.reason("save", d)); return; }
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
    if (!SN.caps.can("save", d)) { toast(SN.caps.reason("save", d) + "；可用标签右键菜单导出原始文件"); return; }
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
    // 只读视图按适配器导回原始字节（Hex 存 .hex，大文本按原名）；可编辑文本走另存为
    if (!SN.caps.can("edit", d)) { SN.views.of(d).exportBytes(d); return; }
    cmd.saveAs(id);
  }
  // 公开给右键菜单（大文本/Hex 视图的「导出原始文件」）
  cmd.downloadDoc = downloadDoc;

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
      // 只读视图（不走 persistBody 的）不保存正文，跳过恢复；老会话里的大文件副本也跳过
      if (!SN.views.byKind(m.kind).persistBody || m.tooBig || (m.size && m.size > 8 * 1024 * 1024)) continue;
      const d = {
        id: m.id || SN.uid(), name: m.name || "恢复", path: m.path || "", kind: "text",
        enc: m.enc || "utf8", eol: m.eol || "lf", lang: m.lang || SN.detectLangByName(m.name) || "txt",
        dirty: !!m.dirty, content: m.content || "", readOnly: !!m.readOnly
      };
      addDoc(d);
      any = true;
    }
    const meta = await SN.store.docGet("_meta");
    const first = app.docs[0];
    if (first) activateDoc((meta && meta.activeId && docById(meta.activeId)) ? meta.activeId : first.id, true);
    return any;
  }

  // ============ 结果面板 ============
  // 生成「可折叠的结果分组」：单击文件名标题即折叠/展开该文件的结果。
  // 所有查找结果（当前文件 / 所有打开文件，普通文档 / 大文件分块检索）都渲染进这套结构，
  // 所以折叠行为不区分来源；调用方把结果行 append 到返回的 body 上即可。
  function resultGroup(file, count, opts) {
    const label = (opts && opts.label) || (file + "（" + count + "）");
    const group = el("div", { class: "res-group" });
    const head = el("div", { class: "res-sec" });
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.title = "单击折叠/展开该文件的结果";
    const body = el("div", { class: "res-body" });
    // 折叠只切 class（隐藏），不删节点：正文仍在 DOM 里，复制结果不受影响
    const paint = (collapsed) => {
      group.classList.toggle("collapsed", collapsed);
      head.textContent = (collapsed ? "▸ " : "▾ ") + label;
    };
    const toggle = () => paint(!group.classList.contains("collapsed"));
    // 右键菜单要复用同一个折叠开关（smoke 的 DOM 桩里 click() 是空实现，故显式留句柄）
    head._toggleGroup = toggle;
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    paint(false);
    group.appendChild(head);
    group.appendChild(body);
    return { group, head, body, toggle };
  }
  SN.resultGroup = resultGroup;

  // ============ 全局快捷键 ============
  function bindShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("#modalHost")) {
        if (e.key === "Escape") closeModal();
        return;
      }
      // 按键匹配与执行统一由 SN.shortcuts 表驱动（js/shortcuts.js）：
      // 这里只负责「模态框内不响应」这一层拦截，快捷键本身不再散落成 if 分支。
      SN.shortcuts.dispatch(e);
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
        const bn = el("button", { text: b.label, title: b.title || null });
        if (b.primary) bn.style.background = "var(--accent)";
        if (b.disabled) {
          // 禁用态：不接执行，保留 title 说明原因
          bn.disabled = true;
        } else {
          bn.addEventListener("click", () => { const r = b.action(); if (r !== false) closeModal(); });
        }
        foot.appendChild(bn);
      }
    }
    // 只有真正有动作按钮时才渲染底部条：纯展示类对话框（关于/能力表/快捷键一览…）
    // 靠右上角 ×（以及 Esc / 点遮罩）关闭，不再重复放一个"关闭"按钮，
    // 否则右上角与右下角是同一个语义，底部还会多出一条空的分隔线
    if (foot.children.length) dlgEl.appendChild(foot);
    mask.appendChild(dlgEl);
    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(); });
    host.appendChild(mask);
    modal = { mask, body, el: dlgEl, host, onClose: opts.onClose };
    if (opts.onOpen) opts.onOpen(body);
    return modal;
  }
  function closeModal() {
    if (modal) {
      const m = modal;
      modal.host.classList.remove("show");
      modal.mask.remove();
      modal = null;
      // 先清空 modal 再回调，避免 onClose 里再次 closeModal 造成递归
      if (m.onClose) m.onClose();
    }
  }
  window.closeModal = closeModal;

  // 右键菜单统一入口（旧签名 showCtx(x, y, [[label, fn], ...]) 仍兼容）
  function showCtx(x, y, items) {
    const norm = (items || []).map(it => {
      if (it === "-") return "-";
      if (Array.isArray(it)) return { label: it[0], action: it[1] };
      return it;
    });
    return SN.menu.openCtx(x, y, norm, menuCtx());
  }

  // ============ 右键菜单（宿主委托 + 各作用面菜单模型） ============
  // 每个宿主只挂 1 个 contextmenu 监听器（menu.js 里的 register/bindHosts），
  // 菜单项一律在打开时即时构建：只查 SN.caps（数组查找），不扫描文本、不触发编辑器渲染。

  // 文本视图：正文与行号栏给不同变体
  // 把「打开菜单那一刻的选区」还给编辑器：菜单会抢焦点、部分浏览器右键还会折叠光标，
  // 不还原的话大小写/行编辑/排序这类会从「作用于选中内容」退化成「作用于整篇或当前行」。
  function restoreMenuSel(doc, sel) {
    if (!sel || !doc || !doc.editor) return false;
    try { doc.editor.ta.focus(); doc.editor.ta.setSelectionRange(sel.start, sel.end); return true; }
    catch (e) { return false; }
  }
  // 递归给菜单项（含子菜单）的动作套一层「先还原选区」
  function withMenuSel(doc, sel, items) {
    if (!sel || !doc || !doc.editor) return items;
    const wrap = (list) => (list || []).map(it => {
      if (it === "-") return it;
      const next = Object.assign({}, it);
      if (Array.isArray(next.sub)) next.sub = wrap(next.sub);
      else if (typeof next.sub === "function") {
        const f = next.sub;
        next.sub = () => wrap(f() || []);
      }
      if (next.action) {
        const a = next.action;
        next.action = () => { restoreMenuSel(doc, sel); a(); };
      }
      return next;
    });
    return wrap(items);
  }

  function textEditorMenuItems(doc, e) {
    const ed = doc.editor;
    // 菜单在「打开那一刻」确定操作对象：当前选区，或最近一次有效选区（见 editor.js effectiveSelection）
    const effSel = ed && ed.effectiveSelection ? ed.effectiveSelection() : null;
    const hasSel = !!effSel;
    const inGutter = !!SN.menu.upFrom(e.target, n => SN.menu.hasClass(n, "ed-gutter"));
    if (inGutter) {
      return [
        { label: "书签", sub: bookMarkItems() },
        { label: "行编辑", sub: lineItems() },
        "-",
        { label: "查找…", action: () => dlg.find({ scope: "doc" }) },
        { label: "跳转行…", sc: "edit.goto" }
      ];
    }
    // 只读文本视图（打不开大文本虚拟视图时的兜底等）：只留「看」与「标记」，不给编辑入口
    if (doc.readOnly) {
      return withMenuSel(doc, effSel, [
        { label: "清除全部标记", requires: "mark", action: () => cmd.clearMarksAll() },
        { label: "标记颜色", palette: true, requires: "mark", markSel: effSel },
        "-",
        { label: "查找…", action: () => dlg.find({ scope: "doc" }) },
        { label: "跳转行…", sc: "edit.goto" }
      ]);
    }
    // 所有动作统一先还原这段选区，再执行（见 withMenuSel）
    return withMenuSel(doc, effSel, [
      { label: "撤销", sc: "edit.undo" },
      { label: "重做", sc: "edit.redo" },
      "-",
      // 不提供「粘贴」：脚本读剪贴板在 file:// 与部分浏览器上并不保证可用，
      // 与其给一个可能失效的入口，不如明确留给 Ctrl+V（剪贴板策略由本项目约定）
      { label: "剪切", sc: "edit.cut", disabled: !hasSel, action: () => ctxCut(doc) },
      { label: "复制", sc: "edit.copy", disabled: !hasSel, action: () => ctxCopy(doc) },
      { label: "全选", sc: "edit.selectAll", action: () => ctxSelectAll(doc) },
      "-",
      // 这里只放「清除全部标记」与调色板：整体性的「全部标记」属于查找面板/顶栏（右键菜单以选中内容为准，
      // 而点颜色本身就已经标记了当前目标，两者语义重复）
      { label: "清除全部标记", requires: "mark", action: () => cmd.clearMarksAll() },
      // sel 传给调色板：点颜色时先把这段选区还原回编辑器，再走与顶栏一致的高亮路径
      { label: "标记颜色", palette: true, requires: "mark", markSel: effSel },
      "-",
      { label: "大小写转换", sub: caseItems() },
      { label: "行编辑", sub: lineItems() },
      { label: "空白字符操作", sub: [
        { label: "移除行首空白", requires: "edit", action: () => cmd.blankOp("head") },
        { label: "移除行尾空白", requires: "edit", action: () => cmd.blankOp("end") },
        { label: "移除首尾空白", requires: "edit", action: () => cmd.blankOp("both") },
        "-",
        { label: "TAB → 空格", requires: "edit", action: () => cmd.tabOp("tab2space") },
        { label: "空格 → TAB(全部)", requires: "edit", action: () => cmd.tabOp("space2tabAll") },
        { label: "空格 → TAB(行首)", requires: "edit", action: () => cmd.tabOp("space2tabLead") }
      ]},
      "-",
      { label: "书签", sub: bookMarkItems() },
      { label: "查找…", action: () => dlg.find({ scope: "doc" }) },
      { label: "跳转行…", sc: "edit.goto" },
      { label: "列块编辑…", sc: "edit.columnEdit" }
    ]);
  }

  // 剪贴板：复制走 clipboard.writeText（失败回退 execCommand），剪切在写成功后才删（可撤销）
  function ctxCopy(doc) {
    const ed = doc.editor;
    if (!ed) return;
    const text = ed.effectiveSelectedText ? ed.effectiveSelectedText() : ed.selectedText();
    if (!text) { setMsg("请先选中要复制的文本"); return; }
    SN.menu.copyText(text).then(ok => setMsg(ok ? "已复制 " + text.length + " 字符" : "浏览器未允许写入剪贴板，请按 Ctrl+C"));
  }
  function ctxCut(doc) {
    const ed = doc.editor;
    if (!ed) return;
    const r = ed.effectiveSelection ? ed.effectiveSelection() : null;
    const text = r ? ed.ta.value.slice(r.start, r.end) : "";
    if (!r || !text) { setMsg("请先选中要剪切的文本"); return; }
    SN.menu.copyText(text).then(ok => {
      if (!ok) { setMsg("浏览器未允许写入剪贴板，未执行剪切（可用 Ctrl+X）"); return; }
      ed.replaceRange("", r.start, r.end);   // 自带 pushUndo + 置脏
      setMsg("已剪切 " + text.length + " 字符");
    });
  }
  function ctxSelectAll(doc) {
    const ed = doc.editor;
    if (!ed) return;
    ed.ta.focus();
    ed.ta.select();
    ed._reportStatus();
  }

  // 状态栏：按落点给四种变体
  function statusbarMenuItems(target) {
    const hit = SN.menu.upFrom(target, n => n.id) || target;
    const id = hit && hit.id;
    if (id === "codeLabel") return encItems();
    if (id === "langLabel") return langMenuItems();
    if (id === "eolSel") {
      return [
        { label: "转为 Windows(CR+LF)", requires: "eolSwitch", action: () => cmd.eolConv("crlf") },
        { label: "转为 Unix(LF)", requires: "eolSwitch", action: () => cmd.eolConv("lf") },
        { label: "转为 Mac(CR)", requires: "eolSwitch", action: () => cmd.eolConv("cr") }
      ];
    }
    return [
      { label: "工具栏", checked: !SN.$("#toolbar").classList.contains("hidden"), action: () => cmd.toggleToolbar() },
      { label: "文件列表窗口", checked: !SN.$("#fileDock").classList.contains("hidden"), action: () => cmd.toggleFileDock() },
      { label: "查找结果面板", checked: !SN.$("#bottomDock").classList.contains("hidden"), action: () => cmd.toggleResultDock() },
      "-",
      { label: "放大", requires: "zoom", action: () => cmd.zoom(10) },
      { label: "缩小", requires: "zoom", action: () => cmd.zoom(-10) },
      { label: "重置为 100%", requires: "zoom", action: () => cmd.zoom(100 - (app.zoomPct || 100)) }
    ];
  }

  // 宿主注册：编辑器区按「页 → 文档 → 该视图的 contextMenu」分派，具体菜单由各视图适配器提供
  // 右键菜单的渲染上下文：palette 项（标记颜色）的来源只有本文件知道（app.MARK_COLORS）
  function ctxMenuCtx(doc) {
    // 调色板带上菜单项里冻结的选区（见 textEditorMenuItems 的 markSel）
    return { doc: doc || activeDoc(), paletteSource: (it) => () => markColorItems(it && it.markSel) };
  }
  SN.menu.register("#editorZone", {
    match: (n) => n.dataset && n.dataset.doc,
    items: (page, e) => {
      const doc = docById(SN.menu.dataOf(page, "doc"));
      if (!doc) return null;
      const ad = SN.views.of(doc);
      return ad.contextMenu ? ad.contextMenu(doc, e) : null;
    },
    ctx: (page) => ctxMenuCtx(docById(SN.menu.dataOf(page, "doc")))
  });
  SN.menu.register("#tabstrip", {
    match: (n) => SN.menu.dataOf(n, "id"),
    items: (tab) => {
      const doc = docById(SN.menu.dataOf(tab, "id"));
      return doc ? docMenuItems(doc) : null;
    },
    ctx: (tab) => ctxMenuCtx(docById(SN.menu.dataOf(tab, "id")))
  });
  SN.menu.register("#fileList", {
    match: (n) => SN.menu.dataOf(n, "id"),
    items: (li) => {
      const doc = docById(SN.menu.dataOf(li, "id"));
      return doc ? docMenuItems(doc) : null;
    },
    ctx: (li) => ctxMenuCtx(docById(SN.menu.dataOf(li, "id")))
  });
  SN.menu.register("#statusbar", {
    match: () => true,
    items: (n) => statusbarMenuItems(n),
    ctx: () => ctxMenuCtx()
  });

  // ============ 简单的编辑命令入口（具体由 app2 补全） ============
  // 命令层只做能力转发：撤销/重做与剪贴板都由视图适配器实现（文本视图=编辑器，见 app2.js），
  // 当前视图没实现时按能力表给出统一原因（不再各自写一遍 setMsg）
  function edCmd(name) {
    SN.views.invoke("undo", name === "redo" ? "redo" : "undo", activeDoc());
  }
  function execNative(cmdName) {
    SN.views.invoke("clipboard", "clipboard", activeDoc(), [cmdName]);
  }

  // 文件/编辑子命令占位，app2 覆盖
  const placeholders = ["eolConv", "blankOp", "tabOp", "caseOp", "lineOp", "sortOp", "edStatus",
    "toggleWrap", "toggleSpaces", "toggleEol", "toggleWeb", "toggleFileDock", "toggleToolbar",
    "toggleResultDock", "copyResultDock", "reloadWith", "convertTo", "reloadAs",
    "markAll", "clearMarksAll", "wordHighlight", "toggleBookmark", "gotoBookmark", "clearBookmarks",
    "openDefineLang", "zoom"];
  placeholders.forEach(n => { if (cmd[n] === undefined) cmd[n] = () => toast("该功能在演示版暂不可用：" + n); });

  // ============ Boot ============
  app.boot = async function () {
    const saved = await SN.store.kvGet("settings", null);
    app.settings = Object.assign({}, SETTINGS_DEFAULT, saved || {});
    // 旧版本默认值 100MB 会绕过大文本虚拟视图，自动修正为新默认 2MB
    if (app.settings.bigThresholdMB === 100) app.settings.bigThresholdMB = 2;
    app.curMarkColor = app.MARK_COLORS[app.settings.markColorIdx || 0] || app.MARK_COLORS[0];
    SN.applyEditorTheme(app.settings.editorTheme);
    loadUserSettings();
    // 文件列表与结果面板接入同一套自绘滚动条（内容长时滑块保底可点长度，不再缩到十几像素）
    if (SN.scrollbar) {
      for (const sel of ["#fileList", "#resultView"]) {
        const sc = SN.$(sel);
        if (sc) SN.scrollbar.attach(sc, sc.parentElement);
      }
    }

    SN.$("#eolSel").addEventListener("change", (e) => {
      const d = activeDoc();
      if (!d) return;
      if (!SN.caps.can("eolSwitch", d)) { setMsg(SN.caps.reason("eolSwitch", d)); return; }
      d.eol = e.target.value; docContentTouched(d); setMsg("行尾格式将保存为 " + d.eol.toUpperCase());
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
    // 右键菜单：宿主委托只在这里绑一次（每个宿主 1 个 contextmenu 监听器）
    SN.menu.bindHosts();
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
  SN.refreshMenus = refreshMenus;
  SN.saveSettings = saveSettings;
  SN.encodeDocContent = encodeDocContent;
  SN.extForLang = extForLang;
  SN.docContentTouched = function (d) {
    if (!d.dirty) { d.dirty = true; updateTabNodes(); updateTitle(); }
    scheduleSaveSession();
  };
  // 「重新打开为 …」用：正文被磁盘字节替换，脏标记必须清掉（否则标签一直挂 * 且关闭时误报未保存）
  SN.docMarkClean = function (d) {
    if (!d) return;
    d.dirty = false;
    updateTabNodes();
    updateTitle();
    scheduleSaveSession();
  };
  // 视图相关工具（app2.js 的 cmd.reloadAs 使用）：判定/解码与「取原始字节」都只有一处
  SN.applyBytesToDoc = applyBytesToDoc;
  SN.sourceBytesOf = sourceBytesOf;
  SN.bigLimitBytes = bigLimitBytes;
  SN.updateTabTags = updateTabTags;
})();
