# StackNote 项目约定（AGENTS.md）

StackNote 是一款**零依赖、零构建**的纯前端多标签文本编辑器：全部代码为可直接打开的静态文件，可离线运行，可部署到任意静态托管。本文件是编码代理在本仓库工作时的长期记忆与硬性规则，改动代码前必须阅读并遵守。

## 目录与模块组织

- `index.html` —— 唯一入口；**`<script>` 顺序即模块加载顺序**，`window.SN` 没有加载器，新增模块必须按依赖从底层到上层排列（`util.js` → … → `app.js` / `app2.js` 最后），顺序错会导致运行时报错。
- `js/` —— 一个文件一个关注点：`util.js`、`themes.js`、`encoding.js`、`editor.js`、`bigtext.js`、`app.js`、`app2.js` 等。每个文件都是 `"use strict";` + IIFE，通过共享命名空间 `window.SN` 暴露能力。
- `css/sn.css` —— 全部样式；界面亮/暗皮肤与编辑器主题通过 CSS 自定义属性实现。
- `smoke.js` —— Node（≥ 16）启动冒烟测试：加载全部站点 JS 并执行 `boot()`。
- `manifest.webmanifest` —— PWA 清单。
- `js/version.js` —— 版本号唯一来源与运行时常量（见「版本号规则」）。

## 常用命令

项目无构建步骤、无包管理器：

- 运行：直接双击 `index.html`，或 `python3 -m http.server 8080` 后访问 `http://localhost:8080`。
- 自检：`node smoke.js`；成功输出 `SMOKE OK` 且退出码为 0。任何 JS 改动后都应运行。

## 编码风格

- 两空格缩进、双引号字符串、只用 `const` / `let`（不用 `var`）、箭头函数、文件顶部 `"use strict";` + IIFE。
- 标识符与元素 id 用 `camelCase`（`editorZone`、`fileDock`）；CSS 类用 kebab-case（`dock-split`）；高频热元素用短名（`tabbar`、`iconbt`）。
- 文本变换写成纯函数（参考 `js/textops.js` 等）。
- UI 文案与注释用中文，代码标识符用英文。
- 无 linter/formatter，新代码与周边风格保持一致。

## 测试要求

- JS 改动后必须运行 `node smoke.js` 并保持通过——这是回归门禁。
- 尽量为所改行为补充针对性断言（`smoke.js` 的 DOM 桩可扩展）。
- 浏览器专有能力（File System Access、IndexedDB、大文件虚拟滚动等）桩测覆盖不到，需在 Chrome/Edge 手工验证。

## 版本号规则（重要）

- 版本号 = 14 位「发布时间戳」**YYYYMMDDHHMM**（本地时间：年 4 位 + 月 2 位 + 日 2 位 + 时 2 位 + 分 2 位），如 `202609091506`；同一分钟内再次 push 不强制递增。
- 唯一来源：`js/version.js`，内容形如 `window.SN_VERSION = "202609091506";`；读取/修改版本号只操作这一个文件，不设独立的 `VERSION` 文件。
- 运行时展示：
  - `index.html` 的 `<script>` 顺序中把 `js/version.js` 放在 `app2.js` 之前加载；
  - 「关于 → 关于 StackNote」（`dlg.about()`，位于 `js/app2.js`）读取 `window.SN_VERSION` 展示「版本：`<版本号>`」，读取不到时显示 `dev`。
- 若该文件与展示尚未落地，首个带版本号的 push 前必须先按此约定实现，禁止跳过。
- **每次向远端 push 之前必须按序执行**：
  1. 用当前本地时间生成新版本号 `YYYYMMDDHHMM`；与 `js/version.js` 中当前值相同则跳过；
  2. 把新版本号写入 `js/version.js`；
  3. 先提交代码改动（若有），再以 Conventional Commit 提交版本号，如 `chore: bump version to 202609091506`；
  4. 随后执行 `git push`，使版本号提交与代码改动一起推送到远端。
- 禁止手工改写版本号文件、绕过上述流程直接 push，或对已推送的版本提交使用 `git commit --amend` 改写历史。

## 提交与 PR 规范

- 提交信息遵循 Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` + 简洁的中文（或英文）摘要。
- 说明改了什么、为什么改，标注涉及模块（如 `js/editor.js`），UI 变化需描述清楚；一次提交 / 一个 PR 聚焦一个功能或修复。
- 许可：GPL-3.0（见 `LICENSE`）。本项目是 notepad-- 的独立前端实现，仅参考其交互与功能布局、不含其 C++/Qt 代码；出处声明保留在 `README.md`，只引入许可兼容的代码。
