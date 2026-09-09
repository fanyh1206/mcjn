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

/* ---------------- 音频桩（无本地音频文件时静默） ---------------- */
PM.Audio = (function () {
  var ambient = null, bgm = null;
  function tryPlay(a) { if (a) { var p = a.play(); if (p && p.catch) p.catch(function () {}); } }
  return {
    setAmbient: function (on) {
      if (!ambient) { ambient = document.querySelector("audio#ambient"); }
      if (!ambient) return;
      if (on) tryPlay(ambient); else ambient.pause();
    },
    setBgm: function (on) {
      if (!bgm) { bgm = document.querySelector("audio#bgm"); }
      if (!bgm) return;
      if (on) tryPlay(bgm); else bgm.pause();
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
