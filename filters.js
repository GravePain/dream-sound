// Filters: a chain of native Web Audio filters (low/high pass, echo, generated reverb, gate, gain, pitch)
// over the open sound or the Slicer's selected slice. The preview and the render both go through
// audio.applyChain, so the saved file is what was heard.
let app, $, chain = [], playing = null;

const NAMES = { lowpass: 'Low-pass', highpass: 'High-pass', echo: 'Echo', reverb: 'Reverb', gate: 'Gate', gain: 'Gain', pitch: 'Pitch' };
// [param, label, min, max, step, unit]
const PARAMS = {
  lowpass: [['freq', 'Cutoff', 40, 18000, 1, 'Hz', true], ['q', 'Resonance', 0.1, 18, 0.1]],
  highpass: [['freq', 'Cutoff', 20, 8000, 1, 'Hz', true], ['q', 'Resonance', 0.1, 18, 0.1]],
  echo: [['time', 'Time', 0.02, 1.5, 0.01, 's'], ['feedback', 'Feedback', 0, 0.9, 0.01], ['mix', 'Mix', 0, 1, 0.01]],
  reverb: [['seconds', 'Length', 0.2, 6, 0.1, 's'], ['decay', 'Decay', 0.5, 8, 0.1], ['mix', 'Mix', 0, 1, 0.01]],
  gate: [['threshold', 'Threshold', -80, -5, 1, 'dB'], ['hold', 'Hold', 0, 0.5, 0.01, 's']],
  gain: [['db', 'Gain', -24, 24, 0.5, 'dB']],
  pitch: [['rate', 'Rate', 0.25, 4, 0.01, '×']],
};

export function init(a) {
  app = a; $ = a.$;
  const add = $('fx-add');
  for (const k of Object.keys(app.audio.FILTERS)) add.append(new Option(NAMES[k], k));
  add.onchange = () => { if (add.value) { chain.push({ type: add.value, ...app.audio.FILTERS[add.value] }); render(); } add.value = ''; };
  $('fx-play').onclick = preview;
  $('fx-stop').onclick = stop;
  $('fx-save').onclick = save;
  $('fx-on').onchange = target;
  app.on('sound', target);
  app.on('tab', (t) => { if (t === 'filters') target(); else stop(); });
  app.filters = { get chain() { return chain; }, set chain(c) { chain = c; render(); } };
  render();
}

/** The buffer the chain works on, and its name. */
function source() {
  if (!app.sound) return null;
  if ($('fx-on').value === 'slice') {
    const s = app.slicer.selected();
    if (s) return { ...s, slice: { start: s.start, end: s.end } };
  }
  return { buf: app.sound.buf, name: app.sound.name };
}
function target() {
  const s = source();
  $('fx-target').innerHTML = s ? 'Filtering <b></b>' : '';
  if (s) $('fx-target').querySelector('b').textContent = `${s.name} (${s.buf.duration.toFixed(2)} s)`;
}

function render() {
  const box = $('chain');
  box.innerHTML = chain.length ? '' : '<p class="hint">No filters yet. Add one below.</p>';
  chain.forEach((f, k) => {
    const el = document.createElement('div');
    el.className = 'fx';
    el.innerHTML = `<div class="head"><b>${NAMES[f.type]}</b><button title="Earlier">▲</button><button title="Later">▼</button><button title="Remove">✕</button></div>`;
    const [, up, dn, del] = el.firstChild.children;
    up.onclick = () => { if (k > 0) { [chain[k - 1], chain[k]] = [chain[k], chain[k - 1]]; render(); } };
    dn.onclick = () => { if (k < chain.length - 1) { [chain[k + 1], chain[k]] = [chain[k], chain[k + 1]]; render(); } };
    del.onclick = () => { chain.splice(k, 1); render(); };
    for (const [p, label, min, max, step, unit = '', log] of PARAMS[f.type]) {
      const row = document.createElement('label');
      row.className = 'row';
      row.innerHTML = `<span class="lbl">${label}</span><input type="range"><output></output>`;
      const [, input, out] = row.children;
      // cutoffs move on a log scale so the low end is not crammed
      const to = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
      const from = (u) => (log ? min * Math.pow(max / min, u) : min + u * (max - min));
      Object.assign(input, { min: 0, max: 1, step: log ? 0.001 : step / (max - min) });
      input.value = to(f[p]);
      const show = () => { out.textContent = `${+f[p].toFixed(step < 1 ? 2 : 0)}${unit ? ' ' + unit : ''}`; };
      input.oninput = () => { f[p] = log ? Math.round(from(+input.value)) : Math.round(from(+input.value) / step) * step; show(); };
      // a change while previewing restarts the preview with the new values
      input.onchange = () => { if (playing) preview(); };
      show();
      el.append(row);
    }
    box.append(el);
  });
}

function preview() {
  stop();
  const s = source();
  if (!s) return app.toast('Open a sound from the library first.', { kind: 'warn' });
  playing = app.audio.play(s.buf, { chain: structuredClone(chain) });
  playing.onended = () => { playing = null; };
}
function stop() { try { playing?.stop(); } catch {} playing = null; }

async function save() {
  const s = source();
  if (!s) return app.toast('Open a sound from the library first.', { kind: 'warn' });
  if (!chain.length) return app.toast('Add a filter first.', { kind: 'warn' });
  const name = prompt('Save the filtered sound as:', `${s.name} ${chain.map((f) => NAMES[f.type].toLowerCase()).join(' ')}`)?.trim();
  if (!name) return;
  try {
    const out = await app.wave.renderChain(s.buf, chain);
    app.wave.normalise(out, Math.min(-1, 20 * Math.log10(Math.max(1e-6, app.wave.peak(out))))); // only ever turn a clipping render down
    const r = await app.saveSound(out, name, { source: { place: app.sound.place, path: app.sound.path }, slice: s.slice ?? null, filters: structuredClone(chain) }, { tags: ['filtered', ...chain.map((f) => f.type)] });
    app.toast(`Saved ${r?.path ?? name}`, { kind: 'good' });
  } catch (e) { app.toast('Render failed: ' + e.message, { kind: 'bad' }); }
}
