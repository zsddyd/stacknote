# StackNote（纯前端多标签文本编辑器）

用 **零依赖、零构建** 的纯前端静态页面实现的多标签文本编辑器，支持大文本 / Hex 只读、编码识别与转码、查找替换、语法高亮、Markdown 预览等功能，可直接部署到 Cloudflare Pages / 阿里云 OSS / Netlify / GitHub Pages 等静态托管。

## 快速体验

直接双击 `index.html` 即可在浏览器打开（建议用 Chrome/Edge/Firefox）。
本地起服务（可选）：

```bash
cd stacknote
python3 -m http.server 8080
# 打开 http://localhost:8080
```

可选自检（Node ≥ 16，无浏览器依赖，用 DOM 桩做启动冒烟）：

```bash
node smoke.js
```

## 实现的功能

### 文档与文件
- 多标签新建/打开/保存/另存为/重命名/关闭（标签右键菜单）
- **打开入口只有一个**（`文件 → 打开…`，Ctrl+O）：视图按内容自动识别 —— 超过阈值(默认 2MB)且头部无 NUL
  的按「大文本只读/虚拟滚动」打开；头部有 NUL 且非 UTF-16 的按「二进制(Hex)只读」打开；其余按可编辑文本打开。
  需要强制某个视图时，打开后在标签/文件列表上右键「重新打开为 →（文本编辑 / 大文本只读 / 二进制(Hex)只读）」，
  三种视图可任意互切（会重新读取原始字节，必要时二次确认）
- 拖拽文件、批量打开；最近文件列表（支持 File System Access 句柄持久化重开）
- 会话恢复：标签、正文、脏标记、编码写入 IndexedDB，刷新后自动还原
- 自动保存草稿到浏览器（可开关）
- 文件列表停靠窗、查找结果停靠窗、工具栏显隐

### 编辑器
- 自带轻量语法高亮引擎（约 30 种语言，含 C/C++/Java/Python/Go/Rust/JS/TS/HTML/CSS/JSON/SQL/Shell 等），行号+书签侧栏，整行高亮，多色指示器（查找/标记）
- 撤销/重做（自管栈，Ctrl+Z/Y）、Tab 插入/行首退格、跳转行
- 大文本只读模式（BigTextRO，虚拟滚动：只渲染可视行，默认 >2MB 自动启用，避免大文件卡顿/OOM）；Hex 只读视图（分页/地址跳转）
- 大文本只读视图的行列定位（statusPos）：有选中内容显示「选区起点行/列 + 已选行数/字符数 + 总行数」，
  无选中显示「视口首行 + 总行数」，滚动或改选即时刷新；只依赖可视行与 `scrollTop`，O(1)，不碰全文
- 大文本只读视图的缩放（zoom）：50%~250%，只改字号与行高并重画可视行（O(可视行)，不动数据）；
  换算公式与编辑器同源（`SN.zoomMetrics`），所以同一缩放级别下两种视图行高一致，且缩放是全局设置——
  新打开的文档会沿用当前级别
- 大文本只读视图的横向滚动：不支持自动换行，但长行不再被裁掉——内容层按**最长行**撑开宽度，
  可直接拖动底部滚动条左右查看；行号列用 `position:sticky` 钉在左侧，横向滚动时不会跑出视野
  （最长行在建行索引时顺带统计，宽度按等宽字形实测宽度换算；多字节字符会略微多留空白，不会裁掉内容）
- 自动换行、显示空白/行尾、缩放
- 右键菜单：编辑器三视图（文本/大文本只读/Hex）与行号栏、标签栏、文件列表、查找结果、状态栏各自一套，
  与顶栏菜单共用同一份菜单模型与能力置灰规则（`js/menu.js` + `js/viewcaps.js`），支持 Esc / ↑↓ / →← / Enter 键盘导航。
  菜单只有「剪切/复制/全选」不提供「粘贴」——脚本读剪贴板在 `file://` 与部分浏览器上不保证可用，粘贴请用 Ctrl+V
- 右键菜单只放「以选中内容为准」的动作：整体性入口（`全部标记(Mark All)`）留在顶栏菜单与查找面板，
  不重复出现在右键菜单里；分隔线与置灰项不带 hover 高亮，也不会出现手型光标
- 右键菜单的动作以**打开菜单那一刻的选区**为准（`js/editor.js` 记忆最近一次有效选区，大文件视图在
  `js/bigtext.js` 里同样记忆）：菜单抢焦点或浏览器右键把光标折叠后，复制/剪切/标记颜色/大小写/行编辑仍作用于
  用户刚选中的那段，不会退化成"作用于整篇"；大文件视图没选中时，会直接取**右键落点下的词**作为标记目标

### 编码与换行
- BOM/无 BOM 编码探测（UTF-8/UTF-16LE/BE/GBK/Big5/Shift-JIS…）
- 以编码重载、转换为编码（写出支持 UTF-8/BOM/UTF-16；GBK 等只读解码）
- 行尾 CRLF/LF/CR 状态栏切换与整文转换

