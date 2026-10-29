// Dream Sound: slice Graves's CC0 recordings into one-shots, run them through a few filters, play a basic
// subtractive synth, roll chord / melody / riff dice and step them into clips, all saved to the Dream Library.
// Everything plays through the shared runtime /common/audio.js, so what plays here is what the game plays.
// This file holds what the tabs share (the open sound, the synth preset, saving); each tab is its own module.
import { checkLibrary, toast } from '/common/ui/toast.js';
checkLibrary();

const $ = (id) => document.getElementById(id);
const COMMON = `${location.origin}/common`;
const audio = await import(`${COMMON}/audio.js`).catch(() => null);
if (!audio) {
  document.body.innerHTML = '<p style="padding:20px">Dream Sound needs the Dream Library (port 5230) running: it serves the audio runtime.</p>';
  throw new Error('no library');
}
const wave = await import('./wave.js');
const { createLibrary, fileUrl } = await import(`${COMMON}/library.js`).catch(() => ({}));

const b64text = (s) => btoa(unescape(encodeURIComponent(s)));
const folderOf = (p) => p.split('/').slice(0, -1).join('/');

/** What the tabs share. */
export const app = {
  $, audio, wave, toast, fileUrl, b64text, folderOf,
  library: null,
  /** The sound open in the Slicer: { buf, name, place, path } */
  sound: null,
  /** The synth preset the Synth tab edits; Dice and new note rows use it. */
  synth: structuredClone(audio.DEFAULT_SYNTH),
  tab: 'slicer',
  listeners: { sound: [], tab: [] },
  on(ev, fn) { this.listeners[ev].push(fn); },
  emit(ev, v) { for (const fn of this.listeners[ev]) fn(v); },

  /** Save an AudioBuffer as a Library sound: <name>.wav with <name>.wav.sound.json (how it was made) beside it. */
  async saveSound(buf, name, made = {}, { folder = 'Sounds', tags = [] } = {}) {
    if (!this.library?.online) { download(new Blob([wave.encodeWav(buf)], { type: 'audio/wav' }), `${name}.wav`); return null; }
    const r = await this.library.save({
      name, ext: '.wav', folder,
      data: wave.base64(wave.encodeWav(buf)),
      parts: { '.sound.json': b64text(JSON.stringify({ format: 'dream-sound', ...made, seconds: +buf.duration.toFixed(3), sampleRate: buf.sampleRate }, null, 1)) },
      thumb: wave.waveThumb(buf),
      meta: { kind: 'audio', tags: ['sound', ...tags].filter((t, i, a) => a.indexOf(t) === i), seconds: +buf.duration.toFixed(3) },
    });
    this.library.refreshSaved().catch(() => {});
    return r;
  },

  /** Open a Library sound in the Slicer. */
  async openSound(place, path, name) {
    try {
      const buf = await audio.loadSound(place, path);
      this.sound = { buf, name: name ?? path.split('/').pop().replace(/\.[^.]+$/, ''), place, path };
      this.emit('sound', this.sound);
      if (this.tab !== 'filters' && this.tab !== 'slicer' && this.tab !== 'clip') setTab('slicer');
      toast(`Opened ${this.sound.name} (${buf.duration.toFixed(2)} s)`, { kind: 'good' });
    } catch (e) { toast('Could not open that sound: ' + e.message, { kind: 'bad' }); }
  },
};

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
app.download = download;

// ---------- the active window ----------
// Every tool is on screen at once, in its own window. `tab` is the one last used: it decides where an opened
// sound goes (a Clip row, or the Slicer) and tells that tool to refresh.
function setTab(t) {
  if (app.tab === t) return;
  app.tab = t;
  app.emit('tab', t);
}
app.setTab = setTab;
addEventListener('pointerdown', (e) => { const w = e.target.closest?.('.dw-win'); if (w) setTab(w.dataset.win); }, true);

// ---------- the tabs' modules ----------
const slicer = await import('./slicer.js');
const filters = await import('./filters.js');
const synth = await import('./synth.js');
const clips = await import('./clips.js');
const dice = await import('./dice.js');
for (const m of [slicer, filters, synth, clips, dice]) m.init(app);

// ---------- library ----------
if (createLibrary) {
  app.library = createLibrary({
    // in the Clip tab a sound becomes a row; anywhere else it opens in the Slicer
    onOpenSound: ({ item, place }) => (app.tab === 'clip' ? clips.addSoundRow(place, item.path, item.name, item.placeId) : app.openSound(place, item.path, item.name)),
    onOpenSynth: ({ url, item, place }) => synth.openPreset(url, item, place),
    onOpenClip: ({ url, item, place }) => clips.openClip(url, item, place),
  });
  app.library.ready.then(() => {
    document.body.classList.toggle('dl-online', app.library.online);
    synth.refreshPresets();
  });
}

// ?sound= / ?synth= / ?clip= place|path open a piece (the library panel in other tools links here)
const q = new URLSearchParams(location.search);
for (const [k, fn] of [['sound', (p, path) => app.openSound(p, path)], ['synth', (p, path) => synth.openPreset(fileUrl(p, path), { path, name: path.split('/').pop().replace(/\.synth\.json$/i, '') }, p)], ['clip', (p, path) => clips.openClip(fileUrl(p, path), { path, name: path.split('/').pop().replace(/\.clip\.json$/i, '') }, p)]]) {
  const v = q.get(k);
  if (!v) continue;
  const [place, ...rest] = v.split('|');
  const path = rest.join('|');
  (app.library?.ready ?? Promise.resolve()).then(() => fn(/^\d+$/.test(place) ? +place : place, path));
  if (k !== 'sound') setTab(k === 'synth' ? 'synth' : 'clip');
}

setTab(q.get('tab') ?? (q.get('synth') ? 'synth' : q.get('clip') ? 'clip' : 'slicer'));
for (const t of ['slicer', 'filters', 'synth', 'dice', 'clip']) app.emit('tab', t); // each tool draws once; the one asked for is active
window.dreamSound = app;
