// 启动自检：在 Node 中用极简 DOM 桩把整站 JS 加载一遍并走一次 boot()。
// 用法：node smoke.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class ClassList {
  constructor() { this.s = new Set(); }
  add(...a) { a.forEach(x => this.s.add(x)); }
  remove(...a) { a.forEach(x => this.s.delete(x)); }
  toggle(x, f) {
    if (f === undefined) { this.s.has(x) ? this.s.delete(x) : this.s.add(x); }
    else if (f) this.s.add(x); else this.s.delete(x);
    return this.s.has(x);
  }
  contains(x) { return this.s.has(x); }
}

function makeNode(tag) {
  const node = {
    tagName: (tag || "div").toUpperCase(),
    nodeType: 1,
    children: [],
    style: { cssText: "", setProperty(k, v) { this[k] = v; } },
    dataset: {},
    classList: new ClassList(),
    className: "",
    value: "",
    textContent: "",
    _html: "",
    innerHTML: "",
    readOnly: false,
    scrollTop: 0,
    scrollLeft: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    selectionStart: 0,
    selectionEnd: 0,
    handlers: {},
    appendChild(c) { if (c) this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { if (this.parent) this.parent.removeChild(this); },
    append(...cs) { cs.forEach(c => this.appendChild(c)); },
    addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); },
    dispatchEvent() { return true; },
    setAttribute(k, v) { this[k] = v; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    focus() { this._focused = true; },
    blur() { },
    click() { },
    select() { },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; }
  };
  Object.defineProperty(node, "parent", { get() { return node._parent; }, set(v) { node._parent = v; } });
  // 与浏览器一致：把 textContent 设为 "" 会清空子节点。
  // 不少代码靠 `container.textContent = ""` 清空后重建列表（结果面板/停靠窗），
  // 桩若只记属性不清子节点，跨次渲染会累积出陈旧节点、断言随之失真。
  Object.defineProperty(node, "textContent", {
    get() { return node._text || ""; },
    set(v) { node._text = v == null ? "" : String(v); if (node._text === "") node.children.length = 0; }
  });
  node.appendChild = (function (orig) {
    return function (c) { if (c) { c._parent = this; } return orig.call(this, c); };
  })(node.appendChild);
  return node;
}

const registry = {};
const documentStub = {
  readyState: "complete",
  body: makeNode("body"),
  documentElement: makeNode("html"),
  createElement(tag) { return makeNode(tag); },
  createTextNode(t) { const n = makeNode("#text"); n.textContent = t; return n; },
  createDocumentFragment() { return makeNode("#frag"); },
  // 记录监听器（而非丢弃）：这样才能对「真实按键链路」做断言，例如 Ctrl+Shift+F 的分发
  handlers: {},
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); },
  querySelector(sel) {
    if (!registry[sel]) registry[sel] = makeNode("div");
    return registry[sel];
  },
  querySelectorAll() { return []; }
};

