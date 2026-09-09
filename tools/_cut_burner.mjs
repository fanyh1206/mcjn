/* 临时抠图 v6（绝对色相关系）：新香炉素材 → assets/img/incense_burner.png —— 用完即删
   1) 核心 = 青瓷绿（g-r>=6 严规；布底恒 r>g 不命中）∪ 沙金/金边（r-g>=22 且 g-b>=42）
   2) 水印矩形强制非核心
   3) 闭运算 r=45 bridging 高光/反射断缝 + 补凹缘缺口
   4) 保留最大连通域 → 测地生长（mask 40px 内且 Y<185 的暗橄榄/暗金边像素）
      → 小闭运算 r=25 平滑阶梯 → 孔洞回填（边界 flood 未达 = 孔）
   5) 2px 边缘补偿 + 3x3 模糊抗锯齿 → 裁切 → 降采样 640 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { join } from 'node:path';

const SRC = 'D:\\Users\\fanya\\AppData\\Roaming\\QoderCN\\SharedClientCache\\cache\\images\\task-334\\宠物香炉设计-cc76df6a.png';
const OUT = join(process.cwd(), 'assets', 'img', 'incense_burner.png');
const PREVIEW = join(process.cwd(), 'tools', 'preview', '_burner_on_dark.png');

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('仅支持 8bit PNG');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('不支持的 colorType ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = y * stride, prev = row - stride;
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
  for (let i = 0; i < w * h; i++) {
    if (ch === 4) { rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1]; rgba[i * 4 + 2] = out[i * 4 + 2]; rgba[i * 4 + 3] = out[i * 4 + 3]; }
    else if (ch === 3) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i]; rgba[i * 4 + 3] = 255; }
  }
  return { w, h, rgba };
}

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
    raw[y * (stride + 1)] = 0;
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

/* 多源 BFS City-block 距离：dist[i] = 到最近 mask 像素的距离；mask 内为 0 */
function distToMask(mask, w, h) {
  const dist = new Int32Array(w * h).fill(0x7fffffff);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  for (let i = 0; i < w * h; i++) if (mask[i]) { dist[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const d = dist[i] + 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0 && dist[i - 1] > d) { dist[i - 1] = d; q[qt++] = i - 1; }
    if (x < w - 1 && dist[i + 1] > d) { dist[i + 1] = d; q[qt++] = i + 1; }
    if (y > 0 && dist[i - w] > d) { dist[i - w] = d; q[qt++] = i - w; }
    if (y < h - 1 && dist[i + w] > d) { dist[i + w] = d; q[qt++] = i + w; }
  }
  return dist;
}

const img = decodePNG(readFileSync(SRC));
const { w, h, rgba } = img;
console.log('源图', w, 'x', h);

/* 背景色采样 */
const pts = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3], [w >> 1, 2], [w >> 1, h - 3], [2, h >> 1], [w - 3, h >> 1]];
let sr = 0, sg = 0, sb = 0, n = 0;
for (const [cx, cy] of pts)
  for (let y = Math.max(0, cy - 6); y <= Math.min(h - 1, cy + 6); y++)
    for (let x = Math.max(0, cx - 6); x <= Math.min(w - 1, cx + 6); x++) {
      const p = (y * w + x) * 4;
      sr += rgba[p]; sg += rgba[p + 1]; sb += rgba[p + 2]; n++;
    }
const B = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
const bY = 0.299 * B[0] + 0.587 * B[1] + 0.114 * B[2];
const bCr = B[0] - bY, bCb = B[2] - bY;
console.log('背景 rgb(' + B.join(',') + ')');

/* 1) 核心：青瓷绿（g 主导）∪ 高饱和暖（沙堆/金边）；布底低饱和暖不命中 */
const core = new Uint8Array(w * h);
let coreN = 0;
for (let i = 0; i < w * h; i++) {
  const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
  const green = (g - r >= 6) && (g - b >= 3);
  const warm = (r - g >= 22) && (g - b >= 42);
  if (green || warm) { core[i] = 1; coreN++; }
}
/* 2) 水印矩形强制非核心 */
const WIPE = [0.78, 0.92, 1, 1];
for (let y = Math.floor(WIPE[1] * h); y < h; y++)
  for (let x = Math.floor(WIPE[0] * w); x < w; x++)
    core[y * w + x] = 0;
console.log('核心占比', (coreN / (w * h) * 100).toFixed(1) + '%');

/* 3) 闭运算 r=45：膨胀 → 腐蚀 */
const R = 45;
const d1 = distToMask(core, w, h);
const dil = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) dil[i] = d1[i] <= R ? 1 : 0;
const notDil = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) notDil[i] = dil[i] ? 0 : 1;
const d2 = distToMask(notDil, w, h);
const closed = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) closed[i] = (dil[i] && d2[i] > R) ? 1 : 0;

/* 4) 最大连通域（8 邻域） */
const lab = new Int32Array(w * h).fill(-1);
let bestLab = -1, bestN = 0, nLab = 0;
const q2 = new Int32Array(w * h);
for (let s = 0; s < w * h; s++) {
  if (lab[s] >= 0 || !closed[s]) continue;
  let qh = 0, qt = 0, cnt = 0;
  q2[qt++] = s; lab[s] = nLab;
  while (qh < qt) {
    const i = q2[qh++]; cnt++;
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const j = yy * w + xx;
      if (lab[j] >= 0 || !closed[j]) continue;
      lab[j] = nLab; q2[qt++] = j;
    }
  }
  if (cnt > bestN) { bestN = cnt; bestLab = nLab; }
  nLab++;
}
console.log('连通域', nLab, '个，最大', bestN, 'px');
let mask = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) mask[i] = (lab[i] === bestLab) ? 1 : 0;

