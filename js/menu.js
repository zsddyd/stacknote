"use strict";
// 弹出菜单机制：顶栏下拉与右键菜单共用同一套渲染器 / 子菜单 / 键盘导航实现。
// 目的：右键菜单不再自造第三套渲染逻辑，菜单项模型（label/sc/accel/requires/checked/swatch/sub/
//      stay/disabled/tip）与能力置灰规则（js/viewcaps.js）只保留一处实现。
// 性能约定：所有宿主一律「一次性委托」——每个宿主只挂 1 个 contextmenu 监听器，菜单项不逐项挂监听；
//      打开菜单只重建 ~40 个节点，不做文本扫描、不调用编辑器渲染、不新增 rAF/定时器。
(function () {
  const SN = (window.SN = window.SN || {});
  const el = SN.el;

  const VW = () => window.innerWidth || 1024;
  const VH = () => window.innerHeight || 768;

  let subPop = null, subState = null;   // 子菜单（.menu-pop），同时只允许一个
  let ctxBox = null, ctxOpen = false;   // 右键菜单宿主（#ctxmenu）
  let globalsBound = false;             // 全局关闭/键盘监听只绑一次
  const hosts = [];                     // 宿主注册表：[{selector, spec, bound}]

  // ---------- 小工具（真实 DOM 与 smoke 的 DOM 桩都可用） ----------
  // 桩的 closest() 恒为 null，这里一律用 parentNode/parent 链自己走，保证行为可测
  function upFrom(node, pred) {
    let n = node;
    while (n) {
      if (pred(n)) return n;
      n = n.parentNode || n.parent || null;
    }
    return null;
  }
  function hasClass(node, cls) {
    if (!node) return false;
    if (String(node.className || "").split(/\s+/).indexOf(cls) >= 0) return true;
    // className 与 classList 可能不同步（smoke 的 DOM 桩就是如此），两边都查
    return !!(node.classList && typeof node.classList.contains === "function" && node.classList.contains(cls));
  }
  // 读 data-* ：真实 DOM 走 dataset，DOM 桩的 setAttribute 只落成同名属性
  function dataOf(node, key) {
    if (!node) return undefined;
    const ds = node.dataset;
    if (ds && ds[key] !== undefined && ds[key] !== null) return ds[key];
    const direct = node["data-" + key];
    if (direct !== undefined) return direct;
    if (typeof node.getAttribute === "function") {
      const v = node.getAttribute("data-" + key);
      if (v !== null && v !== undefined) return v;
    }
    return undefined;
  }
  function firstDescendant(node, pred) {
    let hit = null;
    (function walk(n) {
      for (const c of (n.children || [])) {
        if (hit) return;
        if (pred(c)) { hit = c; return; }
        walk(c);
      }
    })(node);
    return hit;
  }
  function insideMenu(node) {
    return !!upFrom(node, n => n === ctxBox || n === subPop || hasClass(n, "menu-pop"));
  }

  // ---------- 菜单项渲染（顶栏下拉与右键菜单共用） ----------
  // ctx: { doc, onClose, onRebuild, openSub, paletteSource, hoverSub }
  function renderInto(container, items, ctx) {
    ctx = ctx || {};
    container.textContent = "";
    const doc = ctx.doc !== undefined ? ctx.doc : (SN.activeDoc ? SN.activeDoc() : null);
    const onClose = ctx.onClose || (() => closeCtx());
    const onRebuild = ctx.onRebuild || (() => rebuildSub());
    const openChild = ctx.openSub || ((source, rect, c) => openSub(source, rect, c));
    // 只有右键菜单这棵树带 role=menu 容器（顶栏下拉不用这套 ARIA），因此只给它补 menuitem 语义
    const aria = !!ctx.hoverSub;

    for (const it of (items || [])) {
      if (it === "-") {
        const sep = el("div", { class: "mi sep" });
        if (aria) sep.setAttribute("role", "separator");
        container.appendChild(sep);
        continue;
      }

      if (it.sub || it.palette) {
        const row = el("div", { class: "mi", "data-sub": 1 });
        if (aria) { row.setAttribute("role", "menuitem"); row.setAttribute("aria-haspopup", "true"); }
        row.appendChild(el("span", { text: it.label }));
        row.appendChild(el("span", { class: "caret", text: "›" }));
        const show = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const src = it.palette ? (ctx.paletteSource ? ctx.paletteSource(it) : null) : it.sub;
          if (!src) return;
          if (ctx.hoverSub) setKb(container, row);
          // 取锚点矩形（DOM 桩没有该方法，openSub 会按 0 兜底）
          const rect = typeof row.getBoundingClientRect === "function" ? row.getBoundingClientRect() : null;
          openChild(src, rect, ctx);
        };
        row.addEventListener("click", show);
        // 右键菜单按 Win32 习惯 hover 即展开；顶栏下拉保持「点击展开」，不改既有交互。
        // 子菜单内部不挂 hover 行为，否则鼠标移进子菜单会把它自己关掉。
        if (ctx.hoverSub && !ctx.isSub) row.addEventListener("mouseenter", () => show(null));
        row._openSub = show;
        container.appendChild(row);
        continue;
      }

      const mi = el("div", { class: "mi" });
      if (it.disabled) mi.classList.add("disabled");
      if (aria) mi.setAttribute("role", "menuitem");
      if (it.swatch) {
        const sw = el("span", { class: "sw" });
        sw.style.background = it.swatch;
        mi.appendChild(sw);
      }
      if (it.checked !== undefined) {
        mi.appendChild(el("span", { text: it.checked ? "☑" : "☐" }));
      }
      mi.appendChild(el("span", { text: it.label || "" }));
      // 快捷键提示与点击行为统一取 SN.shortcuts 表（js/shortcuts.js）：
      // 有 sc 的菜单项，显示与执行都来自同一处定义，不会出现「菜单写的键」与「实际按的键」脱节。
      const scDef = it.sc ? SN.shortcuts.byId(it.sc) : null;
      const accel = it.sc ? SN.shortcuts.accelOf(it.sc) : it.accel;
      if (accel) mi.appendChild(el("span", { class: "accel", text: accel }));
      // 视图能力（js/viewcaps.js）：当前文档不具备所需能力时置灰，
      // 并把「为什么不可用」写进 tooltip，取代点下去毫无反应的旧行为。
      const req = it.requires || (scDef && scDef.requires);
      const blockedWhy = req && SN.caps ? SN.caps.reason(req, doc) : "";
      if (blockedWhy) mi.classList.add("disabled");
      if (aria && (it.disabled || blockedWhy)) mi.setAttribute("aria-disabled", "true");
      const tip = blockedWhy || it.tip;
      if (tip) mi.title = tip;
      const act = it.action || (scDef && scDef.run ? scDef.run : null);
      if (!it.disabled && !blockedWhy && act) {
        const run = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          if (it.stay) {
            act();
            if (it.rebuild) onRebuild();
          } else {
            onClose();
            act();
          }
        };
        mi.addEventListener("click", run);
        // 键盘 Enter/Space 激活同一段逻辑（桩里 click() 是空实现，故显式留句柄）
        mi._activate = () => run(null);
      }
      // hover 到普通项时收起已展开的子菜单（回到「同时只允许一个」的桌面习惯）
      if (ctx.hoverSub && !ctx.isSub) mi.addEventListener("mouseenter", () => { if (subPop) closeSub(); });
      if (it.id) mi.dataset.id = it.id;
      container.appendChild(mi);
    }
  }

  // ---------- 键盘导航 ----------
  function navList(box) {
    const out = [];
    for (const c of (box.children || [])) {
      if (hasClass(c, "sep") || hasClass(c, "disabled")) continue;
      if (c._activate || c._openSub) out.push(c);
    }
    return out;
  }
  function setKb(box, node) {
    if (!box) return;
    for (const c of (box.children || [])) c.classList.remove("kb");
    box._kb = node || null;
    if (node) node.classList.add("kb");
  }
  function moveKb(box, step) {
    const list = navList(box);
    if (!list.length) return;
    let i = list.indexOf(box._kb);
    i = i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length;
    setKb(box, list[i]);
  }
  function onKeyDown(e) {
    if (!ctxOpen || !ctxBox) return;
    const active = subPop || ctxBox;
    const k = e.key;
    if (k === "Escape") {
      stop(e);
      if (subPop) closeSub(); else closeCtx({ restoreFocus: true });
      return;
    }
    if (k === "ArrowDown" || k === "ArrowUp") { stop(e); moveKb(active, k === "ArrowDown" ? 1 : -1); return; }
    if (k === "ArrowRight") { if (active._kb && active._kb._openSub) { stop(e); active._kb._openSub(null); } return; }
    if (k === "ArrowLeft") { if (subPop) { stop(e); closeSub(); } return; }
    if (k === "Enter" || k === " ") {
      const kb = active._kb;
      if (!kb) return;
      stop(e);
      if (kb._activate) kb._activate();
      else if (kb._openSub) kb._openSub(null);
      return;
    }
    if (k === "Tab") closeCtx();
  }
  function stop(e) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }

  // ---------- 子菜单 ----------
  function openSub(source, anchorRect, ctx) {
    closeSub();
    const pop = el("div", { class: "menu-pop" });
    // 子菜单层标记 isSub：hover 行为只在根菜单上挂（见 renderInto）
    const subCtx = Object.assign({}, ctx || {}, { isSub: true });
    if (subCtx.hoverSub) pop.setAttribute("role", "menu");
    renderInto(pop, typeof source === "function" ? source() : source, subCtx);
    document.body.appendChild(pop);
    subPop = pop;
    subState = { source, rect: anchorRect, ctx: subCtx };
    const r = anchorRect || { left: 0, right: 0, top: 0 };
    const right = r.right || 0, left = r.left || 0, top = r.top || 0;
    const pw = pop.offsetWidth || Math.min(280, Math.max(180, VW() - right - 20));
    let x = right + 2;
    if (x + pw > VW() - 4) x = Math.max(4, left - pw - 2);
    let y = top;
    const ph = pop.offsetHeight || 0;
    if (y + ph > VH() - 6) y = Math.max(4, VH() - ph - 6);
    pop.style.left = x + "px";
    pop.style.top = y + "px";
    pop._kb = null;
    return pop;
  }
  function closeSub() {
    if (subPop) {
      if (subPop.parentNode) subPop.parentNode.removeChild(subPop);
      else if (subPop.remove) subPop.remove();
      subPop = null;
      subState = null;
    }
  }
  function rebuildSub() {
    if (!subState || !subPop) return;
    const items = typeof subState.source === "function" ? subState.source() : subState.source;
    renderInto(subPop, items, subState.ctx);
    subPop._kb = null;
  }

  // ---------- 右键菜单 ----------
  function openCtx(x, y, items, ctx) {
    const box = SN.$("#ctxmenu");
    if (!box) return null;
    closeCtx();
    const c = Object.assign({}, ctx || {}, {
      hoverSub: true,
      onClose: () => closeCtx(),
      onRebuild: () => rebuildSub()
    });
    renderInto(box, items, c);
    box.classList.remove("hidden");
    if (typeof box.setAttribute === "function") box.setAttribute("aria-hidden", "false");
    // 定位：fixed 定位容器，脏化范围限于菜单自身子树（先写后读，每次打开一次强制布局）
    const w = box.offsetWidth || 170, h = box.offsetHeight || 0;
    box.style.left = Math.max(4, Math.min(x, VW() - w - 4)) + "px";
    box.style.top = Math.max(4, Math.min(y, VH() - h - 4)) + "px";
    box._kb = null;
    ctxBox = box;
    ctxOpen = true;
    if (typeof box.focus === "function") { try { box.focus(); } catch (e) { /* ignore */ } }
    return box;
  }
  function closeCtx(opts) {
    if (!ctxOpen && !subPop) return;
    closeSub();
    const box = ctxBox || SN.$("#ctxmenu");
    if (box) {
      box.classList.add("hidden");
      // 先把焦点从菜单里挪走，再置 aria-hidden=true，避免「隐藏的子树里还留着焦点」
      if (typeof box.blur === "function" && document.activeElement === box) box.blur();
      if (typeof box.setAttribute === "function") box.setAttribute("aria-hidden", "true");
      box._kb = null;
    }
    ctxOpen = false;
    // 只有「取消」（Esc）才把焦点还给编辑器：点选动作后再抢焦点会打断随后弹出的对话框
    if (opts && opts.restoreFocus && SN.activeEditor) {
      const ed = SN.activeEditor();
      if (ed && ed.focus) ed.focus();
    }
  }

  // ---------- 宿主注册与委托 ----------
  // spec: { match(node) → 命中节点|null, items(target, event) → 菜单项数组, ctx(target, event) → 渲染上下文 }
  function register(selector, spec) {
    hosts.push({ selector, spec, bound: false });
  }
  function bindHosts() {
    for (const h of hosts) {
      if (h.bound) continue;
      const node = SN.$(h.selector);
      if (!node || typeof node.addEventListener !== "function") continue;
      h.bound = true;
      node.addEventListener("contextmenu", (e) => {
        const t = h.spec.match ? upFrom(e.target, h.spec.match) : e.target;
        if (!t) return;
        const items = h.spec.items(t, e);
        if (!items || !items.length) return;
        stop(e);
        openCtx(e.clientX || 0, e.clientY || 0, items, h.spec.ctx ? h.spec.ctx(t, e) : {});
      });
    }
    bindGlobals();
  }
  function bindGlobals() {
    if (globalsBound) return;
    globalsBound = true;
    // 关闭路径：点击别处 / 别处右键 / 滚动 / 改窗口大小 / 失焦；监听器只绑这一次，反复打开不累积
    document.addEventListener("mousedown", (e) => { if (ctxOpen && !insideMenu(e.target)) closeCtx(); }, true);
    document.addEventListener("contextmenu", (e) => { if (ctxOpen && !insideMenu(e.target)) closeCtx(); });
    document.addEventListener("scroll", (e) => { if (ctxOpen && !insideMenu(e.target)) closeCtx(); }, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", () => { if (ctxOpen) closeCtx(); });
    window.addEventListener("blur", () => { if (ctxOpen) closeCtx(); });
  }

  // ---------- 剪贴板（只写不读：本仓库的右键菜单不提供「粘贴」） ----------
  // 返回 Promise<boolean>：优先 clipboard.writeText，失败或不可用时退回 execCommand("copy")
  function copyText(text) {
    return new Promise((resolve) => {
      const nav = window.navigator || {};
      const s = String(text == null ? "" : text);
      if (nav.clipboard && typeof nav.clipboard.writeText === "function") {
        try {
          nav.clipboard.writeText(s).then(() => resolve(true), () => resolve(legacyCopy(s)));
        } catch (e) {
          resolve(legacyCopy(s));
        }
        return;
      }
      resolve(legacyCopy(s));
    });
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
      document.body.appendChild(ta);
      if (typeof ta.select === "function") ta.select();
      const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      else if (ta.remove) ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  SN.menu = {
    renderInto, openCtx, closeCtx, openSub, closeSub, rebuildSub,
    register, bindHosts, copyText,
    upFrom, hasClass, dataOf, firstDescendant, setKb,
    isCtxOpen: () => ctxOpen
  };
})();
