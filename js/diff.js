"use strict";
(function () {
  const SN = window.SN;

  function split(v) { return v === "" ? [""] : v.split("\n"); }

  function diffLines(aText, bText) {
    const a = split(aText), b = split(bText);
    let ops;
    if (a.length * b.length > 4e6) {
      ops = coarseDiff(a, b);
      return ops;
    }
    const n = a.length, m = b.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ type: "eq", a: i, b: j, text: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", a: i, b: -1, text: a[i] }); i++; }
      else { ops.push({ type: "add", a: -1, b: j, text: b[j] }); j++; }
    }
    while (i < n) { ops.push({ type: "del", a: i, b: -1, text: a[i] }); i++; }
    while (j < m) { ops.push({ type: "add", a: -1, b: j, text: b[j] }); j++; }
    return ops;
  }

  function coarseDiff(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const ops = [];
    for (let k = 0; k < i; k++) ops.push({ type: "eq", a: k, b: k, text: a[k] });
    if (i < a.length || i < b.length) {
      ops.push({ type: "del", a: i, b: -1, text: "…（内容差异过大，仅做公共前后缀对比）" });
      ops.push({ type: "add", a: -1, b: i, text: "…（左侧共 " + a.length + " 行，右侧共 " + b.length + " 行）" });
    }
    return ops;
  }

  function buildSides(ops) {
    const left = [], right = [];
    for (const o of ops) {
      if (o.type === "eq") { left.push({ cls: "eq", text: o.text }); right.push({ cls: "eq", text: o.text }); }
      else if (o.type === "del") left.push({ cls: "del", text: o.text });
      else right.push({ cls: "add", text: o.text });
    }
    return { left, right };
  }

  SN.diffLines = diffLines;
  SN.diffBuildSides = buildSides;
})();
