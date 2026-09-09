/* =========================================================
   utils/image.js —— 照片读取、校验、压缩（最长边限制 + 质量）
   ========================================================= */
window.PM = window.PM || {};

PM.Image = (function () {
  var MAX_BYTES = 10 * 1024 * 1024; // 上传上限 10MB
  var ALLOWED = ["image/jpeg", "image/png", "image/webp"];

  // 是否移动端（用于压缩最长边分档）
  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  }

  // 校验文件类型与体积
  function validate(file) {
    if (!file) return { ok: false, msg: "还没有选择照片呢" };
    if (ALLOWED.indexOf(file.type) === -1) {
      return { ok: false, msg: "这里只收 jpg / png / webp 格式的照片" };
    }
    if (file.size > MAX_BYTES) {
      return { ok: false, msg: "照片有点大，请选择 10MB 以内的图片" };
    }
    return { ok: true };
  }

  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("image load failed")); };
      img.src = src;
    });
  }

  // 压缩：最长边 ≤ maxEdge（默认桌面 1600 / 手机 1280），质量 0.85，输出 WebP（失败降级 JPEG）
  function compress(file, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge || (isMobile() ? 1280 : 1600);
    var quality = opts.quality || 0.85;

    return readAsDataURL(file).then(loadImage).then(function (img) {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, cw, ch);

      return new Promise(function (resolve) {
        var done = function (blob) {
          resolve({
            blob: blob,
            width: cw,
            height: ch,
            url: URL.createObjectURL(blob)
          });
        };
        // 优先 WebP，Safari 等不支持时 toBlob 会回退，做特性检测
        var supportsWebP = canvas.toDataURL("image/webp").indexOf("data:image/webp") === 0;
        var type = supportsWebP ? "image/webp" : "image/jpeg";
        canvas.toBlob(function (b) { done(b); }, type, quality);
      });
    });
  }

  // Blob -> ObjectURL
  function blobToURL(blob) {
    return URL.createObjectURL(blob);
  }

  return {
    MAX_BYTES: MAX_BYTES,
    isMobile: isMobile,
    validate: validate,
    readAsDataURL: readAsDataURL,
    loadImage: loadImage,
    compress: compress,
    blobToURL: blobToURL
  };
})();
