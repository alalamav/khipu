# Just Ends

An instrument and installation study built from the Open Khipu Repository:
619 khipus, 54,403 cords, 110,151 knots.

Every cord is sounded from its row in the database. Every cord ends the way
the archive says it ended. Reading is touch, and touch wears the khipu out:
knots loosen, cords part and fall as cords do, and lie where they land. The
database row beside it never changes.

Three voices read the same rows:

| voice | reads the row as | what you hear |
|---|---|---|
| **string** | measurements | A string as long as the cord, with each knot as a partial where it was tied. |
| **operator** | relationships | Every cord is a sine tone. The cord you touch is frequency-modulated by the cords tied onto it and by the cord before it in its group, at the proportion between their numbers. |
| **resonator** | numbers | The cord is struck and a bank of resonant filters rings, tuned by the values of its knots. |

The full project proposal (concept, installation design, hardware, skills,
timeline, risks) is in [`docs/proposal.md`](docs/proposal.md). How each voice
works, and which columns of the database it reads, is in
[`docs/sound.md`](docs/sound.md).

## Run it

The app is TypeScript, React, three.js, Tone.js and Tailwind, built with Vite.
It needs Node 20.19 or later (or 22.12 or later).

```
cd app
npm ci             # installs exactly what package-lock.json lists
npm run dev        # serves it at http://localhost:5173
```

`npm install` works too, but depending on your version of npm it rewrites
`package-lock.json`.

| command | what it does |
|---|---|
| `npm run dev` | development server with hot reload |
| `npm run build` | type-checks, then writes the static site to `app/dist` |
| `npm run preview` | serves `app/dist` |
| `npm test` | unit tests (Vitest), including a pass over all 619 data files |
| `npm run typecheck` | TypeScript only |

It can no longer be opened as a file: a browser will not load modules or data
from `file://`. The build in `app/dist` uses relative paths, so any static
server can serve it from any folder.

It has been run in Chrome only.

### Using it

- Move the pointer across the cords to sound them. They swing. On a touch screen, drag with one finger.
- **Read** passes a hand along the main cord, left to right, and repeats. Space does the same.
- **wear** sets how much each touch costs. At zero nothing is lost.
- **Re-tie** hangs the khipu again from its rows. What fell stays on the floor, up to 2,500 cords;
  beyond that the oldest are cleared a few at a time.
- **voice** chooses string, operator or resonator. The operator voice has a
  **depth** slider (0 is bare sine tones); the resonator has **ring** (how long the filters ring).
- The ledger shows the row of the cord under the hand: what the archive says,
  what is left, and what the current voice makes of it, in all three voices.
- The khipu number opens the catalogue of all 619. Left and right arrows step through it.
- Drag with the left mouse button to pan, pinch or ctrl-scroll to zoom, `f` or double-click to fit.
  On a touch screen two fingers pan and pinch, and sound nothing.
- Everything can be reached from the keyboard. Tab moves between controls, the arrow keys
  choose the voice or move a slider when one has focus, and Escape closes a sheet.

Links can carry state, which is useful for showing a collaborator one moment:

| parameter | effect |
|---|---|
| `#KH0438` | open that khipu |
| `?autostart` | skip the opening text |
| `?voice=operator` | start in that voice: `string`, `operator` or `resonator` |
| `?depth=1.5` | operator voice: modulation depth, 0 to 2 |
| `?ring=2` | resonator voice: ring time as a multiplier, 0.2 to 3 |
| `?ff=300` | start as if it had already been read for 300 seconds (at most 3600) |
| `?wear=0.8` | set the wear, 0 to 1 |
| `?cord=20` | show cord 20's row in the ledger |
| `?zoom=5` | start five times closer; only the opening view, fitting or moving the view drops it |
| `?panel=about` | open the About or the `catalogue` sheet |
| `?play` | kiosk mode: start reading immediately (the browser must allow autoplay) |
| `?debug` | show the state of the audio engine in the tally |

A browser gives no sound until the page has been clicked or a key pressed. A link
that skips the opening text (`?autostart`, `?play`, `?panel=`) therefore shows a
note beside the tally until the first click or key press, which starts the sound.

Example: `http://localhost:5173/?autostart&voice=operator&ff=120#KH0279`

## Layout

