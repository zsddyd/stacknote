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
      caps: ["edit", "undo", "clipboard", "save", "exportBytes", "find", "replace", "mark", "bookmark",
        "gotoLine", "columnEdit", "format", "plugin", "zoom", "view", "lang", "encoding", "eolSwitch",
        "hashSelection", "statusPos"]
    },
    big: {
      label: "大文本只读",
      // 大文件走虚拟滚动只读视图：能看、能搜、能标记、能定位行、能导出原始字节
      caps: ["find", "mark", "gotoLine", "exportBytes"]
    },
    hex: {
      label: "Hex 只读",
      caps: ["exportBytes"]
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

  SN.caps = { NAMES, MATRIX, kindOf, of, label, can, reason };
})();
