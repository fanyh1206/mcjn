/* =========================================================
   fx/soil.js —— 泥土倾落 / 浮尘 / 花瓣（周年提醒）
   ========================================================= */
window.PM = window.PM || {};
PM.FX = PM.FX || {};

(function () {
  var rand = function (a, b) { return PM.FX.rand(a, b); };

  // 泥土倾落：从坑两侧向坑中倾落，重力明显
  PM.FX.createSoil = function (cfg) {
    cfg = cfg || {};
    return {
      x: cfg.x || 0, y: cfg.y || 0, width: cfg.width || 200,
      rate: cfg.rate || 24, intensity: cfg.intensity == null ? 1 : cfg.intensity,
      enabled: true, targetY: cfg.targetY || (cfg.y || 0),
      update: function (dt, system) {
        if (!this.enabled || this.intensity <= 0) return;
        var self = this;
        system.emitBatch(this.rate * this.intensity, function () {
          var side = Math.random() < 0.5 ? -1 : 1;
          return {
            type: "soil",
            x: self.x + side * rand(self.width * 0.2, self.width * 0.5),
            y: self.y - rand(40, 120),
            vx: -side * rand(0.2, 0.8), vy: rand(0.6, 1.6),
            ay: 0.12, drag: 0.995, wind: 0,
            life: 0, maxLife: rand(0.8, 1.4),
            size: rand(1.6, 3.4), sizeEnd: rand(1, 2),
            alpha: rand(0.7, 1),
            c0: "#6b5540", c1: "#3d2f22", glow: false
          };
        });
      }
    };
  };

  // 浮尘：地面扬起一圈灰尘，向四周扩散并缓慢消散
  PM.FX.spawnDustRing = function (system, opts) {
    var x = opts.x, y = opts.y, count = opts.count || 40, speed = opts.speed || 2;
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2);
      var sp = rand(0.3, 1) * speed;
      system.emit({
        type: "dust",
        x: x + Math.cos(a) * rand(0, 20), y: y + Math.sin(a) * rand(0, 6),
        vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp * 0.5 - rand(0.1, 0.5),
        ay: 0.01, drag: 0.97, wind: 0.3, windPhase: rand(0, 6.28),
        life: 0, maxLife: rand(1, 2),
        size: rand(3, 7), sizeEnd: rand(10, 18),
        alpha: rand(0.15, 0.3), c0: "#8b7d68", c1: "#4a4638", glow: false
      });
    }
  };

  // 石屑弹起（墓碑升起时）
  PM.FX.spawnDebris = function (system, opts) {
    var x = opts.x, y = opts.y, count = opts.count || 24;
    for (var i = 0; i < count; i++) {
      system.emit({
        type: "debris",
        x: x + rand(-30, 30), y: y,
        vx: rand(-1.5, 1.5), vy: -rand(1.5, 4),
        ay: 0.18, drag: 0.99, wind: 0,
        life: 0, maxLife: rand(0.5, 1),
        size: rand(1, 2.4), sizeEnd: 0.6,
        alpha: rand(0.6, 1), c0: "#9aa0a8", c1: "#5b6169", glow: false
      });
    }
  };

  // 花瓣飘落（周年提醒），从顶部缓慢飘落
  PM.FX.createPetals = function (cfg) {
    cfg = cfg || {};
    return {
      width: cfg.width || window.innerWidth,
      rate: cfg.rate || 3, intensity: cfg.intensity == null ? 1 : cfg.intensity,
      enabled: true,
      update: function (dt, system) {
        if (!this.enabled || this.intensity <= 0) return;
        var self = this;
        system.emitBatch(this.rate * this.intensity, function () {
          return {
            type: "petal",
            x: rand(0, self.width), y: -10,
            vx: rand(-0.3, 0.3), vy: rand(0.4, 1),
            ay: 0.005, drag: 0.999, wind: 0.5, windPhase: rand(0, 6.28),
            life: 0, maxLife: rand(5, 9),
            size: rand(2.5, 4.5), sizeEnd: rand(2, 4),
            alpha: rand(0.5, 0.85),
            c0: PM.FX.pick(["#f6c9d8", "#f3b6c6", "#f8d9e3", "#e9a9c0"]),
            c1: "#c98ba6", glow: false,
            vrot: rand(-2, 2)
          };
        });
      }
    };
  };
})();
