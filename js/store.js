/* =========================================================
   store.js —— 本地存储封装
   localStorage：结构化数据（pet_memorial_data / pet_memorial_draft）
   IndexedDB：照片二进制（pet_memorial_db / photos）
   写入策略：先写临时键再替换，防止中途失败写坏主数据
   ========================================================= */
window.PM = window.PM || {};

PM.Store = (function () {
  var DATA_KEY = "pet_memorial_data";
  var TMP_KEY = "pet_memorial_data__tmp";
  var DRAFT_KEY = "pet_memorial_draft";
  var DB_NAME = "pet_memorial_db";
  var DB_STORE = "photos";
  var DB_VERSION = 1;

  function defaultData() {
    return {
      version: 1,
      state: "UNBUILT",            // UNBUILT | CEREMONY | BUILT
      ceremonyStep: 0,             // 0~7
      pet: {
        ownerName: "",
        petName: "",
        birthday: "",
        deathDate: "",
        gender: "secret",          // male | female | secret
        breed: ""
      },
      stele: { erectedAt: "" },
      incense: {
        lastLightTime: 0,
        totalLightDays: 0,
        continuousLightDays: 0
      },
      messages: [],
      mainPhotoId: "",
      photosMeta: [],              // [{id, createdAt, isMain}] 便于排序/统计（blob 在 IndexedDB）
      settings: { bgmEnabled: false, reducedMotion: false }
    };
  }

  // ---------- localStorage ----------
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) { raw = null; }
    if (!raw) return defaultData();
    try {
      var parsed = JSON.parse(raw);
      // 与默认结构浅合并，容错缺字段
      var base = defaultData();
      return deepMerge(base, parsed);
    } catch (e) {
      return defaultData();
    }
  }

  function save(data) {
    try {
      var json = JSON.stringify(data);
      localStorage.setItem(TMP_KEY, json);       // 先写临时键
      localStorage.setItem(DATA_KEY, json);      // 再落主键
      localStorage.removeItem(TMP_KEY);          // 清理临时键
      return true;
    } catch (e) {
      return false;
    }
  }

  function deepMerge(base, over) {
    if (over === null || typeof over !== "object") return over === undefined ? base : over;
    var out = Array.isArray(base) ? (Array.isArray(over) ? over : base) : Object.assign({}, base);
    if (!Array.isArray(base)) {
      Object.keys(over).forEach(function (k) {
        if (over[k] && typeof over[k] === "object" && base[k] && typeof base[k] === "object") {
          out[k] = deepMerge(base[k], over[k]);
        } else {
          out[k] = over[k];
        }
      });
    }
    return out;
  }

  function clearAll() {
    try {
      localStorage.removeItem(DATA_KEY);
      localStorage.removeItem(TMP_KEY);
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
    return clearPhotos();
  }

  // ---------- 草稿 ----------
  function saveDraft(obj) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  // ---------- IndexedDB ----------
  var _dbPromise = null;
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) { reject(new Error("no indexedDB")); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          var store = db.createObjectStore(DB_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function _tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, mode);
        var store = tx.objectStore(DB_STORE);
        var result = fn(store);
        tx.oncomplete = function () { resolve(result && result.__value !== undefined ? result.__value : true); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function genPhotoId() { return "p_" + Date.now() + "_" + Math.floor(Math.random() * 1000); }

  // 存入一张照片 blob，返回 {id}
  function addPhoto(blob) {
    var id = genPhotoId();
    var rec = { id: id, blob: blob, createdAt: Date.now(), isMain: false };
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(rec);
        tx.oncomplete = function () { resolve({ id: id, createdAt: rec.createdAt }); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getPhotoBlob(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var req = tx.objectStore(DB_STORE).get(id);
        req.onsuccess = function () { resolve(req.result ? req.result.blob : null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deletePhoto(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function clearPhotos() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).clear();
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  // 估算 IndexedDB 占用（用于设置页空间提示）
  function estimateUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      });
    }
    return Promise.resolve({ usage: 0, quota: 0 });
  }

  return {
    DATA_KEY: DATA_KEY,
    defaultData: defaultData,
    load: load,
    save: save,
    clearAll: clearAll,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    openDB: openDB,
    genPhotoId: genPhotoId,
    addPhoto: addPhoto,
    getPhotoBlob: getPhotoBlob,
    deletePhoto: deletePhoto,
    clearPhotos: clearPhotos,
    estimateUsage: estimateUsage
  };
})();