const globals = {
  console,
  setTimeout,
  clearTimeout,
  window: null,
  document: documentStub,
  navigator: { clipboard: { writeText: async () => { } } },
  localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
  indexedDB: undefined,
  // 真实回调（用 setTimeout 近似）：bigtext 的分块搜索靠双 rAF 让出主线程（allowPaint），
  // 若 rAF 只返回 0 而不回调，搜索在 Node 里会永久挂起，这类问题就被掩盖了
  requestAnimationFrame: (cb) => setTimeout(() => { if (typeof cb === "function") cb(Date.now()); }, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  confirm: () => false,
  prompt: () => "0",
  performance: { now: () => Date.now() },
  TextEncoder,
  TextDecoder,
  crypto: require("crypto").webcrypto,
  CustomEvent,
  URL,
  Blob: class { },
  FileReader: class { },
  getComputedStyle: () => ({ lineHeight: "21.7px" }),
  addEventListener() { },
  removeEventListener() { }
};
globals.window = globals;
globals.globalThis = globals;

const sandbox = Object.assign({}, globals);
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = [
  "js/util.js", "js/viewcaps.js", "js/shortcuts.js", "js/themes.js", "js/langdefs.js", "js/highlight.js",
  "js/encoding.js", "js/hash.js", "js/storage.js", "js/editor.js",
  "js/bigtext.js",
  "js/textops.js", "js/app.js", "js/app2.js"
];
for (const f of files) {
  const code = fs.readFileSync(path.join(__dirname, f), "utf8");
  vm.runInContext(code, sandbox, { filename: f });
}

// 纯函数冒烟
const SN = sandbox.window.SN;
function assert(cond, msg) { if (!cond) throw new Error("断言失败: " + msg); }
assert(SN && SN.app && SN.app.boot, "app.boot 存在");
assert(SN.encodeText("中文测试", "utf8bom")[0] === 0xef, "utf8bom");
assert(SN.detectEncode(SN.encodeText("你好", "utf8")).id === "utf8", "detect utf8");
assert(SN.md5(new TextEncoder().encode("abc")) === "900150983cd24fb0d6963f7d28e17f72", "md5 abc");
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(SN.uuid()), "uuid v4");
assert(SN.textops.caseText("hello", "upper") === "HELLO", "case");
assert(SN.highlightRender("// hi\nint a = 1;", "cpp", []).length > 0, "highlight");

// 快捷键表：菜单提示 / 按键分发 / 一览对话框同源（js/shortcuts.js）
assert(SN.shortcuts, "shortcuts 模块加载");
assert(SN.shortcuts.accelOf("file.new") === "Ctrl+T", "快捷键显示值 Ctrl+T");
assert(SN.shortcuts.accelOf("find.openDocs") === "Ctrl+Shift+F", "快捷键显示值 Ctrl+Shift+F");
assert(SN.shortcuts.accelOf("no.such.id") === "", "未知 id 显示为空");
{
  const spec = SN.shortcuts.parse("Ctrl+Shift+S");
  assert(spec.ctrl && spec.shift && !spec.alt && spec.key === "s", "解析 Ctrl+Shift+S");
}
assert(SN.shortcuts.conflicts().length === 0, "默认表无重复绑定");
assert(SN.shortcuts.items().every(it => SN.shortcuts.parse(it.accel).key), "每项按键串可解析");
assert(SN.shortcuts.groups().length >= 4, "按键表按组呈现");

// 按键命中：修饰键必须完全相等
// （旧实现里 Ctrl+Shift+F 被 Ctrl+F 吞掉、Ctrl+F2 被 F2 吞掉，都是因为没做这一步）
const keyEv = (o) => Object.assign({
  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "", defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }
}, o);
const hitOf = (o) => { const it = SN.shortcuts.findEvent(keyEv(o)); return it ? it.id : null; };

