/* =========================================================
   fx/fire.js —— 火焰发射器
   颜色在 #FFD700 / #FF8C00 / #FF4500 间过渡，向上初速 + 横向抖动，
   生命周期 0.5~1.2s，尺寸随生命衰减，叠加发光。
   ========================================================= */
window.PM = window.PM || {};
PM.FX = PM.FX || {};

PM.FX.createFire = function (cfg) {
  cfg = cfg || {};
  var rand = PM.FX.rand, pick = PM.FX.pick;
  var COLORS = ["#FFD700", "#FFA500", "#FF8C00", "#FF4500"];

  return {
    // x,y：火焰基部中心；width：基部宽度；rate：每帧生成量；intensity：0~1 火势
    x: cfg.x || 0,
    y: cfg.y || 0,
    width: cfg.width || 60,
    height: cfg.height || 120,
    rate: cfg.rate || 40,
    intensity: cfg.intensity == null ? 1 : cfg.intensity,
    enabled: true,

    update: function (dt, system) {
      if (!this.enabled || this.intensity <= 0) return;
      var self = this;
      var count = this.rate * this.intensity;
      system.emitBatch(count, function () {
        var spread = self.width / 2;
        var up = rand(1, 3) * (0.6 + self.intensity);
        return {
          type: "fire",
          x: self.x + rand(-spread, spread),
          y: self.y + rand(-4, 4),
          vx: rand(-0.4, 0.4),
          vy: -up,
          ay: -0.02,                 // 轻微上升加速（热气）
          drag: 0.985,
          wind: 0.3,
          windPhase: rand(0, 6.28),
          life: 0,
          maxLife: rand(0.5, 1.2),
          size: rand(3, 7) * (0.7 + self.intensity * 0.5),
          sizeEnd: 0.4,
          alpha: rand(0.7, 1),
          c0: pick(COLORS),
          c1: "#FF4500",
          glow: true
        };
      });
      // 少量上升火星
      if (Math.random() < 0.3 * this.intensity) {
        system.emit({
          type: "ember",
          x: self.x + rand(-self.width / 2, self.width / 2),
          y: self.y,
          vx: rand(-0.6, 0.6), vy: -rand(3, 5),
          ay: 0.01, drag: 0.99, wind: 0.5, windPhase: rand(0, 6.28),
          life: 0, maxLife: rand(1, 2),
          size: rand(1, 2), sizeEnd: 0, alpha: 1,
          c0: "#FFE9A8", c1: "#FF6A00", glow: true
        });
      }
    }
  };
};
