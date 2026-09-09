/* =========================================================
   fx/ash.js —— 灰烬飘落 / 青烟 / 贝塞尔扫入
   ========================================================= */
window.PM = window.PM || {};
PM.FX = PM.FX || {};

(function () {
  var rand = function (a, b) { return PM.FX.rand(a, b); };

  // 灰烬飘落发射器：灰白小颗粒，重力微弱，横向随风漂移，缓慢下落
  PM.FX.createAsh = function (cfg) {
    cfg = cfg || {};
    return {
      x: cfg.x || 0, y: cfg.y || 0, width: cfg.width || 120,
      rate: cfg.rate || 20, intensity: cfg.intensity == null ? 1 : cfg.intensity,
      enabled: true,
      update: function (dt, system) {
        if (!this.enabled || this.intensity <= 0) return;
        var self = this;
        system.emitBatch(this.rate * this.intensity, function () {
          return {
            type: "ash",
            x: self.x + rand(-self.width / 2, self.width / 2),
            y: self.y + rand(-6, 6),
            vx: rand(-0.3, 0.3), vy: rand(0.2, 0.8),
            ay: 0.02,                 // 微弱重力
            drag: 0.995,
            wind: 0.6, windPhase: rand(0, 6.28),
            life: 0, maxLife: rand(2, 4),
            size: rand(1, 2.6), sizeEnd: rand(0.6, 1.4),
            alpha: rand(0.5, 0.9),
            c0: "#d8d6d0", c1: "#8a8781", glow: false
          };
        });
      }
    };
  };

  // 青烟发射器：半透明白色小圆，上升 + 正弦横摆 + 半径渐大 + 透明度渐隐
  PM.FX.createSmoke = function (cfg) {
    cfg = cfg || {};
    return {
      x: cfg.x || 0, y: cfg.y || 0,
      rate: cfg.rate || 8, intensity: cfg.intensity == null ? 1 : cfg.intensity,
      enabled: true, rise: cfg.rise == null ? 1.1 : cfg.rise,
      tint: cfg.tint || "#cfd6e6",
      update: function (dt, system) {
        if (!this.enabled || this.intensity <= 0) return;
        var self = this;
        system.emitBatch(this.rate * this.intensity, function () {
          return {
            type: "smoke",
            x: self.x + rand(-2, 2), y: self.y + rand(-2, 2),
            vx: rand(-0.15, 0.15), vy: -self.rise * rand(0.7, 1.2),
            drag: 0.995, wind: 0.35, windPhase: rand(0, 6.28),
            life: 0, maxLife: rand(2, 4),
            size: rand(2, 4), sizeEnd: rand(8, 14),
            alpha: rand(0.16, 0.34) * self.intensity,
            c0: self.tint, c1: "#5a6076", glow: false
          };
        });
      }
    };
  };

  // 贝塞尔扫入：从 (sx,sy) 沿二次贝塞尔曲线飞向 (tx,ty)，到达即回收
  // control 为曲线控制点；duration 秒；每帧发射 count 个
  PM.FX.spawnSweep = function (system, opts) {
    var sx = opts.sx, sy = opts.sy, tx = opts.tx, ty = opts.ty;
    var cx = opts.cx != null ? opts.cx : (sx + tx) / 2;
    var cy = opts.cy != null ? opts.cy : Math.min(sy, ty) - 80;
    var dur = opts.duration || 0.9;
    var c0 = opts.c0 || "#e6e3dc", c1 = opts.c1 || "#9a968e";
    var size = opts.size || 2;

    function bez(a, b, c, t) {
      var mt = 1 - t;
      return mt * mt * a + 2 * mt * t * b + t * t * c;
    }
    system.emitBatch(opts.count || 6, function () {
      var jx = rand(-6, 6), jy = rand(-4, 4);
      var p = {
        type: "sweep",
        x: sx + jx, y: sy + jy,
        life: 0, maxLife: dur * rand(0.85, 1.15),
        size: size * rand(0.7, 1.3), sizeEnd: 0.5,
        alpha: rand(0.7, 1), c0: c0, c1: c1, glow: false,
        vx: 0, vy: 0, drag: 1, wind: 0
      };
      var startX = sx + jx, startY = sy + jy;
      p.custom = function (pt, step) {
        var t = pt.progress();
        pt.x = bez(startX, cx + jx * 0.4, tx, t);
        pt.y = bez(startY, cy, ty, t);
        pt.alpha = (1 - t) * 0.9;
      };
      return p;
    });
  };
})();
