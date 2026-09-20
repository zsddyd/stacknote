"use strict";
// 视图能力表：把「文本编辑 / 大文本只读 / Hex 只读」三种视图在各项功能上的差异集中定义在这里。
// 目的：菜单、工具栏、快捷键、对话框都按「能力」判断可用性，并给出统一原因，
//      取代原先散落各处、点下去毫无反馈的 `if (!activeEditor()) return`
//      （此前 47 处 kind 判断 + 29 处判空，用户无法分辨「不支持」和「坏了」）。
// 用法：SN.caps.can("save", doc) / SN.caps.reason("save", doc) / SN.caps.label(doc)
(function () {
  const SN = (window.SN = window.SN || {});

  // 能力名 → 中文功能名（拼提示文案用）
  const NAMES = {
    edit: "文本操作（大小写/空白/行编辑/换行符转换）",
    undo: "撤销/重做",
    clipboard: "剪切/复制/粘贴/全选（面板与工具栏入口）",
    save: "保存/另存为",
    exportBytes: "导出原始字节",
    find: "查找",
    findStep: "查找下一个/上一个（需要光标定位）",
    replace: "替换",
    mark: "标记高亮",
    bookmark: "书签",
    gotoLine: "跳转行",
    columnEdit: "列块编辑",
    format: "格式化",
    plugin: "插件",
    zoom: "缩放",
    view: "自动换行/显示空白/显示行尾",
    lang: "语言与语法高亮",
    encoding: "编码重载/转换",
    eolSwitch: "行尾格式切换",
    hashSelection: "选中文本哈希",
    statusPos: "行列定位信息"
  };

  // 各视图支持的能力白名单；未列出的能力一律视为不支持
  const MATRIX = {
    text: {
      label: "文本编辑",
      caps: ["edit", "undo", "clipboard", "save", "exportBytes", "find", "findStep", "replace", "mark", "bookmark",
        "gotoLine", "columnEdit", "format", "plugin", "zoom", "view", "lang", "encoding", "eolSwitch",
        "hashSelection", "statusPos", "rename", "reloadAsText"]
    },
    big: {
      label: "大文本只读",
      // 大文件走虚拟滚动只读视图：能看、能搜、能标记、能定位行、能导出原始字节；
      // 也能切回可编辑文本（右键「重新打开为 → 文本编辑」，会二次确认，见 app2 的 cmd.reloadAs）
      caps: ["find", "mark", "gotoLine", "exportBytes", "rename", "reloadAsText"]
    },
    hex: {
      label: "Hex 只读",
      // 重命名只改文档名、不需要正文，Hex 视图同样可用（右键菜单据此给出「重命名…」）
      caps: ["exportBytes", "reloadAsText", "rename"]
    }
  };

  // 未显式传入 doc 时取当前活动文档（方便 dispatch/菜单等只需判断「当前视图」的场景）
  function resolve(doc) { return doc === undefined && SN.activeDoc ? SN.activeDoc() : doc; }
  function kindOf(doc) { const d = resolve(doc); return (d && d.kind) || "text"; }
  function of(doc) { return MATRIX[kindOf(doc)] || MATRIX.text; }
  function label(doc) { return of(doc).label; }
  function can(cap, doc) { return of(doc).caps.indexOf(cap) >= 0; }
  // 不可用时给出一句统一的解释（可用时返回空串）
  function reason(cap, doc) {
    if (can(cap, doc)) return "";
    return label(doc) + "视图不支持" + (NAMES[cap] || cap);
  }

  // 能力表展示顺序（关于 → 视图能力表 用；短名比 NAMES 更适合表格）
  const DISPLAY = [
    ["edit", "文本操作"], ["undo", "撤销/重做"], ["clipboard", "剪切/复制/粘贴"],
    ["save", "保存/另存为"], ["exportBytes", "导出原始字节"],
    ["find", "查找（含跨文档）"], ["findStep", "查找下一个/上一个"], ["replace", "替换"],
    ["mark", "标记高亮"], ["bookmark", "书签"], ["gotoLine", "跳转行"],
    ["columnEdit", "列块编辑"], ["format", "格式化"], ["plugin", "插件"],
    ["zoom", "缩放"], ["view", "换行/空白/行尾开关"], ["lang", "语言与语法高亮"],
    ["encoding", "编码重载/转换"], ["eolSwitch", "行尾格式切换"], ["hashSelection", "选中文本哈希"],
    ["statusPos", "行列定位"], ["rename", "重命名"], ["reloadAsText", "切回可编辑文本"]
  ];

  // ============ 视图适配器 ============
  // 能力表回答「支不支持」，适配器回答「怎么做」。
  // 各视图的拥有者模块把自己那份注册进来（app.js 负责文本页、bigtext.js 负责大文本、app2.js 负责 Hex），
  // 调用方一律走 SN.views.of(doc).xxx()，不再写 if (doc.kind === "big") 这类分叉。
  const ADAPTERS = {};
  // 打开文件时该视图的默认属性（由 app.js importFile 使用）：
  //   readOnly       打开即只读
  //   keepRawBytes   保留原始字节（便于导出原始文件、按编码重载）
  //   decodeMode     "full" 整篇解码 | "head" 只解头部判行尾 | "none" 不解码（二进制）
  //   fallbackEnc    无法解码时的编码占位
  //   note           打开提示里追加的说明
  const DEFAULT_OPEN = { readOnly: false, keepRawBytes: false, decodeMode: "full", fallbackEnc: "", note: "" };
  const EMPTY = {
    tabTag: "", listTag: "", modeTag: "", persistBody: true,
    open: DEFAULT_OPEN,
    render: null, jumpToLine: null, search: null,
    selectionKeyword: null, markSelection: null, clearMarks: null, exportBytes: null,
    // 各视图自己的右键菜单（由拥有该视图实现的模块注册；缺省表示该视图不接管右键）
    contextMenu: null
  };
  function define(kind, part) {
    const merged = Object.assign({}, EMPTY, ADAPTERS[kind], part);
    merged.open = Object.assign({}, DEFAULT_OPEN, ADAPTERS[kind] && ADAPTERS[kind].open, part && part.open);
    ADAPTERS[kind] = merged;
    return ADAPTERS[kind];
  }
  function byKind(kind) { return ADAPTERS[kind] || EMPTY; }
  function forDoc(doc) { return byKind(kindOf(doc)); }

  // 命令层唯一入口：能力(cap) → 适配器方法(method)。
  // 适配器没实现该方法时，按能力表给出与菜单置灰同一句原因（绝不静默 —— "菜单亮了但点了没反应"就是缺这一层）。
  // silent=true 用于批量广播（例如缩放要作用到所有已打开文档），不给不支持的视图逐个刷提示。
  // args 为附加参数数组；适配器方法返回 false 视为"未执行"，其余情况视为已处理。
  function invoke(cap, method, doc, args, silent) {
    const d = resolve(doc);
    // 注意用 forDoc（取适配器），不是 of（那是能力矩阵）
    const ad = forDoc(d);
    if (!ad || typeof ad[method] !== "function") {
      if (!silent && SN.setMsg) SN.setMsg(reason(cap, d));
      return false;
    }
    return ad[method].apply(ad, [d].concat(args || [])) !== false;
  }

  SN.caps = { NAMES, DISPLAY, MATRIX, kindOf, of, label, can, reason };
  SN.views = { define, byKind, of: forDoc, ADAPTERS, invoke };
})();