```
app/
  index.html             the app
  selftest.html          sound self-test (development only, see below)
  public/data/           index.json + one JSON file per khipu      (generated)
  src/
    khipu/               the data model and library; no React, three.js or Tone.js
      index.ts             what the library exports
      schema.ts            the typed data model, schema version 2
      vocabulary.ts        the archive's own words for its codes
      Khipu.ts             Khipu, Cord, Knot: the record, immutable
      KhipuArchive.ts      opens the catalogue, loads and searches khipus
      HangingKhipu.ts      what is left of a khipu while it is read; the wear rule
      layout.ts            where each cord hangs, in centimetres
      relations.ts         which cords act on which
      random.ts            the seeded random numbers that make wear and noise repeatable
    audio/               the sound, on Tone.js
      cordSound.ts         what all voices share: pitch from length, durations
      endings.ts           how a sound ends, by termination
      stringVoice.ts       string voice: a pure function from a cord to samples
      operatorPatch.ts     operator voice: the mapping (pure)
      OperatorVoice.ts     operator voice: plays a patch with sine oscillators
      resonatorPatch.ts    resonator voice: the mapping (pure)
      ResonatorVoice.ts    resonator voice: plays a patch with band-pass filters
      bus.ts               compressor, room, limiter; shared noises
      AudioEngine.ts       chooses the voice; hum, grains, snaps
    stage/               the khipu in space, on three.js
      RopeSim.ts           cords as ropes: swinging, falling, folding, piling up
      Stage.ts             scene, camera, what is drawn
      CordLines.ts, KnotSprites.ts, InstancedQuads.ts
    piece/               Piece.ts joins archive, hand, stage and sound; views.ts is what the interface shows
    ui/                  React components
    App.tsx, main.tsx, index.css
    selftest.ts          renders the voices offline and measures them
  tests/                 Vitest: library, mappings, ledger read-outs, string voice, rope physics, the real data
tools/
  build_data.py          khipu.db -> app/public/data
  tying_score.py         one khipu -> a cord-by-cord making sheet at any scale
docs/
  proposal.md            the project proposal
  sound.md               each sound algorithm, and the database columns it reads
  archive_stats.json     the numbers quoted in the proposal        (generated)
  tying_scores/          example making sheet
data-src/                clone of the Open Khipu Repository (only needed to rebuild the data)
```

## The khipu library

`app/src/khipu` can be used on its own. The record and what is left of it are
kept apart: a `Khipu` never changes; a `HangingKhipu` only gets smaller.

```ts
import { HangingKhipu, KhipuArchive, httpReader, relationsInto } from './khipu';

const archive = await KhipuArchive.open(httpReader('data'));
archive.search('Ica', 'cords');                 // catalogue lines, largest first

const khipu = await archive.load('KH0279');     // the record
const cord = khipu.pendants[13];
cord.length;                                    // 43.5 (cm), or null: not recorded
cord.knots.map((k) => k.value);                 // [20, 8]
cord.children;                                  // its subsidiaries
relationsInto(cord);                            // the cords that act on it

const hanging = new HangingKhipu(khipu);        // what is left
hanging.wear(cord, 0.45, {
  knotFell: (cord, knot) => {},
  cordSnapped: (cord, lost) => {},
  cordFell: (cord) => {},
});
hanging.valueNow(cord);                         // what the cord still carries
hanging.now;                                    // { cords, knots, value } still hanging
```

`null` always means "the archive did not record this". The data model is in
[`schema.ts`](app/src/khipu/schema.ts); it and `tools/build_data.py` must be
changed together.

## The mappings

Each mapping is stated in the About sheet of the app, set out in full in
[`docs/sound.md`](docs/sound.md), and implemented in one file:

- **String**: [`stringVoice.ts`](app/src/audio/stringVoice.ts). Pitch is 6600 ÷ cm in hertz, moved by
  whole octaves into 65–1568 Hz, with no scale applied.
- **Operator**: [`operatorPatch.ts`](app/src/audio/operatorPatch.ts). A subsidiary modulates the cord it
  hangs from, stacked up to three deep; the cord before a cord in its group modulates it more weakly.
  A modulator's frequency is the carrier's times the proportion between the two cords' numbers (their
  lengths, where a cord has no knots), lowered by octaves where it would pass 6 kHz. Its depth follows
  the share of the pair's number it carries, and its wear. Fallen cords modulate nothing, so a khipu's
  cords become bare sine tones as it comes apart. In the archive two cords in three have at least one
  modulator.
- **Resonator**: [`resonatorPatch.ts`](app/src/audio/resonatorPatch.ts). One resonance for each cluster
  of knots, at 110 Hz × 2^log10(value): the digits 1 to 9 across an octave, each power of ten an octave
  higher. Single knots strike once each, a long knot once for each turn, a figure-eight knot is two
  resonances beating. A cord has at most twelve filters, shared out so that every number gets one
  before any gets a second.

The patch files are pure functions, so a mapping can be changed and tested without touching audio code.

## Checking the sound

The string voice is a pure function from a cord to samples, so `npm test` checks
it directly: its output is compared sample for sample with recorded digests, and
the knot partial is measured where the mapping puts it. The operator and
resonator mappings are tested the same way as far as their patches. Playing a
patch needs Web Audio nodes, which cannot run under Node.
With `npm run dev` running, open `http://localhost:5173/selftest.html`. It
renders the voices offline and compares what comes out with what the mappings
say: the operator voice's sidebands against the Bessel-function proportions of
frequency modulation at the stated index, the resonator's pitches and ring
times, the loudness of the three voices against one another, and the headroom
with the most cords sounding at once.

## Rebuild the data

```
git clone --depth 1 https://github.com/khipulab/open-khipu-repository.git data-src/open-khipu-repository
python3 tools/build_data.py
python3 tools/tying_score.py KH0279 --scale 4
```

Python 3.9 or later, standard library only.

## Sources and licence of the data

Data: [Open Khipu Repository](https://github.com/khipulab/open-khipu-repository),
`khipu.db`, MIT licence, doi:10.5281/zenodo.18025748. This is the open database
that the [Khipu Field Guide](https://www.khipufieldguide.com/) builds on. The
Field Guide's own curated set is larger (703 khipus); this prototype uses the
619 in the public SQLite file.

The words used for terminations, fibres, attachments and knot types are quoted
from the database's dictionary tables.