// DOM 桩遍历工具（桩只在 children 上建树，textContent 不会自动聚合子节点）
const walkNodes = (n, fn) => { (n.children || []).forEach(c => { fn(c); walkNodes(c, fn); }); };
// 按 class token 匹配（等价于 classList.contains），这样 "iconbt disabled" 也能被 "iconbt" 找到
const byClass = (root, cls) => {
  const out = [];
  walkNodes(root, n => { if (String(n.className).split(/\s+/).indexOf(cls) >= 0) out.push(n); });
  return out;
};
const byText = (root, text) => { let hit = null; walkNodes(root, n => { if (!hit && n.textContent === text) hit = n; }); return hit; };
const clickableByText = (root, text) => {
  let hit = null;
  walkNodes(root, n => { if (!hit && n.textContent === text && n.handlers && n.handlers.click) hit = n; });
  return hit;
};
assert(hitOf({ ctrlKey: true, key: "f" }) === "find.open", "Ctrl+F → 查找");
assert(hitOf({ ctrlKey: true, shiftKey: true, key: "F" }) === "find.openDocs", "Ctrl+Shift+F → 跨文档查找");
assert(hitOf({ ctrlKey: true, shiftKey: true, key: "f" }) === "find.openDocs", "Ctrl+Shift+F 大小写无关");
assert(hitOf({ ctrlKey: true, metaKey: true, key: "f" }) === "find.open", "Cmd+F 同 Ctrl+F");
assert(hitOf({ key: "f" }) === null, "单独 f 不触发");
assert(hitOf({ ctrlKey: true, altKey: true, key: "f" }) === null, "多余修饰键不误触发");
assert(hitOf({ key: "F2" }) === "bookmark.next", "F2 → 下一个书签");
assert(hitOf({ ctrlKey: true, key: "F2" }) === "bookmark.toggle", "Ctrl+F2 → 设置/移除书签");
assert(hitOf({ shiftKey: true, key: "F2" }) === "bookmark.prev", "Shift+F2 → 上一个书签");
assert(hitOf({ altKey: true, key: "x" }) === "edit.columnEdit", "Alt+X → 列块编辑");
assert(hitOf({ ctrlKey: true, key: "z" }) === null, "Ctrl+Z 由文本域处理，不全局拦截");
assert(hitOf({ ctrlKey: true, key: "x" }) === null, "Ctrl+X 走浏览器原生");
assert(hitOf({ ctrlKey: true, key: "d" }) === "line.dup", "Ctrl+D → 复制当前行");

// 分发链路真的执行（用桩替换 dlg.find 观察收到的 mode）
{
  const saved = SN.dlg.find;
  const seen = [];
  SN.dlg.find = (mode) => seen.push(mode);
  SN.shortcuts.dispatch(keyEv({ ctrlKey: true, shiftKey: true, key: "F" }));
  SN.shortcuts.dispatch(keyEv({ ctrlKey: true, key: "f" }));
  SN.dlg.find = saved;
  assert(seen.join(",") === "opendocs,find", "dispatch 分别执行跨文档查找与查找");
}

// 改键接口（后续「自���义快捷键」的落点）：显示与分发同步跟随
SN.shortcuts.setOverrides({ "find.open": "Ctrl+L" });
assert(SN.shortcuts.accelOf("find.open") === "Ctrl+L", "覆盖后显示值");
assert(hitOf({ ctrlKey: true, key: "l" }) === "find.open", "覆盖后分发跟随");
assert(hitOf({ ctrlKey: true, key: "f" }) === null, "覆盖后旧键失效");
SN.shortcuts.resetOverrides();
assert(SN.shortcuts.accelOf("find.open") === "Ctrl+F" && hitOf({ ctrlKey: true, key: "f" }) === "find.open", "恢复默认");