/* 4.6) 测地生长：mask 40px 内的暗色边像素（暗橄榄影面 g-r>=1 / 暗金边 r-g>=10，亮度门 Y<185 挡布影） */
const loose = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) {
  const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (Y < 185 && ((g - r >= 1 && g - b >= 3) || (r - g >= 10 && g - b >= 25))) loose[i] = 1;
}
const dm = distToMask(mask, w, h);
let grown = 0;
for (let i = 0; i < w * h; i++) if (loose[i] && dm[i] <= 40) { mask[i] = 1; grown++; }
console.log('测地生长', grown, 'px');
/* 小闭运算 r=25 平滑生长后的阶梯缘 */
const R2 = 25;
const e1 = distToMask(mask, w, h);
const dil2 = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) dil2[i] = e1[i] <= R2 ? 1 : 0;
const notDil2 = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) notDil2[i] = dil2[i] ? 0 : 1;
const e2 = distToMask(notDil2, w, h);
for (let i = 0; i < w * h; i++) mask[i] = (dil2[i] && e2[i] > R2) ? 1 : 0;

/* 4.5) 孔洞回填：从图像边界 flood 非 mask 区，未达边界的非 mask 区 = 孔（内碗阴影/高光白斑） */
const reach = new Uint8Array(w * h);
const q3 = new Int32Array(w * h);
let qh3 = 0, qt3 = 0;
const seed = (i) => { if (!mask[i] && !reach[i]) { reach[i] = 1; q3[qt3++] = i; } };
for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
while (qh3 < qt3) {
  const i = q3[qh3++];
  const x = i % w, y = (i / w) | 0;
  if (x > 0) seed(i - 1);
  if (x < w - 1) seed(i + 1);
  if (y > 0) seed(i - w);
  if (y < h - 1) seed(i + w);
}
let filled = 0;
for (let i = 0; i < w * h; i++) if (!mask[i] && !reach[i]) { mask[i] = 1; filled++; }
console.log('孔洞回填', filled, 'px');

/* 5) 2px 边缘补偿 + 3x3 模糊抗锯齿 */
const d3 = distToMask(mask, w, h);
for (let i = 0; i < w * h; i++) mask[i] = d3[i] <= 2 ? 1 : 0;
const alpha = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  let s = 0, c = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const yy = y + dy, xx = x + dx;
    if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
    s += mask[yy * w + xx]; c++;
  }
  alpha[y * w + x] = Math.round(s / c * 255);
}
for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = alpha[i];

/* 裁切 bbox + 降采样 640 */
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (rgba[(y * w + x) * 4 + 3] > 8) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
}
x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
const cropped = new Uint8Array(cw * chh * 4);
for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
  const si = ((y + y0) * w + (x + x0)) * 4, di = (y * cw + x) * 4;
  for (let c = 0; c < 4; c++) cropped[di + c] = rgba[si + c];
}
console.log('裁切', cw, 'x', chh, '宽高比', (cw / chh).toFixed(2));
const scale = Math.min(1, 640 / Math.max(cw, chh));
const nw = Math.round(cw * scale), nh = Math.round(chh * scale);
const out = new Uint8Array(nw * nh * 4);
for (let y = 0; y < nh; y++) {
  const sy = (y + 0.5) / scale - 0.5;
  const ya = Math.max(0, Math.floor(sy)), yb = Math.min(chh - 1, ya + 1), fy = sy - ya;
  for (let x = 0; x < nw; x++) {
    const sx = (x + 0.5) / scale - 0.5;
    const xa = Math.max(0, Math.floor(sx)), xb = Math.min(cw - 1, xa + 1), fx = sx - xa;
    const di = (y * nw + x) * 4;
    for (let c = 0; c < 4; c++) {
      const v00 = cropped[(ya * cw + xa) * 4 + c], v10 = cropped[(ya * cw + xb) * 4 + c];
      const v01 = cropped[(yb * cw + xa) * 4 + c], v11 = cropped[(yb * cw + xb) * 4 + c];
      const v0 = v00 + (v10 - v00) * fx, v1 = v01 + (v11 - v01) * fx;
      out[di + c] = Math.round(v0 + (v1 - v0) * fy);
    }
  }
}
writeFileSync(OUT, encodePNG(nw, nh, out));
console.log('✅ 输出', OUT, nw + 'x' + nh, (readFileSync(OUT).length / 1024).toFixed(0) + 'KB');

const pv = new Uint8Array(nw * nh * 4);
for (let i = 0; i < nw * nh; i++) {
  const a = out[i * 4 + 3] / 255;
  pv[i * 4] = Math.round(out[i * 4] * a + 11 * (1 - a));
  pv[i * 4 + 1] = Math.round(out[i * 4 + 1] * a + 14 * (1 - a));
  pv[i * 4 + 2] = Math.round(out[i * 4 + 2] * a + 26 * (1 - a));
  pv[i * 4 + 3] = 255;
}
writeFileSync(PREVIEW, encodePNG(nw, nh, pv));
console.log('预览', PREVIEW);
