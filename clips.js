// Clip editor: a step grid (rows are Library sounds or notes of a synth preset; 16, 32 or 64 sixteenth
// steps; tempo and swing), played and looped through audio.playClip, rendered offline through the same
// scheduler, and saved as <name>.clip.json with its render <name>.clip.json.wav beside it.
let app, $, audio, clip, opened = null, handle = null, prepared = null, paint = null;

const blank = () => ({ format: 'dream-clip', name: 'Clip', tempo: 110, swing: 0, steps: 16, rows: [], notes: [] });

export function init(a) {
  app = a; $ = a.$; audio = a.audio;
  clip = blank();
  $('cl-name').oninput = () => { clip.name = $('cl-name').value; };
  $('cl-tempo').onchange = () => { clip.tempo = Math.max(40, Math.min(240, +$('cl-tempo').value || 110)); restart(); };
  $('cl-swing').oninput = () => { clip.swing = +$('cl-swing').value; $('cl-swing-o').textContent = clip.swing; };
  $('cl-swing').onchange = restart;
  $('cl-steps').onchange = () => { clip.steps = +$('cl-steps').value; clip.notes = clip.notes.filter((n) => n.s < clip.steps); grid(); restart(); };
  $('cl-add-sound').onclick = () => {
    if (!app.sound) return app.toast('Open a sound first: in this tab, click a sound in the library to add it as a row.', { kind: 'warn' });
    addSoundRow(app.sound.place, app.sound.path, app.sound.name);
  };
  $('cl-add-note').onclick = () => addNoteRow();
  $('cl-play').onclick = () => start(false);
  $('cl-loop').onclick = () => start(true);
  $('cl-stop').onclick = stop;
  $('cl-save').onclick = () => save(false);
  $('cl-save-as').onclick = () => save(true);
  addEventListener('pointerup', () => { paint = null; });
  app.on('tab', (t) => { if (t === 'clip') { fields(); grid(); } });
  app.clips = { setClip, grid: drawGrid, get clip() { return clip; } };
  fields();
}

function fields() {
  $('cl-name').value = clip.name;
  $('cl-tempo').value = clip.tempo;
  $('cl-swing').value = clip.swing;
  $('cl-swing-o').textContent = clip.swing;
  $('cl-steps').value = clip.steps;
  if (![16, 32, 64].includes(clip.steps)) $('cl-steps').append(new Option(clip.steps));
  $('clip-name').innerHTML = opened ? `Editing <b></b>${opened.readonly ? ' <span class="hint">(read-only place: Save makes a copy)</span>' : ''}` : '';
  if (opened) $('clip-name').querySelector('b').textContent = opened.name;
}

/** Replace the clip being edited (the dice's Keep, or an opened .clip.json). */
export function setClip(def, from = null) {
  stop();
  clip = { ...blank(), ...structuredClone(def) };
  opened = from;
  prepared = null;
  fields();
  if (app.tab === 'clip') grid();
}

export async function openClip(url, item, place) {
  try {
    const def = await (await fetch(url)).json();
    if (def?.format !== 'dream-clip') throw new Error('not a clip');
    setClip(def, { place, path: item.path, name: item.name, readonly: place !== 0 });
    app.setTab('clip');
  } catch (e) { app.toast('Could not open it: ' + e.message, { kind: 'bad' }); }
}

export function addSoundRow(place, path, name, placeId) {
  clip.rows.push({ name: name ?? path.split('/').pop().replace(/\.[^.]+$/, ''), sound: { place: placeId ?? place, path }, gain: 1 });
  prepared = null;
  grid();
  app.toast(`Row added: ${clip.rows.at(-1).name}`);
}
function addNoteRow(note = 60) {
  const s = structuredClone(app.synth);
  clip.rows.push({ name: s.name, synth: { ...s, format: 'dream-synth' }, note, gain: 1 });
  prepared = null;
  grid();
}

// ---------- the grid ----------
function grid() { drawGrid($('grid'), clip, true); }

