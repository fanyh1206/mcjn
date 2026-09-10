/* =========================================================
   main.js —— 入口：状态机路由（UNBUILT / CEREMONY / BUILT）
   同时提供全局 UI 辅助（toast / confirm / prompt / 抽屉 / 操作菜单）与音频桩
   ========================================================= */
window.PM = window.PM || {};

/* ---------------- UI 辅助 ---------------- */
PM.UI = (function () {
  var toastTimer = null;
  function el(id) { return document.getElementById(id); }

  function toast(msg, ms) {
    var t = el("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2400);
  }

  function _modal(text, withInput, cb) {
    var mask = el("modal-mask");
    el("modal-text").textContent = text;
    var wrap = el("modal-input-wrap");
    var input = el("modal-input");
    wrap.hidden = !withInput;
    input.value = "";
    mask.hidden = false;
    if (withInput) setTimeout(function () { input.focus(); }, 50);

    function cleanup() {
      mask.hidden = true;
      el("modal-ok").onclick = null;
      el("modal-cancel").onclick = null;
    }
    el("modal-ok").onclick = function () {
      var v = withInput ? input.value : true;
      cleanup(); cb && cb(v);
    };
    el("modal-cancel").onclick = function () {
      cleanup(); cb && cb(withInput ? null : false);
    };
  }
  function confirm(text, cb) { _modal(text, false, cb); }
  function prompt(text, cb) { _modal(text, true, cb); }

  // 抽屉
  function openDrawer(id) {
    closeDrawers();
    el(id).hidden = false;
    el("drawer-mask").hidden = false;
  }
  function closeDrawers() {
    ["drawer-message", "drawer-photos", "drawer-settings"].forEach(function (d) {
      var e = el(d); if (e) e.hidden = true;
    });
    el("drawer-mask").hidden = true;
  }

  // 操作菜单（照片长按/右键）
  function actionSheet(title, items) {
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    var sheet = document.createElement("div");
    sheet.className = "modal";
    sheet.style.maxWidth = "320px";
    var t = document.createElement("p");
    t.className = "modal-text"; t.textContent = title;
    sheet.appendChild(t);
    var box = document.createElement("div");
    box.className = "set-actions";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.className = it.danger ? "btn-ghost btn-danger" : "btn-primary btn-sm";
      b.textContent = it.label;
      b.onclick = function () { document.body.removeChild(mask); it.onClick && it.onClick(); };
      box.appendChild(b);
    });
    var cancel = document.createElement("button");
    cancel.className = "btn-ghost"; cancel.textContent = "取消";
    cancel.onclick = function () { document.body.removeChild(mask); };
    box.appendChild(cancel);
    sheet.appendChild(box);
    mask.appendChild(sheet);
    mask.addEventListener("click", function (e) { if (e.target === mask) document.body.removeChild(mask); });
    document.body.appendChild(mask);
  }

  // 照片操作菜单
  function photoActions(meta, current, cb) {
    actionSheet("这张照片", [
      {
        label: current.isMain ? "已是碑上照片" : "设为碑上照片",
        onClick: function () {
          if (current.isMain) return;
          PM.Memorial.setMainPhoto(current.id);
          toast("已设为碑上照片");
          cb && cb(true);
        }
      },
      {
        label: "删除照片", danger: true,
        onClick: function () {
          confirm("删去后就找不回了，确定删除这张照片吗？", function (ok) {
            if (!ok) return;
            PM.Memorial.deletePhoto(current.id).then(function () {
              toast("已删除"); cb && cb(true);
            });
          });
        }
      }
    ]);
  }

  return {
    toast: toast, confirm: confirm, prompt: prompt,
    openDrawer: openDrawer, closeDrawers: closeDrawers,
    actionSheet: actionSheet, photoActions: photoActions
  };
})();

/* ---------------- 音频：环境音/BGM（<audio loop>）+ 音效（WebAudio 按需 fetch 解码） ----------------
   音效静音不走 pause：sfxMaster 增益归 0，循环句柄继续跑 → 中途取消静音立即恢复，
   各幕无需重启循环。autoplay 策略：首次 pointerdown 统一 unlock。 */