// 模块加载后 app2 已自动触发 boot（async），这里等待其完成
(async function () {
  for (let i = 0; i < 100 && !SN.app.settings; i++) await new Promise(r => setTimeout(r, 10));
  assert(SN.app.settings, "settings");
  assert(SN.app.docs.length >= 1, "已创建至少一个文档");
  // 业务命令冒烟
  const d0 = SN.app.docs[0];
  if (d0 && d0.editor) {
    SN.app.activeId = d0.id;
    d0.editor.setText("hello world\nfoo bar\nend", [0, 0]);
    SN.cmd.caseOp("upper");
    assert(d0.editor.text.startsWith("HELLO WORLD"), "caseOp");
    const upperText = d0.editor.text;
    SN.cmd.caseOp("lower");
    d0.editor.undo();
    assert(d0.editor.text === upperText, "undo 程序化操作");
    d0.editor.redo();
    assert(d0.editor.text !== upperText, "redo");
    SN.cmd.caseOp("upper");
    SN.app.findOpt = { keyword: "world", case: false, whole: false, regex: false };
    SN.cmd.markAll();
    assert(d0.editor.markRecords.length > 0 && d0.editor.combinedRanges().length > 0, "markAll 记录层");
    SN.cmd.toggleBookmark();
    assert(d0.editor.bookmarks.size > 0, "bookmark");
    SN.cmd.blankOp("both");
    SN.cmd.tabOp("tab2space");
    SN.cmd.lineOp("dup");
    assert(d0.editor.text.split("\n").length >= 4, "lineOp dup");
    SN.cmd.eolConv("crlf");
    SN.cmd.convertTo("utf8bom");
    assert(d0.enc === "utf8bom", "convertTo");
    SN.dlg.about();
    SN.closeModal();
  }
  // 多组“关键词+颜色”标记可共存
  if (d0 && d0.editor) {
    SN.cmd.clearMarksAll();
    d0.editor.setText("alpha beta alpha\nbeta end\n", [0, 0]);
    d0.editor.render();
    SN.app.curMarkColor = "#FF0000";
    d0.editor._setTextWithSel(d0.editor.text, 0, 5);   // alpha
    SN.cmd.markSelected();
    SN.app.curMarkColor = "#00FF00";
    d0.editor._setTextWithSel(d0.editor.text, 6, 10);  // beta
    SN.cmd.markSelected();
    assert(d0.editor.markRecords.length === 2, "多组标记共存 records=" + d0.editor.markRecords.length);
    assert(d0.editor.combinedRanges().length === 4, "合并高亮 4 处=" + d0.editor.combinedRanges().length);
  }
  // 大文本虚拟视图冒烟（不整篇解码 / 不建高亮 DOM）
  const bigText = ("第1行日志 abc\n").repeat(3000);
  const bigDoc = {
    id: "bigtest", name: "big.log", kind: "big", enc: "utf8", eol: "lf",
    lang: "txt", content: "", raw: new TextEncoder().encode(bigText)
  };
  const bigPage = SN.buildBigTextPage(bigDoc);
  assert(bigPage, "buildBigTextPage 返回页面");
  await new Promise(r => setTimeout(r, 20));
  assert(bigDoc.bigLineCount === 3000, "大文本行索引 lineCount=" + bigDoc.bigLineCount);
  assert(!bigDoc.content, "大文本不整篇解码为 content");
  // 回归：超过高亮上限的可编辑文本必须切换为可见纯文本，而不是空白
  if (d0 && d0.editor) {
    const huge = ("第N行 abcdefg\n").repeat(150 * 1024); // ~1.8MB
    d0.editor.setText(huge, [0, 0]);
    d0.editor.render();
    assert(d0.editor.ta.classList.contains("solid"), "大文本编辑器应显示可见文字(solid)");
    assert(d0.editor.pre.innerHTML === "", "大文本不生成整篇高亮 DOM");
  }

  // 菜单右侧的快捷键提示必须能在快捷键表里找到（防止菜单再写死一份按键串而跑偏）
  {
    const accelTexts = byClass(documentStub.querySelector("#menubar"), "accel").map(n => n.textContent);
    const known = SN.shortcuts.items().map(it => it.accel);
    assert(accelTexts.length >= 15, "菜单渲染出快捷键提示，数量 = " + accelTexts.length);
    assert(accelTexts.every(t => known.indexOf(t) >= 0), "菜单提示均来自快捷键表：" + accelTexts.join(","));
    assert(accelTexts.indexOf("Ctrl+Shift+F") >= 0, "菜单提示含 Ctrl+Shift+F");
  }

  // 真实键位链路：document 上的 keydown 监听器应经由快捷键表分发
  {
    const handlers = documentStub.handlers.keydown || [];
    assert(handlers.length === 1, "已注册全局 keydown 监听，数量 = " + handlers.length);
    const saved = SN.dlg.find;
    const seen = [];
    SN.dlg.find = (mode) => seen.push(mode);
    const fire = (o) => handlers.forEach(f => f(Object.assign({ target: { closest: () => null } }, keyEv(o))));
    fire({ ctrlKey: true, shiftKey: true, key: "F" });
    fire({ ctrlKey: true, key: "f" });
    fire({ ctrlKey: true, altKey: true, key: "f" });
    SN.dlg.find = saved;
    assert(seen.join(",") === "opendocs,find", "Ctrl+Shift+F / Ctrl+F 经真实监听器分发到对应 mode，多余修饰键不触发");
  }

  // 快捷键一览对话框同样从表里取数（改键后此处自动跟随，不再是另一份硬编码清单）
  {
    SN.dlg.shortcuts();
    const texts = [];
    walkNodes(documentStub.querySelector("#modalHost"), n => { if (n.textContent) texts.push(n.textContent); });
    const all = texts.join("|");
    assert(all.indexOf("快捷键一览") >= 0, "一览对话框已打开");
    assert(all.indexOf("Ctrl+Shift+F") >= 0 && all.indexOf("在打开的文档中查找…") >= 0, "一览对话框含跨文档查找条目");
    assert(all.indexOf("Alt+X") >= 0 && all.indexOf("Ctrl+D") >= 0, "一览对话框含列块编辑/复制当前行条目");
    SN.closeModal();
  }

  // 文本域内的撤销/重做也以快捷键表为准：改键后不仅显示变，实际按键也跟着变
  if (d0 && d0.editor) {
    const ed = d0.editor;
    const savedUndo = ed.undo, savedRedo = ed.redo;
    const seq = [];
    ed.undo = () => seq.push("undo");
    ed.redo = () => seq.push("redo");
    const fireKey = (o) => ed._onKey(Object.assign({ isComposing: false, preventDefault() { } }, keyEv(o)));
    fireKey({ ctrlKey: true, key: "z" });
    fireKey({ ctrlKey: true, key: "y" });
    fireKey({ ctrlKey: true, shiftKey: true, key: "Z" });
    assert(seq.join(",") === "undo,redo,redo", "文本域内 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z，实际=" + seq.join(","));
    seq.length = 0;
    SN.shortcuts.setOverrides({ "edit.undo": "Ctrl+U" });
    fireKey({ ctrlKey: true, key: "u" });
    fireKey({ ctrlKey: true, key: "z" });
    assert(seq.join(",") === "undo", "改键后 Ctrl+U 撤销、旧键 Ctrl+Z 不再触发，实际=" + seq.join(","));
    SN.shortcuts.resetOverrides();
    ed.undo = savedUndo;
    ed.redo = savedRedo;
  }

  // 回归：同时打开多个大文件时，Ctrl+Shift+F 必须仍是「跨文档查找」
  // （大文件没有编辑器，dlg.find 原先在无编辑器时无视 mode，直接把 Ctrl+Shift+F 降级为当前文件查找）
  {
    const makeBig = (id, name, text) => {
      const doc = { id, name, kind: "big", enc: "utf8", eol: "lf", lang: "txt", content: "", raw: new TextEncoder().encode(text) };
      SN.app.docs.push(doc);
      SN.buildBigTextPage(doc);
      return doc;
    };
    const b1 = makeBig("bigA", "a.log", "alpha needle\nbeta line\nneedle two\n");
    const b2 = makeBig("bigB", "b.log", "gamma\nneedle three\n");
    await new Promise(r => setTimeout(r, 20));
    SN.app.activeId = b1.id;
    assert(SN.activeEditor() === null, "大文件没有编辑器（复现前提）");

    SN.app.findOpt.keyword = "needle";
    SN.dlg.find("opendocs");
    const modal = documentStub.querySelector("#modalHost");
    assert(byText(modal, "在打开的文档中查找"), "当前是大文件时仍打开「在打开的文档中查找」");
    const runAll = clickableByText(modal, "在所有文档查找");
    assert(runAll, "对话框提供「在所有文档查找」按钮");
    assert(!clickableByText(modal, "查找下一个"), "无编辑器时不提供逐条跳转按钮");
    // 桩里 el() 建的输入框不在 registry 上，这里给桩节点补上关键字
    documentStub.querySelector("#findKey").value = "needle";
    await runAll.handlers.click[0]();
    const secs = byClass(documentStub.querySelector("#resultView"), "res-sec").map(n => n.textContent);
    assert(secs.length === 2, "两个大文件都参与检索，实际=" + secs.join(" / "));
    const secText = secs.join(" / ");
    assert(secText.indexOf("a.log（2）") >= 0, "a.log 命中 2 处，实际=" + secText);
    assert(secText.indexOf("b.log（1）") >= 0, "b.log 命中 1 处，实际=" + secText);
    SN.closeModal();

    // 结果按文件分组，单击文件名标题可折叠/展开该文件的结果（需求：不区分大文件/小文件）
    {
      const view = documentStub.querySelector("#resultView");
      const groups = byClass(view, "res-group");
      assert(groups.length === 2, "结果按文件分组，组数=" + groups.length);
      const headA = byClass(groups[0], "res-sec")[0];
      const rowsA = byClass(groups[0], "res-row").length;
      assert(headA && headA.handlers && headA.handlers.click, "文件名标题可点击");
      assert(rowsA === 2, "分组内含该文件全部结果行，实际=" + rowsA);
      assert(headA.textContent.indexOf("▾ ") === 0, "默认展开并带折叠标记，实际=" + headA.textContent);
      headA.handlers.click[0]();
      assert(groups[0].classList.contains("collapsed"), "单击文件名后该文件结果折叠");
      assert(headA.textContent.indexOf("▸ ") === 0, "折叠后标记变为 ▸，实际=" + headA.textContent);
      assert(byClass(groups[0], "res-row").length === rowsA, "折叠只隐藏不删节点（复制结果不受影响）");
      assert(!groups[1].classList.contains("collapsed"), "只折叠被点的那一组，其它文件保持展开");
      headA.handlers.click[0]();
      assert(!groups[0].classList.contains("collapsed"), "再次单击展开");
      // 键盘可达：Enter / 空格 同样切换
      headA.handlers.keydown[0]({ key: "Enter", preventDefault() { } });
      assert(groups[0].classList.contains("collapsed"), "Enter 键同样可折叠");
      headA.handlers.keydown[0]({ key: " ", preventDefault() { } });
      assert(!groups[0].classList.contains("collapsed"), "空格键展开");
    }

    // 点击大文件的结果行应跳到对应行（走 _bigJump），而不是要求编辑器存在
    const rowB = byClass(documentStub.querySelector("#resultView"), "res-row").filter(r => r.dataset.doc === "bigB")[0];
    assert(rowB, "结果行带 docId（bigB）");
    const jumped = [];
    b2._bigJump = (line) => jumped.push(line);
    const savedActivate = SN.activateDoc;
    SN.activateDoc = (id) => { SN.app.activeId = id; };
    rowB.handlers.click[0]();
    SN.activateDoc = savedActivate;
    assert(jumped.join(",") === "2", "点击结果跳到大文件第 2 行，实际=" + jumped.join(","));

    // 当前文档查找仍走该大文件自己的分块搜索（Ctrl+F 行为不变）
    const b1Find = b1.bigFind;
    let calledFind = 0;
    b1.bigFind = () => { calledFind++; };
    SN.app.activeId = b1.id;
    SN.dlg.find("find");
    assert(calledFind === 1, "Ctrl+F 在大文件上仍走本文件分块搜索");
    b1.bigFind = b1Find;

    // ============ 视图能力表：菜单/工具栏/快捷键按能力置灰（js/viewcaps.js） ============
    {
      const textDoc = { kind: "text" }, bigDoc = { kind: "big" }, hexDoc = { kind: "hex" };
      assert(SN.caps.can("save", textDoc) && SN.caps.can("undo", textDoc) && SN.caps.can("view", textDoc), "文本视图能力齐全");
      assert(!SN.caps.can("save", bigDoc) && !SN.caps.can("edit", bigDoc) && !SN.caps.can("undo", bigDoc), "大文本视图不支持保存/编辑/撤销");
      assert(SN.caps.can("find", bigDoc) && SN.caps.can("mark", bigDoc) && SN.caps.can("gotoLine", bigDoc) && SN.caps.can("exportBytes", bigDoc), "大文本视图仍支持查找/标记/跳转行/导出");
      assert(!SN.caps.can("bookmark", bigDoc) && !SN.caps.can("view", bigDoc) && !SN.caps.can("hashSelection", bigDoc) && !SN.caps.can("statusPos", bigDoc), "大文本视图不支持书签/视图开关/选中哈希/行列定位");
      assert(SN.caps.can("exportBytes", hexDoc) && !SN.caps.can("find", hexDoc), "Hex 视图只支持导出原始字节");
      assert(SN.caps.reason("save", bigDoc) === "大文本只读视图不支持保存/另存为", "统一原因文案，实际=" + SN.caps.reason("save", bigDoc));
      assert(SN.caps.reason("save", textDoc) === "", "可用时原因为空");

      SN.app.activeId = b1.id;
      SN.refreshMenus();
      const menubarNode = documentStub.querySelector("#menubar");
      const saveItem = byText(menubarNode, "保存").parent;
      assert(saveItem.classList.contains("disabled"), "大文件下菜单「保存」置灰");
      assert(String(saveItem.title).indexOf("大文本只读视图不支持保存") === 0, "置灰项 tooltip 说明原因，实际=" + saveItem.title);
      assert(!byText(menubarNode, "查找…").parent.classList.contains("disabled"), "大文件下「查找…」仍可用");
      assert(!byText(menubarNode, "全部标记(Mark All)").parent.classList.contains("disabled"), "大文件下「全部标记」仍可用");
      const tbBtns = byClass(documentStub.querySelector("#toolbar"), "iconbt");
      const tbSave = tbBtns.filter(b => String(b.title || "").indexOf("保存") === 0)[0];
      const tbFind = tbBtns.filter(b => String(b.title || "").indexOf("查找") === 0)[0];
      assert(tbSave && tbSave.className.indexOf("disabled") >= 0, "大文件下工具栏「保存」置灰");
      assert(tbFind && tbFind.className.indexOf("disabled") < 0, "大文件下工具栏「查找」仍可用");
      assert(documentStub.querySelector("#posLabel").textContent.indexOf("大文本只读视图不支持行列定位信息") === 0,
        "状态栏不再显示陈旧行列，实际=" + documentStub.querySelector("#posLabel").textContent);
      assert(documentStub.querySelector("#eolSel").disabled === true, "行尾选择器在只读视图禁用");

      // 快捷键：能力不足时不执行、不静默，且仍 preventDefault（挡住浏览器默认行为）
      const toasts = [];
      const savedToast = SN.toast, savedSave = SN.cmd.save;
      let saved = 0;
      SN.toast = (m) => toasts.push(m);
      SN.cmd.save = () => { saved++; };
      const evSave = keyEv({ ctrlKey: true, key: "s" });
      const blocked = SN.shortcuts.dispatch(evSave);
      assert(blocked && blocked.blocked === true && saved === 0, "大文件下 Ctrl+S 不执行保存");
      assert(evSave.defaultPrevented === true, "被拦时仍 preventDefault（否则会弹出浏览器另存为）");
      assert(toasts.length === 1 && toasts[0].indexOf("大文本只读视图不支持保存") === 0, "给出统一提示，实际=" + toasts.join("|"));
      SN.shortcuts.dispatch(keyEv({ key: "F3" }));      // 大文件支持查找：应照常执行、不提示
      assert(toasts.length === 1, "可用快捷键不产生提示");
      assert(SN.shortcuts.available("find.open", b1) && !SN.shortcuts.available("file.save", b1), "available() 与能力表一致");
      SN.app.activeId = d0.id;
      assert(SN.shortcuts.dispatch(keyEv({ ctrlKey: true, key: "s" })) && saved === 1, "文本视图下 Ctrl+S 正常执行");
      SN.cmd.save = savedSave;
      SN.toast = savedToast;

      // 哈希面板：只读视图下「计算选中文本」禁用并说明（原先会算出空串的哈希）
      SN.app.activeId = b1.id;
      SN.tool.hash();
      const hm = documentStub.querySelector("#modalHost");
      assert(!clickableByText(hm, "计算选中文本"), "只读视图下「计算选中文本」不可点击");
      let hashBtn = null;
      walkNodes(hm, n => { if (!hashBtn && n.textContent === "计算选中文本") hashBtn = n; });
      assert(hashBtn && hashBtn.disabled === true, "「计算选中文本」为禁用态");
      assert(String(hashBtn.title).indexOf("大文本只读视图不支持") === 0, "禁用按钮带原因，实际=" + hashBtn.title);
      SN.closeModal();

      // 快捷键一览同样标注当前视图不可用的键
      SN.dlg.shortcuts();
      const texts = [];
      walkNodes(documentStub.querySelector("#modalHost"), n => { if (n.textContent) texts.push(n.textContent); });
      const allText = texts.join("|");
      assert(allText.indexOf("Ctrl+S（大文本只读视图不支持保存/另存为）") >= 0, "一览标注不可用的 Ctrl+S");
      assert(allText.indexOf("Ctrl+H（大文本只读视图不支持替换）") >= 0, "一览标注不可用的 Ctrl+H");
      assert(allText.indexOf("Ctrl+F（") < 0, "可用的 Ctrl+F 不加标注");
      SN.closeModal();
      SN.app.activeId = d0.id;
      SN.refreshMenus();
    }

    // 大文件单文件搜索（bigtext 分块检索 → showBigResults）也必须落到同一套可折叠分组
    SN.app.activeId = b1.id;
    const pBig = b1.bigFind();               // 打开关键字对话框
    await new Promise(r => setTimeout(r, 0));
    documentStub.querySelector("#bigFindKw").value = "needle";
    const searchBtn = clickableByText(documentStub.querySelector("#modalHost"), "搜索");
    assert(searchBtn, "大文件查找对话框有“搜索”按钮");
    searchBtn.handlers.click[0]();
    await pBig;
    const bigView = documentStub.querySelector("#resultView");
    const bigGroups = byClass(bigView, "res-group");
    const bigRows = byClass(bigView, "res-row");
    assert(bigGroups.length === 1, "大文件单文件搜索出一组结果，组数=" + bigGroups.length);
    assert(bigRows.length === 2, "大文件结果行数=" + bigRows.length);
    const bigHead = byClass(bigView, "res-sec")[0];
    assert(bigHead.textContent.indexOf("已全部列出 2 条") >= 0, "标题保留原命中统计，实际=" + bigHead.textContent);
    bigHead.handlers.click[0]();
    assert(bigGroups[0].classList.contains("collapsed"), "大文件单文件结果同样可折叠");
    bigHead.handlers.click[0]();
    assert(!bigGroups[0].classList.contains("collapsed"), "大文件结果再次单击可展开");
  }

  console.log("SMOKE OK, docs =", SN.app.docs.length,
    "activeId =", SN.app.activeId,
    "names =", SN.app.docs.map(d => d.name).join(","),
    "menus built =", documentStub.querySelector("#menubar").children.length);
})().catch((e) => {
  console.error("SMOKE FAIL", e);
  process.exit(1);
});
