// Synth: one subtractive voice (oscillator or noise → filter with its own envelope → amp ADSR, an LFO on
// pitch or filter). Played from the page's keys or the computer keyboard through audio.synthNote, saved as
// .synth.json presets, and a note rendered to a Library sound.
let app, $, audio, presets = [], opened = null, octave = 4;

const BUILT_IN_RAW = [
  { name: 'Init saw' },
  { name: 'Soft pad', osc: 'triangle', gain: 0.45, amp: { a: 0.4, d: 0.6, s: 0.8, r: 1.2 }, filter: { type: 'lowpass', cutoff: 900, q: 1, env: 1.2, a: 0.6, d: 0.8, s: 0.5, r: 1 }, lfo: { target: 'pitch', rate: 4.5, depth: 8 } },
  { name: 'Pluck', osc: 'square', gain: 0.4, amp: { a: 0.002, d: 0.25, s: 0, r: 0.15 }, filter: { type: 'lowpass', cutoff: 500, q: 6, env: 3.5, a: 0.002, d: 0.18, s: 0, r: 0.1 }, lfo: { target: 'off' } },
  { name: 'Bass', osc: 'saw', gain: 0.55, amp: { a: 0.005, d: 0.3, s: 0.7, r: 0.12 }, filter: { type: 'lowpass', cutoff: 220, q: 4, env: 2.2, a: 0.005, d: 0.2, s: 0.3, r: 0.1 }, lfo: { target: 'off' } },
  { name: 'Wobble', osc: 'saw', gain: 0.45, amp: { a: 0.01, d: 0.2, s: 0.9, r: 0.2 }, filter: { type: 'lowpass', cutoff: 400, q: 9, env: 0.5, a: 0.01, d: 0.2, s: 0.8, r: 0.2 }, lfo: { target: 'filter', rate: 3, depth: 160 } },
  { name: 'Noise hat', osc: 'noise', gain: 0.35, amp: { a: 0.001, d: 0.06, s: 0, r: 0.05 }, filter: { type: 'highpass', cutoff: 6000, q: 1, env: 0, a: 0.001, d: 0.1, s: 0, r: 0.1 }, lfo: { target: 'off' } },
  { name: 'Snare noise', osc: 'noise', gain: 0.5, amp: { a: 0.001, d: 0.16, s: 0, r: 0.1 }, filter: { type: 'bandpass', cutoff: 1800, q: 0.8, env: 0.6, a: 0.001, d: 0.1, s: 0, r: 0.1 }, lfo: { target: 'off' } },
];
let BUILT_IN = [];
const DEFAULT = () => structuredClone(app.audio.DEFAULT_SYNTH);
const full = (p) => ({ ...DEFAULT(), ...structuredClone(p), amp: { ...DEFAULT().amp, ...p.amp }, filter: { ...DEFAULT().filter, ...p.filter }, lfo: { ...DEFAULT().lfo, ...p.lfo } });

// [group, param, label, min, max, step, unit, log]
const PARAMS = [
  [null, 'gain', 'Volume', 0, 1, 0.01],
  ['amp', 'a', 'Attack', 0.001, 2, 0.001, 's', true], ['amp', 'd', 'Decay', 0.01, 3, 0.01, 's', true], ['amp', 's', 'Sustain', 0, 1, 0.01], ['amp', 'r', 'Release', 0.01, 4, 0.01, 's', true],
  ['filter', 'cutoff', 'Cutoff', 40, 16000, 1, 'Hz', true], ['filter', 'q', 'Resonance', 0.1, 20, 0.1], ['filter', 'env', 'Env amount', 0, 6, 0.1, 'oct'],
  ['filter', 'a', 'Env attack', 0.001, 2, 0.001, 's', true], ['filter', 'd', 'Env decay', 0.01, 3, 0.01, 's', true], ['filter', 's', 'Env sustain', 0, 1, 0.01],
  ['lfo', 'rate', 'LFO rate', 0.1, 20, 0.1, 'Hz', true], ['lfo', 'depth', 'LFO depth', 0, 200, 1, 'ct'],
];
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n) => `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`;
const KEYS = 'awsedftgyhujk'; // C to C, black keys on the top row

