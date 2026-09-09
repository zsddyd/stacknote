"use strict";
(function () {
  const SN = window.SN;
  const DB_NAME = "snweb";
  const DB_VER = 1;

  let dbPromise = null;
  function idb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("no-indexeddb"));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return idb().then(db => {
      return new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    });
  }

  function kvGet(key, def) {
    return idb().then(db => new Promise((res, rej) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => res(r.result === undefined ? def : r.result);
      r.onerror = () => rej(r.error);
    })).catch(() => Promise.resolve(localGet(key, def)));
  }
  function kvSet(key, val) {
    return idb().then(db => new Promise((res, rej) => {
      const r = db.transaction("kv", "readwrite").objectStore("kv").put(val, key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    })).catch(() => { try { localStorage.setItem("sn:" + key, JSON.stringify(val)); } catch (e) { } });
  }
  function kvDel(key) {
    return idb().then(db => new Promise((res, rej) => {
      const r = db.transaction("kv", "readwrite").objectStore("kv").delete(key);
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    })).catch(() => { try { localStorage.removeItem("sn:" + key); } catch (e) { } });
  }
  function localGet(key, def) {
    try { const v = localStorage.getItem("sn:" + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }

  function docPut(id, obj) {
    return idb().then(db => new Promise((res, rej) => {
      const r = db.transaction("docs", "readwrite").objectStore("docs").put(obj, id);
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    })).catch(() => { });
  }
  function docGet(id) {
    return idb().then(db => new Promise((res, rej) => {
      const r = db.transaction("docs").objectStore("docs").get(id);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    })).catch(() => Promise.resolve(null));
  }
  function docDel(id) {
    return idb().then(db => new Promise((res, rej) => {
      const r = db.transaction("docs", "readwrite").objectStore("docs").delete(id);
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    })).catch(() => { });
  }

  // ---- 会话 ----
  const SESSION_KEY = "session.v1";
  const SESSION_TEXT_CAP = 4 * 1024 * 1024; // 超过 4MB 的正文不写入 IndexedDB（避免大文件 OOM/卡顿）
  function saveSession(session) {
    // 把每个文档正文单独存，元信息存 kv
    const meta = Object.assign({}, session, { docs: undefined, list: [] });
    meta.list = (session.docs || []).map(d => {
      const m = { id: d.id, name: d.name, path: d.path || "", kind: d.kind || "text", enc: d.enc || "utf8", eol: d.eol || "lf", lang: d.lang || "txt", dirty: !!d.dirty, handle: !!d.handle, size: d.size };
      const isText = m.kind === "text";
      const len = (d.content || "").length;
      if (isText && len > 0 && len <= SESSION_TEXT_CAP) {
        docPut(d.id, { text: d.content });
      } else if (!isText || len > SESSION_TEXT_CAP) {
        m.tooBig = true;   // 大文件正文不持久化，重启后不自动恢复
      }
      if (d.handle && d.handle.queryPermission) {
        // FileSystemHandle 无法序列化，但可放 handles map；这里只记 id
        m.hasHandle = true;
      }
      return m;
    });
    meta.activeId = session.activeId || (session.docs && session.docs[0] && session.docs[0].id) || null;
    return kvSet(SESSION_KEY, meta);
  }
  function loadSession() {
    return kvGet(SESSION_KEY, null).then(meta => {
      if (!meta || !Array.isArray(meta.list)) return null;
      const loads = meta.list.map(m => docGet(m.id).then(c => {
        return { id: m.id, name: m.name, path: m.path || "", kind: m.kind || "text", enc: m.enc || "utf8", eol: m.eol || "lf", lang: m.lang || "txt", dirty: !!m.dirty, tooBig: !!m.tooBig, content: (c && c.text) || "" };
      }));
      return Promise.all(loads).then(docs => ({ docs, activeId: meta.activeId, layout: meta.layout }));
    });
  }
  function clearSessionDocs() {
    return idb().then(db => new Promise((res) => {
      const t = db.transaction("docs", "readwrite");
      t.objectStore("docs").clear();
      t.oncomplete = () => res();
    })).catch(() => { });
  }

  SN.store = { kvGet, kvSet, kvDel, docPut, docGet, docDel, saveSession, loadSession, clearSessionDocs };
})();
