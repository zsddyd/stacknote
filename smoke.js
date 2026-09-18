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

// 编码探测分档：小文件仍全量校验（与旧行为一致），大文件只采样头/中/尾（毫秒级）
{
  const MB = 1024 * 1024;
  const rep = (arr, k) => { const out = new Uint8Array(arr.length * k); for (let i = 0; i < k; i++) out.set(arr, i * arr.length); return out; };
  const cat = (...ps) => {
    const o = new Uint8Array(ps.reduce((a, p) => a + p.length, 0));
    let at = 0; ps.forEach(p => { o.set(p, at); at += p.length; });
    return o;
  };
  const gbkCJK = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);              // GBK 的“中文”
  const nl = new Uint8Array([10]);
  const u16le = (t) => { const o = new Uint8Array(t.length * 2); for (let i = 0; i < t.length; i++) o[i * 2] = t.charCodeAt(i); return o; };

  // ① 小文件：走全量路径，各类样本的判定与旧实现一致
  const smallCases = [
    [SN.encodeText("hello", "utf8"), "utf8"],
    [SN.encodeText("你好世界", "utf8"), "utf8"],
    [SN.encodeText("你好", "utf8bom"), "utf8bom"],
    [SN.encodeText("你好", "utf16le"), "utf16le"],
    [SN.encodeText("你好", "utf16be"), "utf16be"],
    [gbkCJK, "gbk"],
    [new Uint8Array([0x41, 0x80, 0x42, 0x43, 0x44]), "unknown"],       // 既非合法 UTF-8 也非合法 GBK
    [u16le("ab\ncd\n"), "utf16le"]                                    // 无 BOM 的 UTF-16LE（靠 NUL 奇偶判）
  ];
  smallCases.forEach(([b, want], i) => {
    const r = SN.detectEncode(b);
    assert(r.id === want, "小文件编码探测[" + i + "] 期望 " + want + " 实际 " + r.id);
    assert(r.sampled === false && r.sampledBytes === b.length, "小文件编码探测[" + i + "] 走全量路径");
  });
  assert(SN.detectEncode(SN.encodeText("你好", "utf8bom")).skip === 3, "utf8bom 跳过 3 字节 BOM");
  assert(SN.detectEncode(SN.encodeText("你好", "utf16le")).skip === 2, "utf16le 跳过 2 字节 BOM");

  // ② 大文件：走采样路径；关键用例是“ASCII 头 + GBK 尾”必须仍判对
  const utf8Line = SN.encodeText("第N行 abc\n", "utf8");
  const bigCases = [
    [rep(utf8Line, Math.ceil(1.3 * MB / utf8Line.length)), "utf8"],
    [rep(cat(gbkCJK, nl), 250000), "gbk"],                              // 1.25MB 纯 GBK
    [cat(rep(new Uint8Array([0x41]), MB), rep(cat(gbkCJK, nl), 30000)), "gbk"],
    [cat(rep(new Uint8Array([0x41]), MB), rep(new Uint8Array([0x80]), 3000)), "unknown"],
    [cat(new Uint8Array([0x41]), rep(SN.encodeText("中", "utf8"), 400000)), "utf8"],   // 窗口切在汉字中间
    [rep(u16le("abcdefgh\n"), Math.ceil(1.3 * MB / 18)), "utf16le"]
  ];
  bigCases.forEach(([b, want], i) => {
    const r = SN.detectEncode(b);
    assert(r.id === want, "大文件编码探测[" + i + "] 期望 " + want + " 实际 " + r.id);
    assert(r.sampled === true, "大文件编码探测[" + i + "] 走采样路径");
    assert(r.sampledBytes <= 512 * 1024 + 8, "大文件编码探测[" + i + "] 采样量有界，实际 " + r.sampledBytes);
  });

  // ③ 差分护栏：≤1MB 的判定必须与旧实现（全量校验）完全一致
  const refDetect = (bytes) => {
    const n = bytes.length;
    const bs = (arr, at) => { for (let i = 0; i < arr.length; i++) if (bytes[at + i] !== arr[i]) return false; return true; };
    if (n >= 3 && bs([0xef, 0xbb, 0xbf], 0)) return "utf8bom";
    if (n >= 2 && bs([0xff, 0xfe], 0)) return "utf16le";
    if (n >= 2 && bs([0xfe, 0xff], 0)) return "utf16be";
    if (n > 4) {
      let e = 0, o = 0;
      for (let i = 0; i < n; i++) if (bytes[i] === 0) { if (i % 2 === 0) e++; else o++; }
      if (e > n / 8 && e > o) return "utf16be";
      if (o > n / 8) return "utf16le";
    }
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return "utf8"; } catch (x) { }
    try { new TextDecoder("gbk", { fatal: true }).decode(bytes); return "gbk"; } catch (x) { }
    return "unknown";
  };
  let seed = 20260914;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const KINDS = ["ascii", "utf8", "utf8trunc", "gbk", "gbktrunc", "utf16le", "utf16le-nobom", "binary", "high"];
  const srcUtf8 = SN.encodeText("中文行".repeat(3000), "utf8");
  const srcUtf16 = SN.encodeText("abc行".repeat(1000), "utf16le");
  const diffs = [];
  for (let it = 0; it < 120; it++) {
    const kind = KINDS[Math.floor(rnd() * KINDS.length)];
    const len = 8 + Math.floor(rnd() * 2000);
    let b = null;
    if (kind === "ascii") { b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = (i % 17 === 0) ? 10 : 0x41 + Math.floor(rnd() * 60); }
    else if (kind === "utf8") b = srcUtf8.subarray(0, len - (len % 9));            // 按字符边界截断
    else if (kind === "utf8trunc") b = srcUtf8.subarray(0, len);                    // 故意切在多字节字符中间
    else if (kind === "gbk") { const k = Math.floor(len / 2) * 2; b = new Uint8Array(k); for (let i = 0; i < k; i += 2) { b[i] = 0x81 + Math.floor(rnd() * 0x7d); b[i + 1] = 0x40 + Math.floor(rnd() * 0xbe); } }
    else if (kind === "gbktrunc") { b = new Uint8Array(len); for (let i = 0; i < len - 1; i += 2) { b[i] = 0x81 + Math.floor(rnd() * 0x7d); b[i + 1] = 0x40 + Math.floor(rnd() * 0xbe); } b[len - 1] = 0x81 + Math.floor(rnd() * 0x7d); }
    else if (kind === "utf16le") b = srcUtf16.subarray(0, len - (len % 2));
    else if (kind === "utf16le-nobom") b = srcUtf16.subarray(2, len - (len % 2));
    else if (kind === "high") { b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = 0xa0 + Math.floor(rnd() * 0x60); }
    else { b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = Math.floor(rnd() * 256); }
    if (!b || b.length < 8) continue;
    const want = refDetect(b), got = SN.detectEncode(b).id;
    if (want !== got) diffs.push(kind + "/len" + b.length + " 旧=" + want + " 新=" + got);
  }
  assert(diffs.length === 0, "≤1MB 判定与旧实现不一致：\n" + diffs.slice(0, 5).join("\n"));
}
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
const byIdIn = (root, id) => { let hit = null; walkNodes(root, n => { if (!hit && n.id === id) hit = n; }); return hit; };
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