export function init(a) {
  app = a; $ = a.$; audio = a.audio;
  BUILT_IN = BUILT_IN_RAW.map(full);
  app.synth = structuredClone(BUILT_IN[0]);
  $('sy-preset').onchange = () => {
    const p = presets[+$('sy-preset').value];
    if (!p) return;
    load(p.def, p.item ? { place: p.place, path: p.item.path, name: p.item.name, readonly: p.place !== 0 } : null);
  };
  $('sy-save').onclick = () => save(false);
  $('sy-save-as').onclick = () => save(true);
  $('sy-render').onclick = renderNote;
  const note = $('sy-note'), len = $('sy-len');
  note.oninput = () => { $('sy-note-o').textContent = noteName(+note.value); };
  len.oninput = () => { $('sy-len-o').textContent = `${len.value} s`; };
  keyboard();
  computerKeys();
  refreshPresets();
  params();
}

export async function refreshPresets() {
  presets = BUILT_IN.map((def) => ({ def }));
  const items = (await app.library?.all('synth').catch(() => [])) ?? [];
  for (const item of items) {
    try { presets.push({ def: await (await fetch(app.fileUrl(item.place, item.path))).json(), item, place: item.place }); } catch {}
  }
  const sel = $('sy-preset');
  sel.innerHTML = '';
  presets.forEach((p, k) => sel.append(new Option(p.item ? `${p.def.name ?? p.item.name} (library)` : p.def.name, k)));
  const at = opened ? presets.findIndex((p) => p.item?.path === opened.path && p.place === opened.place) : presets.findIndex((p) => p.def.name === app.synth.name && !p.item);
  sel.value = Math.max(0, at);
}

function load(def, from = null) {
  app.synth = full(def);
  opened = from;
  params();
}
export async function openPreset(url, item, place) {
  try {
    const def = await (await fetch(url)).json();
    if (def?.format !== 'dream-synth') throw new Error('not a synth preset');
    load(def, { place, path: item.path, name: item.name, readonly: place !== 0 });
    app.setTab('synth');
    await refreshPresets();
  } catch (e) { app.toast('Could not open it: ' + e.message, { kind: 'bad' }); }
}

