/* =========================================================
   pages/memorial.js —— 纪念馆首页 + 上香系统
   场景渲染、每日香火逻辑、留言、照片墙、周年提醒、蜡烛彩蛋
   ========================================================= */
window.PM = window.PM || {};

PM.Memorial = (function () {
  var handlers = {};
  var canvas, ctx, system, incense, petals;
  var data = null, photoImg = null, layout = null;
  var zoomLayout = null, zoom = 0, zoomDir = 0;   // 点碑放大：0=坟冢前小碑 1=放大特写
  var raf = null, last = 0, time = 0, dpr = 1, W = 0, H = 0;
  var visible = false;
  var endOfDayTimer = null, pollTimer = null;
  var candle = { on: false, until: 0 };
  var bgLayer;

  function el(id) { return document.getElementById(id); }

  // ---------- 香火状态 ----------
  function isLit() {
    var t = data && data.incense && data.incense.lastLightTime;
    if (!t) return false;
    return PM.Date.isSameLocalDay(t, Date.now());
  }

  // 23:59:59~00:00:00 的 1 秒余韵内不响应上香
  function inLastSecond() {
    var now = Date.now();
    var d = PM.Date.startOfDay(now);
    var end = d.getTime() + PM.Date.DAY - 1000; // 23:59:59.000
    return now >= end && now < end + 1000;
  }

  function syncIncenseVisual() {
    if (!incense) return;
    if (isLit()) {
      if (!incense.lit) incense.light();
    } else {
      incense.extinguish();
    }
    updateLightBtn();
  }

  function updateLightBtn() {
    var btn = el("btn-light");
    var lit = isLit();
    btn.disabled = lit;
    btn.textContent = lit ? "香火燃烧中" : "🔥 上香";
    el("incense-stat").textContent =
      "已连续上香 " + (data.incense.continuousLightDays || 0) + " 天 · 累计 " + (data.incense.totalLightDays || 0) + " 天";
  }

  function onLight() {
    if (inLastSecond()) {
      PM.UI.toast("今日香火已尽，明日记得再来上香");
      return;
    }
    var now = Date.now();
    var alreadyToday = isLit();
    if (!alreadyToday) {
      var litYesterday = data.incense.lastLightTime &&
        PM.Date.isSameLocalDay(data.incense.lastLightTime, PM.Date.startOfYesterday(now).getTime() + 3600000);
      data.incense.continuousLightDays = litYesterday ? (data.incense.continuousLightDays || 0) + 1 : 1;
      data.incense.totalLightDays = (data.incense.totalLightDays || 0) + 1;
    }
    data.incense.lastLightTime = now;
    PM.Store.save(data);
    incense.light();
    updateLightBtn();
    scheduleEndOfDay();
    if (!alreadyToday) {
      PM.UI.toast("已为 " + data.pet.petName + " 点上今日香火 🕯 连续第 " + data.incense.continuousLightDays + " 天");
    }
  }

  // 每日 23:59:59 精确熄灭 + 30s 轮询兜底
  function scheduleEndOfDay() {
    clearTimeout(endOfDayTimer);
    var ms = PM.Date.msToEndOfDay(Date.now());
    if (ms > 0 && ms < PM.Date.DAY) {
      endOfDayTimer = setTimeout(function () {
        if (isLit()) {
          incense.extinguish();
          updateLightBtn();
          PM.UI.toast("今日香火已尽，明日记得再来上香。");
        }
        scheduleEndOfDay();
      }, ms + 200);
    }
  }
  function startPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { syncIncenseVisual(); }, 30000);
  }

  // ---------- 顶部信息 & 周年 ----------
  function updateHeader() {
    el("tb-petname").textContent = data.pet.petName || "它";
    var n = PM.Date.daysGone(data.pet.deathDate);
    el("tb-days").textContent = n === 0 ? "今天刚离开" : "已经离开 " + n + " 天";

    var banner = el("anniv-banner");
    var anni = PM.Date.deathAnniversaryYears(data.pet.deathDate);
    var bday = PM.Date.isBirthday(data.pet.birthday);
    if (anni > 0) {
      banner.hidden = false;
      banner.textContent = "今天是 " + data.pet.petName + " 离开 " + anni + " 周年纪念日，它一定也在想你。";
      enablePetals(true);
    } else if (bday) {
      banner.hidden = false;
      banner.textContent = "今天是 " + data.pet.petName + " 的生日，它一定也在想你。";
      enablePetals(true);
    } else {
      banner.hidden = true;
      enablePetals(false);
    }
  }
  function enablePetals(on) {
    if (on && !petals) petals = PM.FX.createPetals({ rate: 3 });
    if (petals) petals.enabled = on;
    if (petals) petals.width = W;
  }

  // ---------- 画布 ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 坟冢前小碑形态：与仪式幕同参数，同一座坟；冢底渐隐沉入草面
    layout = PM.Scene.computeLayout(W, H, true, 0.70);
    // 缩小态香炉整体再上移一点（贴近碑底/新土堆）：只改缩小态端点，放大特写态不受影响；
    // 不动共享 computeLayout，仪式幕7 炉位保持现状
    layout.burnerY -= Math.round(layout.steleW * 0.12);
    // 特写下香炉适度放大（1.3 倍）+炉底对齐碑底：与仪式幕7 同走共享规则 burnerLayout
    zoomLayout = PM.Scene.burnerLayout(PM.Scene.computeLayout(W, H, false, 0.70), 1.3, true);
    incense.setPosition(layout.burnerX, layout.burnerY - layout.burnerH * 0.22);
    incense.height = Math.max(46, layout.steleH * 0.32);
    incense.spacing = Math.max(8, Math.round(layout.burnerW * 0.12));
    if (petals) petals.width = W;
  }

  function drawAmbient() {
    // 缓慢飘落的微光粒子（萤火/星光）
    if (Math.random() < 0.25) {
      system.emit({
        type: "firefly",
        x: PM.FX.rand(0, W), y: PM.FX.rand(0, H * 0.7),
        vx: PM.FX.rand(-0.15, 0.15), vy: PM.FX.rand(0.05, 0.25),
        drag: 0.999, wind: 0.2, windPhase: PM.FX.rand(0, 6.28),
        life: 0, maxLife: PM.FX.rand(4, 8),
        size: PM.FX.rand(0.8, 1.8), sizeEnd: 0.3,
        alpha: PM.FX.rand(0.3, 0.7), c0: "#fff3c4", c1: "#cbb98a", glow: true
      });
    }
  }

  function drawCandle(L) {
    if (!candle.on) return;
    if (Date.now() > candle.until) { candle.on = false; return; }
    var y = L.groundY + 6;
    var h = L.steleH * 0.12, w = h * 0.28;
    // 墓碑左右对称各一支蜡烛（side=-1 左 / +1 右）
    [-1, 1].forEach(function (side) {
      var x = L.burnerX + side * L.burnerW * 0.9;
      ctx.save();
      ctx.fillStyle = "#e8dcc0";
      PM.Scene.roundRect(ctx, x - w / 2, y - h, w, h, w * 0.3);
      ctx.fill();
      // 火苗（两侧错相闪烁，更自然）
      var fl = 0.7 + 0.3 * Math.sin(time * 8 + (side > 0 ? 0 : 1.7));
      ctx.globalCompositeOperation = "lighter";
      var g = ctx.createRadialGradient(x, y - h - 4, 0, x, y - h - 4, 12 * fl);
      g.addColorStop(0, "rgba(255,220,140,0.9)");
      g.addColorStop(1, "rgba(255,120,30,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - h - 4, 12 * fl, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 烛火烟
      if (Math.random() < 0.2) {
        system.emit({
          type: "smoke", x: x, y: y - h - 6, vx: PM.FX.rand(-0.1, 0.1), vy: -PM.FX.rand(0.4, 0.7),
          drag: 0.996, wind: 0.2, windPhase: PM.FX.rand(0, 6.28), life: 0, maxLife: PM.FX.rand(1, 2),
          size: 1.5, sizeEnd: 6, alpha: 0.12, c0: "#ffe6b0", c1: "#6a6252", glow: false
        });
      }
    });
  }

  // 当前帧布局：小碑（坟冢前）与大碑（放大特写）按 zoom 缓动插值
  function curLayout() {
    if (zoom <= 0.001) return layout;
    if (zoom >= 0.999) return zoomLayout;
    var e = zoom < 0.5 ? 2 * zoom * zoom : 1 - Math.pow(-2 * zoom + 2, 2) / 2;
    var out = {};
    for (var k in layout) {
      out[k] = (typeof layout[k] === "number" && typeof zoomLayout[k] === "number")
        ? layout[k] + (zoomLayout[k] - layout[k]) * e : layout[k];
    }
    return out;
  }

  // 点击命中墓碑矩形（canvas fixed 铺满视口，client 坐标即画布坐标）
  function steleHit(x, y) {
    var L = curLayout();
    return x >= L.steleX && x <= L.steleX + L.steleW && y >= L.steleTop && y <= L.groundY;
  }
  function setZoom(dir) {
    zoomDir = dir;
    syncZoomBtn();
  }
  function syncZoomBtn() {
    var b = el("memorial-zoom-btn");
    if (!b) return;
    b.hidden = !(zoomDir === 0 && zoom >= 1);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? (now - last) / 1000 : 0.016;
    last = now; time += dt;
    if (dt > 0.1) dt = 0.016;

    // 放大/缩回动画
    if (zoomDir !== 0) {
      zoom = Math.max(0, Math.min(1, zoom + zoomDir * dt / 0.6));
      if (zoom <= 0 || zoom >= 1) zoomDir = 0;
      syncZoomBtn();
    }
    var L = curLayout();

    ctx.clearRect(0, 0, W, H);
    // 入土处新土堆永久保留：固定初始大小（与幕6/幕7 同尺寸），不随碑/炉缩放
    PM.Scene.drawDirtMound(ctx, zoomLayout, 0.6);
    PM.Scene.drawStele(ctx, L, data, photoImg, 0);
    // 香炉+插点走共享规则（与仪式幕7 同一段代码）：插点=炉口沙面中心、间距按沙面半径钳制、
    // 香长随形态微调（缩小态略收、放大态略增，香头不遮主碑文）
    PM.Scene.drawBurner(ctx, L);
    PM.Scene.alignIncense(incense, L, 0.25 - 0.14 * zoom);
    drawCandle(L);
    incense.update(dt, time);
    incense.draw(ctx, time);
    drawAmbient();
    if (petals && petals.enabled) petals.update(dt, system);
    system.update(dt, time);
    system.draw(ctx);
  }

  function startLoop() {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  // ---------- 主照片加载 ----------
  function loadMainPhoto() {
    photoImg = null;
    if (!data.mainPhotoId) return Promise.resolve();
    return PM.Store.getPhotoBlob(data.mainPhotoId).then(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      return PM.Image.loadImage(url).then(function (img) { photoImg = img; });
    }).catch(function () {});
  }

  // ---------- 留言 ----------
  function renderMessages() {
    if (!data) return;
    var list = el("msg-list");
    list.innerHTML = "";
    var msgs = (data.messages || []).slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (!msgs.length) {
      list.innerHTML = '<li class="empty-tip">还没有留言，写下第一句思念吧。</li>';
      return;
    }
    msgs.forEach(function (m) {
      var li = document.createElement("li");
      li.className = "msg-item";
      var p = document.createElement("p"); p.textContent = m.text;
      var t = document.createElement("time"); t.textContent = PM.Date.formatDateTimeCN(m.createdAt);
      var del = document.createElement("button");
      del.className = "msg-del"; del.textContent = "✕"; del.title = "删除";
      del.onclick = function () {
        PM.UI.confirm("确定要删去这句思念吗？", function (ok) {
          if (!ok) return;
          data.messages = data.messages.filter(function (x) { return x.id !== m.id; });
          PM.Store.save(data); renderMessages();
        });
      };
      li.appendChild(p); li.appendChild(t); li.appendChild(del);
      list.appendChild(li);
    });
  }
  function sendMessage() {
    var input = el("msg-input");
    var text = input.value.trim();
    if (!text) { PM.UI.toast("先写点什么吧"); return; }
    if (text.length > 500) { PM.UI.toast("想说的话控制在 500 字以内"); return; }
    data.messages.unshift({ id: "m_" + Date.now(), text: text, createdAt: Date.now() });
    PM.Store.save(data);
    input.value = "";
    renderMessages();
    PM.UI.toast("已收下你的思念");
  }

  // ---------- 照片墙 ----------
  var photoCache = {}; // id -> url
  function renderPhotos() {
    if (!data) return;
    var grid = el("photo-grid");
    grid.innerHTML = "";
    var meta = (data.photosMeta || []).slice().sort(function (a, b) {
      if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
    if (!meta.length) {
      grid.innerHTML = '<div class="empty-tip" style="grid-column:1/-1">还没有照片，添加一张吧。</div>';
      return;
    }
    meta.forEach(function (m) {
      var cell = document.createElement("div");
      cell.className = "photo-cell";
      var img = document.createElement("img");
      img.alt = "照片";
      cell.appendChild(img);
      if (m.isMain) {
        var b = document.createElement("span"); b.className = "badge-main"; b.textContent = "碑上";
        cell.appendChild(b);
      }
      ensureURL(m.id).then(function (url) { img.src = url; });
      // 点击预览
      cell.addEventListener("click", function () { openLightbox(meta, m.id); });
      // 长按/右键菜单
      attachCellMenu(cell, m, meta);
      grid.appendChild(cell);
    });
  }
  function ensureURL(id) {
    if (photoCache[id]) return Promise.resolve(photoCache[id]);
    return PM.Store.getPhotoBlob(id).then(function (blob) {
      if (!blob) return "";
      var url = URL.createObjectURL(blob);
      photoCache[id] = url;
      return url;
    });
  }
  function attachCellMenu(cell, m, meta) {
    var timer = null;
    function menu(e) {
      if (e) e.preventDefault();
      PM.UI.photoActions(m, meta, function (changed) {
        if (changed) { renderPhotos(); loadMainPhoto(); }
      });
    }
    cell.addEventListener("contextmenu", menu);
    cell.addEventListener("touchstart", function () {
      timer = setTimeout(function () { menu(); }, 500);
    }, { passive: true });
    cell.addEventListener("touchend", function () { clearTimeout(timer); });
    cell.addEventListener("touchmove", function () { clearTimeout(timer); });
  }

  function addPhotos(files) {
    if (!files || !files.length) return;
    var tasks = Array.prototype.slice.call(files).map(function (f) {
      var check = PM.Image.validate(f);
      if (!check.ok) { PM.UI.toast(check.msg); return Promise.resolve(null); }
      return PM.Image.compress(f).then(function (res) {
        return PM.Store.addPhoto(res.blob).then(function (r) {
          return { id: r.id, createdAt: r.createdAt, isMain: false };
        });
      }).catch(function () { return null; });
    });
    Promise.all(tasks).then(function (added) {
      var list = added.filter(Boolean);
      if (!list.length) return;
      data.photosMeta = (data.photosMeta || []).concat(list);
      // 若还没有主照片，第一张设为主照片
      if (!data.mainPhotoId && data.photosMeta.length) {
        setMainPhoto(data.photosMeta[0].id);
      }
      PM.Store.save(data);
      renderPhotos();
      loadMainPhoto();
      PM.UI.toast("已添加 " + list.length + " 张照片");
    });
  }
  function setMainPhoto(id) {
    data.mainPhotoId = id;
    (data.photosMeta || []).forEach(function (m) { m.isMain = (m.id === id); });
    PM.Store.save(data);
  }
  function deletePhoto(id) {
    return PM.Store.deletePhoto(id).then(function () {
      delete photoCache[id];
      data.photosMeta = (data.photosMeta || []).filter(function (m) { return m.id !== id; });
      if (data.mainPhotoId === id) {
        data.mainPhotoId = data.photosMeta.length ? data.photosMeta[0].id : "";
        if (data.mainPhotoId) setMainPhoto(data.mainPhotoId);
      }
      PM.Store.save(data);
    });
  }

  // ---------- 大图预览 ----------
  var lbList = [], lbIndex = 0;
  function openLightbox(meta, id) {
    lbList = meta; lbIndex = meta.findIndex(function (m) { return m.id === id; });
    el("lightbox").hidden = false;
    showLb();
  }
  function showLb() {
    if (lbIndex < 0 || lbIndex >= lbList.length) return;
    ensureURL(lbList[lbIndex].id).then(function (url) { el("lightbox-img").src = url; });
  }
  function closeLightbox() { el("lightbox").hidden = true; el("lightbox-img").src = ""; }

  // ---------- 生命周期 ----------
  function init(h) {
    handlers = h || {};
    canvas = el("memorial-canvas");
    ctx = canvas.getContext("2d");
    bgLayer = el("bg-layer");
    system = new PM.FX.System({});
    incense = PM.FX.createIncense({ system: system });

    el("btn-light").addEventListener("click", onLight);
    // 点击墓碑放大特写；放大后点任意处或“放回坟冢”按钮缩回
    canvas.addEventListener("click", function (e) {
      if (zoom >= 1) { setZoom(-1); return; }
      if (zoom <= 0 && steleHit(e.clientX, e.clientY)) setZoom(1);
    });
    canvas.addEventListener("mousemove", function (e) {
      canvas.style.cursor = (zoom >= 1 || (zoom <= 0 && steleHit(e.clientX, e.clientY))) ? "pointer" : "default";
    });
    el("memorial-zoom-btn").addEventListener("click", function () { setZoom(-1); });
    el("msg-send").addEventListener("click", sendMessage);
    el("photo-add").addEventListener("change", function (e) { addPhotos(e.target.files); e.target.value = ""; });

    // 底部功能栏
    document.querySelectorAll(".bb-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var action = b.getAttribute("data-action");
        if (action === "message") { renderMessages(); PM.UI.openDrawer("drawer-message"); }
        else if (action === "photos") { renderPhotos(); PM.UI.openDrawer("drawer-photos"); }
        else if (action === "candle") { toggleCandle(); }
      });
    });
    el("btn-bgm").addEventListener("click", toggleMusic);
    el("btn-settings").addEventListener("click", function () {
      PM.Settings.render(data, { onChanged: refreshAll });
      PM.UI.openDrawer("drawer-settings");
    });

    // lightbox 控件
    el("lb-close").addEventListener("click", closeLightbox);
    el("lb-prev").addEventListener("click", function () { lbIndex = (lbIndex - 1 + lbList.length) % lbList.length; showLb(); });
    el("lb-next").addEventListener("click", function () { lbIndex = (lbIndex + 1) % lbList.length; showLb(); });
    el("lightbox").addEventListener("click", function (e) { if (e.target === el("lightbox")) closeLightbox(); });

    window.addEventListener("resize", function () { if (visible) resize(); });
    window.addEventListener("orientationchange", function () { if (visible) setTimeout(resize, 200); });
    document.addEventListener("visibilitychange", function () {
      if (!visible) return;
      if (document.hidden) { stopLoop(); }
      else { syncIncenseVisual(); startLoop(); last = 0; }
    });
  }

  function toggleCandle() {
    if (candle.on) {
      candle.on = false;
      PM.UI.toast("蜡烛已熄灭");
    } else {
      candle.on = true;
      candle.until = Date.now() + 10 * 60 * 1000;
      PM.UI.toast("为它点亮一对蜡烛，将燃烧 10 分钟");
    }
  }
  // 顶栏小喇叭：背景音乐开关（进馆默认播放，手动关过才记忆关闭）
  function syncBgmBtn() {
    var b = el("btn-bgm");
    if (!b) return;
    var on = !!data.settings.bgmEnabled;
    b.textContent = on ? "🔊" : "🔇";
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function toggleMusic() {
    data.settings.bgmEnabled = !data.settings.bgmEnabled;
    data.settings.bgmTouched = true;
    PM.Store.save(data);
    if (PM.Audio) PM.Audio.setBgm(data.settings.bgmEnabled);
    if (PM.Audio) PM.Audio.setSfx(data.settings.bgmEnabled);   // 纪念馆音效随声音开关
    syncBgmBtn();
    PM.UI.toast(data.settings.bgmEnabled ? "已开启背景音乐" : "已关闭背景音乐");
  }

  function refreshAll() {
    updateHeader();
    syncIncenseVisual();
    loadMainPhoto();
  }

  function show(d) {
    data = d;
    visible = true;
    PM.Assets.preloadForAct(7); // 预加载香炉素材
    bgLayer.classList.add("has-image");
    el("view-memorial").hidden = false;
    resize();
    // 进馆默认放大特写：碑与炉居中展示；点“放回坟冢”或画面缩回小碑全景
    zoom = 1; zoomDir = 0;
    syncZoomBtn();
    updateHeader();
    loadMainPhoto().then(function () { syncIncenseVisual(); });
    syncIncenseVisual();
    scheduleEndOfDay();
    startPoll();
    startLoop();
    // 背景音乐：进馆即播（旧数据未手动关过的一律默认开启）
    if (data.settings.bgmTouched !== true) data.settings.bgmEnabled = true;
    syncBgmBtn();
    if (data.settings.bgmEnabled && PM.Audio) PM.Audio.setBgm(true);
    if (PM.Audio) PM.Audio.setSfx(!!data.settings.bgmEnabled);
    // 每日香火提示：今日未上香时 toast 提醒一次
    if (!isLit()) {
      setTimeout(function () {
        if (visible) PM.UI.toast("香火每天都可以重新点燃，今天也来为它上一炷香吧");
      }, 1200);
    }
  }

  function hide() {
    visible = false;
    stopLoop();
    if (PM.Audio) PM.Audio.setBgm(false);
    if (PM.Audio) PM.Audio.setSfx(false);
    if (PM.Audio) PM.Audio.stopLoops();
    clearTimeout(endOfDayTimer);
    clearInterval(pollTimer);
  }

  return {
    init: init, show: show, hide: hide, refresh: refreshAll,
    addPhotos: addPhotos, deletePhoto: deletePhoto, setMainPhoto: setMainPhoto
  };
})();
