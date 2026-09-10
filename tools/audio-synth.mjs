/* =========================================================
   audio-synth.mjs —— 零依赖 WAV 合成（环境音 + 背景音乐）
   谐波叠加法：所有分量频率取 loop 基频整数倍 → 天然无缝循环。
   ambient：夜风（1/f 低频噪声谐波 + 慢速幅度 LFO）≈8s loop
   bgm   ：暖垫 Am add9 + 稀疏钟声 ≈16s loop
   22050Hz mono 16-bit。运行：node tools/audio-synth.mjs
   ========================================================= */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SR = 22050;
const OUT = join(process.cwd(), 'assets', 'audio');
mkdirSync(OUT, { recursive: true });

/* 确定性随机（可复现） */
let seed = 20260907;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

function encodeWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);          // PCM mono
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/* 谐波分量：freq 必须 = k / duration 的整数倍（无缝循环） */
function makeTrack(duration, parts) {
  const n = Math.round(SR * duration);
  const out = new Float64Array(n);
  for (const p of parts) {
    const w = 2 * Math.PI * p.f;
    const ph = p.ph != null ? p.ph : rnd() * Math.PI * 2;
    // 幅度 LFO（整数周期/loop）
    const lw = p.lfoHz ? 2 * Math.PI * p.lfoHz : 0;
    const lph = p.lfoPh != null ? p.lfoPh : rnd() * Math.PI * 2;
    const depth = p.lfoDepth != null ? p.lfoDepth : 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let a = 1 - depth + depth * Math.sin(lw * t + lph);
      out[i] += p.amp * a * Math.sin(w * t + ph);
    }
  }
  return out;
}

/* 钟击包络（loop 内完整衰减） */
function bell(out, t0, freq, amp, decay) {
  const n = out.length;
  const start = Math.round(t0 * SR);
  for (let i = start; i < n; i++) {
    const t = (i - start) / SR;
    const env = Math.exp(-t / decay) * Math.min(1, t * 80); // 快攻击慢衰减
    out[i] += amp * env * (Math.sin(2 * Math.PI * freq * t) +
      0.4 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-t / (decay * 0.4)));
  }
}

/* ---------------- 环境音：夜风 8s ---------------- */
{
  const D = 8;
  const parts = [];
  // 1/f 低频风噪：2Hz 起谐波，幅度随频率衰减
  for (let k = 1; k <= 90; k++) {
    parts.push({ f: k / D * 4, amp: 0.055 / Math.pow(k, 0.75) }); // 0.5~180Hz 带
  }
  // 中频哨声成分（草叶沙沙）
  for (let k = 60; k <= 160; k++) {
    parts.push({ f: k / D * 12, amp: 0.010 / Math.pow(k / 60, 1.2), lfoHz: 2 / D * Math.ceil(rnd() * 4), lfoDepth: 0.7 });
  }
  // 整体阵风 LFO：0.125/0.25Hz 整数周期
  const wind = makeTrack(D, parts);
  const n = wind.length;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const gust = 0.62 + 0.38 * (0.6 * Math.sin(2 * Math.PI * (1 / D) * t + 1.1) + 0.4 * Math.sin(2 * Math.PI * (2 / D) * t + 4.0));
    wind[i] *= gust;
  }
  // 归一化到峰值 0.35（环境音宜轻）
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(wind[i]));
  for (let i = 0; i < n; i++) wind[i] = wind[i] / pk * 0.35;
  writeFileSync(join(OUT, 'ambient.wav'), encodeWav(wind));
  console.log('✅ ambient.wav', D + 's', (encodeWav(wind).length / 1024).toFixed(0) + 'KB');
}

