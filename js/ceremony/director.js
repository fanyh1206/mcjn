/* =========================================================
   ceremony/director.js —— 仪式总导演
   幕切换、时间轴循环、进度保存、跳过、方向变化重放、完成建馆。
   ========================================================= */
window.PM = window.PM || {};

PM.Director = (function () {
  var canvas, ctx, view;
  var system, incense;
  var acts = PM.Acts.list;
  var data, photoImg;
  var index = 0;             // 当前幕 0~6
  var raf = null, last = 0, time = 0;
  var dpr = 1, W = 0, H = 0;
  var layout = null;
  var timers = [];
  var onFinishCb = null;
  var onBackCb = null;
  var bgImage = false;
  var audioOn = false;
  var finished = false;

  // ---------- DOM ----------
  function el(id) { return document.getElementById(id); }
  var btnEl, captionEl, photoLayer, vignetteEl, skipEl, audioEl, bgLayer, backEl;

  // ---------- 上下文 C ----------
  var C = {
    get ctx() { return ctx; },
    get system() { return system; },
    get incense() { return incense; },
    get layout() { return layout; },
    get data() { return data; },
    get photoImg() { return photoImg; },
    get w() { return W; },
    get h() { return H; },

    showButton: function (text) {
      btnEl.textContent = text;
      btnEl.hidden = false;
      requestAnimationFrame(function () { btnEl.classList.add("show"); });
    },
    hideButton: function () {
      btnEl.classList.remove("show");
      setTimeout(function () { btnEl.hidden = true; }, 400);
    },
    showCaption: function (text) {
      captionEl.innerHTML = text.replace(/\n/g, "<br>");
      captionEl.hidden = false;
      requestAnimationFrame(function () { captionEl.classList.add("show"); });
    },
    hideCaption: function () {
      captionEl.classList.remove("show");
      setTimeout(function () { captionEl.hidden = true; }, 600);
    },
    showPhoto: function (show) {
      var p = photoLayer.querySelector(".cer-photo");
      if (show) {
        if (!p) {
          p = document.createElement("img");
          p.className = "cer-photo";
          p.alt = "宠物照片";
          photoLayer.appendChild(p);
        }
        if (photoImg) p.src = photoImg.src;
        p.hidden = false;
      } else if (p) {
        p.hidden = true;
      }
    },
    hidePhoto: function (clear) {
      var p = photoLayer.querySelector(".cer-photo");
      if (p) {
        if (clear) { p.remove(); } else { p.hidden = true; }
      }
    },
    setVignette: function (warm) { vignetteEl.classList.toggle("warm", !!warm); },
    setBgImage: function (on) {
      bgImage = on;
      bgLayer.classList.toggle("has-image", !!on);
    },
    delay: function (ms, fn) {
      var id = setTimeout(function () {
        timers = timers.filter(function (t) { return t !== id; });
        fn();
      }, ms);
      timers.push(id);
      return id;
    },
    clearTimers: function () {
      timers.forEach(clearTimeout);
      timers = [];
    },
    next: function () { goto(index + 1); },
    finish: function () { finish(); },
    markIncenseLit: function () { /* 由 finish 统一提交点燃数据 */ }
  };

  // ---------- 画布尺寸 ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = view.clientWidth;
    H = view.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = PM.Scene.computeLayout(W, H);
    if (incense) {
      incense.setPosition(layout.burnerX, layout.burnerY - layout.burnerH * 0.4);
      incense.height = Math.max(50, layout.steleH * 0.34);
      incense.spacing = Math.max(12, layout.burnerW * 0.28);
    }
  }

  // ---------- 幕切换 ----------
  function goto(i) {
    if (finished) return;
    if (i >= acts.length) { finish(); return; }
    // 预加载下一幕所需素材（异步、非阻塞，失败降级为代码绘制）
    PM.Assets.preloadForAct(i + 1);
    // 离开旧幕
    var old = acts[index];
    if (old && typeof old.leave === "function") old.leave.call(old, C);
    C.clearTimers();
    C.hideButton();
    C.hideCaption();
    system.clear();
    index = i;
    saveProgress();
    var act = acts[index];
    // 进入新幕
    if (act.enter) act.enter.call(act, C);
  }

  function saveProgress() {
    data.state = "CEREMONY";
    data.ceremonyStep = index + 1; // 1~7
    PM.Store.save(data);
  }

  // ---------- 主循环 ----------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    time += dt;
    if (dt > 0.1) dt = 0.016;

    ctx.clearRect(0, 0, W, H);
    if (!bgImage) PM.Scene.drawStars(ctx, W, H, time);

    var act = acts[index];
    if (act) {
      if (act.update) act.update.call(act, C, dt);
      if (act.draw) act.draw.call(act, C);
    }
    system.update(dt, time);
    system.draw(ctx);
  }

  // ---------- 完成建馆 ----------
  function finish() {
    if (finished) return;
    finished = true;
    stop();
    // 提交最终数据
    data.state = "BUILT";
    data.ceremonyStep = 7;
    data.stele.erectedAt = PM.Date.todayStr();
    var now = Date.now();
    data.incense.lastLightTime = now;
    data.incense.totalLightDays = 1;
    data.incense.continuousLightDays = 1;
    // “想对它说的话”写入第一条留言
    if (data._pendingWords) {
      data.messages.unshift({
        id: "m_" + now, text: data._pendingWords, createdAt: now
      });
      delete data._pendingWords;
    }
    PM.Store.save(data);
    PM.Store.clearDraft();
    if (onFinishCb) onFinishCb(data);
  }

  // ---------- 跳过 ----------
  function requestSkip() {
    if (finished) return;
    PM.UI.confirm("仪式可以稍后再看，现在直接为它立一座碑吗？", function (ok) {
      if (ok) finish();
    });
  }

  // ---------- 返回上一步 ----------
  // 幕内回退一幕并重放；第一幕返回信息填写页（由 onBack 回调路由）
  function back() {
    if (finished) return;
    if (index > 0) { goto(index - 1); return; }
    stop();
    if (onBackCb) onBackCb();
  }

  // ---------- 音频开关（无本地音频文件时仅切换图标） ----------
  function toggleAudio() {
    audioOn = !audioOn;
    audioEl.textContent = audioOn ? "🔊" : "🔇";
    audioEl.setAttribute("aria-pressed", audioOn ? "true" : "false");
    if (PM.Audio) PM.Audio.setAmbient(audioOn);
  }

  // ---------- 启动 ----------
  function start(opts) {
    data = opts.data;
    photoImg = opts.photoImg || null;
    onFinishCb = opts.onFinish || null;
    onBackCb = opts.onBack || null;

    view = el("view-ceremony");
    canvas = el("ceremony-canvas");
    ctx = canvas.getContext("2d");
    btnEl = el("ceremony-btn");
    captionEl = el("ceremony-caption");
    photoLayer = el("ceremony-photo-layer");
    vignetteEl = el("ceremony-vignette");
    skipEl = el("ceremony-skip");
    backEl = el("ceremony-back");
    audioEl = el("ceremony-audio");
    bgLayer = el("bg-layer");

    system = new PM.FX.System({ reducedMotion: data.settings && data.settings.reducedMotion });
    incense = PM.FX.createIncense({ system: system, height: 90, spacing: 22 });

    view.hidden = false;
    resize();

    // 事件
    btnEl.onclick = function () {
      var act = acts[index];
      if (act && act.onButton) act.onButton.call(act, C);
    };
    skipEl.onclick = requestSkip;
    backEl.onclick = back;
    audioEl.onclick = toggleAudio;
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    // 起始幕：从进度恢复（ceremonyStep 1~7 -> index 0~6）
    var step = data.ceremonyStep || 1;
    index = Math.max(0, Math.min(acts.length - 1, step - 1));
    finished = false;
    last = 0; time = 0;
    PM.Assets.preloadForAct(step);
    var act = acts[index];
    if (act.enter) act.enter.call(act, C);
    saveProgress();
    raf = requestAnimationFrame(frame);
  }

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      // 已播放的仪式幕从当前幕头部重放
      var act = acts[index];
      C.clearTimers();
      system.clear();
      if (act.enter) act.enter.call(act, C);
    }, 200);
  }
  function onKey(e) {
    if (e.key === "Escape") requestSkip();
    else if (e.key === "Enter" && !btnEl.hidden) btnEl.click();
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    C.clearTimers();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
  }

  return { start: start, stop: stop, requestSkip: requestSkip, back: back };
})();
