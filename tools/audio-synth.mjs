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
console.log('完成。index.html 需 <audio id="ambient"|"bgm" loop preload="none"> 接入。');