/* ---------------- 背景音乐：暖垫 + 钟声 16s ---------------- */
{
  const D = 16;
  const A2 = 110, C3 = 130.81, E3 = 164.81, B3 = 246.94, A3 = 220, E4 = 329.63;
  // 频率对齐到 loop 谐波网格会有音高偏移 → 垫音用精确频率但相位连续：
  // 16s 内非整数周期的正弦在 loop 点相位不连续会产生咔哒声；
  // 解决办法：频率取 round(f*D)/D（<0.04Hz 偏移，听感不变）
  const q = (f) => Math.round(f * D) / D;
  const parts = [];
  const pad = (f, amp) => {
    parts.push({ f: q(f), amp });
    parts.push({ f: q(f * 1.003), amp: amp * 0.5 });   // 轻失拍加宽
    parts.push({ f: q(f * 2), amp: amp * 0.22 });      // 八度泛音
  };
  pad(A2, 0.16); pad(C3, 0.11); pad(E3, 0.10); pad(B3, 0.055); pad(A3, 0.05); pad(E4, 0.03);
  // 慢速呼吸（整数周期）
  for (const p of parts) { p.lfoHz = 1 / D * 2; p.lfoDepth = 0.25; }
  const out = makeTrack(D, parts);
  // 稀疏钟声：E5 / A4 各一击，loop 内衰减完毕（残留 <1% 避免循环咔哒）
  bell(out, 1.0, 659.25, 0.085, 2.6);
  bell(out, 8.5, 440.0, 0.070, 1.6);
  // 垫音频率已量化到 loop 谐波网格、钟声 loop 内衰减完毕 → 天然无缝，无需交叉淡化
  let pk = 0; for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]));
  for (let i = 0; i < out.length; i++) out[i] = out[i] / pk * 0.30;
  writeFileSync(join(OUT, 'bgm.wav'), encodeWav(out));
  console.log('✅ bgm.wav', D + 's', (encodeWav(out).length / 1024).toFixed(0) + 'KB');
}
/* ---------------- SFX 通用工具 ---------------- */
function noiseArr(n, amp) { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = (rnd() * 2 - 1) * amp; return a; }
function lpPass(x, cutoff) { const a = Math.min(1, 2 * Math.PI * cutoff / SR); const y = new Float64Array(x.length); let p = 0; for (let i = 0; i < x.length; i++) { p += a * (x[i] - p); y[i] = p; } return y; }
function hpPass(x, cutoff) { const l = lpPass(x, cutoff); const y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] - l[i]; return y; }
function addAt(out, src, t0, gain) { const s = Math.round(t0 * SR); for (let i = 0; i < src.length; i++) { const o = s + i; if (o >= 0 && o < out.length) out[o] += src[i] * gain; } }
// 滑音正弦 + 指数衰减（one-shot 用，不需谐波对齐）
function sineDecay(dur, f0, f1, decay, amp) {
  const n = Math.round(dur * SR); const y = new Float64Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 + (f1 - f0) * Math.min(1, t / Math.max(0.05, dur * 0.6));
    ph += 2 * Math.PI * f / SR;
    y[i] = amp * Math.exp(-t / decay) * Math.sin(ph);
  }
  return y;
}
// 高频噪声短爆（爆裂/碎屑/擦划颗粒），loop 内收敛不跨循环点
function crackle(out, t0, dur, hpHz, amp) {
  const m = Math.round(dur * SR);
  const b = hpPass(noiseArr(m, 1), hpHz);
  for (let i = 0; i < m; i++) b[i] *= Math.exp(-(i / SR) / (dur * 0.35));
  addAt(out, b, t0, amp);
}
function norm(x, peak) { let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i])); if (pk > 0) for (let i = 0; i < x.length; i++) x[i] = x[i] / pk * peak; return x; }
// one-shot 尾部淡出，杜绝 BufferSource 结束咔哒；loop 禁用（靠谐波对齐无缝）
function fadeTail(x, sec) { const m = Math.min(x.length, Math.round(sec * SR)); for (let i = 0; i < m; i++) x[x.length - 1 - i] *= i / m; return x; }
function writeSfx(name, x, D) {
  writeFileSync(join(OUT, name + '.wav'), encodeWav(x));
  console.log('✅ ' + name + '.wav', D + 's', (encodeWav(x).length / 1024).toFixed(0) + 'KB');
}