PM.Audio = (function () {
  var ambient = null, bgm = null;
  var wantAmbient = false, wantBgm = false;
  var ctx = null, sfxMaster = null;
  var buffers = {}, loading = {};
  var liveLoops = [];

  function tryPlay(a) { if (a) { var p = a.play(); if (p && p.catch) p.catch(function () {}); } }

  function ensureCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      sfxMaster = ctx.createGain();
      sfxMaster.gain.value = 0.9;
      sfxMaster.connect(ctx.destination);
    }
    if (ctx.state === "suspended") { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    return ctx;
  }

  function buf(name, cb) {
    if (buffers[name]) { cb(buffers[name]); return; }
    if (loading[name]) { loading[name].push(cb); return; }
    loading[name] = [cb];
    fetch("assets/audio/" + name + ".wav").then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      return ensureCtx().decodeAudioData(ab);
    }).then(function (b) {
      buffers[name] = b;
      loading[name].forEach(function (f) { f(b); });
      delete loading[name];
    }).catch(function () {
      loading[name].forEach(function (f) { f(null); });
      delete loading[name];
    });
  }

  return {
    setAmbient: function (on) {
      wantAmbient = !!on;
      if (!ambient) { ambient = document.querySelector("audio#ambient"); }
      if (!ambient) return;
      if (on) tryPlay(ambient); else ambient.pause();
    },
    setBgm: function (on) {
      wantBgm = !!on;
      if (!bgm) { bgm = document.querySelector("audio#bgm"); }
      if (!bgm) return;
      if (on) tryPlay(bgm); else bgm.pause();
    },
    // 音效总开关（仪式喇叭/纪念馆 BGM 按钮共用）：静音时循环不停，只降主增益
    setSfx: function (on) {
      if (!ctx) { if (!on) return; if (!ensureCtx()) return; }
      sfxMaster.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05);
    },
    // 单次音效
    one: function (name, gain) {
      var c = ensureCtx();
      if (!c) return;
      buf(name, function (b) {
        if (!b) return;
        var s = c.createBufferSource();
        s.buffer = b;
        var g = c.createGain();
        g.gain.value = gain == null ? 0.8 : gain;
        s.connect(g); g.connect(sfxMaster);
        s.start();
      });
    },
    // 循环音效句柄：{ setGain(v) 随动画强度, stop(fadeSec) }；解码完成前 setGain 记待加值
    loop: function (name, gain) {
      var c = ensureCtx();
      var h = {
        _on: true, _s: null, _g: null, _v: gain || 0,
        setGain: function (v) { this._v = v; if (this._g && this._on) this._g.gain.setTargetAtTime(v, c.currentTime, 0.08); },
        stop: function (fade) {
          if (!this._on) return;
          this._on = false;
          liveLoops = liveLoops.filter(function (x) { return x !== h; });
          var s = this._s, g = this._g;
          if (!s || !g) return;
          var f = fade == null ? 0.3 : fade;
          g.gain.setTargetAtTime(0, c.currentTime, f / 3);
          setTimeout(function () { try { s.stop(); } catch (e) {} }, f * 1000 + 120);
        }
      };
      if (!c) return h;
      liveLoops.push(h);
      buf(name, function (b) {
        if (!b || !h._on) return;
        var s = c.createBufferSource();
        s.buffer = b; s.loop = true;
        var g = c.createGain();
        g.gain.value = h._v;
        s.connect(g); g.connect(sfxMaster);
        s.start();
        h._s = s; h._g = g;
      });
      return h;
    },
    // 离场/建馆完成：停掉所有循环句柄（防漏到下一视图）
    stopLoops: function () {
      liveLoops.slice().forEach(function (h) { h.stop(0.3); });
    },
    // 首次手势解锁：恢复 AudioContext + 补播被 autoplay 拦截的 loop 元素
    unlock: function () {
      ensureCtx();
      if (wantAmbient && ambient && ambient.paused) tryPlay(ambient);
      if (wantBgm && bgm && bgm.paused) tryPlay(bgm);
    }
  };
})();

/* ---------------- 应用状态机 ---------------- */
PM.app = (function () {
  var data = null;

  function hideAllViews() {
    ["view-form", "view-ceremony", "view-memorial"].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.hidden = true;
    });
  }

  function loadPhotoImage(id) {
    if (!id) return Promise.resolve(null);
    return PM.Store.getPhotoBlob(id).then(function (blob) {
      if (!blob) return null;
      return PM.Image.loadImage(URL.createObjectURL(blob));
    }).catch(function () { return null; });
  }

  // 开始仪式：写入宠物信息 + 主照片，切换到 CEREMONY
  function beginCeremony(petValue, photoInfo) {
    PM.Store.addPhoto(photoInfo.blob).then(function (r) {
      data.pet = {
        ownerName: petValue.ownerName,
        petName: petValue.petName,
        birthday: petValue.birthday,
        deathDate: petValue.deathDate,
        gender: petValue.gender,
        breed: petValue.breed
      };
      data.photosMeta = [{ id: r.id, createdAt: r.createdAt, isMain: true }];
      data.mainPhotoId = r.id;
      data.state = "CEREMONY";
      data.ceremonyStep = 1;
      data._pendingWords = petValue.words || "";
      PM.Store.save(data);
      return loadPhotoImage(r.id);
    }).then(function (img) {
      hideAllViews();
      PM.Director.start({
        data: data, photoImg: img,
        onFinish: function (finalData) {
          data = finalData;
          hideAllViews();
          PM.Memorial.show(data);
        },
        onBack: backToForm
      });
    });
  }

  // 仪式第一幕返回上一步：回信息填写页（保留已填内容与照片）
  function backToForm() {
    data.state = "UNBUILT";
    PM.Store.save(data);
    hideAllViews();
    document.getElementById("bg-layer").classList.remove("has-image");
    PM.Form.show(data);
  }

  function route() {
    hideAllViews();
    var bg = document.getElementById("bg-layer");
    if (data.state === "BUILT") {
      bg.classList.add("has-image");
      PM.Memorial.show(data);
    } else if (data.state === "CEREMONY" && data.mainPhotoId) {
      bg.classList.remove("has-image");
      loadPhotoImage(data.mainPhotoId).then(function (img) {
        PM.Director.start({
          data: data, photoImg: img,
          onFinish: function (finalData) {
            data = finalData;
            hideAllViews();
            PM.Memorial.show(data);
          },
          onBack: backToForm
        });
      });
    } else {
      // UNBUILT 或数据不完整 → 信息填写页
      data.state = "UNBUILT";
      bg.classList.remove("has-image");
      PM.Form.show(data);
    }
  }

  function boot() {
    data = PM.Store.load();
    // 全局：抽屉关闭 & 遮罩
    document.querySelectorAll(".drawer-close").forEach(function (b) {
      b.addEventListener("click", function () { PM.UI.closeDrawers(); });
    });
    document.getElementById("drawer-mask").addEventListener("click", function () { PM.UI.closeDrawers(); });

    // 减少动态效果偏好
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      data.settings.reducedMotion = true;
    }

    PM.Form.init({ onStart: beginCeremony });
    PM.Memorial.init({});

    route();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  return { boot: boot, route: route, getData: function () { return data; } };
})();