/** Draw a clip's grid into `box`; editable for the Clip tab, read-only for the dice's audition. */
export function drawGrid(box, def, editable) {
  box.innerHTML = '';
  if (!def.rows.length) {
    box.innerHTML = `<p class="empty">${editable ? 'No rows yet. Click a sound in the library to add it as a row, or add a synth note row.' : 'Roll the dice.'}</p>`;
    return;
  }
  const g = document.createElement('div');
  g.className = 'grid';
  g.style.gridTemplateColumns = `190px repeat(${def.steps}, minmax(14px, 1fr))`;
  const noteAt = (r, s) => def.notes.find((n) => n.r === r && s >= n.s && s < n.s + (n.len ?? 1));
  def.rows.forEach((row, r) => {
    const name = document.createElement('div');
    name.className = 'name';
    name.title = row.sound ? row.sound.path : `${row.name}, note ${row.note}`;
    if (editable) {
      name.innerHTML = '<button title="Hear this row">▶</button><button title="Remove the row">✕</button>';
      const [hear, del] = name.children;
      hear.onclick = () => hearRow(row);
      del.onclick = () => { def.rows.splice(r, 1); def.notes = def.notes.filter((n) => n.r !== r).map((n) => (n.r > r ? { ...n, r: n.r - 1 } : n)); prepared = null; grid(); };
      if (row.synth) {
        const note = document.createElement('input');
        Object.assign(note, { type: 'number', min: 12, max: 108, value: row.note, title: 'MIDI note' });
        note.onchange = () => { row.note = +note.value; };
        name.append(note);
      }
    }
    name.append(document.createTextNode(row.name));
    g.append(name);
    for (let s = 0; s < def.steps; s++) {
      const cell = document.createElement('div'), n = noteAt(r, s);
      cell.className = 'cell' + (s % 4 === 0 ? ' beat' : '') + (n ? (n.s === s ? ' on' : ' held') : '');
      cell.dataset.s = s;
      if (editable) {
        cell.onpointerdown = (e) => {
          e.preventDefault();
          if (e.button === 2) { if (n) def.notes.splice(def.notes.indexOf(n), 1); grid(); return; }
          if (n) { def.notes.splice(def.notes.indexOf(n), 1); grid(); return; }
          const nn = { r, s, len: 1 };
          def.notes.push(nn);
          paint = row.synth ? nn : null; // drag right to hold a synth note longer
          grid();
        };
        cell.onpointerenter = () => {
          if (!paint || paint.r !== r || s < paint.s) return;
          const clash = def.notes.some((o) => o !== paint && o.r === r && o.s > paint.s && o.s <= s);
          if (!clash) { paint.len = s - paint.s + 1; grid(); }
        };
        cell.oncontextmenu = (e) => e.preventDefault();
      }
      g.append(cell);
    }
  });
  box.append(g);
}

function hearRow(row) {
  if (row.synth) return audio.synthNote(row.synth, row.note, audio.stepTime(clip.tempo) * 2);
  audio.loadSound(row.sound.place, row.sound.path).then((b) => audio.play(b, { gain: row.gain ?? 1 })).catch((e) => app.toast('That sound will not load: ' + e.message, { kind: 'bad' }));
}

/** Show the playing step on whichever grid is showing. */
export function showStep(s) {
  for (const c of document.querySelectorAll('#grid .cell.now')) c.classList.remove('now');
  if (s >= 0) for (const c of document.querySelectorAll(`#grid .cell[data-s="${s}"]`)) c.classList.add('now');
}

// ---------- playing and saving ----------
async function start(loop) {
  stop();
  if (!clip.rows.length) return app.toast('Add a row first.', { kind: 'warn' });
  prepared ??= await audio.prepareClip(clip);
  prepared.def = clip;
  handle = audio.playClip(prepared, { loop, onStep: showStep });
  $('cl-loop').classList.toggle('on', loop);
}
function stop() { handle?.stop(); handle = null; $('cl-loop').classList.remove('on'); }
function restart() { if (handle?.playing) start($('cl-loop').classList.contains('on')); }

/** Render a clip offline through the same scheduler playClip uses. */
export async function renderClip(def) {
  const p = await audio.prepareClip(def);
  const length = def.steps * audio.stepTime(def.tempo);
  const buf = await app.wave.renderWith(length + 3, (c) => audio.scheduleClip(c, p, { when: 0 }));
  // never shorter than one pass of the pattern (it loops), and turned down, never up, if hits pile into clipping
  let out = app.wave.trimEnd(buf);
  if (out.duration < length) out = app.wave.cut(buf, 0, Math.ceil(length * buf.sampleRate));
  if (app.wave.peak(out) > 0.89) app.wave.normalise(out, -1);
  return out;
}

async function save(asNew) {
  if (!clip.rows.length || !clip.notes.length) return app.toast('Put some notes in the grid first.', { kind: 'warn' });
  const over = !asNew && opened && !opened.readonly;
  const name = over ? opened.name : prompt('Clip name:', clip.name)?.trim();
  if (!name) return;
  clip.name = name;
  $('cl-name').value = name;
  try {
    const buf = await renderClip(clip);
    const wav = app.wave.encodeWav(buf);
    if (!app.library?.online) {
      app.download(new Blob([JSON.stringify(clip, null, 1)], { type: 'application/json' }), `${name}.clip.json`);
      app.download(new Blob([wav], { type: 'audio/wav' }), `${name}.clip.json.wav`);
      return;
    }
    const r = await app.library.save({
      name, ext: '.clip.json', folder: over ? app.folderOf(opened.path) : 'Clips', overwrite: over,
      data: app.b64text(JSON.stringify(clip, null, 1)),
      parts: { '.wav': app.wave.base64(wav) },
      thumb: app.wave.waveThumb(buf),
      meta: { kind: 'clip', tags: ['clip', ...clip.rows.map((r) => (r.synth ? 'synth' : 'sounds'))].filter((t, i, a) => a.indexOf(t) === i), tempo: clip.tempo, steps: clip.steps, seconds: +buf.duration.toFixed(3) },
    });
    opened = { place: 0, path: r.path, name, readonly: false };
    fields();
    app.toast(`Saved ${r.path} and its render`, { kind: 'good' });
    app.library.refreshSaved().catch(() => {});
  } catch (e) { app.toast('Save failed: ' + e.message, { kind: 'bad' }); }
}
