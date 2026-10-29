// Waves: cut, measure, render and encode AudioBuffers, and draw them. The sound itself plays through the
// shared runtime (/common/audio.js); this is the editor-side half.
const audio = await import(`${location.origin}/common/audio.js`);

/** A new buffer holding samples [a, b) of `buf`. */
export function cut(buf, a, b) {
  a = Math.max(0, Math.floor(a)); b = Math.min(buf.length, Math.ceil(b));
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: Math.max(1, b - a), sampleRate: buf.sampleRate });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, b), ch);
  return out;
}

export function peak(buf) {
  let p = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) p = Math.max(p, Math.abs(v));
  return p;
}

/** Scale so the loudest sample is at `db` (default -1 dB). In place; returns the buffer. */
export function normalise(buf, db = -1) {
  const p = peak(buf);
  if (p < 1e-6) return buf;
  const k = Math.pow(10, db / 20) / p;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}

/** Level of each 10 ms window (peak over all channels), and the window size in samples. */
function levels(buf) {
  const win = Math.max(1, Math.round(buf.sampleRate * 0.01)), n = Math.ceil(buf.length / win), out = new Float32Array(n);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) { const w = (i / win) | 0, v = Math.abs(d[i]); if (v > out[w]) out[w] = v; }
  }
  return { lv: out, win };
}

/** Sample bounds [a, b) of `buf` with leading and trailing quiet (under `db`) taken off. */
export function trimBounds(buf, a = 0, b = buf.length, db = -45) {
  const lim = Math.pow(10, db / 20), d = buf.getChannelData(0), d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d;
  const loud = (i) => Math.abs(d[i]) >= lim || Math.abs(d2[i]) >= lim;
  while (a < b && !loud(a)) a++;
  while (b > a && !loud(b - 1)) b--;
  // a few milliseconds of air on each side so attacks and tails are not clipped
  const pad = Math.round(buf.sampleRate * 0.004);
  return [Math.max(0, a - pad), Math.min(buf.length, b + pad)];
}

/**
 * The sounding parts of `buf`: [[a, b], …] in samples, where the level is over `db` and quiet gaps shorter
 * than `gap` seconds do not split a part. Parts shorter than `min` seconds are dropped.
 */
export function soundingParts(buf, db = -40, gap = 0.12, min = 0.03) {
  const { lv, win } = levels(buf), lim = Math.pow(10, db / 20), parts = [];
  let start = -1, quiet = 0;
  const gapW = Math.round(gap / 0.01);
  for (let w = 0; w <= lv.length; w++) {
    const loud = w < lv.length && lv[w] >= lim;
    if (loud) { if (start < 0) start = w; quiet = 0; }
    else if (start >= 0 && (++quiet > gapW || w === lv.length)) {
      const end = w - quiet + 1;
      if ((end - start) * 0.01 >= min) parts.push([start * win, Math.min(buf.length, end * win)]);
      start = -1; quiet = 0;
    }
  }
  return parts;
}

/** Render `buf` through a filter chain (audio.applyChain) offline; returns the new buffer. */
export async function renderChain(buf, chain) {
  const probe = new OfflineAudioContext(buf.numberOfChannels, 1, buf.sampleRate);
  const { duration } = audio.applyChain(probe, buf, chain); // only to learn the length with tails
  const off = new OfflineAudioContext(Math.max(2, buf.numberOfChannels), Math.ceil(duration * buf.sampleRate) + 1, buf.sampleRate);
  const { source } = audio.applyChain(off, buf, chain, { when: 0 });
  source.start(0);
  return trimEnd(await off.startRendering());
}

/** Render `seconds` of whatever `draw(ctx)` schedules on an offline context (synth notes, clips). */
export async function renderWith(seconds, draw, sampleRate = 48000) {
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  draw(off);
  return off.startRendering();
}

/** Take silent samples off the end (echo and reverb tails are rendered long to be safe). */
export function trimEnd(buf, db = -70) {
  const [, b] = trimBounds(buf, 0, buf.length, db);
  return b < buf.length - 1 ? cut(buf, 0, Math.max(b, 1)) : buf;
}

/** 16-bit PCM WAV bytes of a buffer. */
export function encodeWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, bytes = 44 + n * ch * 2, v = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, k) => buf.getChannelData(k));
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < ch; k++) { const s = Math.max(-1, Math.min(1, data[k][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(v.buffer);
}

export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Draw a waveform of samples [a, b) into a canvas, min/max per pixel column. */
export function drawWave(g, buf, a = 0, b = buf.length, { x = 0, y = 0, w = g.canvas.width, h = g.canvas.height, color = '#e0a040' } = {}) {
  const d = buf.getChannelData(0), span = Math.max(1, b - a), mid = y + h / 2;
  g.fillStyle = color;
  for (let px = 0; px < w; px++) {
    const i0 = a + Math.floor((px / w) * span), i1 = Math.max(i0 + 1, a + Math.floor(((px + 1) / w) * span));
    let lo = 1, hi = -1;
    for (let i = i0; i < i1 && i < d.length; i += Math.max(1, ((i1 - i0) / 64) | 0)) { const s = d[i]; if (s < lo) lo = s; if (s > hi) hi = s; }
    if (hi < lo) continue;
    g.fillRect(x + px, mid - hi * h / 2, 1, Math.max(1, (hi - lo) * h / 2));
  }
}

/** A 256×96 PNG of a buffer's waveform, base64, for a Library thumbnail. */
export function waveThumb(buf, color = '#e0a040') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1c1f'; g.fillRect(0, 0, 256, 96);
  drawWave(g, buf, 0, buf.length, { color });
  return c.toDataURL('image/png').split(',')[1];
}
