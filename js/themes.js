"use strict";
(function () {
  const SN = window.SN;

  // 编辑器主题（18 套）
  const EDITOR_THEMES = [
    { id: "default",      name: "Default",            light: true,  bg: "#FFFFFF", fg: "#000000", font: "Courier New 14" },
    { id: "blue_light",   name: "Blue light",         light: true,  bg: "#EAF7FF", fg: "#000000", font: "Courier New 14" },
    { id: "lavender",     name: "lavender",           light: true,  bg: "#FFF0F5", fg: "#000000", font: "Courier New 14" },
    { id: "misty_rose",   name: "misty rose",         light: true,  bg: "#FFE4E1", fg: "#000000", font: "Courier New 14" },
    { id: "yellow_rice",  name: "yellow rice",        light: true,  bg: "#F6F3EA", fg: "#000000", font: "Courier New 14" },
    { id: "bespin",       name: "Bespin",             light: false, bg: "#2A211C", fg: "#BDAE9D", font: "Courier New 14" },
    { id: "black_board",  name: "Black board",        light: false, bg: "#0C1021", fg: "#F8F8F8", font: "Courier New 14" },
    { id: "choco",        name: "Choco",              light: false, bg: "#1A0F0B", fg: "#C3BE98", font: "Courier New 14" },
    { id: "danslerush",   name: "DansLeRuSH-Dark",    light: false, bg: "#2E2E2E", fg: "#C7C7C7", font: "Courier New 14" },
    { id: "deep_black",   name: "Deep Black",         light: false, bg: "#000000", fg: "#FFFFFF", font: "Courier New 13" },
    { id: "hot_fudge",    name: "HotFudgeSundae",     light: false, bg: "#2B0F01", fg: "#B7975D", font: "Consolas 14" },
    { id: "mono_ind",     name: "Mono Industrial",    light: false, bg: "#222C28", fg: "#FFFFFF", font: "Courier New 14" },
    { id: "monokai",      name: "Monokai",            light: false, bg: "#272822", fg: "#F8F8F2", font: "Courier New 14" },
    { id: "obsidian",     name: "Obsidian",           light: false, bg: "#293134", fg: "#E0E2E4", font: "Courier New 14" },
    { id: "plastic",      name: "Plastic Code Wrap",  light: false, bg: "#0B161D", fg: "#F8F8F8", font: "Courier New 14" },
    { id: "ruby_blue",    name: "Ruby Blue",          light: false, bg: "#FF8000", fg: "#FFFF80", font: "Courier New 14" },
    { id: "twilight",     name: "Twilight",           light: false, bg: "#141414", fg: "#F8F8F8", font: "Consolas 14" },
    { id: "vibrant_ink",  name: "Vibrant Ink",        light: false, bg: "#FF8000", fg: "#FFFF80", font: "Courier New 14" }
  ];

  // 控件皮肤（应用层 QSS 语义映射到 CSS 变量）
  const APP_SKINS = [
    { id: "light", name: "浅色", accent: "#FAAA3C", border: "#C0DCF2" },
    { id: "dark",  name: "暗色", accent: "#FAAA3C", border: "#3a3f47" }
  ];

  // 语法色盘：亮 / 暗（Monokai 系）两套 + 特殊覆盖
  const PAL_LIGHT = { key: "#0000cc", kw2: "#0000cc", str: "#cc0000", com: "#7f7f7f", num: "#0000ff", fn: "#795e26", ty: "#267f99", pp: "#af00db", tag: "#800000", attr: "#e50000", meta: "#800080" };
  const PAL_DARK  = { key: "#66D9EF", kw2: "#66D9EF", str: "#E6DB74", com: "#75715E", num: "#F92672", fn: "#A6E22E", ty: "#66D9EF", pp: "#F92672", tag: "#F92672", attr: "#A6E22E", meta: "#FD971F" };
  const SPECIAL = {
    bespin:      { key: "#E5C138", kw2: "#E5C138", str: "#BDAE9D", com: "#2E3436", num: "#FCAF3E", fn: "#FFFF80", ty: "#FAAA3C", pp: "#CC0000", tag: "#FAAA3C", attr: "#FCAF3E", meta: "#FCAF3E" },
    choco:       { key: "#80D4B2", kw2: "#80D4B2", str: "#C3BE98", com: "#6f5b55", num: "#FCAF3E", fn: "#E7D38C", ty: "#3FBA89", pp: "#CC0000", tag: "#E7D38C", attr: "#FCAF3E", meta: "#CC0000" },
    black_board: { key: "#FFCAB0", kw2: "#FFCAB0", str: "#F8F8F8", com: "#8080C0", num: "#FCAF3E", fn: "#8080C0", ty: "#EEEEEC", pp: "#FCAF3E", tag: "#FFCAB0", attr: "#FFCAB0", meta: "#FCAF3E" },
    obsidian:    { key: "#81969A", kw2: "#81969A", str: "#E0E2E4", com: "#6A8088", num: "#FFCAB0", fn: "#E0E2E4", ty: "#81969A", pp: "#FFFF80", tag: "#FFFF80", attr: "#E0E2E4", meta: "#FFFF80" },
    twilight:    { key: "#b5834a", kw2: "#b5834a", str: "#F8F8F8", com: "#5f5a60", num: "#CF6A4C", fn: "#F9EE98", ty: "#7587A6", pp: "#FCAF3E", tag: "#7587A6", attr: "#F8F8F8", meta: "#CF6A4C" }
  };

  function getTheme(id) {
    return EDITOR_THEMES.find(t => t.id === id) || EDITOR_THEMES[0];
  }

  function applyEditorTheme(id) {
    const t = getTheme(id);
    const pal = !t.light ? PAL_DARK : PAL_LIGHT;
    const s = Object.assign({}, pal, SPECIAL[t.id]);
    const root = document.documentElement.style;
    root.setProperty("--ed-bg", t.bg);
    root.setProperty("--ed-fg", t.fg);
    root.setProperty("--ed-caret", t.fg);
    root.setProperty("--ed-gutter-bg", mixHex(t.bg, 0.04, "#000000"));
    root.setProperty("--ed-line-num", t.light ? "#7a7a7a" : "#6a6a6a");
    root.setProperty("--ed-active-line", hexA(t.light ? "#000000" : "#ffffff", t.light ? 0.05 : 0.06));
    root.setProperty("--ed-selection", hexA("#00CCFF", t.light ? 0.35 : 0.25));
    for (const k of ["key", "kw2", "str", "com", "num", "fn", "ty", "pp", "tag", "attr", "meta"]) {
      root.setProperty("--tok-" + k, s[k]);
    }
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

  function applyAppSkin(id) {
    const skin = APP_SKINS.find(s => s.id === id) || APP_SKINS[0];
    document.body.setAttribute("data-appskin", skin.id);
    SN.settings = SN.settings || {};
    SN.settings.appSkin = skin.id;
  }

  SN.EDITOR_THEMES = EDITOR_THEMES;
  SN.APP_SKINS = APP_SKINS;
  SN.getTheme = getTheme;
  SN.applyEditorTheme = applyEditorTheme;
  SN.applyAppSkin = applyAppSkin;
})();
