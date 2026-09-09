/* =========================================================
   ceremony/scene.js —— 墓碑场景绘制（碑体 / 碑文 / 照片 / 香炉）
   幕 7 与纪念馆首页复用。Canvas 透明背景，星空草地由 #bg-layer 承载。
   碑文规则：正中“故 {宠物名} 之墓”；观者右侧竖排生卒；左侧竖排敬立+立碑日期。
   ========================================================= */
window.PM = window.PM || {};

PM.Scene = (function () {
  // 动态判定移动端：横竖屏切换 / 跨越断点缩放时布局比例随之更新
  function isMobileNow() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
  }

  // 计算布局：所有坐标基于画布 CSS 像素尺寸；compact=true 为坟冢前小碑形态；groundF 可覆写地平线比例
  function computeLayout(w, h, compact, groundF) {
    var isMobile = isMobileNow();
    // 地平线默认 0.70h：碑底与香炉之间留缝、香炉与底部按钮之间留空
    var groundY = Math.round(h * (groundF || 0.70));
    var hFactor = compact ? 0.28 : (isMobile ? 0.50 : 0.55);
    var steleH = Math.round(h * hFactor);
    var steleW = Math.round(Math.min(w * 0.52, steleH * 0.62, 340));
    // 小碑形态尺寸（坟冢宽度基准：比小碑略宽，整体很小）
    var csH = Math.round(h * 0.28);
    var csW = Math.round(Math.min(w * 0.52, csH * 0.62, 340));
    var cx = Math.round(w / 2);
    var steleX = cx - steleW / 2;
    var steleTop = groundY - steleH;
    return {
      w: w, h: h, cx: cx,
      groundY: groundY,
      steleX: steleX, steleTop: steleTop,
      steleW: steleW, steleH: steleH,
      // 香炉立于碑前草地上：炉顶与碑底留 ~10px 缝隙，炉足远离底部按钮
      burnerX: cx,
      burnerY: groundY + Math.round(steleW * 0.30 * 0.5) + 10,
      burnerW: Math.round(steleW * 0.5),
      burnerH: Math.round(steleW * 0.30)
    };
  }

  // 入土处新土堆：覆土时隆起、之后永久保留（墓穴叙事）；k 0~1 控制隆起高度，wf 宽系数（碑后场景加宽使两侧可见）
  function drawDirtMound(ctx, L, k, wf) {
    if (k <= 0.01) return;
    ctx.save();
    ctx.fillStyle = "#4a3a26";
    ctx.beginPath();
    var mw = L.steleW * (wf || 0.9);
    ctx.moveTo(L.cx - mw / 2, L.groundY + 4);
    ctx.quadraticCurveTo(L.cx, L.groundY - mw * 0.3 * k, L.cx + mw / 2, L.groundY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 竖排中文：从 (x,y) 起自上而下逐字绘制
  function drawVerticalText(ctx, text, x, y, size, color, gap) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = size + 'px ' + getComputedStyle(document.body).getPropertyValue('--font-stele');
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    var lh = size * (gap || 1.35);
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === "\n") { break; }
      ctx.fillText(ch, x, y + i * lh);
    }
    ctx.restore();
    return chars.length * lh;
  }

  // 碑体（AI 素材优先：宠物墓碑写实石面；不可用时代码绘制：弧形碑顶、石质渐变、金边）
  function drawSteleBody(ctx, L, riseOffset) {
    var x = L.steleX, top = L.steleTop + riseOffset, w = L.steleW, h = L.steleH;
    var r = w * 0.5; // 碑顶半圆
    var img = PM.Assets.get('stele');
    if (img) {
      ctx.save();
      // 素材按碑体盒拉伸铺满（素材自带金线内框与拱顶，不再叠代码描边避免拱形错位）
      ctx.drawImage(img, x, top, w, h);
      ctx.restore();
      return { x: x, top: top, w: w, h: h, r: r };
    }
    ctx.save();
    // 碑体路径：顶部半圆 + 矩形
    ctx.beginPath();
    ctx.moveTo(x, top + r);
    ctx.arc(x + w / 2, top + r, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, top + h);
    ctx.lineTo(x, top + h);
    ctx.closePath();

    var grad = ctx.createLinearGradient(x, top, x + w, top + h);
    grad.addColorStop(0, "#4a4f5c");
    grad.addColorStop(0.35, "#363b47");
    grad.addColorStop(0.7, "#2b2f3a");
    grad.addColorStop(1, "#20242e");
    ctx.fillStyle = grad;
    ctx.fill();

    // 石面高光
    ctx.save();
    ctx.clip();
    var hl = ctx.createLinearGradient(x, top, x + w * 0.6, top);
    hl.addColorStop(0, "rgba(255,255,255,0.10)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(x, top, w, h);
    ctx.restore();

    // 金色细边框
    ctx.lineWidth = Math.max(1.5, w * 0.012);
    ctx.strokeStyle = "rgba(216,181,106,0.55)";
    ctx.stroke();
    ctx.restore();

    return { x: x, top: top, w: w, h: h, r: r };
  }

  // 碑上照片（3:4，圆角 + 金边）
  function drawPhoto(ctx, box, photoImg) {
    var pw = box.w * 0.40;
    var ph = pw * (4 / 3);
    var px = box.x + box.w / 2 - pw / 2;
    var py = box.top + box.r * 0.75;
    ctx.save();
    // 金色外框
    var pad = Math.max(2, pw * 0.045);
    roundRect(ctx, px - pad, py - pad, pw + pad * 2, ph + pad * 2, 6);
    ctx.fillStyle = "rgba(216,181,106,0.75)";
    ctx.fill();
    // 照片
    roundRect(ctx, px, py, pw, ph, 4);
    ctx.save();
    ctx.clip();
    if (photoImg && photoImg.complete && photoImg.naturalWidth) {
      drawCover(ctx, photoImg, px, py, pw, ph);
    } else {
      ctx.fillStyle = "#1a1d26";
      ctx.fillRect(px, py, pw, ph);
    }
    ctx.restore();
    // 微微泛光
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createRadialGradient(px + pw / 2, py + ph / 2, pw * 0.1, px + pw / 2, py + ph / 2, pw * 0.8);
    g.addColorStop(0, "rgba(255,240,210,0.10)");
    g.addColorStop(1, "rgba(255,240,210,0)");
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
    return { px: px, py: py, pw: pw, ph: ph, bottom: py + ph };
  }

  // 主碑文 + 左右竖排：竖列先算（主碑文限宽依赖竖列占位），主碑文任何长度都不遮左右竖列
  function drawInscriptions(ctx, box, photoBox, data) {
    var petName = (data.pet && data.pet.petName) || "爱宠";
    var ownerName = (data.pet && data.pet.ownerName) || "";
    var gold = "#e7cf9a";
    var dim = "rgba(231,207,154,0.82)";

    // 竖排小字：先组装四列文案，再按碑体剩余高度反推字号，保证任何一列都不超出碑底
    var rightText = "生于" + PM.Date.formatDateCN(data.pet.birthday).replace(/日$/, "");
    var rightText2 = "卒于" + PM.Date.formatDateCN(data.pet.deathDate).replace(/日$/, "");
    var leftText = ownerName ? ownerName + " 敬立" : "敬立";
    var erectText = data.stele && data.stele.erectedAt
      ? PM.Date.formatDateCN(data.stele.erectedAt).replace(/日$/, "") + "立"
      : "";

    var vy = photoBox.bottom + box.h * 0.02;
    var cols = [rightText, rightText2, leftText];
    if (erectText) cols.push(erectText);
    var maxLen = 0;
    cols.forEach(function (t) { maxLen = Math.max(maxLen, Array.from(t).length); });
    var avail = box.top + box.h - vy - box.h * 0.03;
    // 小碑（纪念馆画布较矮）时字号跟随缩小，下限 4px 保证不超碑底
    var vSize = Math.min(box.w * 0.052, 15, avail / (maxLen * 1.3));
    vSize = Math.max(4, vSize);

    // 正中主碑文：故 X 之墓；限宽 = 碑面宽 - 左右竖列占位（各 2 列 + 字半宽 + 余量），永不遮竖列
    // 竖列内移：避开碑素材边缘花边/金线（约碑宽 7~12%）
    var edge = Math.max(vSize * 1.1, box.w * 0.12);
    var mainText = "故 " + petName + " 之墓";
    var innerW = Math.max(box.w * 0.30, box.w - 2 * (edge + vSize * 2.1));
    var mainSize = Math.min(box.w * 0.13, 34);
    var mainY = photoBox.bottom + (box.top + box.h - photoBox.bottom) * 0.26;
    ctx.save();
    ctx.fillStyle = gold;
    ctx.font = "600 " + mainSize + 'px ' + steleFont();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 4;
    // 名字过长时先缩字号（下限 10px）
    while (ctx.measureText(mainText).width > innerW && mainSize > 10) {
      mainSize -= 1;
      ctx.font = "600 " + mainSize + 'px ' + steleFont();
    }
    var lines = [mainText];
    if (ctx.measureText(mainText).width > innerW) {
      // 缩到下限仍超：拆两行居中，每行各自限宽内，保证不遮左右竖列
      var chars = Array.from(mainText);
      var half = Math.ceil(chars.length / 2);
      lines = [chars.slice(0, half).join(""), chars.slice(half).join("")];
      var widest = function () {
        return Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1]).width);
      };
      while (widest() > innerW && mainSize > 8) {
        mainSize -= 1;
        ctx.font = "600 " + mainSize + 'px ' + steleFont();
      }
    }
    var lineH = mainSize * 1.18;
    for (var li = 0; li < lines.length; li++) {
      var ly = mainY + (li - (lines.length - 1) / 2) * lineH;
      ctx.fillText(lines[li], box.x + box.w / 2, ly);
    }
    ctx.restore();

    // 观者右侧：生于…卒于…（内移避开碑边花边）
    var rx = box.x + box.w - edge;
    drawVerticalText(ctx, rightText, rx, vy, vSize, dim, 1.3);
    drawVerticalText(ctx, rightText2, rx - vSize * 1.6, vy, vSize, dim, 1.3);

    // 观者左侧：{主人} 敬立 + 立碑日期
    var lx = box.x + edge;
    drawVerticalText(ctx, leftText, lx, vy, vSize, dim, 1.3);
    if (erectText) drawVerticalText(ctx, erectText, lx + vSize * 1.6, vy, vSize, dim, 1.3);
  }

  // ===== 香炉+三炷香共享规则（纪念馆与仪式幕7 调用同一段代码，结构上杜绝两边不一致）=====
  // 素材沙面中心在图高 26.4% 处（对新香炉素材实测）→ 换算为盒中心偏移 0.236dh；
  // 插点/烟发射点锚在素材真实沙面，香头冒烟位置幕7 与纪念馆天然一致
  var SAND_F = 0.236;

  // 炉口插点纯计算（与 drawBurner 素材/降级两分支返回值完全一致）
  function burnerMouth(L) {
    var x = L.burnerX, y = L.burnerY, w = L.burnerW, h = L.burnerH;
    var img = PM.Assets.get('incense_burner');
    if (img) {
      var ir = (img.naturalWidth || w) / (img.naturalHeight || h);
      var dh = h, dw = dh * ir;
      if (dw > w) { dw = w; dh = dw / ir; }
      return { mouthX: x, mouthY: y - dh * SAND_F, mouthR: dw * 0.30 };
    }
    return { mouthX: x, mouthY: y - h * 0.4, mouthR: w * 0.40 };
  }

  // 香炉布局：规则取自纪念馆特写形态——炉放大 scale 倍；alignGround 时炉底（含三足）落在碑底线上。
  // burnerY 是素材盒中心，需上移半盒高才能底对齐。
  function burnerLayout(L, scale, alignGround) {
    var out = {};
    for (var k in L) out[k] = L[k];
    if (scale && scale !== 1) {
      out.burnerW = Math.round(L.burnerW * scale);
      out.burnerH = Math.round(L.burnerH * scale);
    }
    if (alignGround) {
      var img = PM.Assets.get('incense_burner');
      var ir = img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : 1.09;
      out.burnerY = L.groundY - Math.min(out.burnerH, out.burnerW / ir) / 2 + 2;
    }
    return out;
  }

  // 香插点对齐（必须在 incense.update 发射烟之前调用）：插点=炉口沙面中心、
  // 间距按沙面半径钳制（三炷香必插沙内不超炉缘）、香长=碑高×heightFactor。
  // 烟发射点由此永远锁定在香头火光处，任何一帧都不会用到旧坐标。
  function alignIncense(incense, L, heightFactor) {
    var mouth = burnerMouth(L);
    incense.setPosition(mouth.mouthX, mouth.mouthY);
    incense.spacing = Math.min(Math.max(8, Math.round(L.burnerW * 0.12)), Math.max(6, Math.floor(mouth.mouthR * 0.55)));
    incense.height = Math.max(30, L.steleH * (heightFactor || 0.11));
    return mouth;
  }

  // 画香炉；withIncense 时接着画三炷香（香插入沙面，插点即 alignIncense 锁定的点）
  function drawBurnerIncense(ctx, L, incense, timeSec, withIncense) {
    var mouth = drawBurner(ctx, L);
    if (withIncense && incense) {
      alignIncense(incense, L);
      incense.draw(ctx, timeSec);
    }
    return mouth;
  }

  // 香炉（碗形 + 三足），优先使用 AI 素材，不可用时代码绘制
  function drawBurner(ctx, L) {
    var x = L.burnerX, y = L.burnerY, w = L.burnerW, h = L.burnerH;
    // 尝试素材图片
    var img = PM.Assets.get('incense_burner');
    if (img) {
      ctx.save();
      // 按自然宽高比盒内 fit（中心锚定），避免拉伸变形
      var ir = (img.naturalWidth || w) / (img.naturalHeight || h);
      var dh = h, dw = dh * ir;
      if (dw > w) { dw = w; dh = dw / ir; }
      ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
      // 素材自带沙面：不再叠加代码沙盘，避免浮在素材沙面之上造成插点/冒烟错位
      var sandY = y - dh * SAND_F;
      ctx.restore();
      // 香插入点：沙面中心；mouthR = 沙面半径（外部据此约束香间距不超炉缘）
      return { mouthX: x, mouthY: sandY, mouthR: dw * 0.30 };
    }
    // 降级：代码绘制
    ctx.save();
    // 炉身
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h * 0.4);
    ctx.quadraticCurveTo(x - w * 0.42, y + h * 0.35, x - w * 0.18, y + h * 0.42);
    ctx.lineTo(x + w * 0.18, y + h * 0.42);
    ctx.quadraticCurveTo(x + w * 0.42, y + h * 0.35, x + w / 2, y - h * 0.4);
    ctx.closePath();
    var g = ctx.createLinearGradient(x - w / 2, y - h, x + w / 2, y + h);
    g.addColorStop(0, "#8a6a3a");
    g.addColorStop(0.5, "#5e4526");
    g.addColorStop(1, "#3a2b18");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(216,181,106,0.5)";
    ctx.lineWidth = Math.max(1, w * 0.02);
    ctx.stroke();
    // 炉口椭圆：铺香灰沙（香插在沙里）
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.4, w / 2, h * 0.14, 0, 0, Math.PI * 2);
    var sg2 = ctx.createLinearGradient(x, y - h * 0.54, x, y - h * 0.26);
    sg2.addColorStop(0, "#d9c69c");
    sg2.addColorStop(1, "#a38b62");
    ctx.fillStyle = sg2;
    ctx.fill();
    ctx.strokeStyle = "rgba(216,181,106,0.6)";
    ctx.stroke();
    // 三足
    ctx.fillStyle = "#3a2b18";
    [-0.3, 0.3].forEach(function (k) {
      ctx.fillRect(x + w * k - w * 0.03, y + h * 0.4, w * 0.06, h * 0.16);
    });
    ctx.fillRect(x - w * 0.03, y + h * 0.4, w * 0.06, h * 0.16);
    ctx.restore();
    // 香炉口中心（香的插入点）；mouthR = 沙面半径略收，保证香插在沙里不压炉缘
    return { mouthX: x, mouthY: y - h * 0.4, mouthR: w * 0.40 };
  }

  // 星空（当无背景图时的代码兜底）
  var _stars = null;
  function drawStars(ctx, w, h, timeSec) {
    if (!_stars || _stars.w !== w || _stars.h !== h) {
      _stars = { w: w, h: h, list: [] };
      var n = Math.round((w * h) / 9000);
      for (var i = 0; i < n; i++) {
        _stars.list.push({
          x: Math.random() * w, y: Math.random() * h * 0.6,
          r: Math.random() * 1.3 + 0.3, ph: Math.random() * 6.28
        });
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    _stars.list.forEach(function (s) {
      var a = 0.4 + 0.4 * Math.sin((timeSec || 0) * 1.5 + s.ph);
      ctx.fillStyle = "rgba(255,255,240," + a + ")";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // 完整墓碑场景（碑 + 照片 + 碑文 + 香炉），riseOffset 用于升起动画
  function drawStele(ctx, L, data, photoImg, riseOffset) {
    riseOffset = riseOffset || 0;
    var box = drawSteleBody(ctx, L, riseOffset);
    var photoBox = drawPhoto(ctx, box, photoImg);
    drawInscriptions(ctx, box, photoBox, data);
    return box;
  }

  // ---- 工具 ----
  function steleFont() {
    return getComputedStyle(document.body).getPropertyValue('--font-stele') || 'serif';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawCover(ctx, img, x, y, w, h) {
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var scale = Math.max(w / iw, h / ih);
    var dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  return {
    get isMobile() { return isMobileNow(); },
    computeLayout: computeLayout,
    drawStele: drawStele,
    drawSteleBody: drawSteleBody,
    drawDirtMound: drawDirtMound,
    burnerMouth: burnerMouth,
    burnerLayout: burnerLayout,
    alignIncense: alignIncense,
    drawBurnerIncense: drawBurnerIncense,
    drawBurner: drawBurner,
    drawStars: drawStars,
    drawVerticalText: drawVerticalText,
    roundRect: roundRect
  };
})();