/* ---------------- SFX：火焰燃烧 loop 3s（幕2/幕3 循环床） ---------------- */
{
  const D = 3, n = Math.round(SR * D), out = new Float64Array(n);
  const parts = [];
  for (let k = 1; k <= 36; k++) parts.push({ f: k / D * 2, amp: 0.05 / Math.pow(k, 0.85), lfoHz: Math.ceil(rnd() * 3) / D, lfoDepth: 0.4 });
  const roar = makeTrack(D, parts);
  for (let i = 0; i < n; i++) out[i] += roar[i];
  const hiss = lpPass(noiseArr(n, 1), 900);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] += hiss[i] * 0.05 * (0.7 + 0.3 * Math.sin(2 * Math.PI * (2 / D) * t + 2.0));
  }
  for (let p = 0; p < 110; p++) crackle(out, rnd() * (D - 0.06), 0.008 + rnd() * 0.02, 1800 + rnd() * 2500, 0.10 + Math.pow(rnd(), 2) * 0.5);
  writeSfx('fire_loop', norm(out, 0.6), D);
}

/* ---------------- SFX：点火 whoosh 1.4s（幕2 进入） ---------------- */
{
  const D = 1.4, n = Math.round(SR * D), out = new Float64Array(n);
  const n1 = lpPass(noiseArr(n, 1), 500), n2 = lpPass(noiseArr(n, 1), 2400);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = Math.min(1, t / 0.5);
    const env = Math.min(1, t / 0.18) * Math.exp(-Math.max(0, t - 0.5) / 0.8);
    out[i] += (n1[i] * (1 - k * 0.4) + n2[i] * k * 0.5) * env * 0.5;
  }
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] += 0.25 * Math.min(1, t / 0.6) * (Math.sin(2 * Math.PI * 54 * t) + 0.5 * Math.sin(2 * Math.PI * 81 * t)) * Math.exp(-Math.max(0, t - 0.9) / 0.5);
  }
  for (let p = 0; p < 8; p++) crackle(out, 0.5 + rnd() * 0.8, 0.01 + rnd() * 0.015, 2000 + rnd() * 2000, 0.12 + rnd() * 0.15);
  writeSfx('ignite', norm(fadeTail(out, 0.15), 0.7), D);
}

/* ---------------- SFX：扫灰入罐 1.6s（幕4 sweep 段，三下扫拂） ---------------- */
{
  const D = 1.6, n = Math.round(SR * D), out = new Float64Array(n);
  [0.03, 0.55, 1.07].forEach(function (t0, si) {
    const dur = 0.42, m = Math.round(dur * SR);
    let b = hpPass(lpPass(noiseArr(m, 1), 2600), 500);
    for (let i = 0; i < m; i++) {
      const t = i / SR, u = i / m;
      b[i] *= Math.pow(Math.sin(Math.PI * u), 1.5) * (1 + 0.25 * Math.sin(2 * Math.PI * 26 * t + si));
    }
    addAt(out, b, t0, 0.8 - si * 0.12);
    for (let g = 0; g < 10; g++) crackle(out, t0 + 0.05 + rnd() * (dur - 0.1), 0.006 + rnd() * 0.008, 3000 + rnd() * 1500, 0.06 + rnd() * 0.06);
  });
  writeSfx('sweep', norm(fadeTail(out, 0.12), 0.5), D);
}

/* ---------------- SFX：罐盖合 1.0s（幕4 lid 段：瓷盖落位+轻震） ---------------- */
{
  const D = 1.0, n = Math.round(SR * D), out = new Float64Array(n);
  function clink(t0, g) {
    addAt(out, sineDecay(0.16, 640, 600, 0.05, 0.5), t0, g);
    addAt(out, sineDecay(0.10, 1280, 1240, 0.035, 0.22), t0, g);
    addAt(out, sineDecay(0.20, 190, 150, 0.07, 0.5), t0, g);
  }
  clink(0.02, 1);
  clink(0.22, 0.5);
  crackle(out, 0.30, 0.010, 2500, 0.12);
  crackle(out, 0.36, 0.009, 2600, 0.08);
  crackle(out, 0.41, 0.008, 2700, 0.05);
  writeSfx('urn_lid', norm(fadeTail(out, 0.2), 0.6), D);
}