// 分发链路真的执行（用桩替换 dlg.find 观察收到的参数：两个入口统一到同一个对话框，只差默认作用域）
{
  const saved = SN.dlg.find;
  const seen = [];
  SN.dlg.find = (o) => seen.push(o && o.scope);
  SN.shortcuts.dispatch(keyEv({ ctrlKey: true, shiftKey: true, key: "F" }));
  SN.shortcuts.dispatch(keyEv({ ctrlKey: true, key: "f" }));
  SN.dlg.find = saved;
  assert(seen.join(",") === "docs,doc", "Ctrl+Shift+F 默认查所有打开文件、Ctrl+F 默认查当前文件，实际=" + seen.join(","));
}

// 改键接口（后续「自���义快捷键」的落点）：显示与分发同步跟随
SN.shortcuts.setOverrides({ "find.open": "Ctrl+L" });
assert(SN.shortcuts.accelOf("find.open") === "Ctrl+L", "覆盖后显示值");
assert(hitOf({ ctrlKey: true, key: "l" }) === "find.open", "覆盖后分发跟随");
assert(hitOf({ ctrlKey: true, key: "f" }) === null, "覆盖后旧键失效");
SN.shortcuts.resetOverrides();
assert(SN.shortcuts.accelOf("find.open") === "Ctrl+F" && hitOf({ ctrlKey: true, key: "f" }) === "find.open", "恢复默认");