### 查找 / 替换 / 标记 / 书签
- 统一查找对话框：输入关键字后用「当前文件中查找 / 查找所有打开文件」选择作用域
  （文本视图支持大小写/全词/正则；大文件走分块流式检索），F3/F4 步进查找、Ctrl+F/H
- 全部标记（8 色）、词高亮（双击单词）、清除标记
- 查找结果停靠窗（按文件分组、可折叠，点击跳转、复制结果）
- 书签（F2 / Shift+F2 / Ctrl+F2）

### 文本操作
- 大小写 7 种、行首尾空白清理、TAB↔空格
- 行操作：复制/删除重复(连续或全部)/拆分/上下移/删空行/行反序/6 种排序
- 列块编辑对话框（文本填充 / 数字序列 / 前缀，支持 2/8/10/16 进制）

### 编码/语言/主题
- 语言菜单（按首字母分组 + XML/YAML/TXT/用户自定义语言）
- 自定义语言（名称/后缀/关键字，持久化）
- 15 套主题（含 One Dark Pro），每套自带界面配色（菜单栏/工具栏/标签栏/状态栏），不支持主题与界面混搭

### 工具 / 其它
- JSON/XML 格式化、MD5/SHA-1/256/512 计算（文件或选中文本）
- 批量转换打开文档的编码标记
- 插件系统：内置 Base64/URL/UUID/时间戳等脚本插件，可添加自定义 JS 变换插件
- 快捷键一览（与 js/shortcuts.js 同源：菜单提示即实际按键）、选项对话框、关于
- 视图能力提示：只读视图（大文本/Hex）下不适用的菜单、工具栏按钮与快捷键会置灰，
  并按 js/viewcaps.js 的统一文案说明原因（不再出现“点了没反应”）
- 视图能力表：「关于 → 视图能力表…」只读展示三种视图（文本编辑/大文本只读/Hex 只读）对各功能的支持情况

## 因浏览器/静态托管限制未实现

- 本地文件**监控/外部改动提示**与 **tail -f**（需后端事件）
- **目录遍历查找/替换**（需后端文件系统能力）
- **GBK/Big5/Shift-JIS 写出**（浏览器无对应编码器；读取支持）
- 系统右键菜单、管理员提权、资源管理器/终端打开、批量重命名磁盘文件
- 多窗口（多标签可用；跨浏览器实例 IPC 不做）
- 括号匹配/代码折叠/自动补全等高级编辑特性（当前采用简化方案）

## 技术要点

- 单页面 + 原生 JS（IIFE 分文件），无 npm/打包步骤；打开即用、离线可用
- 编辑区 = `<textarea>`（透明文字）+ 高亮 `<pre>` 覆盖层 + 行号侧栏（对齐/滚动同步）
- 视图能力：能力表（`js/viewcaps.js`）声明每个视图支持什么，UI 据此置灰并给出原因；命令层只做
  `SN.views.invoke(能力, 方法, 文档)` 转发，具体怎么做由各视图适配器实现 —— 适配器没实现的能力会得到
  与菜单置灰同一句原因，不会出现"菜单亮了但点了没反应"（编辑器专有能力集中在 app2.js 的文本适配器里）
- 持久化 = IndexedDB（配置/会话/文件句柄/用户插件）+ localStorage 兜底
- 会话持久化对 >4MB 的正文自动跳过（大文档重启后需重新打开），避免写库卡顿
- 编码探测分档：≤1MB 整篇校验（与旧实现结果一致）；>1MB 只采样头/中/尾（合计约 512KB）判定，
  BOM 仍按文件开头精确判定 —— 打开大文件不再有 1~3 秒的主线程阻塞（200MB 实测约 630ms → 数毫秒）
- 文件写入优先走 File System Access API（Chrome/Edge），否则回退为“下载”

## 文件结构

```text
index.html             入口
manifest.webmanifest   PWA manifest
icons/favicon.svg      应用图标（SVG，小尺寸优化版：无描边、元素加粗，16px 可辨认）
icons/favicon.ico      16/32/48 位图图标（旧浏览器 / 书签栏）
icons/apple-touch-icon.png  iOS 主屏图标（180，满幅橙底）
icons/icon-192.png     PWA 图标
icons/icon-512.png     PWA 图标
icons/icon-maskable-512.png  PWA maskable 图标（满幅橙底，内容收在 80% 安全圆内）
icons/stacknote-icon.svg     图标矢量母版（大尺寸版的设计源，改完重新导出上面 4 个 PNG）
css/sn.css             全部样式（CSS 变量承载主题色，在 :root 给出首屏兜底值）
js/util.js             基础工具/事件总线
js/viewcaps.js         视图能力表（文本/大文本只读/Hex 各支持哪些功能，菜单与快捷键据此置灰）
js/shortcuts.js        快捷键唯一来源（菜单提示/按键分发/一览对话框同源，支持改键覆盖）
js/themes.js           15 套主题（含 One Dark Pro）：编辑区 + 界面配色一体，界面变量统一由 chromeOf 推导
js/langdefs.js         语言表（关键词/后缀/注释风格）
js/highlight.js        轻量语法着色 + 标记渲染
js/encoding.js         编码探测/解码/编码写出
js/hash.js             MD5 + WebCrypto(SHA-1/256/512)
js/storage.js          IndexedDB 封装（设置/会话/用户插件）
js/editor.js           编辑器控件（覆盖层高亮、行号、撤销、书签、缩放）
js/textops.js          文本变换纯函数
js/menu.js             弹出菜单机制（顶栏下拉与右键菜单共用的渲染器/子菜单/键盘导航/宿主委托）
js/app.js              应用框架：菜单/工具栏/标签/文档/状态栏/对话框骨架
js/app2.js             业务实现：查找/编辑操作/Hex/工具/插件/选项/启动
```

