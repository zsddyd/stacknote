"use strict";
(function () {
  const SN = window.SN;

  // 编辑器主题（15 套）：一套主题同时定义「编辑区」与「界面」的配色，不再有独立的界面皮肤。
  //   bg/fg/gutter/lineNum/activeLine/selection —— 编辑区
  //   accent                                    —— 强调色（选中标签顶条等）
  //   界面变量一律由 chromeOf() 按底色/前景/accent 推导：所有主题共用一套推导逻辑
  const EDITOR_THEMES = [
    // 浅色主题的正文色统一用近黑 #111214，不用纯黑（纯黑在 LCD 上过锐，也是"AI 味"清单里明令禁止的值）
    { id: "default",      name: "Default",            light: true,  bg: "#FFFFFF", fg: "#111214", accent: "#FAAA3C", font: "Courier New 14" },
    { id: "blue_light",   name: "Blue light",         light: true,  bg: "#EAF7FF", fg: "#111214", accent: "#2F80ED", font: "Courier New 14" },
    { id: "lavender",     name: "lavender",           light: true,  bg: "#FFF0F5", fg: "#111214", accent: "#B57EDC", font: "Courier New 14" },
    { id: "misty_rose",   name: "misty rose",         light: true,  bg: "#FFE4E1", fg: "#111214", accent: "#D98098", font: "Courier New 14" },
    { id: "yellow_rice",  name: "yellow rice",        light: true,  bg: "#F6F3EA", fg: "#111214", accent: "#C08A2E", font: "Courier New 14" },
    { id: "bespin",       name: "Bespin",             light: false, bg: "#2A211C", fg: "#BDAE9D", accent: "#FCAF3E", font: "Courier New 14" },
    { id: "black_board",  name: "Black board",        light: false, bg: "#0C1021", fg: "#F8F8F8", accent: "#8080C0", font: "Courier New 14" },
    { id: "choco",        name: "Choco",              light: false, bg: "#1A0F0B", fg: "#C3BE98", accent: "#FCAF3E", font: "Courier New 14" },
    { id: "danslerush",   name: "DansLeRuSH-Dark",    light: false, bg: "#2E2E2E", fg: "#C7C7C7", accent: "#C7C7C7", font: "Courier New 14" },
    // Deep Black 保留"近黑"而不是纯黑：观感几乎一致，但避开纯黑值
    { id: "deep_black",   name: "Deep Black",         light: false, bg: "#050506", fg: "#FFFFFF", accent: "#58A6FF", font: "Courier New 13" },
    { id: "hot_fudge",    name: "HotFudgeSundae",     light: false, bg: "#2B0F01", fg: "#B7975D", accent: "#D9A05B", font: "Consolas 14" },
    { id: "mono_ind",     name: "Mono Industrial",    light: false, bg: "#222C28", fg: "#FFFFFF", accent: "#7FBFA0", font: "Courier New 14" },
    { id: "monokai",      name: "Monokai",            light: false, bg: "#272822", fg: "#F8F8F2", accent: "#A6E22E", font: "Courier New 14" },
    { id: "obsidian",     name: "Obsidian",           light: false, bg: "#293134", fg: "#E0E2E4", accent: "#FFCAB0", font: "Courier New 14" },
    // One Dark Pro
    { id: "onedarkpro",   name: "One Dark Pro",       light: false, bg: "#282C34", fg: "#ABB2BF", accent: "#61AFEF", font: "Consolas 14",
      gutter: "#282C34", lineNum: "#495162", activeLine: "#2C313C", selection: "rgba(103,118,150,.55)" }
  ];

  // 语法色盘：亮 / 暗（Monokai 系）两套 + 特殊覆盖
  const PAL_LIGHT = { key: "#0000cc", kw2: "#0000cc", str: "#cc0000", com: "#7f7f7f", num: "#0000ff", fn: "#795e26", ty: "#267f99", pp: "#af00db", tag: "#800000", attr: "#e50000", meta: "#800080" };
  const PAL_DARK  = { key: "#66D9EF", kw2: "#66D9EF", str: "#E6DB74", com: "#75715E", num: "#F92672", fn: "#A6E22E", ty: "#66D9EF", pp: "#F92672", tag: "#F92672", attr: "#A6E22E", meta: "#FD971F" };
  const SPECIAL = {
    bespin:      { key: "#E5C138", kw2: "#E5C138", str: "#BDAE9D", com: "#2E3436", num: "#FCAF3E", fn: "#FFFF80", ty: "#FAAA3C", pp: "#CC0000", tag: "#FAAA3C", attr: "#FCAF3E", meta: "#FCAF3E" },
    choco:       { key: "#80D4B2", kw2: "#80D4B2", str: "#C3BE98", com: "#6f5b55", num: "#FCAF3E", fn: "#E7D38C", ty: "#3FBA89", pp: "#CC0000", tag: "#E7D38C", attr: "#FCAF3E", meta: "#CC0000" },
    black_board: { key: "#FFCAB0", kw2: "#FFCAB0", str: "#F8F8F8", com: "#8080C0", num: "#FCAF3E", fn: "#8080C0", ty: "#EEEEEC", pp: "#FCAF3E", tag: "#FFCAB0", attr: "#FFCAB0", meta: "#FCAF3E" },
    obsidian:    { key: "#81969A", kw2: "#81969A", str: "#E0E2E4", com: "#6A8088", num: "#FFCAB0", fn: "#E0E2E4", ty: "#81969A", pp: "#FFFF80", tag: "#FFFF80", attr: "#E0E2E4", meta: "#FFFF80" },
    // One Dark Pro 语法色（紫关键字/青运算符、绿字符串、灰注释、橙数字、蓝函数、黄类型、红标签）
    onedarkpro:  { key: "#C678DD", kw2: "#56B6C2", str: "#98C379", com: "#7F848E", num: "#D19A66", fn: "#61AFEF", ty: "#E5C07B", pp: "#C678DD", tag: "#E06C75", attr: "#D19A66", meta: "#56B6C2" }
  };

  function getTheme(id) {
    return EDITOR_THEMES.find(t => t.id === id) || EDITOR_THEMES[0];
  }

  // 界面配色：由主题底色/前景/accent 推导出整套控件变量（亮色往暗压、深色往亮提，方向由 light 决定），
  // 主题可用 ui 逐项覆盖。键名与 css/sn.css 里的变量一一对应。
  function chromeOf(t) {
    const light = !!t.light, bg = t.bg, fg = t.fg;
    const accent = t.accent || "#FAAA3C";
    const toward = light ? "#000000" : "#FFFFFF";
    return {
      "--accent": accent,
      "--border": mixHex(bg, light ? 0.18 : 0.14, toward),
      "--btn-bg": mixHex(bg, light ? 0.12 : 0.10, toward),
      "--btn-hover-a": light ? mixHex(bg, 0.03, "#FFFFFF") : mixHex(bg, 0.16, "#FFFFFF"),
      "--btn-hover-b": light ? mixHex(bg, 0.12, "#000000") : mixHex(bg, 0.07, "#FFFFFF"),
      // 选中/高亮底色要压得住白字：亮色系往暗里压，深色系把 accent 掺进底色。
      // 亮色系的压暗比例取 0.45：默认主题（橙 #FAAA3C）上白字能到 ≈5.7:1，满足 WCAG AA 4.5:1
      // （0.30 时只有 3.8:1，不达标）
      "--selection": light ? mixHex(accent, 0.45, "#000000") : mixHex(bg, 0.28, accent),
      "--panel": mixHex(bg, light ? 0.07 : 0.06, toward),
      "--panel2": light ? bg : mixHex(bg, 0.03, toward),
      "--text": fg,
      "--text-weak": mixHex(fg, 0.42, bg),
      "--hl-row": mixHex(bg, light ? 0.16 : 0.22, accent),
      "--hlw": light ? "#FFEB3B" : "rgba(255,211,61,.32)",
      // 标签栏：未选中标签略沉，选中标签与编辑区同底，靠 accent 顶条区分
      "--tab-bg": mixHex(bg, 0.10, "#000000"),
      "--tab-bg-active": bg,
      "--danger": light ? "#C0392B" : "#E06C75"
    };
  }

  function applyEditorTheme(id) {
    const t = getTheme(id);
    const pal = !t.light ? PAL_DARK : PAL_LIGHT;
    const s = Object.assign({}, pal, SPECIAL[t.id]);
    const root = document.documentElement.style;
    // 编辑区
    root.setProperty("--ed-bg", t.bg);
    root.setProperty("--ed-fg", t.fg);
    root.setProperty("--ed-caret", t.fg);
    // 主题可自带 gutter/lineNum/activeLine/selection；缺省时按亮暗自动推导
    root.setProperty("--ed-gutter-bg", t.gutter || mixHex(t.bg, 0.04, "#000000"));
    root.setProperty("--ed-line-num", t.lineNum || (t.light ? "#7a7a7a" : "#6a6a6a"));
    root.setProperty("--ed-active-line", t.activeLine || hexA(t.light ? "#000000" : "#ffffff", t.light ? 0.05 : 0.06));
    root.setProperty("--ed-selection", t.selection || hexA("#00CCFF", t.light ? 0.35 : 0.25));
    for (const k of ["key", "kw2", "str", "com", "num", "fn", "ty", "pp", "tag", "attr", "meta"]) {
      root.setProperty("--tok-" + k, s[k]);
    }
    // 界面（菜单栏/工具栏/标签栏/状态栏/对话框…）：与编辑区同属一套主题
    const ui = chromeOf(t);
    for (const k of Object.keys(ui)) root.setProperty(k, ui[k]);
    document.body.setAttribute("data-edtheme", t.light ? "light" : "dark");
    SN.settings = SN.settings || {};
    SN.settings.editorTheme = id;
  }

  function mixHex(base, ratio, target) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const b = p(base), t = p(target);
    const m = b.map((v, i) => Math.round(v + (t[i] - v) * ratio));
    return "#" + m.map(v => v.toString(16).padStart(2, "0")).join("");
  }
  function hexA(hex, a) {
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  SN.EDITOR_THEMES = EDITOR_THEMES;
  SN.getTheme = getTheme;
  SN.chromeOf = chromeOf;
  SN.applyEditorTheme = applyEditorTheme;
})();
