# Just Ends

An instrument and installation study built from the Open Khipu Repository:
619 khipus, 54,403 cords, 110,151 knots.

Every cord is played as a string as long as its measurement. Every knot rings
where it was tied. Every cord ends the way the archive says it ended. Reading
is touch, and touch wears the khipu out, while the database row beside it
never changes.

The full project proposal (concept, installation design, hardware, skills,
timeline, risks) is in [`docs/proposal.md`](docs/proposal.md).

## Run the prototype

Open `app/index.html` in a browser. That is all: no server, no build, no
network. Chrome, Safari and Firefox should all work; it has only been run in
Chrome so far.

- Move the pointer across the cords to sound them. On a touch screen, drag.
- **Read** passes a hand along the main cord, left to right, and repeats.
- **wear** sets how much each touch costs. At zero nothing is lost.
- **Re-tie** hangs the khipu again from its rows. What fell stays on the floor.
- The khipu number opens the catalogue of all 619.
- Drag with a mouse to pan, pinch or ctrl-scroll to zoom, `f` to fit.

Links can carry state, which is useful for showing a collaborator one moment:

| parameter | effect |
|---|---|
| `#KH0438` | open that khipu |
| `?autostart` | skip the opening text |
| `?ff=300` | start as if it had already been read for 300 seconds |
| `?wear=0.8` | set the wear, 0 to 1 |
| `?cord=20` | show cord 20's row in the ledger |
| `?zoom=5` | start five times closer |
| `?play` | kiosk mode: start reading immediately (the browser must allow autoplay) |

Example: `app/index.html?autostart&ff=300#KH0279`

## Layout

```
app/                 the prototype (static files)
  index.html
  style.css
  js/audio.js        sound: a pure synthesis function + a small Web Audio wrapper
  js/khipu.js        model: layout in centimetres, archive vs now, the wear rule
  js/app.js          canvas, pointer, ledger, catalogue
  data/index.js      catalogue + archive statistics   (generated)
  data/k/KHxxxx.js   one file per khipu               (generated)
tools/
  build_data.py      khipu.db -> app/data
  tying_score.py     one khipu -> a cord-by-cord making sheet at any scale
docs/
  proposal.md        the project proposal
  archive_stats.json the numbers quoted in the proposal  (generated)
  tying_scores/      example making sheet
data-src/            clone of the Open Khipu Repository (not needed to run the app)
```

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