## 应用图标

画面主题是**三层叠放的编辑器页面**：浅蓝文档、白纸、橙色编辑面板，带标签页、行号方块、
行号栏竖线与三行代码色块。配色严格取品牌值：`#FAAA3C`（主橙）/ `#FFFFFF` / `#C0DCF2`（浅蓝）
/ `#26282C`（线条）。

同一套设计语言下有**两套几何**，因为一套图形不可能同时照顾 16px 与 512px：

- `icons/favicon.svg` —— **小尺寸版**：去掉全部描边、元素加粗、层数减到两层，只留行号栏与三行代码。
  实测 16px 下仍能看出「叠放的两页 + 文本行」。
- `icons/icon-192.png` / `icon-512.png` / `icon-maskable-512.png` / `apple-touch-icon.png`
  —— **大尺寸版**：完整三层纸、行号方块、标题栏分隔线、行号栏竖线。其矢量母版是
  `icons/stacknote-icon.svg`（1024 坐标系），改颜色、比例或层数都改它。

`icons/` 里除矢量母版外的 6 个文件都是出货资产。重新导出（需要 `rsvg-convert` 与 ImageMagick）：

```bash
rsvg-convert -w 512 -h 512 icons/stacknote-icon.svg -o icons/icon-512.png
rsvg-convert -w 192 -h 192 icons/stacknote-icon.svg -o icons/icon-192.png
rsvg-convert -w 16 -h 16 icons/favicon.svg -o /tmp/f16.png    # 24/32/48 同理
magick /tmp/f16.png /tmp/f32.png /tmp/f48.png icons/favicon.ico
```

maskable 与 apple-touch 需要在满幅橙底（`#FAAA3C`）上把母版缩到 74.9% / 82% 并居中，再合成导出
——前者保证内容落在 80% 安全圆内，后者避免 iOS 上出现透明边。

关于 `favicon.ico` 不在站点根目录：只要 `index.html` 里声明了 `<link rel="icon">`，浏览器就按声明取图，
不会再去请求惯例路径 `/favicon.ico` —— 实测 Chrome 149：页面加载全程**未**请求根目录 `/favicon.ico`，
只取了声明过的 `icons/` 路径。少数不解析 HTML 的抓取方（部分 RSS 阅读器、老式爬虫、个别 IM 的链接
预览）会盲取 `/favicon.ico`，它们会拿到 404；如果在意这类边角场景，把 `favicon.ico` 复制一份回根目录
即可，其它文件仍可留在 `icons/`。

`smoke.js` 会校验 `index.html` / `manifest.webmanifest` 声明的图标在磁盘上确实存在、且 PNG 尺寸
与声明一致 —— 清单引用缺失图标是静态托管最常见的坑（本地看着正常，装上应用却没有图标）。

## 部署到静态托管

### Cloudflare Pages
1. 在 Cloudflare Dashboard → Workers & Pages → 创建 → Pages。
2. “直接上传”本目录内容（或连接 Git 仓库，构建命令留空，输出目录留空/`/`）。
3. 部署完成后即可访问，无需任何服务器逻辑。

### 阿里云 OSS / 其它对象存储
1. 在 OSS 控制台新建 Bucket，将目录内文件全部上传。
2. Bucket 设置“静态网站托管”，默认首页填 `index.html`。
3. 若绑定自定义域名，请配置对应 CDN/HTTPS。

### Netlify / Vercel / GitHub Pages
- Netlify：拖拽文件夹上传即可（无构建命令）。
- Vercel：项目类型选 “Other / Static”，输出目录 `/`。
- GitHub Pages：把本目录推送到仓库根即可。

> 提示：所有资源均为相对路径且无外部 CDN 依赖，任意静态空间都可直接使用。

## License / 许可证

- StackNote 以 **GNU General Public License v3.0**（SPDX: `GPL-3.0-only`）发布，完整许可文本见 [LICENSE](LICENSE)。
- Copyright (C) 2026 zsddyd。

### 出处与致谢

StackNote 是桌面文本编辑器 **notepad--**（[gitee.com/cxasm/notepad--](https://gitee.com/cxasm/notepad--) / [github.com/cxasm/notepad--](https://github.com/cxasm/notepad--) ，GPL-3.0）的独立前端重实现：仅参考其交互与功能布局进行纯前端开发，不含原项目的 C++/Qt 代码。原项目以 GPL-3.0 发布，依据其许可要求，本项目在此声明出处并沿用 GPL-3.0 许可发布。
