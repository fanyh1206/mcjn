/* =========================================================
   ceremony/acts.js —— 幕 1~7 各幕编排（时间轴 + 绘制）
   每幕：{ button, autoNext, enter(C), update(C,dt), draw(C), onButton(C) }
   C 为导演提供的共享上下文（ctx/system/layout/data/photo/DOM 辅助）。
   陶罐/棺材/灰堆/草地为代码绘制（5.7.7 降级图形，后续可替换 AI 素材）。
   ========================================================= */
window.PM = window.PM || {};

PM.Acts = (function () {
  var rand = function (a, b) { return PM.FX.rand(a, b); };

  // ---------- 通用绘制图形 ----------
  function getPhotoEl() { return document.querySelector(".cer-photo"); }
  function getPhotoRect() {
    var el = getPhotoEl();
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  // 灰堆（growth 0~1）
  function drawAshPile(ctx, x, y, w, growth) {
    if (growth <= 0) return;
    var h = w * 0.28 * growth;
    ctx.save();
    var g = ctx.createLinearGradient(x, y - h, x, y);
    g.addColorStop(0, "#cfcbc2");
    g.addColorStop(1, "#7d7a72");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 * growth, y);
    ctx.quadraticCurveTo(x, y - h, x + w / 2 * growth, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 陶罐（含宠物爪印），lidOffset 0=盖合 1=盖离
  function drawUrn(ctx, x, y, s, opts) {
    opts = opts || {};
    var w = 100 * s, h = 118 * s;
    // 优先使用 AI 素材（5.7.7 加载失败降级）
    var bodyImg = PM.Assets.get('urn_body');
    var lidImg = PM.Assets.get('urn_lid');
    if (bodyImg) {
      ctx.save();
      ctx.translate(x, y);
      // 按素材自然宽高比绘制（底边锚定），避免拉伸变形
      var br = (bodyImg.naturalWidth || w) / (bodyImg.naturalHeight || h);
      var dh = h, dw = dh * br;
      if (dw > w) { dw = w; dh = dw / br; }
      ctx.drawImage(bodyImg, -dw / 2, -dh, dw, dh);
      if (lidImg) {
        // 盖为 3/4 顶视图，竖向压扁模拟低视角盖顶透视
        var lw = dw * 0.78, lh = lw * 0.38;
        // 盖合时盖底缘深入罐口（覆盖口沿椭圆），避免盖与罐体之间出现缝隙
        var lift = (opts.lidOffset || 0) * 52 * s;
        var lidY = -dh - lh + dh * 0.22 - lift;
        ctx.drawImage(lidImg, -lw / 2, lidY, lw, lh);
      }
      ctx.restore();
      return;
    }
    // 降级：代码绘制
    ctx.save();
    ctx.translate(x, y);
    // 罐身
    var body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    body.addColorStop(0, "#6f6a60");
    body.addColorStop(0.35, "#b3aca0");
    body.addColorStop(0.6, "#8d877c");
    body.addColorStop(1, "#5c574e");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, -h);              // 罐口左
    ctx.quadraticCurveTo(-w * 0.5, -h * 0.62, -w * 0.42, -h * 0.18);
    ctx.quadraticCurveTo(-w * 0.36, 0, 0, 0);
    ctx.quadraticCurveTo(w * 0.36, 0, w * 0.42, -h * 0.18);
    ctx.quadraticCurveTo(w * 0.5, -h * 0.62, w * 0.22, -h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(40,36,30,0.5)";
    ctx.lineWidth = Math.max(1, s);
    ctx.stroke();
    // 金色爪印
    drawPaw(ctx, 0, -h * 0.45, 12 * s, "rgba(216,181,106,0.85)");
    // 罐口
    ctx.fillStyle = "#4a463e";
    ctx.beginPath();
    ctx.ellipse(0, -h, w * 0.22, w * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    // 罐盖
    var lidY = -h - 6 * s - (opts.lidOffset || 0) * 40 * s;
    ctx.save();
    ctx.translate(0, lidY);
    var lid = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
    lid.addColorStop(0, "#7d776c");
    lid.addColorStop(0.4, "#c3bcb0");
    lid.addColorStop(1, "#665f55");
    ctx.fillStyle = lid;
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.28, w * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -w * 0.06, w * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = "#b3aca0";
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // 爪印
  function drawPaw(ctx, x, y, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.25, r * 0.62, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    var toes = [[-0.7, -0.5], [-0.25, -0.8], [0.25, -0.8], [0.7, -0.5]];
    toes.forEach(function (t) {
      ctx.beginPath();
      ctx.ellipse(x + t[0] * r, y + t[1] * r, r * 0.22, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // 棺材（45° 俯侧），lidClose 0=敞开 1=合拢
  function drawCoffin(ctx, x, y, s, opts) {
    opts = opts || {};
    var w = 190 * s, h = 78 * s, lidClose = opts.lidClose == null ? 0 : opts.lidClose;
    // 优先使用 AI 素材
    var bodyImg = PM.Assets.get('coffin_body');
    var lidImg = PM.Assets.get('coffin_lid');
    if (bodyImg) {
      ctx.save();
      ctx.translate(x, y);
      // 侧视素材：底边锚定 + 自然宽高比，棺材水平放置
      var br = (bodyImg.naturalWidth || w) / (bodyImg.naturalHeight || h);
      var dw = w, dh = dw / br;
      ctx.drawImage(bodyImg, -dw / 2, -dh, dw, dh);
      if (lidImg && lidClose > 0) {
        ctx.globalAlpha = Math.min(1, lidClose * 1.4);
        var lr = (lidImg.naturalWidth || w) / (lidImg.naturalHeight || h);
        var lw = w * 1.02, lh = lw / lr;
        var off = (1 - lidClose) * w * 0.5;
        // 合拢时盖底缘下压棺体高度 28%（盖住侧视素材的口沿+白缎内衬），水平盖紧无缝隙；敞开时盖抬起并从右滑入
        var lidY = -dh - lh + dh * 0.28 - (1 - lidClose) * dh * 1.1;
        ctx.drawImage(lidImg, -lw / 2 + off, lidY, lw, lh);
      }
      ctx.restore();
      return { dw: dw, dh: dh };
    }
    // 降级：代码绘制
    ctx.save();
    ctx.translate(x, y);
    // 棺体（六角形俯视）
    var wood = ctx.createLinearGradient(0, -h, 0, h);
    wood.addColorStop(0, "#6b4a2c");
    wood.addColorStop(0.5, "#4e351e");
    wood.addColorStop(1, "#33220f");
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, -h * 0.2);
    ctx.lineTo(-w * 0.28, -h * 0.62);
    ctx.lineTo(w * 0.28, -h * 0.62);
    ctx.lineTo(w * 0.5, -h * 0.2);
    ctx.lineTo(w * 0.34, h * 0.5);
    ctx.lineTo(-w * 0.34, h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(20,12,6,0.6)";
    ctx.lineWidth = Math.max(1, s * 1.2);
    ctx.stroke();
    // 内部（敞开时可见暗色内衬）
    if (lidClose < 0.9) {
      ctx.save();
      ctx.globalAlpha = 1 - lidClose;
      ctx.fillStyle = "#241708";
      ctx.beginPath();
      ctx.moveTo(-w * 0.42, -h * 0.18);
      ctx.lineTo(-w * 0.24, -h * 0.5);
      ctx.lineTo(w * 0.24, -h * 0.5);
      ctx.lineTo(w * 0.42, -h * 0.18);
      ctx.lineTo(w * 0.28, h * 0.38);
      ctx.lineTo(-w * 0.28, h * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // 棺盖（滑下合拢：从侧上方滑入）
    if (lidClose > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, lidClose * 1.4);
      var off = (1 - lidClose) * w * 0.5;
      ctx.translate(off, -(1 - lidClose) * h * 1.2);
      var lid = ctx.createLinearGradient(0, -h, 0, h);
      lid.addColorStop(0, "#7d5733");
      lid.addColorStop(1, "#4a3218");
      ctx.fillStyle = lid;
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, -h * 0.2);
      ctx.lineTo(-w * 0.28, -h * 0.62);
      ctx.lineTo(w * 0.28, -h * 0.62);
      ctx.lineTo(w * 0.5, -h * 0.2);
      ctx.lineTo(w * 0.34, h * 0.5);
      ctx.lineTo(-w * 0.34, h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(20,12,6,0.5)";
      ctx.stroke();
      drawPaw(ctx, 0, -h * 0.05, 13 * s, "rgba(216,181,106,0.8)");
      ctx.restore();
    }
    ctx.restore();
  }

  // 平整草地（前景）
  function drawGrass(ctx, w, h, groundY) {
    ctx.save();
    var g = ctx.createLinearGradient(0, groundY - 20, 0, h);
    g.addColorStop(0, "rgba(24,44,28,0.0)");
    g.addColorStop(0.25, "rgba(22,42,26,0.85)");
    g.addColorStop(1, "rgba(10,22,14,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, groundY - 20, w, h - groundY + 20);
    // 草叶纹理
    ctx.strokeStyle = "rgba(60,110,66,0.35)";
    ctx.lineWidth = 1;
    for (var i = 0; i < w; i += 6) {
      var gh = rand(3, 9);
      ctx.beginPath();
      ctx.moveTo(i, groundY + rand(0, h - groundY));
      ctx.lineTo(i + rand(-2, 2), groundY + rand(0, 10) - gh);
      ctx.stroke();
    }
    ctx.restore();
  }

  // =========================================================
  // 幕 1：照片放大
  // =========================================================
  var act1 = {
    button: "点燃送别的火",
    autoNext: false,
    enter: function (C) {
      C.showPhoto(true);
      C.setBgImage(false);
      var el = getPhotoEl();
      if (el) { el.classList.remove("zoomed", "burning", "ashed"); }
      // 下一帧触发放大过渡
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var e = getPhotoEl();
          if (e) e.classList.add("zoomed");
        });
      });
      C.delay(1600, function () { C.showButton(act1.button); });
    },
    update: function () {},
    draw: function () {},
    onButton: function (C) { C.hideButton(); C.next(); }
  };

  // =========================================================
  // 幕 2：火焰升起（自动衔接幕 3）
  // =========================================================
  var act2 = {
    button: null,
    autoNext: true,
    enter: function (C) {
      C.setBgImage(false);
      var el = getPhotoEl();
      if (el) el.classList.add("burning");
      this._t = 0;
      C.setVignette(true);
      C.delay(3000, function () { C.next(); });
    },
    update: function (C, dt) {
      this._t += dt;
      var pr = getPhotoRect();
      if (!pr) return;
      var ramp = Math.min(1, this._t / 1.2);
      // 沿照片左右两侧自下而上蔓延：两个火焰发射器
      var intensity = ramp;
      if (!this._fireL) {
        this._fireL = PM.FX.createFire({ rate: 22, width: 20 });
        this._fireR = PM.FX.createFire({ rate: 22, width: 20 });
      }
      var climb = Math.min(pr.h * 0.9, this._t * pr.h * 0.4);
      this._fireL.x = pr.x + 6; this._fireL.y = pr.y + pr.h - climb * 0.2;
      this._fireR.x = pr.x + pr.w - 6; this._fireR.y = pr.y + pr.h - climb * 0.2;
      this._fireL.intensity = intensity; this._fireR.intensity = intensity;
      // 底部主火
      if (!this._fireB) this._fireB = PM.FX.createFire({ rate: 30, width: pr.w * 0.8 });
      this._fireB.x = pr.cx; this._fireB.y = pr.y + pr.h;
      this._fireB.width = pr.w * 0.8;
      this._fireB.intensity = ramp;
      this._fireL.update(dt, C.system);
      this._fireR.update(dt, C.system);
      this._fireB.update(dt, C.system);
    },
    draw: function () {},
    leave: function () { this._fireL = this._fireR = this._fireB = null; },
    onButton: function () {}
  };

  // =========================================================
  // 幕 3：照片化为灰烬
  // =========================================================
  var act3 = {
    button: "把骨灰收进小罐",
    autoNext: false,
    enter: function (C) {
      this._t = 0;
      this._pileGrowth = 0;
      var el = getPhotoEl();
      if (el) el.classList.add("ashed");
      C.delay(600, function () { C.setVignette(false); });
      C.delay(3000, function () {
        C.hidePhoto(false);
        C.showButton(act3.button);
      });
    },
    update: function (C, dt) {
      this._t += dt;
      var L = C.layout;
      // 火焰渐弱
      if (!this._fire) this._fire = PM.FX.createFire({ rate: 24, width: L.steleW * 0.6 });
      this._fire.x = L.cx; this._fire.y = L.groundY - 10;
      this._fire.intensity = Math.max(0, 1 - this._t / 1.5);
      this._fire.update(dt, C.system);
      // 灰烬飘落
      if (!this._ash) this._ash = PM.FX.createAsh({ rate: 26, width: L.steleW * 1.2 });
      this._ash.x = L.cx; this._ash.y = L.groundY - L.steleH * 0.5;
      this._ash.intensity = this._t < 2.2 ? 1 : Math.max(0, 1 - (this._t - 2.2));
      this._ash.update(dt, C.system);
      // 灰堆显影
      this._pileGrowth = Math.min(1, this._t / 2.4);
    },
    draw: function (C) {
      var L = C.layout;
      this._pileY = L.groundY - 4;
      this._pileW = L.steleW * 0.7;
      drawAshPile(C.ctx, L.cx, this._pileY, this._pileW, this._pileGrowth);
    },
    leave: function () { this._fire = this._ash = null; },
    onButton: function (C) { C.hideButton(); C.next(); }
  };

  // =========================================================
  // 幕 4：扫灰入罐
  // =========================================================
  var act4 = {
    button: "放入棺材",
    autoNext: false,
    enter: function (C) {
      this._t = 0;
      this._phase = "move"; // move -> sweep -> lid
      this._urnX = C.layout.cx + C.layout.w * 0.4;
      this._lid = 1;
      this._shake = 0;
      this._pile = 1;
    },
    update: function (C, dt) {
      this._t += dt;
      var L = C.layout;
      var targetX = L.cx + L.steleW * 0.42;
      if (this._phase === "move") {
        this._urnX += (targetX - this._urnX) * Math.min(1, dt * 2.2);
        if (Math.abs(this._urnX - targetX) < 3 && this._t > 0.8) { this._phase = "sweep"; this._t = 0; }
      } else if (this._phase === "sweep") {
        this._pile = Math.max(0, 1 - this._t / 1.3);
        if (this._pile > 0.02) {
          // 扫灰终点对准罐口（罐高约 99*scale）
          var us = Math.max(0.6, L.steleW / 260);
          PM.FX.spawnSweep(C.system, {
            sx: L.cx, sy: L.groundY - 6, tx: this._urnX, ty: L.groundY - 99 * us,
            cx: (L.cx + this._urnX) / 2, cy: L.groundY - 150 * us,
            count: 8, duration: 0.8
          });
        }
        if (this._t > 1.4) { this._phase = "lid"; this._t = 0; }
      } else if (this._phase === "lid") {
        this._lid = Math.max(0, 1 - this._t / 0.8);
        // 盖合后轻震
        if (this._t > 0.8 && this._t < 1.1) this._shake = Math.sin(this._t * 40) * 3 * (1 - (this._t - 0.8) / 0.3);
        else this._shake = 0;
        if (this._t > 1.4) { C.showButton(act4.button); this._phase = "done"; }
      }
    },
    draw: function (C) {
      var L = C.layout;
      var s = L.steleW / 260;
      drawAshPile(C.ctx, L.cx, L.groundY - 4, L.steleW * 0.7, this._pile);
      var scale = Math.max(0.6, s) * (1 + this._shake * 0.004);
      drawUrn(C.ctx, this._urnX + this._shake, L.groundY, scale, { lidOffset: this._lid });
    },
    onButton: function (C) { C.hideButton(); C.next(); }
  };

  // =========================================================
  // 幕 5：罐入棺材
  // =========================================================
  var act5 = {
    button: "安葬入土",
    autoNext: false,
    enter: function (C) {
      this._t = 0;
      this._phase = "descend"; // descend -> close
      this._urnY = C.layout.groundY - C.layout.steleH * 0.7;
      this._urnFrom = 0;
      this._urnScale = 0.62;
      this._lid = 0;
      C.setBgImage(false);
    },
    update: function (C, dt) {
      this._t += dt;
      var L = C.layout;
      var s = Math.max(0.7, L.steleW / 220);
      var bi = PM.Assets.get("coffin_body");
      var br = bi && bi.naturalWidth ? bi.naturalWidth / bi.naturalHeight : 190 / 78;
      var dh = 190 * s / br;
      var mouthY = (L.groundY - 10) - dh;   // 棺口线（侧视素材顶缘）
      var urnH = 108 * s * this._urnScale;   // 与 drawUrn 实际绘制高一致（100/素材比≈108）
      if (this._phase === "descend") {
        // 罐底沉入棺口 35%：插入姿态，露出大半
        var targetY = mouthY + urnH * 0.35;
        this._urnY += (targetY - this._urnY) * Math.min(1, dt * 1.6);
        if (Math.abs(this._urnY - targetY) < 3 && this._t > 1.2) {
          this._phase = "close"; this._t = 0;
          this._urnFrom = this._urnY;
          PM.FX.spawnDustRing(C.system, { x: L.cx, y: mouthY, count: 16, speed: 1 });
        }
      } else if (this._phase === "close") {
        // 罐边缩边沉至完全没入棺口（被棺前壁遮挡=放进棺内，非淡出）；
        // 缩到 0.44 后罐高小于棺体遮罩区（口线~底拱之间），不会从棺底拱隙露出
        var k = Math.min(1, this._t / 0.9);
        this._urnScale = 0.62 - 0.18 * k;
        var urnHk = 108 * s * this._urnScale;
        this._urnY = this._urnFrom + (mouthY + urnHk * 1.02 - this._urnFrom) * k;
        this._lid = Math.max(0, Math.min(1, (this._t - 0.5) / 0.8));
        if (this._t > 1.6) { C.showButton(act5.button); this._phase = "done"; }
      }
    },
    draw: function (C) {
      var L = C.layout;
      var s = Math.max(0.7, L.steleW / 220);
      // 罐先画、棺后画：罐低于棺口线的部分被棺前壁遮罩 = 视角上沉入棺口
      drawUrn(C.ctx, L.cx, this._urnY, s * this._urnScale, { lidOffset: 0 });
      drawCoffin(C.ctx, L.cx, L.groundY - 10, s, { lidClose: this._lid });
    },
    onButton: function (C) { C.hideButton(); C.next(); }
  };

  // =========================================================
  // 幕 6：覆土下葬（平整草地）
  // =========================================================
  var act6 = {
    button: "立碑纪念",
    autoNext: false,
    enter: function (C) {
      this._t = 0;
      this._phase = "lower"; // lower -> cover -> settle -> done
      this._coffinY = C.layout.groundY - 90;
      this._cover = 0;
      C.setBgImage(true);
    },
    update: function (C, dt) {
      this._t += dt;
      var L = C.layout;
      if (this._phase === "lower") {
        this._coffinY += ((L.groundY + 6) - this._coffinY) * Math.min(1, dt * 1.8);
        if (Math.abs(this._coffinY - (L.groundY + 6)) < 3 && this._t > 1.0) { this._phase = "cover"; this._t = 0; }
      } else if (this._phase === "cover") {
        this._cover = Math.min(1, this._t / 2.0);
        if (!this._soil) this._soil = PM.FX.createSoil({ rate: 26, width: L.steleW * 1.6 });
        this._soil.x = L.cx; this._soil.y = L.groundY;
        this._soil.intensity = this._cover < 1 ? 1 : 0;
        this._soil.update(dt, C.system);
        if (this._t > 2.1) {
          this._phase = "settle"; this._t = 0;
          PM.FX.spawnDustRing(C.system, { x: L.cx, y: L.groundY, count: 24, speed: 1.4 });
        }
      } else if (this._phase === "settle") {
        // 覆土抚平后直接进下一步（坟冢暂不出现）
        if (this._t > 0.8) { C.showButton(act6.button); this._phase = "done"; }
      }
    },
    draw: function (C) {
      var L = C.layout;
      var s = Math.max(0.7, L.steleW / 220);
      // 覆盖前可见棺材，覆盖后被土掩埋
      if (this._cover < 1) {
        C.ctx.save();
        C.ctx.globalAlpha = 1 - this._cover * 0.9;
        drawCoffin(C.ctx, L.cx, this._coffinY, s, { lidClose: 1 });
        C.ctx.restore();
      }
      // 覆土开始才隆起、之后永久保留：下棺阶段（lower）不显示土堆
      var mound = this._phase === "lower" ? 0 : this._phase === "cover" ? this._cover * 0.6 : 0.6;
      PM.Scene.drawDirtMound(C.ctx, L, mound);
    },
    leave: function () { this._soil = null; },
    onButton: function (C) { C.hideButton(); C.next(); }
  };

  // =========================================================
  // 幕 7：墓碑升起（终幕）——大碑居中展示，焚香祭拜后进纪念馆
  // =========================================================
  var act7 = {
    button: "进入纪念馆",
    offerButton: "焚香祭拜",
    autoNext: false,
    enter: function (C) {
      this._t = 0;
      this._rise = C.layout.steleH; // 从地下升起
      this._shake = 0;
      this._lit = false;
      this._burner = 0;       // 香炉出现进度 0~1（焚香祭拜点击后升起）
      this._offering = false;
      this._offerBtnShown = false;
      this._capT = undefined;
      C.setBgImage(true);
      // 插点/间距/香长不再在此预设：炉到位后由共享规则 PM.Scene.alignIncense 统一对齐（与纪念馆同一段代码）
    },
    update: function (C, dt) {
      this._t += dt;
      var L = C.layout;
      // 震动
      if (this._t < 0.8) this._shake = Math.sin(this._t * 50) * 2 * (1 - this._t / 0.8);
      else this._shake = 0;
      if (this._t < 0.3 && !this._debris) {
        this._debris = true;
        PM.FX.spawnDebris(C.system, { x: L.cx, y: L.groundY, count: 26 });
      }
      // 升起
      this._rise = Math.max(0, L.steleH * (1 - Math.min(1, (this._t - 0.3) / 2.4)));
      // 碑立稳后出现“焚香祭拜”按钮
      if (!this._offerBtnShown && this._rise <= 1 && !this._offering) {
        this._offerBtnShown = true;
        C.showButton(act7.offerButton);
      }
      // 焚香祭拜：香炉从草地升起，到位后三炷香自香头依次点燃冒烟
      if (this._offering && this._burner < 1) {
        this._burner = Math.min(1, this._burner + dt / 0.8);
        if (this._burner >= 1 && !this._lit) {
          this._lit = true;
          C.system.clear();   // 点香前清场：杜绝任何残留粒子被误认为烟
          C.incense.light();
          C.markIncenseLit();
        }
      }
      // 香炉到位后持续更新香与烟：先用纪念馆同款共享规则对齐插点/间距/香长
      //（炉 1.3 倍+炉底对齐碑底，香长系数 0.11=纪念馆特写态），再 update——
      // 烟发射点永远在香头火光处，与纪念馆结构上同一段代码
      if (this._burner >= 1) {
        var LBu = PM.Scene.burnerLayout(L, 1.3, true);
        PM.Scene.alignIncense(C.incense, LBu, 0.11);
        C.incense.update(dt, this._t);
      }
      // 文案：点香后延迟出现
      if (this._lit && !this._caption && this._capT === undefined) this._capT = 0;
      if (this._capT !== undefined && !this._caption) {
        this._capT += dt;
        if (this._capT > 1.6) {
          this._caption = true;
          C.showCaption("它没有离开，只是换了一个地方，\n住在你的思念里。");
          C.delay(5200, function () {
            C.hideCaption();
            C.showButton(act7.button);
          });
        }
      }
    },
    draw: function (C) {
      var L = C.layout;
      C.ctx.save();
      C.ctx.translate(this._shake, 0);
      // 土堆在碑后且与幕6 同尺寸（不放大）：碑升起过程盖住土堆，立稳后碑在土堆前面
      PM.Scene.drawDirtMound(C.ctx, L, 0.6);
      PM.Scene.drawStele(C.ctx, L, C.data, C.photoImg, this._rise);
      // 焚香祭拜后香炉才出现：从草地沉升 + 淡入；炉布局/插点/香长全部走纪念馆同款共享规则
      if (this._burner > 0) {
        var LB = PM.Scene.burnerLayout(L, 1.3, true);
        C.ctx.save();
        C.ctx.globalAlpha = this._burner;
        C.ctx.translate(0, (1 - this._burner) * 30);
        PM.Scene.drawBurnerIncense(C.ctx, LB, C.incense, this._t, this._burner >= 1);
        C.ctx.restore();
      }
      C.ctx.restore();
    },
    leave: function () { this._debris = false; this._caption = false; this._capT = undefined; },
    onButton: function (C) {
      // 两段：焚香祭拜（炉出+点香）→ 建馆进纪念馆
      if (!this._offering) {
        C.hideButton();
        this._offering = true;
        return;
      }
      C.hideButton(); C.finish();
    }
  };

  var list = [act1, act2, act3, act4, act5, act6, act7];

  return {
    list: list,
    // 复用绘制图形（供降级/首页蜡烛等）
    draw: {
      drawUrn: drawUrn, drawCoffin: drawCoffin, drawAshPile: drawAshPile,
      drawGrass: drawGrass, drawPaw: drawPaw, getPhotoRect: getPhotoRect
    }
  };
})();
