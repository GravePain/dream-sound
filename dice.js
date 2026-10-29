// Note dice: chord, melody and riff patterns rolled from key, scale, bars, density and a seed (same seed,
// same pattern), played over the Synth tab's preset. Keep sends the pattern to the Clip tab as a clip.
let app, $, audio, kind = 'chords', def = null, handle = null;

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'major pentatonic': [0, 2, 4, 7, 9], 'minor pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
};
// chord roots by scale degree, with how often each follows; the first bar is always the home chord
const PROGRESS = [0, 3, 4, 5, 0, 3, 4, 1, 5, 3];
// where the hits of a bar fall, from sparse to busy (sixteenth steps)
const RHYTHMS = [[0], [0, 8], [0, 6, 8], [0, 4, 8, 12], [0, 3, 6, 8, 11, 14], [0, 2, 4, 6, 8, 10, 12, 14]];

export function init(a) {
  app = a; $ = a.$; audio = a.audio;
  KEYS.forEach((k, i) => $('dc-key').append(new Option(k, i)));
  for (const s of Object.keys(SCALES)) $('dc-scale').append(new Option(s, s));
  $('dc-scale').value = 'minor';
  $('dc-key').value = 9;
  for (const b of document.querySelectorAll('[data-dice]')) b.onclick = () => {
    kind = b.dataset.dice;
    for (const o of document.querySelectorAll('[data-dice]')) o.classList.toggle('on', o === b);
    roll();
  };
  for (const id of ['dc-key', 'dc-scale', 'dc-bars', 'dc-tempo', 'dc-seed']) $(id).onchange = roll;
  $('dc-density').oninput = () => { $('dc-density-o').textContent = $('dc-density').value; };
  $('dc-density').onchange = roll;
  $('dc-reroll').onclick = () => { $('dc-seed').value = +$('dc-seed').value + 1; roll(); };
  $('dc-play').onclick = audition;
  $('dc-stop').onclick = stop;
  $('dc-keep').onclick = keep;
  let rolled = false; // the first time its window is used; every window is on screen at once now, so nothing stops on a change of focus
  app.on('tab', (t) => { if (t === 'dice' && !rolled) { rolled = true; roll(); } });
  app.dice = { roll: (o) => generate(o), get def() { return def; } };
}

const opts = () => ({ kind, key: +$('dc-key').value, scale: $('dc-scale').value, bars: +$('dc-bars').value, density: +$('dc-density').value, tempo: +$('dc-tempo').value || 110, seed: +$('dc-seed').value || 0, synth: app.synth });

/** A pattern as a clip def. Pure: the same options always give the same clip. */
export function generate({ kind, key, scale, bars, density, tempo, seed, synth }) {
  const rng = audio.mulberry32((seed * 2654435761 + ['chords', 'melody', 'riff'].indexOf(kind) * 97) >>> 0);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const sc = SCALES[scale] ?? SCALES.major, base = (kind === 'riff' ? 48 : 60) + key;
  const pitch = (deg) => base + 12 * Math.floor(deg / sc.length) + sc[((deg % sc.length) + sc.length) % sc.length];
  const steps = bars * 16, notes = [];
  const rhythm = () => RHYTHMS[Math.min(RHYTHMS.length - 1, Math.floor(density * RHYTHMS.length * (0.7 + rng() * 0.5)))];

  if (kind === 'chords') {
    for (let b = 0; b < bars; b++) {
      const root = b === 0 ? 0 : pick(PROGRESS) % sc.length, hits = rhythm();
      hits.forEach((h, i) => {
        const len = (hits[i + 1] ?? 16) - h;
        for (const d of [root, root + 2, root + 4]) notes.push({ p: pitch(d), s: b * 16 + h, len, vel: i === 0 ? 1 : 0.8 });
      });
    }
  } else if (kind === 'melody') {
    let deg = sc.length + pick([0, 2, 4]); // start on a chord note an octave up
    for (let s = 0; s < steps; s++) {
      const strong = s % 4 === 0;
      if (rng() > density * (strong ? 1.1 : 0.55)) continue;
      deg = Math.max(0, Math.min(sc.length * 2 + 2, deg + pick([-2, -1, -1, 0, 1, 1, 2, 3, -3])));
      const len = rng() < 0.3 ? 2 : 1;
      notes.push({ p: pitch(deg), s, len, vel: strong ? 1 : 0.75 });
      s += len - 1;
    }
  } else {
    // a riff: one bar's motif, repeated, its last bar varied
    const motif = [];
    for (let s = 0; s < 16; s++) {
      if (s === 0 || rng() < density * (s % 2 ? 0.35 : 0.7)) motif.push({ s, deg: s === 0 ? 0 : pick([0, 0, 2, 4, sc.length, -1 + sc.length, 1]), len: rng() < 0.25 ? 2 : 1 });
    }
    for (let b = 0; b < bars; b++) {
      const shift = b === bars - 1 && bars > 1 ? pick([0, 3, 4, -3]) : 0;
      for (const m of motif) notes.push({ p: pitch(m.deg + shift), s: b * 16 + m.s, len: m.len, vel: m.s % 4 ? 0.8 : 1 });
    }
  }

  // one row per pitch, high at the top, each a note of the synth preset
  const pitches = [...new Set(notes.map((n) => n.p))].sort((a, b) => b - a);
  const preset = { ...structuredClone(synth), format: 'dream-synth' };
  return {
    format: 'dream-clip',
    name: `${kind[0].toUpperCase() + kind.slice(1)} ${KEYS[key]} ${scale} ${seed}`,
    tempo, swing: 0, steps,
    rows: pitches.map((p) => ({ name: `${KEYS[p % 12]}${Math.floor(p / 12) - 1}`, synth: preset, note: p, gain: kind === 'chords' ? 0.55 : 1 })),
    notes: notes.filter((n) => n.s < steps).map((n) => ({ r: pitches.indexOf(n.p), s: n.s, len: Math.min(n.len, steps - n.s), vel: n.vel })),
    dice: { kind, key: KEYS[key], scale, bars, density, seed },
  };
}

function roll() {
  const was = !!handle;
  stop();
  def = generate(opts());
  app.clips.grid($('grid'), def, false);
  if (was) audition();
}
async function audition() {
  stop();
  def ??= generate(opts());
  handle = audio.playClip(await audio.prepareClip(def), { loop: true, onStep: (s) => {
    for (const c of document.querySelectorAll('#grid .cell.now')) c.classList.remove('now');
    if (s >= 0) for (const c of document.querySelectorAll(`#grid .cell[data-s="${s}"]`)) c.classList.add('now');
  } });
}
function stop() { handle?.stop(); handle = null; }
function keep() {
  def ??= generate(opts());
  app.clips.setClip(def);
  app.setTab('clip');
  app.toast(`${def.name} is in the Clip tab: edit it, then Render and save.`, { kind: 'good' });
}