// 主题即一切：一套主题同时写编辑区变量与界面变量，不再有独立的界面皮肤
assert(SN.EDITOR_THEMES.length === 15, "编辑器主题共 15 套");
assert(SN.EDITOR_THEMES.some(t => t.id === "onedarkpro"), "编辑器主题表含 onedarkpro");
assert(SN.getTheme("onedarkpro").name === "One Dark Pro", "主题 id/名称均为 One Dark Pro");
assert(SN.APP_SKINS === undefined && SN.applyAppSkin === undefined, "界面皮肤概念已移除");
// 老用户保存的是已删除主题的 id 时，必须安全回落到 Default，而不是白屏/报错
assert(SN.getTheme("ruby_blue").id === "default" && SN.getTheme("twilight").id === "default", "已删除主题 id 回落到 Default");
{
  const st = documentStub.documentElement.style;
  const t = SN.getTheme("onedarkpro");
  assert(t.light === false && t.bg === "#282C34" && t.fg === "#ABB2BF", "One Dark Pro 底色/前景");
  SN.applyEditorTheme("onedarkpro");
  assert(st["--ed-bg"] === "#282C34" && st["--ed-caret"] === "#ABB2BF", "One Dark Pro 编辑器底色生效");
  assert(st["--tok-key"] === "#C678DD" && st["--tok-str"] === "#98C379" && st["--tok-num"] === "#D19A66" && st["--tok-fn"] === "#61AFEF",
    "One Dark Pro 语法色取自 One Dark 色盘");
  // 主题自带的覆盖值优先于「按亮暗推导」的默认值
  assert(st["--ed-gutter-bg"] === "#282C34" && st["--ed-line-num"] === "#495162" && st["--ed-active-line"] === "#2C313C",
    "One Dark Pro 行号槽/行号/当前行用主题覆盖值");
  // 界面变量（菜单栏/工具栏/标签栏/状态栏）同属这套主题，且一律来自 chromeOf 的统一推导
  assert(t.ui === undefined, "One Dark Pro 不再手写界面变量");
  const ui = SN.chromeOf(t);
  assert(st["--panel"] === ui["--panel"] && st["--border"] === ui["--border"] && st["--accent"] === ui["--accent"],
    "One Dark Pro 界面变量来自统一推导");
  assert(st["--panel"] !== t.bg, "界面面板与编辑区底色按统一规则拉开一档（不再是同色手写值）");
  SN.applyEditorTheme("monokai");
  assert(st["--ed-line-num"] === "#6a6a6a" && st["--tok-key"] === "#66D9EF", "未带覆盖的主题仍按默认推导并回落到 Monokai 色盘");
  assert(st["--panel"] !== "#282C34" && st["--accent"] === "#A6E22E", "换成 Monokai 后界面变量跟着换");
  SN.applyEditorTheme("default");
  assert(st["--ed-bg"] === "#FFFFFF" && st["--text"] === "#000000" && st["--panel"] === "#ededed", "Default 是浅色主题：界面也随之回到浅色");
}
// 每套主题都要给全界面变量，不能有漏项（漏项会退回 :root 的浅色兜底，深色主题就会出现花屏）
{
  const need = Object.keys(SN.chromeOf(SN.getTheme("default")));
  assert(need.length >= 15, "界面变量清单齐全，实际 " + need.length + " 项");
  for (const t of SN.EDITOR_THEMES) {
    const ui = SN.chromeOf(t);
    const miss = need.filter(k => !ui[k]);
    assert(miss.length === 0, "主题 " + t.id + " 缺少界面变量：" + miss.join(","));
    assert(/^#[0-9a-fA-F]{6}$/.test(ui["--panel"]) && /^#[0-9a-fA-F]{6}$/.test(ui["--text"]),
      "主题 " + t.id + " 的面板/前景应为具体色值");
    assert(String(ui["--selection"]).length > 0, "主题 " + t.id + " 有选中色");
  }
}

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
    // 「主题与语法样式」点卡片要真正落盘（曾只改预览：themes.js 写 SN.settings，保存读 app.settings）
    const odpPanel = SN.chromeOf(SN.getTheme("onedarkpro"))["--panel"];
    SN.dlg.themeStyle();
    let odpCard = null;
    walkNodes(documentStub.querySelector("#modalHost"), n => {
      if (!odpCard && n["data-id"] === "onedarkpro") odpCard = n;
    });
    assert(odpCard && odpCard.handlers.click && odpCard.handlers.click.length, "主题卡片渲染且可点击");
    SN.app.settings.editorTheme = "default";
    odpCard.handlers.click[0]();
    assert(SN.app.settings.editorTheme === "onedarkpro", "点主题卡片写入 app.settings 并落盘");
    assert(documentStub.documentElement.style["--panel"] === odpPanel, "点主题卡片同时切换界面配色");
    SN.closeModal();
    // 选项里的下拉是即时预览：按「取消」应还原成打开前的主题，而不是留在预览态
    SN.app.settings.editorTheme = "default";
    SN.applyEditorTheme("default");
    SN.dlg.options();
    const themeSel = byIdIn(documentStub.querySelector("#modalHost"), "themeSel");
    assert(themeSel, "选项对话框渲染出主题下拉");
    assert(byIdIn(documentStub.querySelector("#modalHost"), "skinSel") === null, "选项对话框已无界面皮肤下拉");
    themeSel.value = "onedarkpro";
    themeSel.handlers.change[0]();
    assert(documentStub.documentElement.style["--panel"] === odpPanel, "选项里选 One Dark Pro 即时预览界面");
    const cancelBt = clickableByText(documentStub.querySelector("#modalHost"), "取消");
    cancelBt.handlers.click[0]();
    assert(documentStub.documentElement.style["--panel"] === "#ededed", "取消选项后界面还原成 Default 配色");
    assert(SN.app.settings.editorTheme === "default", "取消选项不改动已保存的设置");
    // 保存路径：$("#...") 在桩里走 registry，先把控件值写进去再点「保存」
    SN.dlg.options();
    documentStub.querySelector("#themeSel").value = "onedarkpro";
    documentStub.querySelector("#optTab").value = "4";
    documentStub.querySelector("#optBig").value = "2";
    clickableByText(documentStub.querySelector("#modalHost"), "保存").handlers.click[0]();
    assert(SN.app.settings.editorTheme === "onedarkpro", "保存后主题落盘");
    assert(documentStub.documentElement.style["--panel"] === odpPanel, "保存后 One Dark Pro 界面仍生效（保存不回滚）");
    SN.applyEditorTheme("default");
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
    // 两个查找入口已统一：菜单只剩「查找…」，Ctrl+Shift+F 仍作为快捷方式保留在快捷键表里
    assert(accelTexts.indexOf("Ctrl+F") >= 0, "菜单提示含 Ctrl+F");
    assert(accelTexts.indexOf("Ctrl+Shift+F") < 0, "菜单已不再单列 Ctrl+Shift+F（统一进「查找…」）");
    assert(SN.shortcuts.accelOf("find.openDocs") === "Ctrl+Shift+F", "Ctrl+Shift+F 仍保留在快捷键表（默认查所有打开文件）");
    assert(byText(documentStub.querySelector("#menubar"), "视图能力表…"), "「关于」菜单下有视图能力表入口");
  }

  // 真实键位链路：document 上的 keydown 监听器应经由快捷键表分发
  {
    const handlers = documentStub.handlers.keydown || [];
    assert(handlers.length === 1, "已注册全局 keydown 监听，数量 = " + handlers.length);
    const saved = SN.dlg.find;
    const seen = [];
    SN.dlg.find = (o) => seen.push(o && o.scope);
    const fire = (o) => handlers.forEach(f => f(Object.assign({ target: { closest: () => null } }, keyEv(o))));
    fire({ ctrlKey: true, shiftKey: true, key: "F" });
    fire({ ctrlKey: true, key: "f" });
    fire({ ctrlKey: true, altKey: true, key: "f" });
    SN.dlg.find = saved;
    assert(seen.join(",") === "docs,doc", "Ctrl+Shift+F / Ctrl+F 经真实监听器分发到同一对话框的不同默认作用域，多余修饰键不触发");
  }

  // 快捷键一览对话框同样从表里取数（改键后此处自动跟随，不再是另一份硬编码清单）
  {
    SN.dlg.shortcuts();
    const texts = [];
    walkNodes(documentStub.querySelector("#modalHost"), n => { if (n.textContent) texts.push(n.textContent); });
    const all = texts.join("|");
    assert(all.indexOf("快捷键一览") >= 0, "一览对话框已打开");
    assert(all.indexOf("Ctrl+Shift+F") >= 0 && all.indexOf("查找…（默认查所有打开文件）") >= 0, "一览对话框含「默认查所有打开文件」条目");
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
    SN.dlg.find({ scope: "docs" });
    const modal = documentStub.querySelector("#modalHost");
    assert(byText(modal, "查找"), "当前是大文件时同样打开统一的「查找」对话框");
    assert(clickableByText(modal, "当前文件中查找"), "对话框提供「当前文件中查找」按钮");
    const runAll = clickableByText(modal, "查找所有打开文件");
    assert(runAll, "对话框提供「查找所有打开文件」按钮");
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

    // 统一入口下「当前文件中查找」同样走该大文件的分块检索，并自动定位到首处命中
    SN.app.activeId = b1.id;
    SN.app.findOpt.keyword = "needle";
    SN.dlg.find({ scope: "doc" });
    const docModal = documentStub.querySelector("#modalHost");
    const hereBtn = clickableByText(docModal, "当前文件中查找");
    assert(hereBtn, "「查找」对话框提供当前文件作用域");
    documentStub.querySelector("#findKey").value = "needle";
    const jumpedHere = [];
    b1._bigJump = (line) => jumpedHere.push(line);
    await hereBtn.handlers.click[0]();
    SN.closeModal();
    const hereSecs = byClass(documentStub.querySelector("#resultView"), "res-sec").map(n => n.textContent);
    assert(hereSecs.length === 1 && hereSecs[0].indexOf("a.log") >= 0, "当前文件作用域只列出该大文件，实际=" + hereSecs.join(" / "));
    assert(byClass(documentStub.querySelector("#resultView"), "res-row").length === 2, "当前文件作用域命中该文件 2 处");
    assert(jumpedHere.join(",") === "1", "无编辑器视图自动定位到首处命中行，实际=" + jumpedHere.join(","));

    // 统一查找对话框：两个作用域按钮 + 主按钮随入口切换 + 回车提交 + 视图能力提示
    {
      SN.app.activeId = b1.id;
      // 桩里 el() 建的输入框不在 registry 上，而代码用 $("#findKey") 取它；
      // 清掉上一轮对话框残留的监听，避免调用到旧闭包
      documentStub.querySelector("#findKey").handlers = {};
      SN.dlg.find({ scope: "docs" });
      const um = documentStub.querySelector("#modalHost");
      const here1 = clickableByText(um, "当前文件中查找");
      const all1 = clickableByText(um, "查找所有打开文件");
      assert(here1 && all1, "统一对话框同时提供两个作用域按钮");
      assert(String(all1.style.background).indexOf("accent") >= 0, "从 Ctrl+Shift+F 进入时「查找所有打开文件」为主按钮");
      assert(String(here1.style.background).indexOf("accent") < 0, "非默认作用域不带主色");
      const kwInput = documentStub.querySelector("#findKey");
      assert(kwInput && kwInput.handlers && kwInput.handlers.keydown, "关键字框支持回车提交");
      const umTexts = [];
      walkNodes(um, n => { if (n.textContent) umTexts.push(n.textContent); });
      assert(umTexts.join("|").indexOf("分块流式检索") >= 0, "大文件下说明检索方式（忽略大小写、不支持正则/全词）");
      // 回车 = 默认作用域（scope=docs → 所有打开文件）
      documentStub.querySelector("#findKey").value = "needle";
      kwInput.handlers.keydown[0]({ key: "Enter", preventDefault() { } });
      // 跨文档检索对每个大文件都会分块 + 让出主线程，等结果面板出现两组为止
      for (let i = 0; i < 60 && byClass(documentStub.querySelector("#resultView"), "res-sec").length < 2; i++) {
        await new Promise(r => setTimeout(r, 5));
      }
      const enterSecs = byClass(documentStub.querySelector("#resultView"), "res-sec").map(n => n.textContent);
      assert(enterSecs.length === 2, "回车按默认作用域查所有打开文件，实际=" + enterSecs.join(" / ") + "｜docs=" + SN.app.docs.map(x => x.name + ":" + x.kind).join(","));
      SN.closeModal();

      // 从 Ctrl+F 进入时主按钮切换为「当前文件中查找」
      SN.dlg.find({ scope: "doc" });
      const um2 = documentStub.querySelector("#modalHost");
      assert(String(clickableByText(um2, "当前文件中查找").style.background).indexOf("accent") >= 0, "Ctrl+F 进入时「当前文件中查找」为主按钮");
      SN.closeModal();

      // Hex 视图：当前文件不可查找（按钮禁用 + 原因），跨文档仍可用
      const hexDoc = { id: "hextest", name: "x.bin", kind: "hex", enc: "utf8", eol: "lf", lang: "txt", content: "", raw: new Uint8Array([1, 2, 3]) };
      SN.app.docs.push(hexDoc);
      SN.app.activeId = hexDoc.id;
      SN.dlg.find({ scope: "doc" });
      const um3 = documentStub.querySelector("#modalHost");
      assert(!clickableByText(um3, "当前文件中查找"), "Hex 视图下「当前文件中查找」不可点击");
      let hexHere = null;
      walkNodes(um3, n => { if (!hexHere && n.textContent === "当前文件中查找") hexHere = n; });
      assert(hexHere && hexHere.disabled === true && String(hexHere.title).indexOf("Hex 只读视图不支持查找") === 0,
        "Hex 下禁用并说明原因，实际=" + (hexHere && hexHere.title));
      assert(clickableByText(um3, "查找所有打开文件"), "跨文档查找在 Hex 视图下仍可用");
      // 统一入口：Hex 视图下 Ctrl+F 仍能打开对话框（只是当前文件作用域不可用）
      assert(SN.shortcuts.available("find.open", hexDoc) && SN.shortcuts.available("find.openDocs", hexDoc), "查找对话框在 Hex 视图也可用");
      assert(!SN.shortcuts.available("find.replace", hexDoc) && !SN.shortcuts.available("find.next", hexDoc), "替换与步进查找在 Hex 视图不可用");
      const hexTexts = [];
      walkNodes(um3, n => { if (n.textContent) hexTexts.push(n.textContent); });
      assert(hexTexts.join("|").indexOf("仍可查找其它打开的文档") >= 0, "Hex 下说明可查其它文档");
      SN.closeModal();
      SN.app.docs = SN.app.docs.filter(x => x.id !== hexDoc.id);
      SN.app.activeId = b1.id;
      SN.refreshMenus();
    }

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
      // F3/F4 是「步进查找」，需要光标定位：大文件只读视图不可用；而查找本身（Ctrl+F）仍可用
      assert(SN.shortcuts.available("find.open", b1) && !SN.shortcuts.available("find.next", b1), "大文件可用查找、不可步进查找");
      SN.shortcuts.dispatch(keyEv({ key: "F3" }));
      assert(toasts.length === 2 && toasts[1].indexOf("查找下一个/上一个") >= 0, "F3 在大文件上给出不可用说明，实际=" + toasts.join("|"));
      const savedFind2 = SN.dlg.find;
      SN.dlg.find = () => { };
      SN.shortcuts.dispatch(keyEv({ ctrlKey: true, key: "f" }));
      assert(toasts.length === 2, "可用的 Ctrl+F 不产生提示");
      SN.dlg.find = savedFind2;
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

      // 关于 → 视图能力表：只读展示，与能力矩阵/适配器同源
      SN.dlg.caps();
      const cm = documentStub.querySelector("#modalHost");
      const capCells = byClass(cm, "capcell");
      const capTexts = [];
      walkNodes(cm, n => { if (n.textContent) capTexts.push(n.textContent); });
      const capAll = capTexts.join("|");
      assert(capAll.indexOf("视图能力表") >= 0, "能力表对话框已打开");
      assert(capAll.indexOf("文本编辑") >= 0 && capAll.indexOf("大文本只读") >= 0 && capAll.indexOf("Hex 只读") >= 0, "三种视图列都在");
      assert(capAll.indexOf("（当前）") >= 0, "标出当前视图列");
      assert(capAll.indexOf("✓") >= 0 && capAll.indexOf("—") >= 0, "支持/不支持都有展示");
      assert(capCells.length === SN.caps.DISPLAY.length * 3, "每项能力三列都有单元格，实际=" + capCells.length);
      SN.closeModal();

      // 展示行与能力矩阵必须完全一致（新增能力时不会漏展示、也不会展示不存在的项）
      const shownCaps = SN.caps.DISPLAY.map(r => r[0]);
      const matrixCaps = [];
      Object.keys(SN.caps.MATRIX).forEach(k => SN.caps.MATRIX[k].caps.forEach(c => { if (matrixCaps.indexOf(c) < 0) matrixCaps.push(c); }));
      assert(matrixCaps.every(c => shownCaps.indexOf(c) >= 0), "矩阵中的能力都有展示行，缺=" + matrixCaps.filter(c => shownCaps.indexOf(c) < 0).join(","));
      assert(shownCaps.every(c => matrixCaps.indexOf(c) >= 0), "展示行都在矩阵中定义，多=" + shownCaps.filter(c => matrixCaps.indexOf(c) < 0).join(","));

      // 三个视图适配器都注册了渲染器；打开默认值与会话策略都取自适配器
      assert(!!SN.views.byKind("text").render && !!SN.views.byKind("big").render && !!SN.views.byKind("hex").render, "三种视图都注册了渲染器");
      assert(SN.views.byKind("big").open.readOnly && SN.views.byKind("big").open.keepRawBytes && SN.views.byKind("big").open.decodeMode === "head", "大文本打开默认值来自适配器");
      assert(SN.views.byKind("hex").open.decodeMode === "none" && SN.views.byKind("hex").open.fallbackEnc === "utf8", "Hex 打开默认值来自适配器");
      assert(SN.views.byKind("text").open.decodeMode === "full" && SN.views.byKind("big").persistBody === false, "文本整篇解码、只读视图不持久化正文");
      assert(SN.views.of(null).render === SN.views.byKind("text").render, "未知文档回退文本视图");
      assert(!!SN.views.byKind("big").search && !!SN.views.byKind("big").markSelection && !!SN.views.byKind("big").jumpToLine, "大文本适配器提供分块检索/标记/定位行");
      assert(!!SN.views.byKind("hex").exportBytes && !!SN.views.byKind("text").jumpToLine && !!SN.views.byKind("text").markSelection, "Hex 导出与文本定位/标记均已注册");

      // 收敛护栏：行为模块里不应再出现按视图类型的比较（一律走 SN.caps / SN.views）
      const offenders = [];
      ["js/app.js", "js/app2.js", "js/storage.js"].forEach(f => {
        fs.readFileSync(path.join(__dirname, f), "utf8").split("\n").forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "");
          if (/\bkind\s*[!=]==?\s*"(big|hex|text)"/.test(code)) offenders.push(f + ":" + (i + 1) + " " + code.trim());
        });
      });
      assert(offenders.length === 0, "行为代码不再按视图 kind 分叉：\n" + offenders.join("\n"));

      SN.app.activeId = d0.id;
      SN.refreshMenus();
    }

    // 大文件的结果同样落在可折叠分组里（与普通文档同构）：重跑一次「当前文件中查找」以保证状态确定
    SN.app.activeId = b1.id;
    documentStub.querySelector("#findKey").handlers = {};
    SN.dlg.find({ scope: "doc" });
    documentStub.querySelector("#findKey").value = "needle";
    await clickableByText(documentStub.querySelector("#modalHost"), "当前文件中查找").handlers.click[0]();
    SN.closeModal();
    const bigView = documentStub.querySelector("#resultView");
    const bigGroups = byClass(bigView, "res-group");
    const bigRows = byClass(bigView, "res-row");
    assert(bigGroups.length === 1, "大文件单文件查找出一组结果，组数=" + bigGroups.length);
    assert(bigRows.length === 2, "大文件结果行数=" + bigRows.length);
    const bigHead = byClass(bigView, "res-sec")[0];
    assert(bigHead.textContent.indexOf("a.log（2）") >= 0, "标题含文件名与命中数，实际=" + bigHead.textContent);
    bigHead.handlers.click[0]();
    assert(bigGroups[0].classList.contains("collapsed"), "大文件单文件结果同样可折叠");
    bigHead.handlers.click[0]();
    assert(!bigGroups[0].classList.contains("collapsed"), "大文件结果再次单击可展开");
  }

    // ---- 静态图标资源一致性 ----
    // 静态托管最常见的坑：manifest 引用了不存在的图标文件，本地看着没事、装上应用没图标。
    // 这里把「html/manifest 声明」与「磁盘实际文件」对齐校验。
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const mf = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.webmanifest"), "utf8"));
    const exists = (rel) => fs.existsSync(path.join(__dirname, rel));
    const pngSize = (rel) => {
      const b = fs.readFileSync(path.join(__dirname, rel));
      assert(b.slice(1, 4).toString("latin1") === "PNG", rel + " 应是 PNG");
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    assert(exists("icons/favicon.svg"), "icons/favicon.svg 存在");
    assert(exists("icons/apple-touch-icon.png"), "icons/apple-touch-icon.png 存在");
    // 母版是大尺寸图标的唯一矢量源：丢了就只能重画（这条护栏是补上次它被误删的教训）
    assert(exists("icons/stacknote-icon.svg"), "icons/stacknote-icon.svg 矢量母版存在");
    assert(fs.readFileSync(path.join(__dirname, "icons/stacknote-icon.svg"), "utf8").indexOf("<svg") === 0,
      "icons/stacknote-icon.svg 是 SVG 文件");
    assert(/<link[^>]+rel="icon"[^>]+icons\/favicon\.svg/.test(html), "index.html 引用 icons/favicon.svg");
    assert(/<link[^>]+rel="icon"[^>]+icons\/favicon\.ico/.test(html), "index.html 引用 icons/favicon.ico");
    assert(/<link[^>]+rel="apple-touch-icon"[^>]+icons\/apple-touch-icon\.png/.test(html), "index.html 引用 icons/apple-touch-icon.png");
    assert(Array.isArray(mf.icons) && mf.icons.length >= 3, "manifest 声明了 icons");
    mf.icons.forEach(ic => {
      assert(exists(ic.src), "manifest 图标文件存在：" + ic.src);
      assert(ic.type === "image/png" && /^\d+x\d+$/.test(ic.sizes || ""), "manifest 图标声明 type/sizes：" + ic.src);
      // 尺寸以声明为准，避免维护第二份硬编码清单
      const [w, h] = pngSize(ic.src);
      assert(ic.sizes === w + "x" + h, ic.src + " 实际尺寸与声明不符：声明 " + ic.sizes + "，实测 " + w + "x" + h);
    });
    assert(mf.icons.some(ic => String(ic.purpose).indexOf("maskable") >= 0), "manifest 含 maskable 图标");
    assert(fs.readFileSync(path.join(__dirname, "icons/favicon.ico")).slice(0, 4).toString("hex") === "00000100", "icons/favicon.ico 文件头合法");

  console.log("SMOKE OK, docs =", SN.app.docs.length,
    "activeId =", SN.app.activeId,
    "names =", SN.app.docs.map(d => d.name).join(","),
    "menus built =", documentStub.querySelector("#menubar").children.length);
})().catch((e) => {
  console.error("SMOKE FAIL", e);
  process.exit(1);
});
