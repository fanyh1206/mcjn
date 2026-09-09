/* =========================================================
   cutout.mjs —— 零依赖 PNG 抠图管线（5.7 素材透明化，品红 chroma key）
   流程：PNG 解码(node:zlib) → 品红软键控(色距→alpha) → 反预乘去品红边
         → 自动裁切 → 双线性降采样 → PNG 编码 → 深色底预览图供目检
   背景为纯品红 #FF00FF 时键控最稳：物体色（灰/木/铜/橄榄）与品红色距大。
   运行：node tools/cutout.mjs   任务表：tools/cutout-jobs.json
   ========================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { join } from 'node:path';

const SRC = 'D:\\Users\\fanya\\.qoder-cn\\vibe_images';
const OUT = join(process.cwd(), 'assets', 'img');
const PREVIEW = join(process.cwd(), 'tools', 'preview');
mkdirSync(OUT, { recursive: true });
mkdirSync(PREVIEW, { recursive: true });

/* ---------------- PNG 解码 ---------------- */
function decodePNG(buf) {
  let pos = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('不支持的 PNG 压缩/滤波/交错格式');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('仅支持 8bit PNG, got ' + bitDepth);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('不支持的 colorType ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[rp + x];
      const a = x >= ch ? out[row + x - ch] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = (x >= ch && y > 0) ? out[prev + x - ch] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      out[row + x] = v & 0xff;
    }
    rp += stride;
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    if (ch === 4) { rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1]; rgba[i * 4 + 2] = out[i * 4 + 2]; rgba[i * 4 + 3] = out[i * 4 + 3]; }
    else if (ch === 3) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i]; rgba[i * 4 + 3] = 255; }
  }
  return { w, h, rgba };
}

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 背景色自动采样（四角+四边中点小窗均值） ---------------- */
function sampleBG(w, h, rgba) {
  const pts = [
    [2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3],
    [w >> 1, 2], [w >> 1, h - 3], [2, h >> 1], [w - 3, h >> 1],
  ];
  const R = 6; // 采样半径
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (const [cx, cy] of pts) {
    for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++)
      for (let x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
        const p = (y * w + x) * 4;
        sr += rgba[p]; sg += rgba[p + 1]; sb += rgba[p + 2]; n++;
      }
  }
  return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
}

/* ---------------- 抠图核心：YCbCr 色度平面软键控 + 反预乘 ----------------
   背景（品红/玫红族）在色度平面聚簇于 Cr≈+70, Cb≈+15；
   物体色（中性灰/木棕/铜金/绿缎）Cr,Cb 远离该簇，
   用归一化色度距 dn 做软键控，避免 L1 距离把中性灰误判为背景。 */
function cutout(img, opt) {
  const { w, h, rgba } = img;
  const B = opt.bg || sampleBG(w, h, rgba);
  const bY = 0.299 * B[0] + 0.587 * B[1] + 0.114 * B[2];
  const bCr = B[0] - bY, bCb = B[2] - bY;
  const rCr = opt.rCr ?? 25, rCb = opt.rCb ?? 12; // 背景簇半径（色度单位）
  const d0 = opt.d0 ?? 1.6, d1 = opt.d1 ?? 2.6;   // dn 软过渡带
  const protect = opt.protect || [];              // 保护矩形（分数坐标）：矩形内强制前景（同色度主体如粉花）
  // 去品红后的底色（反预乘用）：despill 与像素同规则
  const BD = (() => {
    let cr = bCr, cb = bCb;
    if (cr > 0 && cb > 0) { const s = Math.min(cr, cb); cr -= s; cb -= s; }
    return [bY + cr, bY - 0.509 * cr - 0.194 * cb, bY + cb];
  })();
  let opaque = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const x = i % w, y = (i / w) | 0;
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const Cr = r - Y, Cb = b - Y;
    // 暗像素（底色上的接触阴影）色度散布更大 → 放宽簇半径（亮度门控）
    const wide = Y < bY * 0.75;
    const dn = Math.hypot((Cr - bCr) / (wide ? rCr * 1.3 : rCr), (Cb - bCb) / (wide ? rCb * 1.35 : rCb));
    let a = (dn - d0) / (d1 - d0);
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    // 背景簇内部（含压暗阴影/水印混色）：直接全透
    if (dn < d0 * 0.75) a = 0;
    // 保护区内强制前景：花床等与背景同色度的主体区域
    for (let k = 0; k < protect.length; k++) {
      const pr = protect[k];
      if (x >= pr[0] * w && x < pr[2] * w && y >= pr[1] * h && y < pr[3] * h) { a = 1; break; }
    }
    if (a > 0) {
      // despill：品红象限色度收缩（min 分量全扣），去除物体表面/边缘的品红反射；
      // 合法暖色（木棕/鲑粉）Cb<0 不受影响
      let cr = Cr, cb = Cb;
      if (cr > 0 && cb > 0) { const s = Math.min(cr, cb); cr -= s; cb -= s; }
      let R = Y + cr, G = Y - 0.509 * cr - 0.194 * cb, Bl = Y + cb;
      // 反预乘去品红边：C = a*O + (1-a)*BD  =>  O = (C - (1-a)*BD) / a
      if (a < 0.995) {
        R = (R - (1 - a) * BD[0]) / a;
        G = (G - (1 - a) * BD[1]) / a;
        Bl = (Bl - (1 - a) * BD[2]) / a;
      }
      rgba[p] = Math.max(0, Math.min(255, Math.round(R)));
      rgba[p + 1] = Math.max(0, Math.min(255, Math.round(G)));
      rgba[p + 2] = Math.max(0, Math.min(255, Math.round(Bl)));
    }
    rgba[p + 3] = Math.round(a * 255);
    if (a > 0.5) opaque++;
  }
  // 水印区抹除（右下角矩形，分数坐标）；wipe 单矩形 / wipes 多矩形任选
  const wipes = opt.wipes || [opt.wipe || [0.55, 0.9, 1, 1]];
  for (const wp of wipes)
    for (let y = Math.floor(wp[1] * h); y < Math.min(h, Math.ceil(wp[3] * h)); y++)
      for (let x = Math.floor(wp[0] * w); x < Math.min(w, Math.ceil(wp[2] * w)); x++)
        rgba[(y * w + x) * 4 + 3] = 0;
  if (opaque < w * h * 0.01) throw new Error('抠图结果为空（键控阈值不当？）');
  console.log(`   键控底色 rgb(${B.join(',')}) 色度中心 Cr=${bCr.toFixed(0)} Cb=${bCb.toFixed(0)} 不透明占比 ${(opaque / (w * h) * 100).toFixed(1)}%`);
  // 自动裁切到不透明 bbox
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
  const cropped = new Uint8Array(cw * chh * 4);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const si = ((y + y0) * w + (x + x0)) * 4, di = (y * cw + x) * 4;
    cropped[di] = rgba[si]; cropped[di + 1] = rgba[si + 1];
    cropped[di + 2] = rgba[si + 2]; cropped[di + 3] = rgba[si + 3];
  }
  return { w: cw, h: chh, rgba: cropped, opaqueRatio: opaque / (w * h) };
}