/* ---------------- SFX：软落地/覆土拍平 0.8s（通用 one-shot） ---------------- */
{
  const D = 0.8, n = Math.round(SR * D), out = new Float64Array(n);
  addAt(out, sineDecay(0.4, 95, 52, 0.16, 0.8), 0, 1);
  const puff = lpPass(noiseArr(Math.round(0.14 * SR), 1), 300);
  for (let i = 0; i < puff.length; i++) puff[i] *= Math.exp(-(i / SR) / 0.05);
  addAt(out, puff, 0, 0.5);
  crackle(out, 0.01, 0.012, 2200, 0.15);
  writeSfx('thud', norm(fadeTail(out, 0.15), 0.65), D);
}

/* ---------------- SFX：棺盖合拢 1.4s（幕5 close 段：木盖滑移+闷落） ---------------- */
{
  const D = 1.4, n = Math.round(SR * D), out = new Float64Array(n);
  const slide = lpPass(noiseArr(n, 1), 700);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.15) * (t < 0.62 ? 1 : Math.max(0, 1 - (t - 0.62) / 0.1));
    out[i] += slide[i] * env * (0.6 + 0.4 * Math.sin(2 * Math.PI * 7 * t)) * 0.22;
  }
  addAt(out, sineDecay(0.30, 150, 90, 0.11, 0.7), 0.62, 1);
  addAt(out, sineDecay(0.12, 330, 300, 0.05, 0.3), 0.62, 1);
  addAt(out, sineDecay(0.50, 68, 55, 0.20, 0.6), 0.62, 1);
  addAt(out, sineDecay(0.18, 140, 95, 0.07, 0.25), 0.82, 1);
  writeSfx('coffin_lid', norm(fadeTail(out, 0.2), 0.65), D);
}

/* ---------------- SFX：覆土 loop 2s（幕6 cover 段循环床） ---------------- */
{
  const D = 2, n = Math.round(SR * D), out = new Float64Array(n);
  const parts = [];
  for (let k = 1; k <= 10; k++) parts.push({ f: k / D, amp: 0.035 / Math.pow(k, 0.7) });
  const rum = makeTrack(D, parts);
  for (let i = 0; i < n; i++) out[i] += rum[i];
  for (let g = 0; g < 70; g++) {
    const dur = 0.03 + rnd() * 0.04;
    const m = Math.round(dur * SR);
    let b = lpPass(noiseArr(m, 1), 700 + rnd() * 500);
    for (let i = 0; i < m; i++) b[i] *= Math.exp(-(i / SR) / (dur * 0.4));
    addAt(out, b, rnd() * (D - 0.08), 0.08 + rnd() * 0.22);
  }
  for (let d = 0; d < 6; d++) addAt(out, sineDecay(0.09, 120, 90, 0.04, 0.25), rnd() * (D - 0.1), 1);
  writeSfx('soil_loop', norm(out, 0.55), D);
}

/* ---------------- SFX：石碑升起磨 rumble loop 2.5s（幕7 升起段） ---------------- */
{
  const D = 2.5, n = Math.round(SR * D), out = new Float64Array(n);
  const parts = [];
  for (let k = 1; k <= 30; k++) parts.push({ f: k / D * 2, amp: 0.07 / Math.pow(k, 0.8), lfoHz: Math.ceil(rnd() * 4) / D, lfoDepth: 0.5 });
  const grind = makeTrack(D, parts);
  for (let i = 0; i < n; i++) out[i] += grind[i];
  const gn = lpPass(noiseArr(n, 1), 240);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] += gn[i] * (0.45 + 0.55 * Math.sin(2 * Math.PI * (3 / D) * t + 1.2)) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (1 / D) * t)) * 0.35;
  }
  writeSfx('rumble_loop', norm(out, 0.6), D);
}

