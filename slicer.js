// Slicer: the open sound's waveform, cut by hand (click to cut, drag to move, right-click to remove) or
// on silence, each slice named, trimmed, normalised and saved as its own Library sound.
// The slices cover the whole sound end to end; a slice that is ticked off (the quiet between hits after
// an auto-cut) is not saved.
let app, $, wave, canvas, g;
let slices = [], sel = -1, drag = -1, playing = null, playhead = null;

export function init(a) {
  app = a; $ = a.$; wave = a.wave;
  canvas = $('wave'); g = canvas.getContext('2d');
  new ResizeObserver(draw).observe(canvas);
  app.on('sound', () => { reset(); draw(); });
  app.on('tab', (t) => { if (t === 'slicer' || t === 'filters') requestAnimationFrame(draw); });
  $('sl-thresh').oninput = () => { $('sl-thresh-o').textContent = `${$('sl-thresh').value} dB`; };
  $('sl-auto').onclick = autoCut;
  $('sl-clear').onclick = () => { reset(); draw(); };
  $('sl-save').onclick = saveTicked;
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  addEventListener('pointerup', () => { drag = -1; });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); removeCutNear(e); });
  app.slicer = { selected, draw, process };
  draw();
}

function reset() {
  const s = app.sound;
  slices = s ? [{ a: 0, b: s.buf.length, on: true, name: s.name }] : [];
  sel = s ? 0 : -1;
  list();
}

// ---------- geometry ----------
const W = () => canvas.width, H = () => canvas.height;
const toX = (i) => (i / app.sound.buf.length) * W();
const toI = (e) => {
  const r = canvas.getBoundingClientRect();
  return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * app.sound.buf.length);
};
/** The cut (boundary k, between slice k-1 and k) within a few pixels of the pointer, or -1. */
function cutNear(e) {
  const r = canvas.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W();
  for (let k = 1; k < slices.length; k++) if (Math.abs(toX(slices[k].a) - px) < 6 * devicePixelRatio) return k;
  return -1;
}

function down(e) {
  if (!app.sound || e.button !== 0) return;
  const k = cutNear(e);
  if (k > 0) { drag = k; canvas.setPointerCapture(e.pointerId); return; }
  const i = toI(e), at = slices.findIndex((s) => i > s.a && i < s.b);
  if (at < 0) return;
  // clicking inside the selected slice cuts it; clicking another slice selects it first
  if (at !== sel) { sel = at; list(); draw(); return; }
  const s = slices[at];
  if (i - s.a < 200 || s.b - i < 200) return;
  slices.splice(at, 1, { ...s, b: i }, { a: i, b: s.b, on: s.on, name: nextName(s.name) });
  list(); draw();
}
function move(e) {
  if (!app.sound) return;
  canvas.style.cursor = cutNear(e) > 0 ? 'ew-resize' : 'crosshair';
  if (drag < 1) return;
  const i = toI(e), lo = slices[drag - 1].a + 200, hi = slices[drag].b - 200;
  if (hi <= lo) return;
  slices[drag - 1].b = slices[drag].a = Math.max(lo, Math.min(hi, i));
  draw(); lens();
}
function removeCutNear(e) {
  if (!app.sound) return;
  const k = cutNear(e);
  if (k < 1) return;
  slices[k - 1].b = slices[k].b;
  slices.splice(k, 1);
  if (sel >= slices.length) sel = slices.length - 1;
  list(); draw();
}
const nextName = (n) => { const m = n.match(/^(.*?)(\d+)$/); return m ? m[1] + (+m[2] + 1) : n + ' 2'; };

function autoCut() {
  if (!app.sound) return app.toast('Open a sound from the library first.', { kind: 'warn' });
  const { buf, name } = app.sound, parts = wave.soundingParts(buf, +$('sl-thresh').value);
  if (!parts.length) return app.toast('Nothing louder than that threshold.', { kind: 'warn' });
  slices = [];
  let at = 0, n = 0;
  for (const [a, b] of parts) {
    if (a > at) slices.push({ a: at, b: a, on: false, name: 'gap' });
    slices.push({ a, b, on: true, name: `${name} ${++n}` });
    at = b;
  }
  if (at < buf.length) slices.push({ a: at, b: buf.length, on: false, name: 'gap' });
  sel = slices.findIndex((s) => s.on);
  list(); draw();
  app.toast(`${n} slices`, { kind: 'good' });
}

/** A slice as its own buffer, trimmed and normalised as ticked. */
function process(s) {
  let [a, b] = [s.a, s.b];
  if ($('sl-trim').checked) [a, b] = wave.trimBounds(app.sound.buf, a, b, Math.min(-45, +$('sl-thresh').value - 6));
  const out = wave.cut(app.sound.buf, a, b);
  return $('sl-norm').checked ? wave.normalise(out) : out;
}
/** The selected slice for the Filters tab: { buf, name, start, end } (seconds), or null. */
function selected() {
  const s = slices[sel];
  if (!s || !app.sound) return null;
  return { buf: process(s), name: s.name, start: s.a / app.sound.buf.sampleRate, end: s.b / app.sound.buf.sampleRate };
}

