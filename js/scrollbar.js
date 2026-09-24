"use strict";
// 自绘滚动条：给「内容可能极长」的滚动容器兜住一个最小可点长度。
// 背景：原生滑块长度 = 视口/内容 × 轨道，内容一长（大文件）就缩到十几像素，鼠标抓不住；
// 而 Chromium 直接忽略 ::-webkit-scrollbar-thumb 的 min-height / min-width
//（实测内容 44 万 px、视口 441px 时，加了 min-height:48px 之后滑块依然是 13px），纯 CSS 无解。
// 做法：这类容器隐藏原生滚动条，在容器上叠一层绝对定位的滑块：
//   长度 = max(最小可点长度, 视口/内容 × 轨道)，位置与滚动位置线性对应，可拖动、可点轨道翻页。
// 只在「精确指针」（桌面鼠标）下启用；触摸设备保留原生 overlay 滚动条（惯性滚动与边缘手势更好）。
(() => {
  const SN = window.SN;
  const MIN_THUMB = 48;   // 滑块最小长度（px），不小于 WCAG 2.5.5 的 44px 目标尺寸

  // 纯函数：算滑块长度（track = 轨道长，client = 视口长，total = 内容长）
  function thumbLen(client, total, track) {
    client = Number(client) || 0;
    total = Number(total) || 0;
    track = Number(track) || 0;
    if (track <= 0) return 0;
    if (client <= 0 || total <= 0 || total <= client) return Math.min(track, Math.max(0, client));
    // 轨道本身很短（小窗口）时不硬撑 48px，最多占轨道一半
    const floor = Math.min(MIN_THUMB, Math.max(8, Math.floor(track / 2)));
    return Math.min(track, Math.max(floor, Math.round(track * client / total)));
  }

  // 触屏设备（没有精确指针、但有触摸能力）：轨道不接收事件，保住整片触摸滚动区，只留滑块可拖。
  // 安卓 Chrome 的原生滚动条是 overlay 且静止即隐藏（用户既看不到也拖不到），所以移动端同样接管绘制。
  function touchOnly() {
    try {
      if (window.matchMedia && window.matchMedia("(any-pointer: fine)").matches) return false;
      return !!(navigator && navigator.maxTouchPoints > 0);
    } catch (e) {
      return false;
    }
  }

  function attach(scroller, host) {
    if (!scroller || !scroller.classList) return null;
    if (scroller.__snScrollbar) return scroller.__snScrollbar;
    host = host || scroller.parentElement;
    if (!host || !host.appendChild) return null;
    const cs = window.getComputedStyle ? window.getComputedStyle(host) : null;
    if (cs && cs.position === "static") host.style.position = "relative";
    scroller.classList.add("sb-native-hidden");     // 只改绘制：滚动行为、键盘翻页、滚轮都不受影响
    if (touchOnly()) host.classList.add("sb-touch");   // 触屏：轨道让出事件，保留整片触摸滚动区
    const v = makeAxis("v");
    const h = makeAxis("h");
    host.appendChild(v.track);
    host.appendChild(h.track);
    const api = { update: update, destroy: destroy, vertical: v, horizontal: h };
    scroller.__snScrollbar = api;
    let raf = 0;
    function onScroll() {
      if (raf) return;      // 滚动事件很密（移动端尤甚），合并到一帧一次，避免反复读布局
      const rafFn = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
      raf = rafFn(() => { raf = 0; update(); });
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
    if (typeof window.ResizeObserver === "function") {
      const ro = new window.ResizeObserver(update);
      ro.observe(scroller);
      ro.observe(host);
      api._ro = ro;
    }
    update();
    return api;

    function update() {
      const needV = v.update();
      const needH = h.update();
      // 自绘滑块浮在内容之上：给宿主让出同宽的槽位（原生滚动条本来就占位），
      // 否则底部横条会盖住最后一行、右侧竖条会盖住长行行尾。
      // 让位加在滚动元素自己身上（margin），不能加宿主的 padding：
      // 编辑器 textarea 是 position:absolute + inset:0，宿主的 padding 对它无效。
      scroller.classList.toggle("sb-mar-r", needV);
      scroller.classList.toggle("sb-mar-b", needH);
    }

    function destroy() {
      if (raf && window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
      raf = 0;
      v.track.remove();
      h.track.remove();
      scroller.classList.remove("sb-native-hidden");
      scroller.classList.remove("sb-mar-r", "sb-mar-b");
      host.classList.remove("sb-touch");
      if (typeof scroller.removeEventListener === "function") scroller.removeEventListener("scroll", onScroll);
      if (api._ro) api._ro.disconnect();
      delete scroller.__snScrollbar;
    }

    function makeAxis(axis) {
      const isV = axis === "v";
      const track = SN.el("div", { class: "sb-track sb-" + axis });
      const thumb = SN.el("div", { class: "sb-thumb", role: "scrollbar" });
      thumb.setAttribute("aria-orientation", isV ? "vertical" : "horizontal");
      thumb.setAttribute("aria-valuemin", "0");
      thumb.setAttribute("aria-valuemax", "100");
      thumb.setAttribute("aria-valuenow", "0");
      track.appendChild(thumb);

      const pos = () => (isV ? scroller.scrollTop : scroller.scrollLeft) || 0;
      const setPos = (p) => { if (isV) scroller.scrollTop = p; else scroller.scrollLeft = p; };
      const sizes = () => {
        const client = (isV ? scroller.clientHeight : scroller.clientWidth) || 0;
        const total = (isV ? scroller.scrollHeight : scroller.scrollWidth) || 0;
        // 无布局宿主（自检桩）里轨道量不到长度，退化成按视口长算，保证纯函数可测
        const tlen = (isV ? track.offsetHeight : track.offsetWidth) || client;
        return { client: client, total: total, track: tlen };
      };

      function update() {
        const m = sizes();
        const need = m.track > 0 && m.total - m.client > 1;
        track.classList.toggle("off", !need);
        if (!need) return false;
        const len = thumbLen(m.client, m.total, m.track);
        const maxPos = Math.max(0, m.track - len);
        const maxScroll = Math.max(0, m.total - m.client);
        const cur = pos();
        const off = maxScroll > 0 ? maxPos * (cur / maxScroll) : 0;
        if (isV) {
          thumb.style.height = len + "px";
          thumb.style.transform = "translateY(" + off.toFixed(2) + "px)";
        } else {
          thumb.style.width = len + "px";
          thumb.style.transform = "translateX(" + off.toFixed(2) + "px)";
        }
        thumb.setAttribute("aria-valuenow", String(Math.round(maxScroll > 0 ? (cur / maxScroll) * 100 : 0)));
        return true;
      }

      // 拖动滑块：按「可滚动距离 / 可移动轨道距离」换算，保持跟手
      thumb.addEventListener("pointerdown", (ev) => {
        if (ev.button > 0) return;
        const m = sizes();
        const len = thumbLen(m.client, m.total, m.track);
        const maxPos = Math.max(1, m.track - len);
        const maxScroll = Math.max(1, m.total - m.client);
        const start = isV ? ev.clientY : ev.clientX;
        const startScroll = pos();
        const k = maxScroll / maxPos;
        const onMove = (e2) => {
          setPos(startScroll + ((isV ? e2.clientY : e2.clientX) - start) * k);
          update();
        };
        const onEnd = () => {
          thumb.classList.remove("dragging");
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onEnd);
          document.removeEventListener("pointercancel", onEnd);
        };
        thumb.classList.add("dragging");
        // 监听挂在 document 上：拖动到滑块外面也跟手。capture 只是加成，失败（合成指针 / 无布局宿主）不能挡住拖动
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onEnd);
        document.addEventListener("pointercancel", onEnd);
        try { if (thumb.setPointerCapture) thumb.setPointerCapture(ev.pointerId); } catch (e) { /* 无真实指针时忽略 */ }
        ev.preventDefault();      // 顺带保住编辑器焦点：拖滑块不该让 textarea 失焦
        ev.stopPropagation();
      });

      // 点轨道 = 翻一屏（与原生行为一致，不改变已有的光标定位习惯）
      track.addEventListener("pointerdown", (ev) => {
        if (ev.target === thumb) return;
        const r = track.getBoundingClientRect ? track.getBoundingClientRect() : null;
        const clickPos = r ? (isV ? ev.clientY - r.top : ev.clientX - r.left) : 0;
        const thumbPos = isV ? thumb.offsetTop : thumb.offsetLeft;
        const step = (isV ? scroller.clientHeight : scroller.clientWidth) * 0.9;
        setPos(pos() + (clickPos < thumbPos ? -step : step));
        update();
        ev.preventDefault();
      });

      return { track: track, thumb: thumb, update: update };
    }
  }

  SN.scrollbar = { attach: attach, thumbLen: thumbLen, MIN_THUMB: MIN_THUMB };
})();