/* ---------------- SFX：石碑落定 1.2s（幕7 立稳：重落+碎屑） ---------------- */
{
  const D = 1.2, n = Math.round(SR * D), out = new Float64Array(n);
  addAt(out, sineDecay(0.55, 62, 40, 0.22, 0.9), 0, 1);
  addAt(out, sineDecay(0.35, 110, 70, 0.12, 0.4), 0, 1);
  const puff = lpPass(noiseArr(Math.round(0.2 * SR), 1), 260);
  for (let i = 0; i < puff.length; i++) puff[i] *= Math.exp(-(i / SR) / 0.07);
  addAt(out, puff, 0, 0.5);
  for (let d = 0; d < 7; d++) crackle(out, 0.12 + rnd() * 0.6, 0.008 + rnd() * 0.012, 1600 + rnd() * 2000, 0.18 - d * 0.02);
  writeSfx('stone_set', norm(fadeTail(out, 0.2), 0.7), D);
}

/* ---------------- SFX：点香 1.6s（幕7 点燃/纪念馆上香：气息+三下火苗+磬） ---------------- */
{
  const D = 1.6, n = Math.round(SR * D), out = new Float64Array(n);
  const air = hpPass(noiseArr(n, 1), 1200);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] += air[i] * Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.4) / 0.5) * 0.18;
  }
  [0.12, 0.42, 0.72].forEach(function (t0) {
    crackle(out, t0, 0.015, 2600, 0.3);
    addAt(out, sineDecay(0.06, 1500, 1200, 0.02, 0.12), t0, 1);
  });
  bell(out, 0.95, 523.25, 0.30, 0.45);
  bell(out, 0.97, 1046.5, 0.10, 0.3);
  writeSfx('incense_lit', norm(fadeTail(out, 0.25), 0.55), D);
}

/* ---------------- SFX：照片放大/香炉升起 气息 1.8s ---------------- */
{
  const D = 1.8, n = Math.round(SR * D), out = new Float64Array(n);
  const air = hpPass(noiseArr(n, 1), 900);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] += air[i] * Math.min(1, t / 1.2) * Math.pow(1 - t / D, 1.5) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 5 * t)) * 0.22;
  }
  const gl = new Float64Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += 2 * Math.PI * (196 + 196 * Math.min(1, t / 1.4)) / SR;
    gl[i] = Math.sin(ph) * Math.min(1, t / 0.6) * Math.pow(1 - t / D, 1.2) * 0.10;
  }
  for (let i = 0; i < n; i++) out[i] += gl[i];
  [523.25, 659.25, 783.99].forEach(function (f, k) {
    const s = sineDecay(1.0, f, f, 0.5, 0.03);
    addAt(out, s, 0.6 + k * 0.12, 1);
  });
  writeSfx('swell', norm(fadeTail(out, 0.25), 0.4), D);
}

/* ---------------- SFX：点蜡烛 0.5s（纪念馆点蜡烛） ---------------- */
{
  const D = 0.5, n = Math.round(SR * D), out = new Float64Array(n);
  crackle(out, 0.02, 0.012, 2400, 0.5);
  addAt(out, sineDecay(0.05, 1100, 900, 0.02, 0.2), 0.02, 1);
  const w = hpPass(noiseArr(n, 1), 1000);
  for (let i = 0; i < n; i++) out[i] += w[i] * Math.exp(-(i / SR) / 0.15) * 0.12;
  writeSfx('flick', norm(fadeTail(out, 0.1), 0.5), D);
}
console.log('完成。index.html 需 <audio id="ambient"|"bgm" loop preload="none"> 接入；音效 wav 由 PM.Audio WebAudio 按需 fetch。');