function params() {
  const box = $('sy-params'), s = app.synth;
  box.innerHTML = '';
  const choice = (label, opts, get, set) => {
    const row = document.createElement('div');
    row.className = 'row mode';
    row.innerHTML = `<span class="lbl">${label}</span>`;
    for (const [v, t] of opts) {
      const b = document.createElement('button');
      b.textContent = t;
      b.classList.toggle('on', get() === v);
      b.onclick = () => { set(v); params(); };
      row.append(b);
    }
    box.append(row);
  };
  choice('Wave', [['sine', '∿'], ['triangle', '△'], ['saw', '⩘'], ['square', '⊓'], ['noise', '░']], () => s.osc, (v) => { s.osc = v; });
  choice('Filter', [['lowpass', 'Low'], ['bandpass', 'Band'], ['highpass', 'High']], () => s.filter.type, (v) => { s.filter.type = v; });
  choice('LFO to', [['off', 'Off'], ['pitch', 'Pitch'], ['filter', 'Filter']], () => s.lfo.target, (v) => { s.lfo.target = v; });
  for (const [grp, p, label, min, max, step, unit = '', log] of PARAMS) {
    if (grp === 'lfo' && s.lfo.target === 'off') continue;
    const obj = grp ? s[grp] : s;
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span class="lbl">${label}</span><input type="range" min="0" max="1"><output></output>`;
    const [, input, out] = row.children;
    const to = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
    const from = (u) => (log ? min * Math.pow(max / min, u) : min + u * (max - min));
    input.step = log ? 0.001 : step / (max - min);
    input.value = to(obj[p]);
    const show = () => { out.textContent = `${+(+obj[p]).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}${unit ? ' ' + unit : ''}`; };
    input.oninput = () => { const v = from(+input.value); obj[p] = log ? +v.toPrecision(3) : Math.round(v / step) * step; show(); };
    show();
    box.append(row);
  }
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = opened ? `Editing ${opened.name}${opened.readonly ? ' (read-only place: Save makes a copy)' : ''}` : `Built-in: ${s.name}. Save makes a library copy.`;
  box.append(note);
}

// ---------- playing ----------
const held = new Map();
function noteOn(n) {
  if (held.has(n)) return;
  // a held note: start it long and cut it on release, so the keys feel like an instrument
  const c = audio.context(), out = c.createGain();
  out.connect(c.destination);
  audio.synthNote(app.synth, n, 30, { dest: out });
  held.set(n, out);
  document.querySelector(`.k[data-n="${n}"]`)?.classList.add('down');
}
function noteOff(n) {
  const out = held.get(n);
  if (!out) return;
  held.delete(n);
  const c = audio.context(), r = Math.max(0.02, app.synth.amp.r);
  out.gain.setTargetAtTime(0, c.currentTime, r / 3);
  setTimeout(() => out.disconnect(), r * 5000);
  document.querySelector(`.k[data-n="${n}"]`)?.classList.remove('down');
}

function keyboard() {
  const box = $('keys');
  box.innerHTML = '';
  const kb = document.createElement('div');
  kb.className = 'keyboard';
  const base = 12 * (octave + 1);
  let whites = 0;
  for (let n = base; n <= base + 24; n++) {
    const black = [1, 3, 6, 8, 10].includes(n % 12), k = document.createElement('div');
    k.className = 'k' + (black ? ' black' : '');
    k.dataset.n = n;
    k.textContent = n % 12 === 0 ? noteName(n) : '';
    if (black) k.style.left = `${whites * 46}px`;
    else whites++;
    k.onpointerdown = (e) => { k.setPointerCapture(e.pointerId); noteOn(n); };
    k.onpointerup = k.onpointercancel = () => noteOff(n);
    kb.append(k);
  }
  box.append(kb);
}
function computerKeys() {
  addEventListener('keydown', (e) => {
    if (app.tab !== 'synth' || e.repeat || e.ctrlKey || e.metaKey || e.target?.matches?.('input[type=text], input[type=number], select')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'x') { octave = Math.max(1, Math.min(7, octave + (k === 'x' ? 1 : -1))); keyboard(); return; }
    const i = KEYS.indexOf(k);
    if (i >= 0) noteOn(12 * (octave + 1) + i);
  });
  addEventListener('keyup', (e) => {
    const i = KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0) for (const o of [octave - 1, octave, octave + 1]) noteOff(12 * (o + 1) + i);
  });
}

// ---------- saving ----------
async function save(asNew) {
  const over = !asNew && opened && !opened.readonly;
  const name = over ? opened.name : prompt('Synth preset name:', app.synth.name)?.trim();
  if (!name) return;
  app.synth.name = name;
  const def = { ...app.synth, format: 'dream-synth', name };
  if (!app.library?.online) return app.download(new Blob([JSON.stringify(def, null, 1)], { type: 'application/json' }), `${name}.synth.json`);
  try {
    const r = await app.library.save({
      name, ext: '.synth.json', folder: over ? app.folderOf(opened.path) : 'Synths', overwrite: over,
      data: app.b64text(JSON.stringify(def, null, 1)),
      meta: { kind: 'synth', tags: ['synth', def.osc, def.filter.type] },
    });
    opened = { place: 0, path: r.path, name, readonly: false };
    app.toast(`Saved ${r.path}`, { kind: 'good' });
    app.library.refreshSaved().catch(() => {});
    await refreshPresets();
    params();
  } catch (e) { app.toast('Save failed: ' + e.message, { kind: 'bad' }); }
}

async function renderNote() {
  const n = +$('sy-note').value, len = +$('sy-len').value, s = app.synth;
  const name = prompt('Save the note as:', `${s.name} ${noteName(n)}`)?.trim();
  if (!name) return;
  try {
    const tail = s.amp.r * 4 + 0.1;
    const buf = app.wave.trimEnd(await app.wave.renderWith(len + tail, (c) => audio.synthNote(s, n, len, { ctx: c, when: 0 })));
    const r = await app.saveSound(buf, name, { synth: structuredClone({ ...s, format: 'dream-synth' }), note: n, duration: len }, { tags: ['synth'] });
    app.toast(`Saved ${r?.path ?? name}`, { kind: 'good' });
  } catch (e) { app.toast('Render failed: ' + e.message, { kind: 'bad' }); }
}
