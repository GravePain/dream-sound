# Dream Sound

A very light sound tool for the Dream series (port 5310). It works on your own CC0 sounds in the Dream Library and makes the
sounds and clips the game plays. It's plain JavaScript and Web Audio, with no packages and no build step.

**Needs:** the Dream Library running first (port 5230, or wherever `DREAM_LIBRARY` points the server). Everything goes through
this server's `/dl/` and `/common/`, so the page never names the Library's port. The server binds all network interfaces:
this is a home LAN setup, not something hardened for the internet.

```
node server.mjs        # http://localhost:5310
```

## What it does

- **Slicer.** Open a sound from the library panel and you see its waveform. Click in the selected slice to cut it, drag a cut
  to move it, or right-click a cut to remove it. **Auto-cut on silence** splits the sound at quiet gaps (the threshold
  slider sets how quiet) and ticks the gaps off. Each slice is named, its quiet ends are trimmed and it's normalised to
  −1 dB. **Save ticked slices** writes each one as its own sound.
- **Filters.** Low-pass, high-pass, echo, reverb (from a generated impulse, not a file), gate, gain and pitch, chained in
  order, over the whole sound or the selected slice. **Preview** plays through the same chain the render uses.
  **Render and save** writes a new sound and leaves the original as it was.
- **Synth.** One voice: sine, triangle, saw, square or noise → a low, band or high-pass filter with its own envelope → an
  amp envelope, with an LFO on pitch or filter. Play it from the keys on the page or the computer keyboard
  (A W S E D F T G Y H U J K; Z and X change the octave). It has built-in presets, saves presets as `.synth.json`, and
  **Render note to library** writes one note as a sound.
- **Dice.** Chord, melody and riff patterns from a key, scale, number of bars, density and a seed (the same seed always
  gives the same pattern), played over the Synth tab's preset. **Re-roll** moves to the next seed. **Keep** opens the
  pattern in the Clip tab.
- **Clip.** A step grid: rows are Library sounds (in this tab, click a sound in the library to add it) or notes of a
  synth preset, with 16, 32 or 64 sixteenth-note steps, tempo and swing. Click a cell for a hit, drag right to hold a
  synth note, right-click to clear. **Play** or **Loop**, then **Render and save**.

## Files it writes (all in the Library's save place)

| What | Files | Kind |
| --- | --- | --- |
| A sound | `Sounds/<name>.wav`, with `<name>.wav.sound.json` beside it (its source, slice bounds, filters, normalise, or the synth and note it was rendered from) | `audio` |
| A synth preset | `Synths/<name>.synth.json` (`format: "dream-synth"`) | `synth` |
| A clip | `Clips/<name>.clip.json` (`format: "dream-clip"`: tempo, swing, steps, rows, notes) with its render `<name>.clip.json.wav` beside it | `clip` |

Each piece also gets the Library's usual `.meta.json`, and sounds and clips get a waveform `.thumb.png`. A clip's sound rows
point at Library sounds by place and path, and its synth rows carry their preset inline, so a clip doesn't depend on a
preset file. The render is one full pass of the pattern, turned down only if it would clip.

## What reads them

The game, and any page, plays them through `dream-common/web/audio.js`: `loadSound`, `play`, `synthNote`, `loadClip`
and `playClip`, plus the filter chain (`applyChain`). Dream Sound previews through the same module, so what plays in
the editor is what the game plays. `dream-common/web/audio-demo.html` plays the first three sounds, a synth preset and
a clip from the Library.

In any tool's library panel, synth presets and clips open in Dream Sound (`?synth=place|path`, `?clip=place|path`).
`?sound=place|path` opens a sound in the Slicer. Clicking a sound in another tool's panel still just previews it.
