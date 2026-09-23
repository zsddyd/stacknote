"use strict";
// 工具栏与界面图标：内联 SVG，零依赖（不引 npm 图标包、不发额外请求，file:// 下同样可用）。
// 字形取自 Tabler Icons 的 outline 集（https://github.com/tabler/tabler-icons，MIT License），
// 只保留本项目用到的那些，并按统一规格重写包装：24 网格 / 1.5px 描边 / 圆角端点 /
// stroke 用 currentColor（跟随主题，深浅色同一套图标，不反相）。
// 用法：SN.uiIcons.get("new") 取完整 <svg> 字符串；SN.uiIcons.names() 列全部键名。
(function () {
  const SN = (window.SN = window.SN || {});

  // 语义沿用原 emoji 版（新建/打开/保存/剪切…都保持不变），只把绘制语言换成线性图标；
  // 其中三处改成语义更准确的字形：关闭全部（原垃圾桶→叠放方框+叉）、
  // 复制（原书签夹→两个叠放方框）、显示空白（原 ␣→¶ 段落符号）。
  const PATHS = {
    // 文件：新建
    new: ["M14 3v4a1 1 0 0 0 1 1h4",
      "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2",
      "M12 11l0 6",
      "M9 14l6 0"],
    open: ["M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2"],
    save: ["M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2",
      "M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      "M14 4l0 4l-6 0l0 -4"],
    // 多个文件：全部保存
    saveall: ["M15 3v4a1 1 0 0 0 1 1h4",
      "M18 17h-7a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h4l5 5v7a2 2 0 0 1 -2 2",
      "M16 17v2a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h2"],
    close: ["M18 6l-12 12", "M6 6l12 12"],
    // 叠放方框 + 叉：关闭全部
    closeall: ["M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
      "M4.012 16.737a2 2 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
      "M11.5 11.5l4.9 5",
      "M16.5 11.5l-5.1 5"],
    cut: ["M3 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
      "M3 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
      "M8.6 8.6l10.4 10.4",
      "M8.6 15.4l10.4 -10.4"],
    copy: ["M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
      "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"],
    paste: ["M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2",
      "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2"],
    undo: ["M9 14l-4 -4l4 -4", "M5 10h11a4 4 0 1 1 0 8h-1"],
    redo: ["M15 14l4 -4l-4 -4", "M19 10h-11a4 4 0 1 0 0 8h1"],
    find: ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M21 21l-6 -6"],
    replace: ["M7 10h14l-4 -4", "M17 14h-14l4 4"],
    mark: ["M3 19h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4",
      "M12.5 5.5l4 4",
      "M4.5 13.5l4 4",
      "M21 15v4h-8l4 -4l4 0"],
    clearmark: ["M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3",
      "M18 13.3l-6.3 -6.3"],
    zoomin: ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M7 10l6 0", "M10 7l0 6", "M21 21l-6 -6"],
    zoomout: ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M7 10l6 0", "M21 21l-6 -6"],
    wrap: ["M4 6l16 0", "M4 18l5 0", "M4 12h13a3 3 0 0 1 0 6h-4l2 -2m0 4l-2 -2"],
    // ¶ 段落符号：显示空白/不可见字符
    blank: ["M13 4v16", "M17 4v16", "M19 4h-9.5a4.5 4.5 0 0 0 0 9h3.5"],
    // 备用：书签（书签功能在用，工具栏暂未放按钮）
    bookmark: ["M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4"]
  };

  const SIZE = 20;         // 默认显示尺寸（CSS 可覆盖）
  const STROKE = 1.5;      // 全局统一线宽（24 网格坐标；Tabler 默认是 2，这里按"小尺寸更轻"调细）
  const cache = {};

  function build(paths) {
    const body = paths.map(d => '<path d="' + d + '"/>').join("");
    return '<svg viewBox="0 0 24 24" width="' + SIZE + '" height="' + SIZE + '" fill="none" stroke="currentColor" ' +
      'stroke-width="' + STROKE + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      body + "</svg>";
  }

  function get(name) {
    const paths = PATHS[name];
    if (!paths) return "";
    if (!cache[name]) cache[name] = build(paths);
    return cache[name];
  }

  SN.uiIcons = {
    get,
    has: (name) => Object.prototype.hasOwnProperty.call(PATHS, name),
    names: () => Object.keys(PATHS),
    PATHS,          // 供测试/二次加工
    source: "Tabler Icons (MIT), https://github.com/tabler/tabler-icons"
  };
})();
