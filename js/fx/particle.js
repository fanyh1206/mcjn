/* =========================================================
   fx/particle.js —— 粒子基类 + 对象池 + 通用粒子系统
   同屏粒子上限：桌面 800 / 手机 400，超出回收复用；
   帧率兜底：连续 1s <24fps 时生成量减半。
   ========================================================= */
window.PM = window.PM || {};
PM.FX = PM.FX || {};

(function () {
  var isMobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  var MAX_PARTICLES = isMobile ? 400 : 800;

  // ---------- 单个粒子 ----------
  function Particle() { this.reset(); }
  Particle.prototype.reset = function () {
    this.active = false;
    this.type = "dust";
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.ax = 0; this.ay = 0;      // 加速度（重力等）
    this.drag = 0.99;              // 速度衰减
    this.life = 0; this.maxLife = 1;
    this.size = 2; this.sizeEnd = 0;
    this.alpha = 1;
    this.wind = 0;                 // 横向风噪声强度
    this.windPhase = 0;
    this.c0 = "#ffffff"; this.c1 = "#ffffff"; // 生命周期起止颜色
    this.glow = false;             // 是否叠加发光
    this.rot = 0; this.vrot = 0;
    return this;
  };
  // t: 0~1 生命进度
  Particle.prototype.progress = function () {
    return this.maxLife > 0 ? Math.min(1, this.life / this.maxLife) : 1;
  };

  // ---------- 对象池 + 系统 ----------
  function System(opts) {
    opts = opts || {};
    this.max = opts.max || MAX_PARTICLES;
    this.pool = [];
    this.active = [];
    this.spawnScale = 1;      // 帧率自适应系数
    this.reducedMotion = !!opts.reducedMotion;
    if (this.reducedMotion) this.spawnScale = 0.5;
    // fps 监测
    this._frames = 0; this._acc = 0; this._lowTime = 0;
    for (var i = 0; i < 64; i++) this.pool.push(new Particle());
  }

  System.prototype._obtain = function () {
    var p = this.pool.pop();
    if (!p) p = new Particle();
    p.reset();
    return p;
  };
  System.prototype._recycle = function (p) {
    p.active = false;
    if (this.pool.length < this.max) this.pool.push(p);
  };

  // 发射一个粒子；超过上限时回收最老的
  System.prototype.emit = function (cfg) {
    if (this.active.length >= this.max) {
      var oldest = this.active.shift();
      this._recycle(oldest);
    }
    var p = this._obtain();
    p.active = true;
    Object.assign(p, cfg);
    if (p.maxLife <= 0) p.maxLife = 1;
    this.active.push(p);
    return p;
  };

  // 按帧率自适应批量发射：count 会乘以 spawnScale
  System.prototype.emitBatch = function (count, cfgFn) {
    var n = Math.max(0, Math.round(count * this.spawnScale));
    for (var i = 0; i < n; i++) this.emit(cfgFn(i, n));
  };

  System.prototype.clear = function () {
    while (this.active.length) this._recycle(this.active.pop());
  };

  System.prototype.count = function () { return this.active.length; };

  // dt 秒
  System.prototype.update = function (dt, timeSec) {
    // fps 监测
    this._frames++; this._acc += dt;
    if (this._acc >= 1) {
      var fps = this._frames / this._acc;
      if (fps < 24) { this._lowTime += this._acc; } else { this._lowTime = 0; }
      if (this._lowTime >= 1 && this.spawnScale > 0.25) this.spawnScale = 0.5;
      else if (this._lowTime === 0 && !this.reducedMotion) this.spawnScale = 1;
      this._frames = 0; this._acc = 0;
    }

    var step = Math.min(dt, 0.05); // 防止大跳帧
    for (var i = this.active.length - 1; i >= 0; i--) {
      var p = this.active[i];
      p.life += step;
      if (p.life >= p.maxLife) {
        this.active.splice(i, 1);
        this._recycle(p);
        continue;
      }
      // 自定义运动（如贝塞尔飞向罐口）：设置 p.custom 则跳过默认物理
      if (typeof p.custom === "function") {
        p.custom(p, step, timeSec || 0);
        p.rot += p.vrot * step;
        continue;
      }
      // 横向风：正弦摆动
      if (p.wind) {
        p.vx += Math.sin((timeSec || 0) * 2 + p.windPhase) * p.wind * step;
      }
      p.vx += p.ax * step;
      p.vy += p.ay * step;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * step * 60;
      p.y += p.vy * step * 60;
      p.rot += p.vrot * step;
    }
  };

  // 颜色插值工具
  function lerpColor(a, b, t) {
    var ca = parseHex(a), cb = parseHex(b);
    var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    var g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }
  function parseHex(h) {
    if (h[0] !== "#") return [255, 255, 255];
    var s = h.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  System.prototype.draw = function (ctx) {
    // 分两遍：普通粒子 -> 发光粒子（lighter）
    var i, p, t;
    ctx.save();
    for (i = 0; i < this.active.length; i++) {
      p = this.active[i];
      if (p.glow) continue;
      drawParticle(ctx, p);
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < this.active.length; i++) {
      p = this.active[i];
      if (!p.glow) continue;
      drawParticle(ctx, p);
    }
    ctx.restore();
  };

  function drawParticle(ctx, p) {
    t = p.progress();
    var size = p.size + (p.sizeEnd - p.size) * t;
    if (size <= 0.1) return;
    var alpha = p.alpha * (1 - t);
    if (alpha <= 0.01) return;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = lerpColor(p.c0, p.c1, t);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  PM.FX.Particle = Particle;
  PM.FX.System = System;
  PM.FX.MAX_PARTICLES = MAX_PARTICLES;
  PM.FX.lerpColor = lerpColor;
  PM.FX.rand = function (a, b) { return a + Math.random() * (b - a); };
  PM.FX.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
})();
