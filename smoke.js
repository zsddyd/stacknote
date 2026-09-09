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
  addEventListener() { },
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
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => { },
  confirm: () => false,
  prompt: () => "0",
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
  "js/util.js", "js/themes.js", "js/langdefs.js", "js/highlight.js",
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
assert(SN.textops.caseText("hello", "upper") === "HELLO", "case");
assert(SN.highlightRender("// hi\nint a = 1;", "cpp", []).length > 0, "highlight");

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
  console.log("SMOKE OK, docs =", SN.app.docs.length,
    "activeId =", SN.app.activeId,
    "names =", SN.app.docs.map(d => d.name).join(","),
    "menus built =", documentStub.querySelector("#menubar").children.length);
})().catch((e) => {
  console.error("SMOKE FAIL", e);
  process.exit(1);
});