/* ---------------- 双线性降采样 ---------------- */
function resize(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.w, img.h));
  if (scale >= 1) return img;
  const nw = Math.round(img.w * scale), nh = Math.round(img.h * scale);
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(img.h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < nw; x++) {
      const sx = (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(img.w - 1, x0 + 1), fx = sx - x0;
      const di = (y * nw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = img.rgba[(y0 * img.w + x0) * 4 + c], v10 = img.rgba[(y0 * img.w + x1) * 4 + c];
        const v01 = img.rgba[(y1 * img.w + x0) * 4 + c], v11 = img.rgba[(y1 * img.w + x1) * 4 + c];
        const v0 = v00 + (v10 - v00) * fx, v1 = v01 + (v11 - v01) * fx;
        out[di + c] = Math.round(v0 + (v1 - v0) * fy);
      }
    }
  }
  return { w: nw, h: nh, rgba: out };
}

/* ---------------- alpha 1px 腐蚀（3x3 min，去亮边光环） ---------------- */
function erodeAlpha(img) {
  const { w, h, rgba } = img;
  const src = Uint8Array.from(rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
      const v = src[(yy * w + xx) * 4 + 3];
      if (v < m) m = v;
    }
    rgba[(y * w + x) * 4 + 3] = m;
  }
  return img;
}

/* ---------------- 深色底预览 ---------------- */
function previewOnDark(img, bg) {
  const out = new Uint8Array(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.rgba[i * 4 + 3] / 255;
    out[i * 4] = Math.round(img.rgba[i * 4] * a + bg[0] * (1 - a));
    out[i * 4 + 1] = Math.round(img.rgba[i * 4 + 1] * a + bg[1] * (1 - a));
    out[i * 4 + 2] = Math.round(img.rgba[i * 4 + 2] * a + bg[2] * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return { w: img.w, h: img.h, rgba: out };
}

/* ---------------- 底部 alpha 线性渐隐（接地边融合用） ---------------- */
function fadeBottomAlpha(img, f) {
  if (!f) return img;
  const { w, h, rgba } = img;
  const y0 = Math.floor(h * (1 - f));
  for (let y = y0; y < h; y++) {
    const k = 1 - (y - y0) / (h - y0);
    for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = Math.round(rgba[(y * w + x) * 4 + 3] * k);
  }
  return img;
}

/* ---------------- 任务表 ---------------- */
const JOBS = JSON.parse(readFileSync(join(process.cwd(), 'tools', 'cutout-jobs.json'), 'utf8'));

for (const job of JOBS) {
  const src = join(SRC, job.src);
  const img = decodePNG(readFileSync(src));
  const cut = cutout(img, job);
  const small = fadeBottomAlpha(erodeAlpha(resize(cut, job.max || 640)), job.fadeBottom);
  writeFileSync(join(OUT, job.out + '.png'), encodePNG(small.w, small.h, small.rgba));
  const pv = previewOnDark(small, [11, 14, 26]);
  writeFileSync(join(PREVIEW, job.out + '_on_dark.png'), encodePNG(pv.w, pv.h, pv.rgba));
  const kb = (readFileSync(join(OUT, job.out + '.png')).length / 1024).toFixed(0);
  console.log(`✅ ${job.out}: ${img.w}x${img.h} → 裁切 ${cut.w}x${cut.h}(不透明占比 ${(cut.opaqueRatio * 100).toFixed(0)}%) → 输出 ${small.w}x${small.h} (${kb}KB)`);
}
console.log('全部完成。预览图见 tools/preview/');
