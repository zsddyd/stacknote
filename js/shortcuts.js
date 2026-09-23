"use strict";
// 快捷键唯一来源：菜单右侧的按键提示、全局按键分发、快捷键一览对话框都读这一张表，
// 因此「界面上显示的键」与「实际响应的键」不可能脱节
//（此前菜单写着 Ctrl+Shift+F 指向跨文档查找，实际却被 Ctrl+F 分支拦走）。
// 后续做「自定义快捷键」时，只需 SN.shortcuts.setOverrides({ id: "新按键串" }) 并把映射持久化，
// 菜单提示、按键分发、一览对话框会自动跟随，无需改动菜单或分发代码。
(function () {
  const SN = (window.SN = window.SN || {});

  // requires 语义：该快捷键需要当前视图具备的能力（见 js/viewcaps.js），
  //   缺少该项能力时不会执行，而是给出统一提示；这也是「只读模式」下键位策略的唯一来源。
  // where 语义（决定谁负责响应，避免双重执行）：
  //   "global" 由全局 keydown 分发，本表 run 会被执行
  //   "editor" 由文本域内的 editor.js 自行处理（run 供将来改键时直接调用，不参与全局分发）
  //   "native" 浏览器原生行为（剪切/复制/粘贴/全选），只展示、不拦截
  const DEFS = [
    { id: "file.new", group: "文件", label: "新建", accel: "Ctrl+T", where: "global", run: () => SN.cmd.new() },
    { id: "file.open", group: "文件", label: "打开…", accel: "Ctrl+O", where: "global", run: () => SN.cmd.open("auto") },
    { id: "file.save", group: "文件", label: "保存", accel: "Ctrl+S", where: "global", requires: "save", run: () => SN.cmd.save() },
    { id: "file.saveAs", group: "文件", label: "另存为…", accel: "Ctrl+Shift+S", where: "global", requires: "save", run: () => SN.cmd.saveAs() },
    { id: "file.closeTab", group: "文件", label: "关闭标签", accel: "Ctrl+W", where: "global", run: () => SN.cmd.closeTab() },

    { id: "edit.undo", group: "编辑", label: "撤销", accel: "Ctrl+Z", where: "editor", requires: "undo", run: () => { const ed = SN.activeEditor(); if (ed) ed.undo(); } },
    { id: "edit.redo", group: "编辑", label: "重做", accel: "Ctrl+Y", where: "editor", requires: "undo", run: () => { const ed = SN.activeEditor(); if (ed) ed.redo(); } },
    { id: "edit.redoAlt", group: "编辑", label: "重做（备用键）", accel: "Ctrl+Shift+Z", where: "editor", requires: "undo", run: () => { const ed = SN.activeEditor(); if (ed) ed.redo(); } },
    { id: "edit.cut", group: "编辑", label: "剪切", accel: "Ctrl+X", where: "native", requires: "clipboard" },
    { id: "edit.copy", group: "编辑", label: "复制", accel: "Ctrl+C", where: "native", requires: "clipboard" },
    { id: "edit.paste", group: "编辑", label: "粘贴", accel: "Ctrl+V", where: "native", requires: "clipboard" },
    { id: "edit.selectAll", group: "编辑", label: "全选", accel: "Ctrl+A", where: "native", requires: "clipboard" },
    { id: "edit.goto", group: "编辑", label: "跳转行…", accel: "Ctrl+G", where: "global", requires: "gotoLine", run: () => SN.dlg.gotoLine() },
    { id: "edit.columnEdit", group: "编辑", label: "列块编辑…", accel: "Alt+X", where: "global", requires: "columnEdit", run: () => SN.dlg.columnEdit() },
    { id: "line.dup", group: "编辑", label: "复制当前行", accel: "Ctrl+D", where: "global", requires: "edit", run: () => SN.cmd.lineOp("dup") },

    // 统一查找对话框本身在所有视图都可用（作用域按钮会按能力禁用），故不设 requires
    { id: "find.open", group: "查找", label: "查找…", accel: "Ctrl+F", where: "global", run: () => SN.dlg.find({ scope: "doc" }) },
    { id: "find.openDocs", group: "查找", label: "查找…（默认查所有打开文件）", accel: "Ctrl+Shift+F", where: "global", run: () => SN.dlg.find({ scope: "docs" }) },
    { id: "find.next", group: "查找", label: "查找下一个", accel: "F3", where: "global", requires: "findStep", run: () => SN.dlg.findNext() },
    { id: "find.prev", group: "查找", label: "查找上一个", accel: "F4", where: "global", requires: "findStep", run: () => SN.dlg.findPrev() },

    { id: "bookmark.toggle", group: "书签", label: "设置/移除书签", accel: "Ctrl+F2", where: "global", requires: "bookmark", run: () => SN.cmd.toggleBookmark() },
    { id: "bookmark.next", group: "书签", label: "下一个书签", accel: "F2", where: "global", requires: "bookmark", run: () => SN.cmd.gotoBookmark(1) },
    { id: "bookmark.prev", group: "书签", label: "上一个书签", accel: "Shift+F2", where: "global", requires: "bookmark", run: () => SN.cmd.gotoBookmark(-1) }
  ];

  // 用户改键覆盖：{ id: "按键串" }，由后续「自定义快捷键」写入并持久化
  let overrides = {};

  function byId(id) { return DEFS.find(d => d.id === id) || null; }

  // 解析 "Ctrl+Shift+S" → { ctrl, shift, alt, key }；key 统一小写便于与事件比较
  function parse(accel) {
    const spec = { ctrl: false, shift: false, alt: false, key: "" };
    String(accel || "").split("+").forEach(raw => {
      const part = raw.trim();
      if (!part) return;
      const t = part.toLowerCase();
      if (t === "ctrl" || t === "cmd" || t === "meta") spec.ctrl = true;
      else if (t === "shift") spec.shift = true;
      else if (t === "alt" || t === "option") spec.alt = true;
      else spec.key = t;
    });
    return spec;
  }

  // 事件是否命中某个按键串：修饰键必须「完全相等」，
  // 这样 Ctrl+F 不会吞掉 Ctrl+Shift+F，F2 也不会吞掉 Ctrl+F2（旧实现的两个 bug 都源于此）
  function matchEvent(e, accel) {
    const spec = parse(accel);
    if (!spec.key || !e) return false;
    if (!!(e.ctrlKey || e.metaKey) !== spec.ctrl) return false;
    if (!!e.shiftKey !== spec.shift) return false;
    if (!!e.altKey !== spec.alt) return false;
    return String(e.key || "").toLowerCase() === spec.key;
  }

  function accelOf(id) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
    const def = byId(id);
    return def ? def.accel : "";
  }

  // 生效后的完整表（已套用覆盖），菜单与对话框都读这里
  function items() {
    return DEFS.map(d => Object.assign({}, d, { accel: accelOf(d.id) }));
  }

  // 命中当前事件的全局快捷键项（editor/native 项不参与拦截，交给下层处理）
  function findEvent(e) {
    const list = items();
    for (const it of list) {
      if (it.where !== "global" || !it.run) continue;
      if (matchEvent(e, it.accel)) return it;
    }
    return null;
  }

  // 该快捷键在当前视图是否可用（无 requires 视作永远可用）
  function available(id, doc) {
    const it = byId(id);
    if (!it || !it.requires) return true;
    return !(SN.caps && !SN.caps.can(it.requires, doc));
  }
  // 不可用原因（可用时返回空串），供菜单置灰 tooltip 与一览对话框复用
  function blockedReason(item, doc) {
    const it = typeof item === "string" ? byId(item) : item;
    if (!it || !it.requires || !SN.caps) return "";
    return SN.caps.reason(it.requires, doc);
  }

  // 全局 keydown 入口：命中则 preventDefault 并执行，返回命中项（未命中返回 null）
  // 当前视图缺少该能力时不执行，而是给出与菜单置灰一致的说明（避免“按了没反应”）
  function dispatch(e) {
    const hit = findEvent(e);
    if (!hit) return null;
    if (e.preventDefault) e.preventDefault();
    if (!available(hit.id)) {
      const why = blockedReason(hit);
      if (SN.toast) SN.toast(why);
      return Object.assign({}, hit, { blocked: true, reason: why });
    }
    hit.run();
    return hit;
  }

  // 按 group 分组（保持 DEFS 顺序），供快捷键一览对话框渲染
  function groups() {
    const out = [];
    items().forEach(it => {
      let g = out.find(x => x.name === it.group);
      if (!g) { g = { name: it.group, items: [] }; out.push(g); }
      g.items.push(it);
    });
    return out;
  }

  // 同 where 层内的重复绑定检测（后续自定义快捷键做冲突提示用）；
  // 不同层（global/editor/native）互不拦截，不算冲突
  function conflicts() {
    const seen = {};
    const dup = [];
    items().forEach(it => {
      if (!it.accel) return;
      const key = it.where + "|" + String(it.accel).toLowerCase();
      if (seen[key]) dup.push(it.accel);
      else seen[key] = true;
    });
    return dup;
  }

  function setOverrides(map) { overrides = Object.assign({}, overrides, map || {}); return items(); }
  function resetOverrides() { overrides = {}; return items(); }

  SN.shortcuts = {
    DEFS, byId, parse, matchEvent, accelOf, items, findEvent, dispatch,
    groups, conflicts, setOverrides, resetOverrides, available, blockedReason
  };
})();
