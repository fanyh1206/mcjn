/* =========================================================
   assets.js —— 素材加载器（5.7 规格实现）
   按幕懒加载、加载失败静默降级（回退代码绘制）、支持 DPR 分档。
   素材文件放入 assets/img/ 后自动生效，无需改代码。
   ========================================================= */
window.PM = window.PM || {};

PM.Assets = (function () {
  // 素材注册表：key -> { file, altFile(降级/1x), acts(需要它的幕) }
  var registry = {
    urn_body:       { file: "urn_body.webp",       fallback: "urn_body.png",       acts: [4] },
    urn_lid:        { file: "urn_lid.webp",        fallback: "urn_lid.png",        acts: [4] },
    coffin_body:    { file: "coffin_body.webp",     fallback: "coffin_body.png",    acts: [5, 6] },
    coffin_lid:     { file: "coffin_lid.webp",      fallback: "coffin_lid.png",     acts: [5] },
    incense_burner: { file: "incense_burner.webp",  fallback: "incense_burner.png", acts: [7] },
    stele:          { file: "stele.webp",           fallback: "stele.png",          acts: [6, 7] },
    bg_night_grass: { file: "bg_night_grass.webp",  fallback: "bg_night_grass.png", acts: [6, 7] }
  };

  var BASE_PATH = "assets/img/";
  var loaded = {};   // key -> Image (成功) 或 null (失败)
  var loading = {};  // key -> Promise

  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  // 尝试加载单张素材（WebP 优先，失败降级 PNG，再失败返回 null）
  function loadOne(key) {
    if (loaded[key] !== undefined) return Promise.resolve(loaded[key]);
    if (loading[key]) return loading[key];

    var reg = registry[key];
    if (!reg) { loaded[key] = null; return Promise.resolve(null); }

    var p = tryLoad(BASE_PATH + reg.file).then(function (img) {
      if (img) { loaded[key] = img; return img; }
      // WebP 不存在或解码失败，尝试 fallback
      return tryLoad(BASE_PATH + reg.fallback).then(function (img2) {
        loaded[key] = img2; // 可能也是 null
        return img2;
      });
    });
    loading[key] = p;
    return p;
  }

  function tryLoad(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  // 按幕预加载：进入某幕前调用，返回 Promise（全部加载完/失败后 resolve）
  function preloadForAct(actNum) {
    var keys = Object.keys(registry).filter(function (k) {
      return registry[k].acts.indexOf(actNum) !== -1;
    });
    return Promise.all(keys.map(loadOne));
  }

  // 预加载全部（首页启动时可选调用）
  function preloadAll() {
    return Promise.all(Object.keys(registry).map(loadOne));
  }

  // 获取已加载素材，null 表示不可用（降级为代码绘制）
  function get(key) {
    return loaded[key] || null;
  }

  // 检查某素材是否可用
  function has(key) {
    return !!loaded[key];
  }

  // 素材是否已出结果（成功或彻底失败）；加载中返回 false，供绘制端跳过降级代码画，
  // 避免素材异步加载完成前先闪现代码绘制的旧图形
  function ready(key) {
    return loaded[key] !== undefined;
  }

  // 在 Canvas 上绘制素材（居中于 x,y，按 scale 缩放），不可用时返回 false
  function draw(ctx, key, x, y, w, h) {
    var img = get(key);
    if (!img) return false;
    ctx.drawImage(img, x - w / 2, y - h, w, h);
    return true;
  }

  return {
    registry: registry,
    dpr: dpr,
    loadOne: loadOne,
    preloadForAct: preloadForAct,
    preloadAll: preloadAll,
    get: get,
    has: has,
    ready: ready,
    draw: draw
  };
})();