function playSlice(k) {
  playing?.stop();
  const s = slices[k], buf = process(s), c = app.audio.context(), t = c.currentTime + 0.02;
  playing = app.audio.play(buf, { when: t });
  playhead = { a: s.a, b: s.b, t, dur: buf.duration };
  const tick = () => { if (!playhead) return; draw(); if (c.currentTime < playhead.t + playhead.dur) requestAnimationFrame(tick); else { playhead = null; draw(); } };
  tick();
}

// ---------- the list ----------
function list() {
  const box = $('slices');
  box.innerHTML = '';
  const sr = app.sound?.buf.sampleRate ?? 1;
  slices.forEach((s, k) => {
    const row = document.createElement('div');
    row.className = 'item' + (k === sel ? ' sel' : '');
    row.innerHTML = '<input type="checkbox" title="Save this slice"><button title="Play">▶</button><input type="text" spellcheck="false"><span class="len"></span>';
    const [tick, play, name, len] = row.children;
    tick.checked = s.on;
    tick.onchange = () => { s.on = tick.checked; draw(); };
    play.onclick = () => { sel = k; list(); playSlice(k); };
    name.value = s.name;
    name.oninput = () => { s.name = name.value; };
    name.onfocus = () => { if (sel !== k) { sel = k; row.parentElement.querySelectorAll('.item').forEach((r, j) => r.classList.toggle('sel', j === k)); draw(); } };
    len.textContent = `${((s.b - s.a) / sr).toFixed(2)} s`;
    box.append(row);
  });
  const hint = $('slicer-hint');
  hint.hidden = !!app.sound && slices.length > 1;
  $('sound-name').innerHTML = app.sound ? 'Slicing <b></b>' : '';
  if (app.sound) $('sound-name').querySelector('b').textContent = app.sound.name;
}
function lens() {
  const sr = app.sound.buf.sampleRate;
  $('slices').querySelectorAll('.len').forEach((el, k) => { el.textContent = `${((slices[k].b - slices[k].a) / sr).toFixed(2)} s`; });
}

async function saveTicked() {
  if (!app.sound) return app.toast('Open a sound from the library first.', { kind: 'warn' });
  const want = slices.filter((s) => s.on);
  if (!want.length) return app.toast('Tick at least one slice.', { kind: 'warn' });
  const sr = app.sound.buf.sampleRate, saved = [];
  for (const s of want) {
    const name = s.name.trim() || app.sound.name;
    try {
      const r = await app.saveSound(process(s), name, {
        source: { place: app.sound.place, path: app.sound.path },
        slice: { start: +(s.a / sr).toFixed(4), end: +(s.b / sr).toFixed(4) },
        trimmed: $('sl-trim').checked, normalise: $('sl-norm').checked ? -1 : null, filters: [],
      }, { tags: ['slice'] });
      saved.push(r?.path ?? name);
    } catch (e) { app.toast(`Could not save ${name}: ${e.message}`, { kind: 'bad' }); return; }
  }
  app.toast(`Saved ${saved.length} sound${saved.length > 1 ? 's' : ''} to Sounds`, { kind: 'good' });
}

// ---------- drawing ----------
function draw() {
  const dpr = devicePixelRatio;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const css = getComputedStyle(document.documentElement), accent = css.getPropertyValue('--accent').trim() || '#e0a040', dim = css.getPropertyValue('--ui-dim').trim() || '#888';
  g.clearRect(0, 0, w, h);
  if (!app.sound) {
    g.fillStyle = dim; g.font = `${14 * dpr}px system-ui`; g.textAlign = 'center';
    g.fillText('Open a sound from the library (Library, bottom right).', w / 2, h / 2);
    return;
  }
  const buf = app.sound.buf;
  slices.forEach((s, k) => {
    const x0 = toX(s.a), x1 = toX(s.b);
    g.fillStyle = k === sel ? 'rgba(224,160,64,0.14)' : k % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0)';
    g.fillRect(x0, 0, x1 - x0, h);
    wave.drawWave(g, buf, s.a, s.b, { x: x0, y: h * 0.08, w: Math.max(1, Math.round(x1 - x0)), h: h * 0.84, color: s.on ? accent : dim });
    g.fillStyle = dim; g.font = `${11 * dpr}px system-ui`; g.textAlign = 'left';
    if (x1 - x0 > 40 * dpr) g.fillText(s.on ? s.name : '', x0 + 5 * dpr, 16 * dpr);
  });
  g.fillStyle = '#f2f2f2';
  for (let k = 1; k < slices.length; k++) g.fillRect(Math.round(toX(slices[k].a)) - dpr, 0, 2 * dpr, h);
  if (playhead) {
    const c = app.audio.context(), f = Math.min(1, (c.currentTime - playhead.t) / playhead.dur);
    g.fillStyle = '#fff';
    g.fillRect(toX(playhead.a + f * (playhead.b - playhead.a)), 0, dpr, h);
  }
}
