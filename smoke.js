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
  // 标准 DOM 属性名是 parentNode；桩早期只提供了 parent，导致用 parentNode 往上找祖先的代码
  //（例如大文件视图的 insidePage / 行节点回溯）在桩里永远走不到底、相关断言失真
  Object.defineProperty(node, "parentNode", { get() { return node._parent; }, set(v) { node._parent = v; } });
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
  removeEventListener(t, f) {
    const a = this.handlers[t];
    if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }
  },
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
  // 与浏览器一致：交给 js/scrollbar.js 判断「是否桌面精确指针」；桩默认按桌面鼠标处理
  matchMedia: (q) => ({ matches: /hover:\s*hover/.test(String(q)), media: String(q) }),
  addEventListener() { },
  removeEventListener() { }
};
globals.window = globals;
globals.globalThis = globals;

const sandbox = Object.assign({}, globals);
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = [
  "js/util.js", "js/scrollbar.js", "js/viewcaps.js", "js/shortcuts.js", "js/themes.js", "js/langdefs.js", "js/highlight.js",
  "js/encoding.js", "js/hash.js", "js/storage.js", "js/editor.js",
  "js/bigtext.js",
  "js/textops.js", "js/menu.js", "js/iconui.js", "js/app.js", "js/app2.js"
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
  // 正文色是近黑 #111214（不用纯黑：纯黑在浅底上过锐，见界面配色不变量一节）
  assert(st["--ed-bg"] === "#FFFFFF" && st["--text"] === "#111214" && st["--panel"] === "#ededed", "Default 是浅色主题：界面也随之回到浅色");
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
    // 关于对话框：仓库地址与联系方式两行，且排在「功能特性」之前
    {
      const aboutTexts = [];
      walkNodes(documentStub.querySelector("#modalHost"), n => { if (n.textContent) aboutTexts.push(n.textContent); });
      const aboutText = aboutTexts.join("|");
      assert(aboutText.indexOf("仓库地址：") >= 0 && aboutText.indexOf("https://github.com/zsddyd/stacknote") >= 0,
        "关于里给出仓库地址");
      assert(aboutText.indexOf("联系我们：") >= 0 && aboutText.indexOf("stacknote@zsddyd.com") >= 0,
        "关于里给出联系方式");
      assert(aboutText.indexOf("仓库地址：") < aboutText.indexOf("功能特性") &&
        aboutText.indexOf("联系我们：") < aboutText.indexOf("功能特性"),
        "仓库与联系方式两行排在「功能特性」之前");
    }
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
    // 两个：① 快捷键表分发（js/app.js bindShortcuts）② 右键菜单键盘导航（js/menu.js，闭菜单时立即返回）
    assert(handlers.length === 2, "已注册全局 keydown 监听（快捷键分发 + 右键菜单导航），数量 = " + handlers.length);
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
      assert(!SN.shortcuts.available("find.next", hexDoc), "步进查找在 Hex 视图不可用");
      // 替换能力整体移除：快捷键表、能力表、菜单、工具栏都不应再有它
      assert(SN.shortcuts.items().every(it => it.id !== "find.replace"), "快捷键表里不再有替换项");
      assert(SN.caps.NAMES.replace === undefined && !SN.caps.can("replace", { kind: "text" }), "能力表里不再有替换能力");
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
      assert(!SN.caps.can("bookmark", bigDoc) && !SN.caps.can("view", bigDoc) && !SN.caps.can("hashSelection", bigDoc), "大文本视图不支持书签/视图开关/选中哈希");
      // 行列定位（statusPos）已补进大文本视图：语义是「选中起点行/列」或「视口首行」，只涉及可视行
      assert(SN.caps.can("statusPos", bigDoc) && !SN.caps.can("statusPos", hexDoc), "大文本支持行列定位，Hex 仍不支持");
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
      // 行列定位已补进大文本视图：切换文档后会写该视图自己的位置信息，而不是留上一个文档的旧值
      const posBig = String(documentStub.querySelector("#posLabel").textContent);
      assert(/^Ln:\d+（视口首行）/.test(posBig) || /^块:\d+\//.test(posBig),
        "切到大文件后状态栏显示该视图自己的行列信息（不再是陈旧值），实际=" + posBig);
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
      assert(allText.indexOf("Ctrl+H") < 0 && allText.indexOf("替换") < 0, "快捷键一览里已无替换（Ctrl+H）");
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
      // 支持用 ✓、不支持用 ×（不再用破折号当占位符：破折号在界面文案里一律不用）
      assert(capAll.indexOf("✓") >= 0 && capAll.indexOf("×") >= 0, "支持/不支持都有展示");
      assert(capAll.indexOf("—") < 0, "能力表里不再出现破折号占位符");
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

  // ============ 右键菜单：宿主委托 / 视图分派 / 能力置灰 / O(1) 与无泄漏（js/menu.js） ============
  {
    const ctxBox = () => documentStub.querySelector("#ctxmenu");
    // 读当前菜单：文本 = 各 span 拼接（含 ☑ 与加速键），disabled = 置灰标记
    const readMenu = (box) => byClass(box, "mi").map(n => ({
      node: n,
      text: (n.children || []).map(c => c.textContent || "").join(""),
      disabled: SN.menu.hasClass(n, "disabled"),
      title: n.title || ""
    }));
    const pick = (list, key) => list.filter(x => x.text.indexOf(key) >= 0)[0];
    const fireCtx = (host, target) => {
      const ev = {
        clientX: 12, clientY: 24, target, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; }
      };
      (host.handlers.contextmenu || []).forEach(f => f(ev));
      return ev;
    };
    const fireDoc = (type, target) => {
      const ev = { target, key: "", preventDefault() { }, stopPropagation() { } };
      (documentStub.handlers[type] || []).forEach(f => f(ev));
      return ev;
    };

    // ① 宿主委托：每个宿主只挂 1 个 contextmenu（不逐项挂监听）
    const editorZone = documentStub.querySelector("#editorZone");
    for (const sel of ["#editorZone", "#tabstrip", "#fileList", "#resultView", "#statusbar"]) {
      const n = (documentStub.querySelector(sel).handlers.contextmenu || []).length;
      assert(n === 1, sel + " 应只挂 1 个委托 contextmenu，实际 " + n);
    }
    SN.menu.bindHosts();   // 幂等：重复调用不得重复挂监听
    assert((editorZone.handlers.contextmenu || []).length === 1, "bindHosts 幂等，重复调用不重复挂监听");
    const indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    assert(indexHtml.indexOf("js/menu.js") >= 0 && indexHtml.indexOf("js/menu.js") < indexHtml.indexOf("js/app.js"),
      "index.html 里 js/menu.js 排在 js/app.js 之前（script 顺序即依赖顺序）");
    assert(/id="ctxmenu"[^>]*role="menu"/.test(indexHtml), "#ctxmenu 声明 role=menu（右键菜单容器语义）");

    // 界面图标：内联 SVG（js/iconui.js），零依赖、跟随主题色、线宽统一，工具栏不再用 emoji 字形
    {
      assert(indexHtml.indexOf("js/iconui.js") >= 0 && indexHtml.indexOf("js/iconui.js") < indexHtml.indexOf("js/app.js"),
        "index.html 里 js/iconui.js 排在 js/app.js 之前（script 顺序即依赖顺序）");
      const tbAll = byClass(documentStub.querySelector("#toolbar"), "iconbt");
      // 18 个：替换按钮随替换功能一起移除
      assert(tbAll.length >= 18, "工具栏按钮数量，实际=" + tbAll.length);
      const wantIcons = ["new", "open", "save", "saveall", "close", "closeall", "cut", "copy", "paste",
        "undo", "redo", "find", "mark", "clearmark", "zoomin", "zoomout", "wrap", "blank"];
      wantIcons.forEach(k => assert(SN.uiIcons.has(k), "内置图标含 " + k));
      assert(!SN.uiIcons.has("replace"), "图标集里不再保留替换图标");
      const svgNew = SN.uiIcons.get("new");
      assert(svgNew.indexOf("<svg") === 0 && svgNew.indexOf("<path") > 0, "图标返回完整 svg 字符串");
      assert(svgNew.indexOf('stroke="currentColor"') > 0, "图标用 currentColor，跟随主题不写死颜色");
      assert(SN.uiIcons.get("__不存在__") === "", "未知图标返回空串，调用方据此回退");
      // 线宽统一：同一套图标只有一种 stroke-width
      const widths = Array.from(new Set(SN.uiIcons.names().map(k => (SN.uiIcons.get(k).match(/stroke-width="([^"]+)"/) || [])[1])));
      assert(widths.length === 1 && widths[0] === "1.5", "所有图标共用同一 stroke-width，实际=" + widths.join(","));
      // path 数据合法性：只含 SVG 路径指令与数字
      SN.uiIcons.names().forEach(k => {
        const ds = SN.uiIcons.PATHS[k];
        assert(Array.isArray(ds) && ds.length > 0, k + " 至少有 1 条 path");
        assert(ds.every(d => /^[MmLlHhVvCcSsQqTtAaZz0-9.,\- ]+$/.test(d)), k + " 的 path 数据只含合法指令");
      });
      // 工具栏确实渲染成 SVG，且不再写 emoji 字形（emoji 仅作为模块缺失时的兜底）
      const withSvg = tbAll.filter(b => String(b.innerHTML || "").indexOf("<svg") >= 0).length;
      assert(withSvg === tbAll.length, "每个工具栏按钮都渲染 SVG，实际 " + withSvg + "/" + tbAll.length);
      assert(tbAll.every(b => !b.textContent), "工具栏不再写 emoji 字形（textContent 为空）");
      const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
      assert(!emojiRe.test(tbAll.map(b => String(b.innerHTML || "") + String(b.textContent || "")).join("")),
        "工具栏按钮里不残留 emoji / 箭头字形");
    }

    // 界面配色不变量（无障碍 / 反"AI 味"清单）：不用纯黑、阴影带底色、选中底色对白字达 WCAG AA
    {
      const themesSrc = fs.readFileSync(path.join(__dirname, "js/themes.js"), "utf8");
      const cssSrc = fs.readFileSync(path.join(__dirname, "css/sn.css"), "utf8");
      // ① 主题的 bg/fg 不得使用纯黑（纯黑在浅底上过锐，也是明令禁止的取值）
      const themeColors = themesSrc.match(/(?:bg|fg):\s*"#[0-9A-Fa-f]{6}"/g) || [];
      const pureBlack = themeColors.filter(s => /#000000/i.test(s));
      assert(pureBlack.length === 0, "主题 bg/fg 不使用纯黑，实际命中=" + pureBlack.join(","));
      // ② CSS 里不再有纯黑实色或纯黑投影（投影要带底色）
      assert(cssSrc.indexOf("#000000") < 0, "css/sn.css 不再出现 #000000");
      // #000 三位简写同样是纯黑（上一版只查了六位写法，漏掉了首屏兜底里的 --text/--ed-caret）
      assert(!/#000(?![0-9a-fA-F])/.test(cssSrc), "css/sn.css 不再出现 #000 简写纯黑");
      // 首屏兜底要和 Default 主题推导值一致，否则首帧会闪一下旧配色
      const defChrome = SN.chromeOf(SN.getTheme("default"));
      const defFg = SN.getTheme("default").fg;
      const fallback = Object.assign({}, defChrome, { "--ed-fg": defFg, "--ed-caret": defFg });
      // 检查范围 = 全部界面变量（chromeOf 的键）+ 编辑区前景/光标；取值只认 :root 首屏兜底块，
      // 且先剥掉注释，免得 --accent 那类行内注释混进取值
      const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(cssSrc.replace(/\/\*[\s\S]*?\*\//g, ""));
      assert(rootBlock, "css/sn.css 存在 :root 首屏兜底块");
      const cssVars = {};
      const varRe = /(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)/g;
      let mv;
      while ((mv = varRe.exec(rootBlock[1]))) if (cssVars[mv[1]] === undefined) cssVars[mv[1]] = mv[2].trim();
      Object.keys(fallback).forEach(k => {
        const got = cssVars[k];
        assert(got !== undefined && got.toLowerCase() === String(fallback[k]).toLowerCase(),
          "首屏兜底 " + k + " 与 Default 主题一致，实际=" + got + " 期望=" + fallback[k]);
      });
      assert(cssSrc.indexOf("rgba(0,0,0") < 0, "css/sn.css 不再出现纯黑半透明（阴影需带底色）");
      assert(/box-shadow:[^;]*rgba\(\s*38\s*,\s*40\s*,\s*44/.test(cssSrc), "投影使用带底色的 rgba(38,40,44,…)");
      // ③ 选中底色 + 白字达到 WCAG AA 4.5:1（白字用在工具栏激活态/菜单 hover/结果命中上）
      const toRgb = (hex) => {
        const h = String(hex).trim();
        const m = /^#([0-9a-f]{6})$/i.exec(h);
        if (!m) return null;
        return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
      };
      const relLum = (hex) => {
        const c = toRgb(hex);
        if (!c) return null;
        const f = c.map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
      };
      const contrast = (a, b) => {
        const la = relLum(a), lb = relLum(b);
        if (la == null || lb == null) return null;
        const hi = Math.max(la, lb), lo = Math.min(la, lb);
        return (hi + 0.05) / (lo + 0.05);
      };
      const ids = (themesSrc.match(/id:\s*"([a-z_0-9]+)"/g) || []).map(s => s.split('"')[1]);
      assert(ids.length >= 15, "主题数量，实际=" + ids.length);
      const bad = [];
      ids.forEach(id => {
        const vars = SN.chromeOf(SN.getTheme(id));
        const r = contrast(vars["--selection"], "#FFFFFF");
        if (r == null || r < 4.5) bad.push(id + "=" + (r == null ? "解析失败" : r.toFixed(2)));
      });
      assert(bad.length === 0, "每套主题的选中底色 + 白字都达到 WCAG AA 4.5:1，未达标=" + bad.join(","));
      // ④ 圆角刻度统一（0/2/3/4 四档）且有文档说明；不再出现刻度外的取值
      assert(cssSrc.indexOf("圆角刻度") >= 0, "css/sn.css 写明了圆角刻度来源");
      assert(cssSrc.indexOf("border-radius:1px") < 0, "圆角不再出现刻度外的 1px");
      // ⑤ 触觉反馈 + 减少动态效果的兜底
      assert(cssSrc.indexOf("button:active") >= 0, "按钮有按下反馈（:active）");
      assert(cssSrc.indexOf("prefers-reduced-motion") >= 0, "有 prefers-reduced-motion 兜底");
      // ⑥ 滚动条：各平台原生绘制差异大（Windows 常驻槽位 + 步进箭头、macOS overlay 会淡出、
      // Linux 随 GTK 变），统一自绘并跟随主题 —— 尺寸固定、去掉箭头与交汇方块、颜色只引用主题变量
      const sbBlock = (sel) => {
        const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(cssSrc);
        return m ? m[1] : "";
      };
      const sbBar = sbBlock("::-webkit-scrollbar");
      assert(/width\s*:\s*var\(--sb-size\)/.test(sbBar) && /height\s*:\s*var\(--sb-size\)/.test(sbBar),
        "垂直与水平滚动条共用 --sb-size，粗细跨平台一致");
      assert(/^\d+px$/.test(String(cssVars["--sb-size"]).trim()),
        "--sb-size 是固定像素值，实际=" + cssVars["--sb-size"]);
      assert(/display\s*:\s*none/.test(sbBlock("::-webkit-scrollbar-button")),
        "去掉 Windows 的步进箭头按钮（平台差异最大的来源之一）");
      assert(/background(?:-color)?\s*:\s*var\(--sb-track\)/.test(sbBlock("::-webkit-scrollbar-track")),
        "轨道颜色来自主题变量 --sb-track");
      const sbThumb = sbBlock("::-webkit-scrollbar-thumb");
      assert(/background-color\s*:\s*var\(--sb-thumb\)/.test(sbThumb), "滑块颜色来自主题变量 --sb-thumb");
      assert(/background-clip\s*:\s*content-box/.test(sbThumb), "滑块用 content-box 裁切内缩出比槽位窄的视觉宽度");
      assert(/::-webkit-scrollbar-thumb:hover[^{]*\{[^}]*var\(--sb-thumb-hover\)/.test(cssSrc),
        "滑块 hover 态用 --sb-thumb-hover");
      assert(/::-webkit-scrollbar-corner\{[^}]*background:transparent/.test(cssSrc), "两轴交汇方块显式绘制为透明");
      assert(/\.ed-input::-webkit-scrollbar-track[^{]*\{[^}]*var\(--ed-bg\)/.test(cssSrc),
        "编辑区轨道铺编辑区底色，高亮文本不会从槽位里透出来");
      assert(/@supports\s+not\s*\(\s*selector\(::-webkit-scrollbar\)\s*\)/.test(cssSrc) &&
        /scrollbar-color:var\(--sb-thumb\)\s+var\(--sb-track\)/.test(cssSrc) &&
        /scrollbar-width:thin/.test(cssSrc),
        "Firefox 退回标准属性（scrollbar-color + scrollbar-width:thin），颜色仍跟随主题");
      // 自绘样式里不许写死色值，否则换主题时滚动条不跟随
      const sbRules = cssSrc.match(/::-webkit-scrollbar[a-z-]*\{[^}]*\}/g) || [];
      const sbHardColor = sbRules.join("").match(/#[0-9a-fA-F]{3,8}|rgba?\(/g) || [];
      assert(sbRules.length >= 5 && sbHardColor.length === 0,
        "滚动条样式不写死颜色，实际=" + sbHardColor.join(","));
      // ⑦ 自绘滚动条（js/scrollbar.js）：内容极长时原生滑块会缩到十几像素，Chromium 又忽略
      //    ::-webkit-scrollbar-thumb 的 min-height，所以长内容容器改用自绘 overlay 滑块
      assert(cssSrc.indexOf("sb-native-hidden") >= 0, "css 提供隐藏原生滚动条的 .sb-native-hidden");
      assert(/\.sb-track\.sb-v\{[^}]*width:var\(--sb-size\)/.test(cssSrc), "自绘垂直轨道与 --sb-size 同宽");
      assert(/\.sb-track\.sb-h\{[^}]*height:var\(--sb-size\)/.test(cssSrc), "自绘水平轨道与 --sb-size 同高");
      assert(/\.sb-thumb\{[^}]*background-color:var\(--sb-thumb\)/.test(cssSrc), "自绘滑块颜色来自主题变量");
      assert(/\.sb-thumb:hover[^{]*\{[^}]*var\(--sb-thumb-hover\)/.test(cssSrc), "自绘滑块 hover 用主题变量");
      assert(/\.sb-thumb\.dragging/.test(cssSrc), "拖动中保持高亮（有按下反馈）");
      assert(/\.ed-main \.sb-track[^{]*\{[^}]*var\(--ed-bg\)/.test(cssSrc), "编辑区自绘轨道铺编辑区底色");
      assert(/\.sb-touch \.sb-track\{pointer-events:none\}/.test(cssSrc) &&
        /\.sb-touch \.sb-thumb\{pointer-events:auto\}/.test(cssSrc),
        "触屏：轨道不拦事件（整片仍可触摸滚动），只有滑块可拖");
      assert(/\.sb-touch \.sb-thumb::after\{[^}]*inset:-8px/.test(cssSrc),
        "触屏：滑块热区外扩 8px（视觉不变，命中区 24px）");
      assert(/\.sb-mar-r\{margin-right:var\(--sb-size\)\}/.test(cssSrc) &&
        /\.sb-mar-b\{margin-bottom:var\(--sb-size\)\}/.test(cssSrc),
        "滚动元素让出同宽槽位（margin，不用宿主 padding），自绘滑块不盖住最后一行/行尾");
      assert(/\.ed-input\.sb-mar-r\{[^}]*width:auto\}/.test(cssSrc) &&
        /\.ed-input\.sb-mar-b\{[^}]*height:auto\}/.test(cssSrc),
        "textarea 让位时改回 width/height:auto（它显式写了 100%，且 .ed-input 的 margin:0 会盖掉通用让位规则）");
      // 纯函数：长度下限按「窗口像素」兜底，而不是跟着内容继续等比缩短
      const TL = SN.scrollbar.thumbLen;
      assert(SN.scrollbar.MIN_THUMB >= 44, "滑块最小长度不小于 44px（WCAG 2.5.5 目标尺寸），实际=" + SN.scrollbar.MIN_THUMB);
      const hugeLen = TL(441, 440008, 441);
      assert(hugeLen === SN.scrollbar.MIN_THUMB,
        "内容 44 万 px / 视口 441px 时滑块取下限 " + SN.scrollbar.MIN_THUMB + "px（原生只有 13px），实际=" + hugeLen);
      assert(TL(441, 882, 441) === 221, "内容 2 倍视口时滑块约占轨道一半，实际=" + TL(441, 882, 441));
      assert(TL(441, 441, 441) === 441, "不溢出时滑块铺满轨道，实际=" + TL(441, 441, 441));
      assert(TL(0, 1000, 441) === 0 && TL(441, 0, 441) === 441,
        "视口为 0 时滑块归 0；内容不可知（total=0）按不溢出处理铺满轨道，都不产生 NaN");
      assert(TL(441, 440008, 20) <= 10, "轨道极短时滑块不超过轨道一半，实际=" + TL(441, 440008, 20));
      let prevLen = Infinity, mono = true;
      [2, 10, 100, 1000, 100000].forEach(k => {
        const v = TL(441, 441 * k, 441);
        if (v > prevLen) mono = false;
        prevLen = v;
      });
      assert(mono, "内容越长滑块越短（单调不增）");
      // 接入点与依赖顺序：模块本身要排在两个使用者之前
      const editorSrc = fs.readFileSync(path.join(__dirname, "js/editor.js"), "utf8");
      const bigtextSrc = fs.readFileSync(path.join(__dirname, "js/bigtext.js"), "utf8");
      assert(/SN\.scrollbar\.attach\(/.test(editorSrc), "js/editor.js 给编辑器 textarea 接入了自绘滚动条");
      assert(/SN\.scrollbar\.attach\(/.test(bigtextSrc), "js/bigtext.js 给大文件视口接入了自绘滚动条");
      const idxHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
      assert(idxHtml.indexOf("js/scrollbar.js") >= 0, "index.html 引入了 js/scrollbar.js");
      assert(idxHtml.indexOf("js/scrollbar.js") < idxHtml.indexOf("js/editor.js") &&
        idxHtml.indexOf("js/scrollbar.js") < idxHtml.indexOf("js/bigtext.js"),
        "js/scrollbar.js 排在 js/editor.js / js/bigtext.js 之前（script 顺序即依赖顺序）");
      // 行为：桩容器上 attach 出两条轨道，极长内容下取最小长度，拖动按比例跟随
      const sbScroller = SN.el("div", { class: "fake-scroller" });
      const sbHost = SN.el("div", { class: "fake-host" });
      sbHost.appendChild(sbScroller);
      sbScroller.clientHeight = 441;
      sbScroller.scrollHeight = 440008;
      sbScroller.clientWidth = 400;
      sbScroller.scrollWidth = 40000;
      sbScroller.scrollTop = 220000;
      const sbApi = SN.scrollbar.attach(sbScroller, sbHost);
      const sbTracks = sbHost.children.filter(c => /sb-track/.test(String(c.className)));
      assert(sbApi && sbTracks.length === 2, "attach 在宿主上挂出垂直/水平两条轨道，实际=" + sbTracks.length);
      assert(sbScroller.classList.contains("sb-native-hidden"), "attach 后隐藏原生滚动条");
      assert(sbApi.vertical.thumb.style.height === "48px",
        "极长内容下垂直滑块高度取最小长度，实际=" + sbApi.vertical.thumb.style.height);
      assert(sbApi.horizontal.thumb.style.width === "48px",
        "极宽内容下水平滑块宽度取最小长度，实际=" + sbApi.horizontal.thumb.style.width);
      assert(sbScroller.classList.contains("sb-mar-r") && sbScroller.classList.contains("sb-mar-b"),
        "两轴都溢出时滚动元素同时让出右/下槽位，滑块不盖内容");
      assert(SN.scrollbar.attach(sbScroller, sbHost) === sbApi, "重复 attach 幂等，返回同一实例");
      // 触屏分支：没有精确指针但有触摸能力 → 宿主标记 sb-touch（轨道让出事件），滑块热区靠 CSS 扩大
      const sbTouch = SN.el("div", { class: "fake-scroller" });
      const sbTouchHost = SN.el("div", { class: "fake-host" });
      sbTouchHost.appendChild(sbTouch);
      sbTouch.clientHeight = 400;
      sbTouch.scrollHeight = 4000;
      sbTouch.clientWidth = 300;
      sbTouch.scrollWidth = 300;
      const sbSavedTouches = sandbox.navigator.maxTouchPoints;
      sandbox.navigator.maxTouchPoints = 5;               // 模拟安卓手机
      const sbTouchApi = SN.scrollbar.attach(sbTouch, sbTouchHost);
      sandbox.navigator.maxTouchPoints = sbSavedTouches;
      assert(sbTouchApi && sbTouchHost.classList.contains("sb-touch"),
        "触屏设备同样接管绘制（安卓原生 overlay 静止即隐藏，看不见也拖不到）");
      assert(sbTouchApi && sbTouch.classList.contains("sb-mar-r") &&
        !sbTouch.classList.contains("sb-mar-b"),
        "触屏同样按轴让位：只溢出纵向时只让底部");
      // 内容不溢出时不该白留空槽位
      const sbPlain = SN.el("div", { class: "fake-scroller" });
      const sbPlainHost = SN.el("div", { class: "fake-host" });
      sbPlainHost.appendChild(sbPlain);
      sbPlain.clientHeight = 400;
      sbPlain.scrollHeight = 400;
      sbPlain.clientWidth = 300;
      sbPlain.scrollWidth = 300;
      SN.scrollbar.attach(sbPlain, sbPlainHost);
      assert(!sbPlain.classList.contains("sb-mar-r") && !sbPlain.classList.contains("sb-mar-b"),
        "内容不溢出时不让位，不留空槽");
      const sbEvt = (y) => ({ clientY: y, clientX: y, button: 0, pointerId: 1, preventDefault() { }, stopPropagation() { } });
      const sbMoveCount = () => (sandbox.document.handlers.pointermove || []).length;
      const sbUpCount = () => (sandbox.document.handlers.pointerup || []).length;
      const sbMovesBefore = sbMoveCount(), sbUpsBefore = sbUpCount();
      sbApi.vertical.thumb.handlers.pointerdown[0](sbEvt(100));
      assert(sbMoveCount() === sbMovesBefore + 1 && sbUpCount() === sbUpsBefore + 1,
        "按下滑块后挂上 document 级 pointermove/pointerup（拖出滑块也跟手）");
      (sandbox.document.handlers.pointermove || [])[sbMoveCount() - 1](sbEvt(200));
      const sbWant = 220000 + Math.round(100 * ((440008 - 441) / (441 - 48)));
      assert(Math.abs(sbScroller.scrollTop - sbWant) <= 2,
        "拖动 100px 后滚动位置按比例跟随（期望 " + sbWant + "，实际=" + sbScroller.scrollTop + "）");
      (sandbox.document.handlers.pointerup || [])[sbUpCount() - 1](sbEvt(200));
      assert(sbMoveCount() === sbMovesBefore && sbUpCount() === sbUpsBefore, "松开后解绑 document 级拖动监听，不留悬挂监听");
      assert(/^[0-9]{1,3}$/.test(String(sbApi.vertical.thumb["aria-valuenow"])),
        "自绘滑块同步 aria-valuenow（读屏能知道滚动位置），实际=" + sbApi.vertical.thumb["aria-valuenow"]);
    }

    // ② 文本视图：右键接管、菜单项齐备、不含「粘贴」、且不触发编辑器渲染
    const d0 = SN.app.docs.filter(d => d.editor)[0];
    assert(d0, "存在可编辑文本文档");
    SN.app.activeId = d0.id;
    d0.editor.setText("hello world\nfoo bar\nend", [0, 0]);
    let rendered = 0;
    const savedRender = d0.editor.render, savedSchedule = d0.editor.scheduleRender;
    d0.editor.render = () => { rendered++; };
    d0.editor.scheduleRender = () => { rendered++; };
    const evText = fireCtx(editorZone, d0.editor.ta);
    assert(evText.defaultPrevented && evText.stopped, "文本区右键接管原生菜单（preventDefault + stopPropagation）");
    assert(!ctxBox().classList.contains("hidden"), "右键后菜单可见");
    const textMenu = readMenu(ctxBox());
    for (const want of ["撤销", "复制", "清除全部标记", "标记颜色", "大小写转换", "行编辑", "空白字符操作", "书签", "查找…", "跳转行…", "列块编辑…"]) {
      assert(pick(textMenu, want), "文本右键菜单含「" + want + "」");
    }
    assert(!pick(textMenu, "全部标记(Mark All)"), "右键菜单不再给「全部标记」（整体性入口留在顶栏/查找面板）");
    assert(textMenu.every(x => x.text.indexOf("粘贴") < 0), "右键菜单不含「粘贴」：脚本不读剪贴板，粘贴请用 Ctrl+V");
    const textMenuItems = textMenu.filter(x => !SN.menu.hasClass(x.node, "sep"));
    assert(textMenuItems.length > 0 && textMenuItems.every(x => x.node.role === "menuitem"),
      "右键菜单项带 menuitem 语义（容器声明 role=menu 的配套）");
    assert(pick(textMenu, "复制").disabled, "无选区时「复制」置灰");
    assert(rendered === 0, "打开右键菜单不触发编辑器渲染，实际 render 次数=" + rendered);
    d0.editor.render = savedRender;
    d0.editor.scheduleRender = savedSchedule;

    // ③ 子菜单：hover/点击展开、调色板勾选、stay+rebuild、逐级关闭
    const colorRow = pick(textMenu, "标记颜色");
    colorRow.node.handlers.click[0]({ stopPropagation() { } });
    let pop = byClass(documentStub.body, "menu-pop")[0];
    assert(pop, "「标记颜色」点击后展开子菜单（.menu-pop）");
    const colorItems = readMenu(pop);
    assert(colorItems.length === SN.app.MARK_COLORS.length, "调色板子菜单项数 = 可用标记颜色数");
    pick(colorItems, "颜色 2").node.handlers.click[0]({ stopPropagation() { } });
    assert(SN.app.curMarkColor === SN.app.MARK_COLORS[1], "点选颜色后当前标记色切换");
    pop = byClass(documentStub.body, "menu-pop")[0];
    assert(pick(readMenu(pop), "颜色 2").text.indexOf("☑") === 0, "stay+rebuild：子菜单重绘并勾选新颜色");
    assert(!ctxBox().classList.contains("hidden"), "stay 项不关闭菜单");

    // ③b 选区记忆：右键菜单抢焦点/浏览器折叠光标后，「标记颜色」仍要作用于用户刚才选的那段文本
    //     （修复前：hasSelection() 已是 false → kw 为空 → 既不标记也不提示，观感就是「点了没反应」）
    {
      const ed = d0.editor;
      SN.menu.closeCtx();
      SN.cmd.clearMarksAll();        // 前面段落已在这份编辑器上标过 alpha/beta，先清空让断言确定
      ed.setText("alpha beta alpha\n", [0, 5]);
      ed.rememberSelection();        // 真实浏览器里由 select/mouseup 触发（桩不派发真实事件）
      ed.ta.setSelectionRange(5, 5);  // 模拟「右键/抢焦点把光标折叠掉」
      assert(ed.hasSelection() === false, "前提：当前选区已被折叠");
      assert(ed.effectiveSelectedText() === "alpha", "折叠后仍能取回最近一次有效选区文本");
      fireCtx(editorZone, ed.ta);
      const menuSel = readMenu(ctxBox());
      assert(!pick(menuSel, "复制").disabled, "光标被折叠后「复制」仍可用（以记忆的选区为准）");
      pick(menuSel, "标记颜色").node.handlers.click[0]({ stopPropagation() { } });
      const palSel = readMenu(byClass(documentStub.body, "menu-pop")[0]);
      pick(palSel, "颜色 3").node.handlers.click[0]({ stopPropagation() { } });
      assert(ed.markRecords.length === 1 && ed.markRecords[0].keyword === "alpha",
        "右键「标记颜色」把用户刚才选中的词标记了出来，实际=" + JSON.stringify(ed.markRecords.map(r => r.keyword)));
      assert(ed.markRecords[0].color === SN.app.MARK_COLORS[2], "标记用的是刚点的那个颜色");
      assert(ed.ta.selectionStart === 0 && ed.ta.selectionEnd === 5,
        "点颜色时把「打开菜单那一刻」的选区还原回编辑器，实际=" + ed.ta.selectionStart + "," + ed.ta.selectionEnd);

      // 更危险的退化：选区被折叠后走「大小写转换」，绝不能把整篇都改掉
      SN.menu.closeCtx();
      ed.clearLastSelection();
      ed.setText("alpha beta\n", [0, 5]);
      ed.rememberSelection();          // 用户选了 "alpha"
      ed.ta.setSelectionRange(5, 5);   // 右键把它折叠
      fireCtx(editorZone, ed.ta);
      pick(readMenu(ctxBox()), "大小写转换").node.handlers.click[0]({ stopPropagation() { } });
      pick(readMenu(byClass(documentStub.body, "menu-pop")[0]), "UPPERCASE").node.handlers.click[0]({ stopPropagation() { } });
      assert(ed.text === "ALPHA beta\n",
        "折叠光标后「大小写转换」仍只作用于菜单打开时的选区（而不是整篇），实际=" + JSON.stringify(ed.text));

      // 真的没有选中内容时必须给出提示，不能再静默
      SN.menu.closeCtx();
      ed.clearLastSelection();
      ed.ta.setSelectionRange(0, 0);
      fireCtx(editorZone, ed.ta);
      pick(readMenu(ctxBox()), "标记颜色").node.handlers.click[0]({ stopPropagation() { } });
      pick(readMenu(byClass(documentStub.body, "menu-pop")[0]), "颜色 5").node.handlers.click[0]({ stopPropagation() { } });
      assert(String(documentStub.querySelector("#msgLabel").textContent).indexOf("请先选中") >= 0,
        "没有选中内容时明确提示而不是静默，实际=" + documentStub.querySelector("#msgLabel").textContent);
      SN.menu.closeCtx();
      ed.setText("hello world\nfoo bar\nend", [0, 0]);   // 还原给后续断言
      // 后续 Esc 段落的前提是「菜单开着、且子菜单也开着」，这里把状态摆回去
      fireCtx(editorZone, ed.ta);
      pick(readMenu(ctxBox()), "标记颜色").node.handlers.click[0]({ stopPropagation() { } });
    }

    const keyHandlers = documentStub.handlers.keydown || [];
    const esc = () => ({ key: "Escape", target: ctxBox(), preventDefault() { }, stopPropagation() { } });
    keyHandlers.forEach(f => f(esc()));
    assert(!byClass(documentStub.body, "menu-pop").length, "Esc 先关闭子菜单");
    assert(!ctxBox().classList.contains("hidden"), "Esc 第一下只关子菜单");
    keyHandlers.forEach(f => f(esc()));
    assert(ctxBox().classList.contains("hidden"), "Esc 第二下关闭右键菜单");
    assert(d0.editor.ta._focused === true, "Esc 关闭后焦点回到编辑器");

    // hover 展开/收起子菜单（Win32 习惯）：根菜单 hover 子项开、hover 普通项关，子菜单内部不挂 hover
    fireCtx(editorZone, d0.editor.ta);
    pick(readMenu(ctxBox()), "大小写转换").node.handlers.mouseenter[0]();
    const hoveredPop = byClass(documentStub.body, "menu-pop")[0];
    assert(hoveredPop, "hover 子菜单项即展开子菜单");
    assert(!(hoveredPop.children[0].handlers.mouseenter), "子菜单内部不挂 hover（否则鼠标移入会自关）");
    pick(readMenu(ctxBox()), "撤销").node.handlers.mouseenter[0]();
    assert(!byClass(documentStub.body, "menu-pop").length, "hover 普通项收起子菜单");
    SN.menu.closeCtx();

    // ④ 关闭路径：点击别处 / 滚动（document 级监听，各 1 个）
    assert((documentStub.handlers.mousedown || []).length === 1, "document 只挂 1 个 mousedown（关闭右键菜单）");
    assert((documentStub.handlers.scroll || []).length === 1, "document 只挂 1 个 scroll（关闭右键菜单）");
    fireCtx(editorZone, d0.editor.ta);
    fireDoc("mousedown", documentStub.createElement("div"));
    assert(ctxBox().classList.contains("hidden"), "点击菜单外关闭右键菜单");
    fireCtx(editorZone, d0.editor.ta);
    fireDoc("scroll", d0.editor.ta);
    assert(ctxBox().classList.contains("hidden"), "编辑器滚动关闭右键菜单");

    // ⑤ 大文本 / Hex 视图菜单按能力表收敛
    const bigDoc = { id: "ctxBig", name: "big.log", kind: "big", enc: "utf8", eol: "lf", lang: "txt", content: "", raw: new TextEncoder().encode("a\nb\n") };
    SN.menu.openCtx(10, 20, SN.views.of(bigDoc).contextMenu(bigDoc), { doc: bigDoc });
    const bigMenu = readMenu(ctxBox());
    for (const want of ["清除全部标记", "标记颜色", "查找…", "跳转行…", "复制选中内容", "导出原始文件", "重命名…"]) {
      assert(pick(bigMenu, want), "大文本右键菜单含「" + want + "」");
    }
    assert(!pick(bigMenu, "全部标记(Mark All)"), "大文本右键菜单不含「全部标记」（点颜色已经标记当前目标）");
    assert(!pick(bigMenu, "撤销") && !pick(bigMenu, "另存为"), "大文本右键菜单不给编辑/保存入口");
    assert(pick(bigMenu, "复制选中内容").disabled, "大文本视图无选中时「复制选中内容」置灰");
    const hexDoc = { id: "ctxHex", name: "x.bin", kind: "hex", enc: "utf8", eol: "lf", lang: "txt", content: "", raw: new Uint8Array([0, 1, 2, 3]) };
    SN.menu.openCtx(10, 20, SN.views.of(hexDoc).contextMenu(hexDoc), { doc: hexDoc });
    const hexMenu = readMenu(ctxBox());
    for (const want of ["导出原始文件", "以文本模式重载", "重命名…"]) {
      assert(pick(hexMenu, want), "Hex 右键菜单含「" + want + "」");
    }
    assert(!pick(hexMenu, "查找…") && !pick(hexMenu, "撤销"), "Hex 右键菜单不给查找/编辑入口");
    assert(SN.caps.can("rename", hexDoc), "Hex 视图能力表含重命名（右键菜单据此提供入口）");

    // ⑥ O(1)：菜单节点数与文档长度无关（3MB 与 3 行完全一致）
    const edBig = new SN.Editor({ readOnly: false, wrap: false, langId: "txt", zoom: 100 });
    edBig.setText("x".repeat(3 * 1024 * 1024) + "\n", [0, 0]);
    const bigTextDoc = { id: "ctx3mb", name: "m3.txt", kind: "text", enc: "utf8", eol: "lf", lang: "txt", content: "", editor: edBig };
    SN.menu.openCtx(10, 20, SN.views.of(d0).contextMenu(d0, {}), { doc: d0 });
    const nSmall = byClass(ctxBox(), "mi").length;
    SN.menu.openCtx(10, 20, SN.views.of(bigTextDoc).contextMenu(bigTextDoc, {}), { doc: bigTextDoc });
    const nBig = byClass(ctxBox(), "mi").length;
    assert(nSmall === nBig && nSmall > 10, "菜单节点数与文档长度无关（O(1)），实际 " + nSmall + " vs " + nBig);

    // ⑦ 反复开合不累积监听器（旧实现每次打开都挂一个 document {once:true} 监听）
    const clickBefore = (documentStub.handlers.click || []).length;
    const keyBefore = (documentStub.handlers.keydown || []).length;
    for (let i = 0; i < 3; i++) { SN.menu.closeCtx(); fireCtx(editorZone, d0.editor.ta); }
    SN.menu.closeCtx();
    assert((documentStub.handlers.click || []).length === clickBefore, "反复开合不累积 click 监听");
    assert((documentStub.handlers.keydown || []).length === keyBefore, "反复开合不累积 keydown 监听");

    // ⑧ 文件列表项：与标签栏共用文档菜单；只读视图的「另存为」按能力置灰
    SN.app.docs.push(hexDoc);
    const fileList = documentStub.querySelector("#fileList");
    const li = documentStub.createElement("li");
    li.dataset.id = d0.id;
    assert(fireCtx(fileList, li).defaultPrevented, "文件列表项右键接管原生菜单");
    for (const want of ["关闭当前文档", "重命名…", "重新打开为（当前：文本编辑）"]) {
      assert(pick(readMenu(ctxBox()), want), "文件列表右键菜单含「" + want + "」");
    }
    // 视图切换收进子菜单：三项齐全，且当前所在视图置灰
    pick(readMenu(ctxBox()), "重新打开为").node.handlers.click[0]({ stopPropagation() { } });
    const viewSub = readMenu(byClass(documentStub.body, "menu-pop")[0]);
    for (const want of ["文本编辑", "大文本只读", "二进制(Hex)只读"]) {
      assert(pick(viewSub, want), "「重新打开为」子菜单含「" + want + "」");
    }
    assert(pick(viewSub, "文本编辑").disabled, "当前视图（文本编辑）在子菜单里置灰");
    SN.menu.closeCtx();
    li.dataset.id = hexDoc.id;
    fireCtx(fileList, li);
    const hexDocMenu = readMenu(ctxBox());
    assert(pick(hexDocMenu, "另存为…").disabled, "只读视图下文件列表「另存为」置灰");
    assert(pick(hexDocMenu, "另存为…").title.indexOf("Hex 只读视图不支持保存") === 0,
      "置灰项说明原因，实际=" + pick(hexDocMenu, "另存为…").title);
    assert(pick(hexDocMenu, "重新打开为（当前：Hex 只读）"), "Hex 视图的「重新打开为」标题标出当前视图");
    pick(hexDocMenu, "重新打开为").node.handlers.click[0]({ stopPropagation() { } });
    const hexViewSub = readMenu(byClass(documentStub.body, "menu-pop")[0]);
    assert(pick(hexViewSub, "二进制(Hex)只读").disabled, "Hex 视图下「二进制(Hex)只读」置灰（就是当前视图）");
    assert(!pick(hexViewSub, "文本编辑").disabled && !pick(hexViewSub, "大文本只读").disabled,
      "Hex 视图可切回文本编辑或大文本只读");
    SN.menu.closeCtx();

    // ⑨ 结果行/分组头：跳转与左键同源、复制入口齐备（回归此前未覆盖的右键面）
    const resultView = documentStub.querySelector("#resultView");
    const row = documentStub.createElement("div");
    row.className = "res-row";
    row.dataset.doc = d0.id; row.dataset.start = 0; row.dataset.end = 5; row.dataset.line = 1;
    const lnn = documentStub.createElement("span"); lnn.className = "lnn"; lnn.textContent = "行 1:";
    const content = documentStub.createElement("span"); content.textContent = "hello";
    row.appendChild(lnn); row.appendChild(content);
    assert(fireCtx(resultView, row).defaultPrevented, "结果行右键接管原生菜单");
    const rowMenu = readMenu(ctxBox());
    for (const want of ["跳转到该行", "复制该行文本", "复制行号+文本", "复制全部结果"]) {
      assert(pick(rowMenu, want), "结果行右键菜单含「" + want + "」");
    }
    SN.app.activeId = "none";
    pick(rowMenu, "跳转到该行").node._activate();
    assert(SN.app.activeId === d0.id, "「跳转到该行」切到命中文档（与左键点击同源）");

    // ⑩ 状态栏四变体：编码格 / 语言格 / 行尾格 / 其它
    const statusbar = documentStub.querySelector("#statusbar");
    const cellWith = (id) => { const n = documentStub.createElement("span"); n.id = id; return n; };
    assert(fireCtx(statusbar, cellWith("codeLabel")).defaultPrevented, "状态栏右键接管原生菜单");
    const codeMenu = readMenu(ctxBox());
    assert(pick(codeMenu, "以编码重新加载") && pick(codeMenu, "转换为编码"), "编码格右键给编码菜单");
    fireCtx(statusbar, cellWith("langLabel"));
    assert(pick(readMenu(ctxBox()), "用户自定义语言…"), "语言格右键给语言菜单");
    fireCtx(statusbar, cellWith("eolSel"));
    assert(pick(readMenu(ctxBox()), "转为 Unix(LF)"), "行尾格右键给换行符转换菜单");
    fireCtx(statusbar, cellWith("msgLabel"));
    const barMenu = readMenu(ctxBox());
    for (const want of ["工具栏", "文件列表窗口", "查找结果面板", "放大", "缩小", "重置为 100%"]) {
      assert(pick(barMenu, want), "状态栏通用右键菜单含「" + want + "」");
    }
    SN.menu.closeCtx();
    assert(ctxBox().classList.contains("hidden"), "关闭后 #ctxmenu 归位隐藏");

    // ⑪ 剪贴板工具：优先 clipboard.writeText，缺失/失败时退回 execCommand，全程不抛异常
    {
      assert(await SN.menu.copyText("hello") === true, "有 clipboard.writeText 时复制成功");
      const savedClip = sandbox.navigator.clipboard;
      sandbox.navigator.clipboard = undefined;
      assert(await SN.menu.copyText("hello") === false, "无 clipboard 且无 execCommand 时安全失败");
      sandbox.navigator.clipboard = savedClip;
    }

    // ⑫ 大文件视图：右键「标记颜色」必须以「打开菜单那一刻的选区」为准
    //     （修复前：折叠 selectionchange 会把 bigSel 清空 → 永远提示「请先选中要高亮的文本」）
    {
      // 造一个走完整 buildPage 流程的大文件文档（pageEl/适配器都齐全）
      const big = {
        id: "ctxBigReal", name: "real.log", kind: "big", enc: "utf8", eol: "lf", lang: "txt",
        content: "", raw: new TextEncoder().encode("alpha needle\nbeta line\nneedle two\n")
      };
      SN.addDoc(big);
      SN.activateDoc(big.id);
      assert(big.pageEl && typeof big.bigSetSelected === "function" && typeof big._bigKeywordAt === "function",
        "大文件视图注册了「固定右键目标」与「右键落点取词」");
      const savedGet = sandbox.window.getSelection;
      big.bigSetSelected("");
      // 大文件视图的「页」是 .page 里的 .bigview（selectionchange 以它为界判断是否属于本视图）
      const bigView = big.pageEl.children[0];
      // 拖选 → 记录
      sandbox.window.getSelection = () => ({ anchorNode: bigView, isCollapsed: false, toString: () => "needle" });
      (documentStub.handlers.selectionchange || []).forEach(f => f());
      assert(big.bigSelected() === "needle", "大文件里拖选后记下目标词，实际=" + JSON.stringify(big.bigSelected()));
      // 右键/菜单抢焦点 → 浏览器报「折叠」，不得因此清空记忆（这条就是本次 bug）
      sandbox.window.getSelection = () => ({ anchorNode: bigView, isCollapsed: true, toString: () => "" });
      (documentStub.handlers.selectionchange || []).forEach(f => f());
      assert(big.bigSelected() === "needle", "折叠不再清掉大文件的选区记忆");
      sandbox.window.getSelection = savedGet;

      big.bigMarks = [];
      SN.app.activeId = big.id;
      fireCtx(editorZone, bigView);
      const bigMenuReal = readMenu(ctxBox());
      assert(!pick(bigMenuReal, "复制选中内容").disabled, "有目标时大文件菜单「复制选中内容」可用");
      assert(!pick(bigMenuReal, "标记颜色").disabled, "大文件菜单「标记颜色」可用（requires=mark）");
      pick(bigMenuReal, "标记颜色").node.handlers.click[0]({ stopPropagation() { } });
      pick(readMenu(byClass(documentStub.body, "menu-pop")[0]), "颜色 4").node.handlers.click[0]({ stopPropagation() { } });
      assert(big.bigMarks.length === 1 && big.bigMarks[0].keyword === "needle",
        "大文件右键「标记颜色」把目标词标记出来，实际=" + JSON.stringify(big.bigMarks));
      assert(big.bigMarks[0].color === SN.app.MARK_COLORS[3], "标记用的是刚点的那个颜色");
      SN.menu.closeCtx();
      // 行号栏改为「每行 .bg-ln 自带底色/分割线 + position:sticky 钉在左侧」：
      // 素材是行节点自己的，这里断言渲染出来的行确实带这个 class（CSS 规则由下面 ⑬ 静态护栏校验）
      await new Promise(r => setTimeout(r, 30));   // 等行索引 + 首屏虚拟行渲染
      const lnCells = byClass(big.pageEl, "bg-ln");
      assert(lnCells.length > 0, "大文件视图的行号栏由行内 .bg-ln 承担（旧的全高装饰层已移除）");
      SN.app.docs = SN.app.docs.filter(d => d.id !== big.id);
    }

    // ⑬ 菜单外观护栏（css/sn.css）：分隔线不得被渲染成「像可选中项」的粗条/高亮条
    {
      const css = fs.readFileSync(path.join(__dirname, "css/sn.css"), "utf8");
      assert(/\.mi:not\(\.sep\):not\(\.disabled\):hover\{/.test(css), "菜单 hover 高亮只给可点击条目");
      assert(!/(^|\n)\.mi:hover\{/m.test(css), "不再有「所有 .mi 都高亮」的旧规则");
      assert(/\.mi\.sep\{[^}]*cursor:default/.test(css), "分隔线用默认光标（不再是手型）");
      assert(/\.mi\.sep\{[^}]*pointer-events:none/.test(css), "分隔线不参与 hover（划过时上一项保持高亮）");
      assert(/#ctxmenu \.mi\.sep\{padding:0\}/.test(css), "右键菜单里分隔线不带条目内边距（否则会变成粗条）");
      // 大文件行号栏：底色/分割线必须来自主题变量，横向滚动时必须钉在左侧，且「行号列宽」单一来源
      // （两边各写一个宽度就是上一版分割线压到首字符的原因）
      assert(/\.bg-ln\{[^}]*background:var\(--ed-gutter-bg\)/.test(css),
        "大文件行号栏用主题的行号槽底色（--ed-gutter-bg）");
      assert(/\.bg-ln\{[^}]*border-right:1px solid var\(--border\)/.test(css),
        "大文件行号栏与正文之间有 1px 分割线");
      assert(/\.bg-ln\{[^}]*position:sticky[^}]*left:0/.test(css),
        "行号栏 position:sticky 钉在左侧：横向滚动查看长行时行号不会跑出视野");
      assert(/\.bigview\{--bg-ln-w:/.test(css), "行号列宽由 --bg-ln-w 定义（作用域在大文件视图上）");
      assert(/\.bg-ln\{[^}]*width:var\(--bg-ln-w\)/.test(css), "行号 span 的宽度来自 --bg-ln-w");
      // 行节点上不能有 overflow:hidden —— 那会让最近裁剪祖先变成行节点，sticky 失效
      assert(/\.bg-row\{/.test(css) ? !/\.bg-row\{[^}]*overflow:hidden/.test(css) : true,
        "行节点不能带 overflow:hidden（会让行号的 sticky 失效）");
      const bigSrc = fs.readFileSync(path.join(__dirname, "js/bigtext.js"), "utf8");
      assert(bigSrc.indexOf("width:64px") < 0, "bigtext.js 不再硬编码行号列宽：内联 width 会盖掉 CSS 造成错位");
      assert(bigSrc.indexOf("overflow:hidden") < 0 || bigSrc.indexOf("white-space:pre;overflow:hidden") < 0,
        "bigtext.js 的行节点不再用 overflow:hidden 裁剪（长行要能横向滚动查看）");
      assert(/inner\.style\.width = contentWidth\(\)/.test(bigSrc),
        "内容层宽度由最长行决定（否则长行只会被裁掉、无法左右拖动）");
    }

    // ⑭ 打开入口统一 + 视图自动识别 + 「重新打开为 …」三向切换
    {
      const menubarNode = documentStub.querySelector("#menubar");
      assert(byText(menubarNode, "打开…"), "文件菜单保留唯一的「打开…」入口");
      assert(!byText(menubarNode, "以文本模式打开…") && !byText(menubarNode, "以二进制(Hex)打开…"),
        "文件菜单不再单列强制视图入口（视图改由自动识别 + 打开后「重新打开为」）");

      // 自动识别规则（js/app.js 的 decideKind，经 SN.applyBytesToDoc 暴露）
      const mkDoc = (id) => ({ id, name: "t", path: "t", eol: "lf", lang: "txt", dirty: false, raw: null, content: "" });
      const encBytes = (t) => new TextEncoder().encode(t);
      const bigLen = SN.bigLimitBytes();
      const small = encBytes("hello\nworld\n");
      const dA = mkDoc("autoA");
      SN.applyBytesToDoc(dA, small, "auto", small.length);
      assert(dA.kind === "text" && dA.readOnly === false, "小文本 → 自动识别为文本编辑");
      const dB = mkDoc("autoB");
      // 用更贴近现实的二进制（PNG 头）：注意这条例不是「任何含 NUL 都算二进制」——
      // 无 BOM 且 NUL 呈 UTF-16 奇偶规律的短样本会被编码探测猜成 utf16le/be，从而按文本打开
      //（既有规则有意偏向 UTF-16，兜底就是右键「重新打开为 → 二进制(Hex)只读」）
      const binBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
      SN.applyBytesToDoc(dB, binBytes, "auto", binBytes.length);
      assert(dB.kind === "hex" && dB.readOnly === true, "含 NUL 的二进制 → 自动识别为 Hex 只读");
      const dC = mkDoc("autoC");
      const bigBytes = new Uint8Array(bigLen + 1);
      bigBytes.fill(0x41);
      SN.applyBytesToDoc(dC, bigBytes, "auto", bigBytes.length);
      assert(dC.kind === "big" && dC.readOnly === true && dC.content === "",
        "超阈值纯文本 → 自动识别为大文本只读，且不整篇解码（content 为空）");
      const dD = mkDoc("autoD");
      const u16 = SN.encodeText("hello world\n第二行\n", "utf16le");
      SN.applyBytesToDoc(dD, u16, "auto", u16.length);
      assert(dD.kind === "text", "UTF-16 虽然含 NUL，也不误判成二进制");
      assert(SN.caps.can("reloadAsText", { kind: "big" }), "大文本只读也支持切回可编辑文本（能力表已放开）");

      // 三向切换：字节来源走内存 raw（真实场景是 handle / File 引用 / raw 三选一）
      const sw = {
        id: "sw1", name: "sw.txt", path: "sw.txt", kind: "text", enc: "utf8", eol: "lf", lang: "txt",
        dirty: false, readOnly: false, newFile: false,
        raw: encBytes("alpha\nbeta\n"), content: "alpha\nbeta\n", size: 11
      };
      SN.addDoc(sw);
      SN.activateDoc(sw.id);
      await SN.cmd.reloadAs(sw.id, "hex");
      assert(sw.kind === "hex" && sw.readOnly === true, "文本 → 二进制(Hex)：切换成功");
      const swTab = byClass(documentStub.querySelector("#tabstrip"), "tab")
        .filter(n => SN.menu.dataOf(n, "id") === sw.id)[0];
      const swTag = SN.menu.firstDescendant(swTab, n => SN.menu.hasClass(n, "tmod"));
      assert(swTag && swTag.textContent === "⛭", "切到 Hex 后标签上的视图标记就地更新为 ⛭");
      await SN.cmd.reloadAs(sw.id, "text");
      assert(sw.kind === "text" && sw.content.indexOf("alpha") === 0, "二进制 → 文本：内容按源字节解码回来");
      await SN.cmd.reloadAs(sw.id, "big");
      assert(sw.kind === "big", "文本 → 大文本只读：切换成功");
      assert(SN.menu.firstDescendant(swTab, n => SN.menu.hasClass(n, "tmod")).textContent === "≫",
        "切到大文本只读后标签标记更新为 ≫");

      // 大文件切回可编辑文本要二次确认（原来靠「文件 → 以文本模式打开…」让用户主动选，入口统一后搬到这里）
      sw.size = bigLen + 1;
      const savedConfirm = sandbox.confirm;
      sandbox.confirm = () => false;
      await SN.cmd.reloadAs(sw.id, "text");
      assert(sw.kind === "big", "大文件切回文本时取消确认 → 保持大文本只读");
      sandbox.confirm = () => true;
      await SN.cmd.reloadAs(sw.id, "text");
      assert(sw.kind === "text" && sw.readOnly === false, "确认后切回可编辑文本");

      // 有未保存修改时切到只读视图也要确认：取消不能丢改动
      sw.dirty = true;
      sw.content = "edited in memory\n";
      sandbox.confirm = () => false;
      await SN.cmd.reloadAs(sw.id, "hex");
      assert(sw.kind === "text" && sw.dirty === true, "有未保存修改时切只读视图需确认，取消 → 保持文本与脏标记");
      sandbox.confirm = () => true;
      await SN.cmd.reloadAs(sw.id, "hex");
      assert(sw.kind === "hex" && sw.dirty === false, "确认后切到 Hex，并清掉脏标记（正文已被源字节替换）");
      sandbox.confirm = savedConfirm;

      // 没有源字节可用时要说清楚，而不是静默失败
      const ghost = { id: "sw2", name: "ghost.txt", path: "ghost.txt", kind: "text", enc: "utf8", eol: "lf",
        lang: "txt", dirty: false, readOnly: false, raw: null, content: "", size: 10 };
      SN.app.docs.push(ghost);
      await SN.cmd.reloadAs(ghost.id, "hex");
      assert(ghost.kind === "text" && String(documentStub.querySelector("#msgLabel").textContent).indexOf("未保留原始字节") >= 0,
        "取不到源字节时给出明确提示");
      SN.app.docs = SN.app.docs.filter(x => x.id !== ghost.id && x.id !== sw.id);
    }

    // ⑮ 命令层与编辑器解耦：命令只做 SN.views.invoke 转发，能力不足必须给原因（不许静默）
    {
      // ① 文本视图把"编辑器专有能力"登记齐全（命令层依赖这些方法名）
      const textAd = SN.views.byKind("text");
      for (const m of ["undo", "redo", "clipboard", "findStep", "status", "applyView", "setZoom",
        "bookmarkToggle", "bookmarkGoto", "bookmarksClear", "wordHighlight", "markKeyword", "setWebRanges"]) {
        assert(typeof textAd[m] === "function", "文本适配器登记了 " + m + "()");
      }
      assert(typeof SN.views.invoke === "function", "SN.views.invoke 存在（命令层唯一转发入口）");
      const msg = () => String(documentStub.querySelector("#msgLabel").textContent);
      // invoke 取的是适配器而不是能力矩阵（这里踩过一次：viewcaps 里 of() 是矩阵、forDoc() 才是适配器）
      const probe = { kind: "text", editor: null };
      SN.setMsg("PROBE");
      assert(SN.views.invoke("bookmark", "bookmarkToggle", probe) === false && msg() === "PROBE",
        "适配器有该方法时 invoke 不写提示（未执行由方法返回 false 表达），实际=" + JSON.stringify(msg()));

      // ② 大文件视图上调用这些命令：必须给出与能力表一致的原因，且不能抛
      const bigDoc0 = SN.docById("bigA");
      SN.app.activeId = bigDoc0.id;
      const expectReason = (label, cap, run) => {
        SN.setMsg("");
        run();
        const want = SN.caps.reason(cap, bigDoc0);
        // want 必须非空：否则能力表已支持该能力，这条断言会变成"空对空"的假通过
        assert(want && msg() === want, label + " 应提示「" + want + "」，实际=" + JSON.stringify(msg()));
      };
      expectReason("书签切换", "bookmark", () => SN.cmd.toggleBookmark());
      expectReason("书签跳转", "bookmark", () => SN.cmd.gotoBookmark(1));
      expectReason("清除书签", "bookmark", () => SN.cmd.clearBookmarks());
      expectReason("显示空白", "view", () => SN.cmd.toggleSpaces());
      expectReason("查找下一个", "findStep", () => { SN.app.findOpt.keyword = "needle"; SN.dlg.findNext(); });
      // 面板"全部标记"：mark 能力在大文件视图是支持的，但该子动作只有编辑器实现 →
      // invoke 的兜底也必须给出非空说明（reason() 此时是空串，不能直接写进状态栏）
      SN.setMsg("");
      SN.app.findOpt.keyword = "needle";
      SN.cmd.markKeyword();
      assert(msg() && msg().indexOf("未实现") >= 0,
        "能力已声明但该子动作未实现时给出非空说明，实际=" + JSON.stringify(msg()));
      // 大文件视图现在支持行列定位：命令不写提示，而是让视图写状态栏；Hex 仍不支持 → 必须给原因
      SN.setMsg("PROBE");
      SN.cmd.edStatus();
      assert(msg() === "PROBE", "大文件行列统计不写提示（由视图直接写状态栏），实际=" + JSON.stringify(msg()));
      const hexPos = { id: "hexPos", name: "x.bin", kind: "hex", enc: "utf8", eol: "lf", lang: "txt", content: "", raw: new Uint8Array([1, 2, 3]) };
      SN.app.docs.push(hexPos);
      SN.app.activeId = hexPos.id;
      SN.setMsg("");
      SN.cmd.edStatus();
      assert(msg() === SN.caps.reason("statusPos", hexPos), "Hex 视图行列统计给能力表原因，实际=" + JSON.stringify(msg()));
      SN.app.docs = SN.app.docs.filter(x => x.id !== hexPos.id);
      SN.app.activeId = bigDoc0.id;
      // 工具栏按钮走的是同一条转发路径（撤销 / 剪切）
      const tbBtns = byClass(documentStub.querySelector("#toolbar"), "iconbt");
      const undoBt = tbBtns.filter(b => String(b.title || "").indexOf("撤销") === 0)[0];
      const cutBt = tbBtns.filter(b => String(b.title || "").indexOf("剪切") === 0)[0];
      if (undoBt && undoBt.handlers.click) expectReason("工具栏撤销", "undo", () => undoBt.handlers.click[0]({ stopPropagation() { } }));
      if (cutBt && cutBt.handlers.click) expectReason("工具栏剪切", "clipboard", () => cutBt.handlers.click[0]({ stopPropagation() { } }));
      // 文本变换类（走 needEditor 前置）也给能力表原因，不再静默
      expectReason("行操作", "edit", () => SN.cmd.lineOp("dup"));
      expectReason("大小写", "edit", () => SN.cmd.caseOp("upper"));

      // ③ 文本视图下同样的命令仍然照常工作（重构不能改行为）
      const dT = SN.app.docs.filter(x => x.editor)[0];
      SN.app.activeId = dT.id;
      dT.editor.setText("alpha needle\nbeta needle\n", [0, 0]);
      SN.app.findOpt.keyword = "needle";
      SN.dlg.findNext();
      assert(msg().indexOf("处（行 ") > 0, "文本视图 F3 仍能步进命中，实际=" + msg());
      SN.cmd.clearBookmarks();
      const bmLine = dT.editor.curLine() - 1;
      SN.cmd.toggleBookmark();
      assert(dT.editor.bookmarks.has(bmLine), "文本视图 toggleBookmark 仍可用（先清空再切换）");
      SN.cmd.gotoBookmark(1);
      SN.cmd.clearBookmarks();
      assert(dT.editor.bookmarks.size === 0, "文本视图清书签仍可用");
      SN.app.settings.showSpaces = true;
      SN.cmd.toggleSpaces();
      assert(dT.editor.showSpaces === SN.app.settings.showSpaces, "文本视图显示空白开关仍落到编辑器");
      SN.cmd.zoom(10);
      assert(dT.editor.zoom === SN.app.zoomPct, "文本视图缩放仍落到编辑器，zoom=" + dT.editor.zoom);
      SN.cmd.wordHighlight("needle");
      assert(dT.editor.wordRanges.length > 0, "文本视图双击词高亮仍可用");
      SN.cmd.markKeyword();
      assert(dT.editor.markRecords.length > 0, "文本视图「全部标记(面板关键字)」仍可用");
      // 剪贴板走 textarea 的原生 execCommand：桩里没有该方法，注入一个假的验证转发链
      const savedExec = documentStub.execCommand;
      let execCalled = "";
      documentStub.execCommand = (a) => { execCalled = a; return true; };
      assert(SN.views.invoke("clipboard", "clipboard", dT, ["copy"]) === true && execCalled === "copy",
        "文本视图剪贴板经适配器走到 execCommand(copy)");
      documentStub.execCommand = savedExec;
      SN.setMsg("");
      assert(SN.views.invoke("clipboard", "clipboard", dT, ["copy"]) === false, "桩里没有 execCommand 时不抛、按未执行返回");
      SN.cmd.edStatus();
      const posText = String(documentStub.querySelector("#posLabel").textContent);
      assert(posText.indexOf("Ln:") === 0, "文本视图行列统计仍上报到状态栏，实际=" + JSON.stringify(posText));
      SN.app.activeId = "bigA";
      SN.refreshMenus();
    }

    // ⑯ 大文件视图的 statusPos（行列定位）：无选中=视口首行，有选中=选区起点行/列 + 已选统计
    {
      const big = {
        id: "posBig", name: "pos.log", kind: "big", enc: "utf8", eol: "lf", lang: "txt",
        content: "", raw: new TextEncoder().encode("alpha needle\nbeta line\nneedle two\n")
      };
      SN.addDoc(big);
      SN.activateDoc(big.id);
      await new Promise(r => setTimeout(r, 30));         // 等行索引 + 首屏行渲染
      const pos = () => String(documentStub.querySelector("#posLabel").textContent);
      assert(SN.caps.can("statusPos", big) && typeof SN.views.byKind("big").status === "function",
        "大文本视图声明并实现了行列定位");
      SN.cmd.edStatus();
      // 注意：大文件视图按「行起始字节偏移」计行，文件末尾的换行符不额外算一个空行
      //（"a\nb\nc\n" → 3 行）；文本视图 countLines 是 +1 口径（同一内容 4 行）——两者各自的模型自洽
      assert(/^Ln:1（视口首行）\s+共 3 行$/.test(pos()), "无选中时显示视口首行与总行数，实际=" + JSON.stringify(pos()));

      // 造一个"选中第 2 行第 6 列"的选区（桩里造不出真实 Range，用等价对象驱动同一条代码路径）
      const bigView = big.pageEl.children[0];
      // 桩没有布局：给视口一个等效高度，让虚拟滚动真的渲染出一屏可视行
      const viewportNode = bigView.children[0];
      viewportNode.clientHeight = 240;
      big._bigJump(1);
      await new Promise(r => setTimeout(r, 30));
      const row2 = SN.menu.firstDescendant(bigView, n => n._i === 1);
      assert(row2, "第 2 行已渲染（虚拟滚动的可视行）");
      const codeSpan = row2.children[1];
      const fakeText = { nodeType: 3, data: "beta line", parentNode: codeSpan };
      const savedSel = sandbox.window.getSelection;
      sandbox.window.getSelection = () => ({
        isCollapsed: false, rangeCount: 1, anchorNode: fakeText,
        getRangeAt: () => ({ startContainer: fakeText, startOffset: 5 }),
        toString: () => "beta line"
      });
      SN.cmd.edStatus();
      assert(pos() === "Ln:2  Col:6  已选 1 行 / 9 字符  共 3 行",
        "有选中时给出起点行列与已选统计，实际=" + JSON.stringify(pos()));

      // 从未有过有效选区时折叠 → 仍是"视口首行"语义（此时还没有任何快照）
      sandbox.window.getSelection = () => ({ isCollapsed: true, rangeCount: 0, anchorNode: fakeText, toString: () => "" });
      SN.cmd.edStatus();
      assert(/^Ln:1（视口首行）/.test(pos()), "没有过选区时显示视口首行，实际=" + JSON.stringify(pos()));

      // —— 真实事件链路：走 selectionchange 处理器（而不是直接调命令）——
      const rebuildSel = () => ({
        isCollapsed: false, rangeCount: 1, anchorNode: fakeText,
        getRangeAt: () => ({ startContainer: fakeText, startOffset: 5 }),
        toString: () => "beta line"
      });
      sandbox.window.getSelection = rebuildSel;
      (documentStub.handlers.selectionchange || []).forEach(f => f());
      assert(pos() === "Ln:2  Col:6  已选 1 行 / 9 字符  共 3 行",
        "拖选后状态栏立即更新为选区信息，实际=" + JSON.stringify(pos()));

      // 右键/菜单抢焦点把 DOM 选区清掉：位置信息不该跟着消失（用户报的就是这个现象）
      sandbox.window.getSelection = () => ({ isCollapsed: true, rangeCount: 0, anchorNode: fakeText, toString: () => "" });
      (documentStub.handlers.selectionchange || []).forEach(f => f());
      assert(pos().indexOf("已选 1 行 / 9 字符") > 0,
        "选区被抢焦点清掉后仍显示刚才的选区信息（快照），实际=" + JSON.stringify(pos()));

      // 显式左键点空白＝有意取消选择 → 清掉快照，回到视口首行
      (bigView.handlers.mouseup || []).forEach(f => f({ button: 0 }));
      assert(/^Ln:1（视口首行）/.test(pos()), "显式左键点空白后回到视口首行，实际=" + JSON.stringify(pos()));

      // 滚动后"视口首行"跟着变（只依赖 scrollTop，O(1)）
      // 用视图自己的定位接口，而不是写死像素：行高随缩放变化（见 ⑰）
      big._bigJump(3);
      sandbox.window.getSelection = savedSel;
      SN.cmd.edStatus();
      assert(/^Ln:3（视口首行）/.test(pos()), "滚动到第 3 行位置后显示 Ln:3，实际=" + JSON.stringify(pos()));
      big._bigJump(1);

      // 非活动文档不抢状态栏（避免后台视图刷掉当前文档的位置信息）
      SN.app.activeId = "bigA";
      const before = pos();
      SN.views.invoke("statusPos", "status", big);
      assert(pos() === before, "非活动文档不写状态栏");

      SN.app.docs = SN.app.docs.filter(x => x.id !== big.id);
    }

    // ⑰ 大文件视图的 zoom（缩放）：只改行高/字号并重画可视行，且与编辑器同一套数值
    {
      const big = {
        id: "zoomBig", name: "zoom.log", kind: "big", enc: "utf8", eol: "lf", lang: "txt",
        content: "", raw: new TextEncoder().encode("one\ntwo\nthree\nfour\nfive\n")
      };
      SN.addDoc(big);
      SN.activateDoc(big.id);
      await new Promise(r => setTimeout(r, 30));
      const bigView = big.pageEl.children[0];
      const viewportNode = bigView.children[0];
      const innerNode = viewportNode.children[0];
      viewportNode.clientHeight = 240;
      assert(SN.caps.can("zoom", big) && typeof SN.views.byKind("big").setZoom === "function",
        "大文本视图声明并实现了缩放");
      assert(!SN.caps.can("zoom", { kind: "hex" }), "Hex 视图仍不支持缩放");

      // 公式与编辑器同源：同一缩放级别下行高必须一致，否则切标签会看到行高跳变
      const m150 = SN.zoomMetrics(150);
      assert(m150.fs === 21 && m150.lh === 33, "SN.zoomMetrics(150) = 21px/33px，实际=" + m150.fs + "/" + m150.lh);
      const dTz = SN.app.docs.filter(x => x.editor)[0];
      dTz.editor.applyZoom(150);
      assert(dTz.editor._lineH === m150.lh, "编辑器与大文件视图在 150% 下行高一致，实际=" + dTz.editor._lineH);
      dTz.editor.applyZoom(100);

      // 走真实命令路径：cmd.zoom(50) → app.zoomPct=150 → 广播到所有文档
      SN.app.zoomPct = 100;
      SN.cmd.zoom(50);
      assert(SN.app.zoomPct === 150 && big.bigZoom === 150, "cmd.zoom 广播到活动的大文件文档，bigZoom=" + big.bigZoom);
      assert(viewportNode.style.fontSize === "21px" && viewportNode.style.lineHeight === "33px",
        "只读视图字号/行高按缩放改写，实际=" + viewportNode.style.fontSize + "/" + viewportNode.style.lineHeight);
      // 行索引就绪后内容高度 = 行数 × 行高（行高变了必须重算，否则滚动位置全错）
      await new Promise(r => setTimeout(r, 20));
      const wantH = ((big.bigLineCount || 1) * m150.lh) + "px";
      assert(innerNode.style.height === wantH, "内容高度按新行高重算，实际=" + innerNode.style.height + " 期望=" + wantH);
      // 行节点是按行高建的，缩放后必须重建（复用了旧行高的节点会错位）
      const row1 = SN.menu.firstDescendant(bigView, n => n._i === 0);
      // 行高是通过 cssText 写进去的（桩不解析 cssText 的属性，只能整体包含判断）
      assert(row1 && String(row1.style.cssText).indexOf("height:33px") >= 0,
        "缩放后重画的行节点用新行高，实际=" + (row1 && row1.style.cssText));
      // 定位/行列读数也跟着新行高走
      big._bigJump(4);
      SN.cmd.edStatus();
      assert(String(documentStub.querySelector("#posLabel").textContent).indexOf("Ln:4") === 0,
        "缩放到 150% 后定位到第 4 行仍然正确，实际=" + documentStub.querySelector("#posLabel").textContent);

      // 缩回 100%：行高与内容高度回到基准
      SN.cmd.zoom(-50);
      assert(SN.app.zoomPct === 100 && big.bigZoom === 100 && viewportNode.style.lineHeight === "22px",
        "缩回 100% 行高回到 22px，实际=" + viewportNode.style.lineHeight);

      // 新开的文档沿用当前缩放（缩放是全局设置）
      SN.cmd.zoom(50);                                  // → 150%
      const big2 = {
        id: "zoomBig2", name: "zoom2.log", kind: "big", enc: "utf8", eol: "lf", lang: "txt",
        content: "", raw: new TextEncoder().encode("x\ny\n")
      };
      SN.addDoc(big2);
      assert(big2.bigZoom === 150, "新开的大文件文档沿用当前缩放级别，实际=" + big2.bigZoom);
      const dtNew = { id: "zoomTxt", name: "z.txt", path: "z.txt", eol: "lf", lang: "txt", dirty: false,
        kind: "text", enc: "utf8", readOnly: false, raw: null, content: "", size: 0 };
      SN.addDoc(dtNew);
      assert(dtNew.editor && dtNew.editor._lineH === SN.zoomMetrics(150).lh,
        "新开的文本文档也沿用当前缩放，实际=" + (dtNew.editor && dtNew.editor._lineH));
      SN.app.zoomPct = 100;
      SN.cmd.zoom(0);                                   // 广播回 100%，避免影响后续段落
      SN.app.docs = SN.app.docs.filter(x => x.id !== big.id && x.id !== big2.id && x.id !== dtNew.id);
    }

    // ⑱ 横向滚动：长行必须能左右拖动查看（内容层要有按"最长行"算出的宽度，行号列 sticky 在左侧）
    {
      const longLine = "L" + "x".repeat(600) + "TAIL";       // 一行 605 字符，远超视口宽度
      const big = {
        id: "wideBig", name: "wide.log", kind: "big", enc: "utf8", eol: "lf", lang: "txt",
        content: "", raw: new TextEncoder().encode("short\n" + longLine + "\nshort2\n")
      };
      SN.addDoc(big);
      SN.activateDoc(big.id);
      await new Promise(r => setTimeout(r, 40));            // 等行索引（最长行在这里统计）
      const bigView = big.pageEl.children[0];
      const viewportNode = bigView.children[0];
      const innerNode = viewportNode.children[0];
      viewportNode.clientHeight = 240;
      viewportNode.clientWidth = 400;                       // 桩没有布局：给个视口宽度
      big._bigApplyZoom(100);                               // 触发一次 size()，按当前宽度重算内容宽度
      await new Promise(r => setTimeout(r, 20));

      // 索引阶段顺带算出最长行（字节数），这是横向滚动宽度的唯一依据
      assert(big.bigMaxLineBytes === longLine.length,
        "建行索引时顺带统计最长行，实际=" + big.bigMaxLineBytes + " 期望=" + longLine.length);
      const charW = Math.round(SN.zoomMetrics(100).fs * 0.6);   // 桩量不出字形宽度 → 代码按 0.6em 兜底
      const innerW = parseInt(innerNode.style.width, 10);
      assert(innerW >= longLine.length * charW,
        "内容层宽度按最长行撑开（长行可左右拖动），实际=" + innerW + " 期望≥" + (longLine.length * charW));
      assert(innerW > (viewportNode.clientWidth || 0),
        "内容层必须宽于视口才会出现横向滚动条，实际=" + innerW + " 视口=" + viewportNode.clientWidth);

      // 窗口很窄也一样能横向滚动；而短文件不应白留横向空白（宽度只按最长行算）
      const bigNarrow = {
        id: "narrowBig", name: "narrow.log", kind: "big", enc: "utf8", eol: "lf", lang: "txt",
        content: "", raw: new TextEncoder().encode("a\nbb\nccc\n")
      };
      SN.addDoc(bigNarrow);
      await new Promise(r => setTimeout(r, 40));
      const nView = bigNarrow.pageEl.children[0];
      const nViewport = nView.children[0];
      nViewport.clientHeight = 240;
      nViewport.clientWidth = 400;
      bigNarrow._bigApplyZoom(100);
      await new Promise(r => setTimeout(r, 20));
      const nInnerW = parseInt(nViewport.children[0].style.width, 10);
      assert(nInnerW === 400, "短行文件的内容层宽度铺满视口即可（不额外留横向空白），实际=" + nInnerW);

      // 缩放后字符变宽 → 内容宽度必须重算
      big._bigApplyZoom(200);
      await new Promise(r => setTimeout(r, 20));
      const innerW200 = parseInt(innerNode.style.width, 10);
      assert(innerW200 > innerW, "放大后内容宽度跟着变宽（字符宽度重算），150→" + innerW + " / 200→" + innerW200);

      SN.app.docs = SN.app.docs.filter(x => x.id !== big.id && x.id !== bigNarrow.id);
    }

    // 收尾：把活动文档与文档表还原，别影响后续段落与前后的既有断言
    SN.app.docs = SN.app.docs.filter(d => d.id !== hexDoc.id);
    SN.app.activeId = "bigA";
    SN.refreshMenus();
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
