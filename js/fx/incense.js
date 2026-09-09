/* =========================================================
   fx/incense.js —— 三炷香：燃点微光（呼吸闪烁）+ 独立烟丝 + 点燃/熄灭动画
   香体红色；熄灭态为灰白香头、无烟无光。
   ========================================================= */
window.PM = window.PM || {};
PM.FX = PM.FX || {};

PM.FX.createIncense = function (cfg) {
  cfg = cfg || {};
  var rand = PM.FX.rand;

  var incense = {
    // burnerX/burnerY：香炉口中心（香从这里向上插）
    x: cfg.x || 0,
    y: cfg.y || 0,
    spacing: cfg.spacing || 22,
    height: cfg.height || 90,
    lit: false,
    sticks: [],
    system: cfg.system || null,
    smokeEnabled: cfg.smoke !== false,   // 仪式幕关闭烟特效（只留燃点微光）
    _lightStart: 0,
    _smokeAcc: [0, 0, 0],

    init: function () {
      this.sticks = [];
      for (var i = 0; i < 3; i++) {
        this.sticks.push({
          dx: (i - 1) * this.spacing,
          lit: false,
          emberPhase: rand(0, 6.28),
          burn: 0 // 0~1 燃尽进度（视觉用）
        });
      }
    },

    setPosition: function (x, y) { this.x = x; this.y = y; },

    // 点燃：三炷香自顶端依次亮起（间隔 0.2s）
    light: function () {
      this.lit = true;
      this._lightStart = performance.now();
      this.sticks.forEach(function (s) { s.burn = 0; });
    },

    // 熄灭：全部转为燃尽态
    extinguish: function () {
      this.lit = false;
      this.sticks.forEach(function (s) { s.lit = false; s.burn = 1; });
    },

    isAnyLit: function () {
      return this.sticks.some(function (s) { return s.lit; });
    },

    update: function (dt, timeSec) {
      var self = this;
      // 依次点亮
      if (this.lit) {
        var elapsed = (performance.now() - this._lightStart) / 1000;
        this.sticks.forEach(function (s, i) {
          if (!s.lit && elapsed >= i * 0.2) s.lit = true;
        });
      }
      // 每炷香独立烟丝：发射点=香头燃点微光正中心（与 draw 的 glow 同点），
      // 轻微一缕：低密度、小粒、淡透明、短命快升，全程贴在香头上方，香体其他位置无任何烟
      if (!this.system || !this.smokeEnabled) return;
      // 保护：插点/香长未就绪（0/NaN）时不发射，杜绝炉底等异常位置冒烟
      if (!(this.height > 0) || !(this.y > 0) || !(this.x > 0)) return;
      this.sticks.forEach(function (s, i) {
        if (!s.lit) return;
        self._smokeAcc[i] += dt;
        var interval = 0.30;
        while (self._smokeAcc[i] >= interval) {
          self._smokeAcc[i] -= interval;
          var tipX = self.x + (i - 1) * self.spacing + rand(-1, 1);
          var tipY = self.y - self.height + rand(-1, 1);
          self.system.emit({
            type: "smoke",
            x: tipX, y: tipY,
            vx: rand(-0.03, 0.03), vy: -rand(0.6, 1.0),
            drag: 0.996, wind: 0.04, windPhase: rand(0, 6.28),
            life: 0, maxLife: rand(0.6, 0.9),
            size: rand(1.5, 2.2), sizeEnd: rand(3, 4),
            alpha: rand(0.16, 0.26), c0: "#e8ecf4", c1: "#9aa0b4", glow: false
          });
        }
      });
    },

    draw: function (ctx, timeSec) {
      var self = this;
      this.sticks.forEach(function (s, i) {
        // 间距动态读取 spacing：外部收窄/加宽后香位立即生效（保证不超炉缘）
        var baseX = self.x + (i - 1) * self.spacing;
        var baseY = self.y;
        var topY = baseY - self.height;
        // 香体
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2, self.height * 0.028);
        // 燃尽部分（灰白）与未燃部分（红）
        var burnLen = self.height * 0.18 * s.burn;
        // 红色主体
        ctx.strokeStyle = "#8e2b22";
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(baseX, topY + burnLen);
        ctx.stroke();
        // 灰白香头
        if (burnLen > 0.5) {
          ctx.strokeStyle = "#cfcbc2";
          ctx.beginPath();
          ctx.moveTo(baseX, topY + burnLen);
          ctx.lineTo(baseX, topY);
          ctx.stroke();
        }
        ctx.restore();

        // 燃点微光（呼吸闪烁）
        if (s.lit) {
          var glow = 0.7 + 0.3 * Math.sin((timeSec || 0) * 3 + s.emberPhase);
          var gx = baseX, gy = topY;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          var r = self.height * 0.12;
          var grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
          grad.addColorStop(0, "rgba(255,190,90," + (0.95 * glow) + ")");
          grad.addColorStop(0.4, "rgba(255,120,40," + (0.5 * glow) + ")");
          grad.addColorStop(1, "rgba(255,80,20,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(gx, gy, r, 0, Math.PI * 2);
          ctx.fill();
          // 燃点核心
          ctx.fillStyle = "rgba(255,240,200," + glow + ")";
          ctx.beginPath();
          ctx.arc(gx, gy, Math.max(1.2, r * 0.18), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  };

  incense.init();
  return incense;
};
