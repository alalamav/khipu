/**
 * The piece.
 *
 * This is where the parts meet: the archive, the khipu that is hanging, the
 * hand that reads it, the stage that shows it and the engine that sounds it.
 * It runs once a frame. The interface watches a small snapshot of it (see
 * views.ts) and calls its methods; it never reaches into the parts.
 */
import { AudioEngine } from '../audio/AudioEngine';
import { VOICE_KINDS, type VoiceKind } from '../audio/cordSound';
import {
  HangingKhipu,
  KhipuArchive,
  httpReader,
  type Cord,
  type Khipu,
  type Knot,
  type WearListener,
} from '../khipu';
import { Stage, type FitMargins } from '../stage/Stage';
import { headerOf, recordOf, rowOf, tallyOf, type HeaderView, type LedgerView, type TallyView } from './views';

export const DEFAULT_KHIPU = 'KH0279';

/** Window width, in CSS px, from which the ledger stands beside the khipu. The same as the `desk` breakpoint in index.css. */
export const WIDE_FROM = 980;

export type Overlay = 'intro' | 'catalogue' | 'about' | null;

/** The longest ?ff= that is honoured, in seconds of reading. */
const MAX_FAST_FORWARD = 3600;
/** The drone stays up for this long after the pointer last moved, in milliseconds. Then it begins to go down. */
const DRONE_HOLD_MS = 2000;
/** Milliseconds of a frame that a fast-forward may take. The rest is left for drawing and for the visitor. */
const FORWARD_SLICE_MS = 40;

export interface PieceState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** The khipu on stage, or being fetched. */
  khipuId: string;
  header: HeaderView | null;
  tally: TallyView | null;
  ledger: LedgerView | null;
  reading: boolean;
  /** The sound engine is running. False until the browser has let it start, which takes a click or a key press. */
  audible: boolean;
  /** Set when nothing hangs any more: what the archive still says. */
  finished: { cords: number; knots: number; value: number } | null;
  wear: number;
  volume: number;
  /** The drone of the main cord is heard. */
  drone: boolean;
  /** The snap of a cord parting and the crack of a torn or cut cord are heard. */
  clicks: boolean;
  /** Breath is heard: where a length or an ending was not recorded, and on worn cords. */
  breath: boolean;
  voice: VoiceKind;
  /** Operator voice: modulation depth. */
  depth: number;
  /** Resonator voice: ring time. */
  ring: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Options that can be set in the address, e.g. ?autostart&ff=300&voice=operator#KH0438 */
interface Params {
  autostart: boolean;
  play: boolean;
  debug: boolean;
  fastForward: number;
  wear: number | null;
  cord: number | null;
  zoom: number | null;
  panel: Overlay;
  voice: VoiceKind | null;
  depth: number | null;
  ring: number | null;
}

function readParams(search: string): Params {
  const p = new URLSearchParams(search);
  const number = (name: string): number | null => {
    const v = parseFloat(p.get(name) ?? '');
    return Number.isFinite(v) ? v : null;
  };
  const panel = p.get('panel');
  const voice = p.get('voice');
  return {
    autostart: p.has('autostart'),
    play: p.has('play'),
    debug: p.has('debug'),
    fastForward: clamp(number('ff') ?? 0, 0, MAX_FAST_FORWARD),
    wear: number('wear'),
    cord: number('cord'),
    zoom: number('zoom'),
    panel: panel === 'catalogue' || panel === 'about' ? panel : null,
    voice: VOICE_KINDS.includes(voice as VoiceKind) ? (voice as VoiceKind) : null,
    depth: number('depth'),
    ring: number('ring'),
  };
}

export class Piece {
  readonly audio = new AudioEngine();
  readonly params: Params;
  archive: KhipuArchive | null = null;
  /**
   * How much of the window the interface covers on each side, in CSS px. The
   * interface sets this; the khipu is fitted into what is left.
   */
  margins: (() => FitMargins) | null = null;

  private stage: Stage | null = null;
  private opening: Promise<void> | null = null;
  private khipu: Khipu | null = null;
  private hanging: HangingKhipu | null = null;
  /** How many times this khipu has been re-tied. */
  private generation = 0;
  private loadToken = 0;

  // the reading hand
  private reading = false;
  private handX = 0;
  private nextPendant = 0;
  private handSpeed = 1;
  private restUntil = 0;

  private time = 0;
  private lastFrame = 0;
  private frameRequest = 0;
  private wearAmount = 0.45;
  private silent = false;
  private lastSnap = 0;
  /** When the pointer last moved, anywhere in the window (as `performance.now()` counts). */
  private lastMoveAt = -Infinity;
  /** For each cord, drawn by lot when the khipu is tied: 1 if the echoes of what it drops climb, 0 if they sink. */
  private climbs = new Uint8Array(0);
  private lastPluck = new Float64Array(0);
  private fastForwarded = false;
  /** Steps of a ?ff= that are still to run. */
  private forward = 0;

  /** The view is as it was placed for the visitor: they have not moved or zoomed it since. */
  private fitted = true;
  /** A link to a close view (?zoom=). It holds until the visitor chooses a view, or another khipu. */
  private closeUp: number | null;
  /** Faults already reported, so that one which repeats every frame is logged once. */
  private readonly reported = new Set<string>();

  private focus: Cord | null = null;
  private focusVersion = -1;
  private lastFocusAt = 0;
  private tallyDirty = false;
  private ledgerDirty = false;

  private state: PieceState;
  private readonly listeners = new Set<() => void>();

  constructor(search = '') {
    this.params = readParams(search);
    const p = this.params;
    if (p.wear !== null) this.wearAmount = clamp(p.wear, 0, 1);
    if (p.voice) this.audio.settings.kind = p.voice;
    if (p.depth !== null) this.audio.settings.depth = clamp(p.depth, 0, 2);
    if (p.ring !== null) this.audio.settings.ring = clamp(p.ring, 0.2, 3);
    this.closeUp = p.zoom !== null && p.zoom > 0 ? p.zoom : null;
    this.state = {
      status: 'loading',
      error: null,
      khipuId: DEFAULT_KHIPU,
      header: null,
      tally: null,
      ledger: null,
      reading: false,
      audible: false,
      finished: null,
      wear: this.wearAmount,
      volume: 0.8,
      drone: true,
      clicks: false,
      breath: false,
      voice: this.audio.settings.kind,
      depth: this.audio.settings.depth,
      ring: this.audio.settings.ring,
    };
  }

  // ───────────────────────── for the interface ─────────────────────────

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): PieceState => this.state;

  private set(patch: Partial<PieceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Open the archive and hang the first khipu. Asking again while it is opening changes nothing. */
  open(dataUrl: string, firstId: string): Promise<void> {
    this.opening ??= this.openOnce(dataUrl, firstId);
    return this.opening;
  }

  private async openOnce(dataUrl: string, firstId: string): Promise<void> {
    try {
      this.archive = await KhipuArchive.open(httpReader(dataUrl));
    } catch (error) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return;
    }
    await this.load(firstId);
    const { autostart, play, panel } = this.params;
    // A link that skips the opening text has had no click. Sound is asked for all the same: a kiosk
    // browser is set to allow it, and anywhere else the first click or key press will start it.
    if (autostart || play || panel) this.enter();
    if (play) {
      // Kiosk: start reading as well.
      this.reading = this.hanging !== null && !this.hanging.isEmpty;
      this.set({ reading: this.reading });
    }
  }

  /** Begin: called from the first click, which is what lets a browser make sound. */
  enter(): void {
    this.audio.start();
    this.audio.setVolume(this.state.volume);
  }

  async load(id: string): Promise<void> {
    const archive = this.archive;
    if (!archive) return;
    if (!archive.has(id)) id = DEFAULT_KHIPU;
    const token = ++this.loadToken;
    this.reading = false;
    this.set({ khipuId: id, reading: false, status: this.khipu ? this.state.status : 'loading', error: null });
    let khipu: Khipu;
    try {
      khipu = await archive.load(id);
    } catch (error) {
      if (token === this.loadToken) this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (token !== this.loadToken) return; // another khipu was asked for meanwhile
    if (this.khipu) this.closeUp = null; // the close view was asked of the khipu the link named
    this.khipu = khipu;
    this.generation = 0;
    this.tie(true);
    try {
      history.replaceState(null, '', '#' + id);
    } catch {
      // the address cannot be changed here (e.g. a sandboxed frame); nothing depends on it
    }
  }

  /** The khipu `step` places along in the catalogue. */
  go(step: number): void {
    if (this.archive) void this.load(this.archive.neighbour(this.state.khipuId, step));
  }

  /** Tie the khipu again from its rows. The floor is tidied: what had fallen is cleared away. */
  retie(): void {
    if (!this.khipu) return;
    this.reading = false;
    this.tie(false);
  }

  toggleReading(): void {
    const hanging = this.hanging;
    if (!hanging || !hanging.khipu.cords.length) return;
    this.audio.start();
    if (hanging.isEmpty) {
      this.finish();
      return;
    }
    this.reading = !this.reading;
    this.set({ reading: this.reading });
  }

  setWear(amount: number): void {
    this.wearAmount = clamp(amount, 0, 1);
    this.set({ wear: this.wearAmount });
  }

  setVolume(volume: number): void {
    this.audio.setVolume(volume);
    this.set({ volume });
  }

  setDrone(drone: boolean): void {
    this.audio.setDroneOn(drone);
    this.set({ drone });
  }

  setClicks(clicks: boolean): void {
    this.audio.setClicks(clicks);
    this.set({ clicks });
  }

  setBreath(breath: boolean): void {
    this.audio.setBreath(breath);
    this.set({ breath });
  }

  setVoice(voice: VoiceKind): void {
    this.audio.settings.kind = voice;
    this.ledgerDirty = true;
    this.set({ voice });
  }

  setDepth(depth: number): void {
    this.audio.settings.depth = depth;
    this.ledgerDirty = true;
    this.set({ depth });
  }

  setRing(ring: number): void {
    this.audio.settings.ring = ring;
    this.ledgerDirty = true;
    this.set({ ring });
  }

  /** Show the whole khipu: the visitor asked to. */
  fit(): void {
    this.closeUp = null;
    this.place();
  }

  /**
   * The room around the stage changed (the window, or the interface over it).
   * A view that is still as it was placed is placed again; one the visitor has
   * chosen is left alone.
   */
  layoutChanged(): void {
    if (this.fitted) this.place();
    else if (this.hanging) this.stage?.setRoom(this.room());
  }

  /** Fit the khipu into the room the interface leaves. On a link to a close view, then go that close. */
  private place(): void {
    const stage = this.stage;
    if (!stage || !this.hanging) return;
    const margins = this.room();
    stage.fit(margins);
    if (this.closeUp) stage.zoomAt(this.closeUp, window.innerWidth * 0.4, margins.top);
    this.fitted = true;
  }

  /** The room the interface leaves for the khipu. */
  private room(): FitMargins {
    const wide = window.innerWidth >= WIDE_FROM;
    return this.margins?.() ?? { left: 40, right: wide ? 356 : 40, top: 112, bottom: wide ? 168 : 300 };
  }

  /** The visitor moved or zoomed the view. It is theirs now, and is not placed for them again. */
  private viewChosen(): void {
    this.fitted = false;
    this.closeUp = null;
  }

  // ───────────────────────── tying ─────────────────────────

  private tie(fresh: boolean): void {
    const khipu = this.khipu;
    if (!khipu) return;
    const hanging = new HangingKhipu(khipu);
    if (!fresh) this.generation++;
    this.hanging = hanging;
    this.lastPluck = new Float64Array(khipu.cords.length).fill(-1e9);
    this.climbs = Uint8Array.from(khipu.cords, () => (Math.random() < 0.5 ? 1 : 0));

    const width = hanging.layout.width;
    const pass = clamp(khipu.pendants.length * 0.22, 25, 150); // seconds for the hand to cross
    this.handSpeed = width / pass;
    this.handX = -width * 0.01;
    this.nextPendant = 0;
    this.restUntil = 0;

    this.forward = 0;

    this.stage?.setKhipu(hanging);
    this.place();
    // String sounds are kept by cord and state; the ones kept so far are of cords that no longer hang.
    this.audio.forget();
    this.audio.setDrone(khipu.cords.length ? khipu.primary.length || 0 : null);
    this.audio.setErosion(0);

    this.focus = null;
    this.focusVersion = -1;
    this.set({
      status: 'ready',
      error: null,
      khipuId: khipu.id,
      header: headerOf(khipu),
      tally: tallyOf(hanging, this.generation, this.debugLine()),
      ledger: recordOf(khipu),
      reading: this.reading,
      finished: null,
    });
  }

  // ───────────────────────── touch ─────────────────────────

  private readonly wearListener: WearListener = {
    knotFell: (cord: Cord, knot: Knot) => {
      this.stage?.knotFell(cord, knot);
      this.tallyDirty = true;
    },
    cordSnapped: (cord: Cord, lost: number) => {
      this.stage?.cordSnapped(cord, lost);
      this.crack(cord);
    },
    cordFell: (cord: Cord) => {
      this.stage?.cordFell(cord);
      this.crack(cord);
      this.tallyDirty = true;
    },
  };

  private crack(cord: Cord): void {
    if (this.silent || this.time - this.lastSnap < 0.07 || !this.hanging) return;
    this.lastSnap = this.time;
    const { layout } = this.hanging;
    this.audio.snap((layout.cords[cord.index].x / layout.width) * 1.4 - 0.7, this.climbs[cord.index] === 1);
  }

  /**
   * Touch a cord: it sounds, it moves, and it wears. The cords hanging from
   * it are touched after it, more softly.
   */
  private pluck(cord: Cord, gain: number, delay: number, silent: boolean, y: number | null, push: number): void {
    const hanging = this.hanging;
    if (!hanging) return;
    const state = hanging.state(cord);
    if (state.gone) return;
    this.lastPluck[cord.index] = this.time;
    this.stage?.touch(cord, y, push);
    if (!silent) {
      this.audio.pluck(hanging, cord, {
        gain,
        delay,
        key: `${hanging.khipu.id}:${this.generation}:${cord.index}:${state.version}`,
      });
    }
    const children = cord.children;
    this.silent = silent;
    hanging.wear(cord, this.wearAmount, this.wearListener);
    for (let j = 0; j < children.length; j++) {
      if (!hanging.state(children[j]).gone) {
        this.pluck(children[j], gain * 0.6, Math.min(0.7, delay + 0.09 * (j + 1)), silent || j >= 8, y, push * 0.6);
      }
    }
  }

  /** A stroke of the hand from x0 to x1 at height y (layout cm). `push` is its speed, -1 to 1. */
  private strum(x0: number, x1: number, y: number, push: number): void {
    const hanging = this.hanging;
    const stage = this.stage;
    if (!hanging || !stage) return;
    const { layout } = hanging;
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    if (b - a > layout.width * 0.25) return; // the pointer jumped; that is not a stroke
    const tolerance = 6 / stage.pxPerCm;
    const byX = layout.byX;
    let lo = 0;
    let hi = byX.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (layout.cords[byX[mid].index].x < a) lo = mid + 1;
      else hi = mid;
    }
    let touched = 0;
    for (let i = lo; i < byX.length && layout.cords[byX[i].index].x <= b; i++) {
      const cord = byX[i];
      const state = hanging.state(cord);
      if (state.gone || this.time - this.lastPluck[cord.index] < 0.12) continue;
      const at = layout.cords[cord.index];
      const end = at.top + at.dir * state.hangingLength;
      if (y < Math.min(at.top, end) - tolerance || y > Math.max(at.top, end) + tolerance) continue;
      this.pluck(cord, 1, touched * 0.012, false, y, push);
      this.setFocus(cord);
      if (++touched > 12) break;
    }
  }

  private setFocus(cord: Cord | null): void {
    this.focus = cord;
    this.focusVersion = -1;
    this.lastFocusAt = this.time;
    this.ledgerDirty = true;
  }

  private finish(): void {
    this.reading = false;
    const archive = this.hanging?.archive;
    this.set({ reading: false, finished: archive ? { ...archive } : null });
    this.tallyDirty = true;
  }

  // ───────────────────────── time ─────────────────────────

  private step(dt: number, silent: boolean): void {
    this.time += dt;
    const hanging = this.hanging;
    if (!hanging) return;
    this.silent = silent;

    // Nothing hangs any more. Say so once, whether the reading hand wore it out or the visitor's own.
    // (A khipu the archive gives no cords never had anything to lose.)
    if (hanging.isEmpty && hanging.khipu.cords.length > 0 && !this.state.finished) this.finish();

    if (this.reading && !hanging.isEmpty && this.time >= this.restUntil) {
      const pendants = hanging.khipu.pendants;
      const width = hanging.layout.width;
      this.handX += this.handSpeed * dt;
      let touched = 0;
      while (this.nextPendant < pendants.length && (pendants[this.nextPendant].position ?? 0) <= this.handX) {
        const cord = pendants[this.nextPendant++];
        if (hanging.state(cord).gone) continue;
        this.pluck(cord, 0.85, Math.min(0.1, touched * 0.012), silent, null, 0.45);
        if (!silent && this.time - this.lastFocusAt > 0.22) this.setFocus(cord);
        touched++;
      }
      if (this.handX > width * 1.01) {
        hanging.readings++;
        this.handX = -width * 0.01;
        this.nextPendant = 0;
        this.restUntil = this.time + 1.4;
        this.tallyDirty = true;
      }
    }
    this.silent = silent;
    this.stage?.setHand(this.reading ? this.handX : null);
    this.stage?.step(dt);
  }

  private readonly frame = (t: number): void => {
    // The next frame is asked for first: whatever goes wrong in this one, the piece must not stop for good.
    this.frameRequest = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (t - this.lastFrame) / 1000 || 0);
    this.lastFrame = t;

    try {
      if (this.hanging && this.stage && !this.fastForwarded) {
        // The first frame with a khipu on stage: take up what the link asked for.
        this.fastForwarded = true;
        const { fastForward, cord } = this.params;
        this.forward = Math.round(fastForward * 30);
        if (cord !== null) {
          const focus = this.hanging.khipu.cords[cord - 1];
          if (focus) {
            this.stage.highlight(focus);
            this.setFocus(focus);
          }
        }
      }

      if (this.forward > 0) this.runForward();
      else this.step(dt, false);
      // The drone is there while the khipu is attended to: a hand moving, or a reading that can be heard.
      this.audio.setDroneActive((this.reading && this.forward === 0) || performance.now() - this.lastMoveAt < DRONE_HOLD_MS);
      this.stage?.render();
      this.flush();
    } catch (error) {
      this.report(error);
    }
  };

  /**
   * ?ff=seconds: wear the khipu as that much reading would, without sound, to
   * see a later state. It is done a slice at a time, one slice a frame, so
   * that a long one does not freeze the page; it ends early once nothing
   * hangs and nothing moves.
   */
  private runForward(): void {
    const hanging = this.hanging;
    const stage = this.stage;
    if (!hanging || !stage) {
      this.forward = 0;
      return;
    }
    const was = this.reading;
    const until = performance.now() + FORWARD_SLICE_MS;
    while (this.forward > 0) {
      if (!hanging.isEmpty) this.reading = true;
      else if (!stage.moving) {
        this.forward = 0; // worn out and at rest: nothing more can happen
        break;
      }
      this.forward--;
      // with ?debug the last second and a half is heard
      this.step(1 / 30, !(this.params.debug && this.forward < 45));
      if ((this.forward & 7) === 0 && performance.now() >= until) break;
    }
    this.reading = was && !hanging.isEmpty;
    if (this.forward === 0) this.set({ reading: this.reading });
  }

  /** A fault in a frame is logged, once for each kind, and the piece carries on. */
  private report(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (this.reported.has(message)) return;
    this.reported.add(message);
    console.error(error);
  }

  /** Bring the interface up to date, at most once a frame. */
  private flush(): void {
    const patch: Partial<PieceState> = {};
    if (this.audio.ready !== this.state.audible) patch.audible = this.audio.ready;
    const hanging = this.hanging;
    if (!hanging) {
      if (patch.audible !== undefined) this.set(patch);
      return;
    }
    if (this.focus && hanging.state(this.focus).version !== this.focusVersion) this.ledgerDirty = true;
    if (this.ledgerDirty) {
      this.ledgerDirty = false;
      const s = this.audio.settings;
      if (this.focus) {
        this.focusVersion = hanging.state(this.focus).version;
        patch.ledger = rowOf(hanging, this.focus, this.archive!.palette, s.kind, s.depth, s.ring);
      } else {
        patch.ledger = recordOf(hanging.khipu);
      }
    }
    if (this.tallyDirty || this.params.debug) {
      const debug = this.debugLine();
      if (this.tallyDirty || debug !== this.state.tally?.debug) patch.tally = tallyOf(hanging, this.generation, debug);
      if (this.tallyDirty) this.audio.setErosion(erosionOf(hanging));
      this.tallyDirty = false;
    }
    if (patch.ledger || patch.tally || patch.audible !== undefined) this.set(patch);
  }

  private debugLine(): string | null {
    if (!this.params.debug) return null;
    return `audio ${this.audio.state}, ${this.audio.played} cords sounded, ${this.audio.voices} voices, ${this.audio.landings} landings, drone ${this.audio.droning ? 'up' : 'down'}`;
  }

  // ───────────────────────── the canvas ─────────────────────────

  /** Take over a canvas: draw on it, and listen to the hand on it. Returns how to let go. */
  attach(canvas: HTMLCanvasElement): () => void {
    const stage = new Stage(canvas);
    this.stage = stage;
    stage.onGrainLanded = (pan, lightness, cordIndex) => {
      if (!this.silent) this.audio.tick(pan, lightness, this.climbs[cordIndex] === 1);
    };

    stage.onCordLanded = (pan, cordIndex, length, force, first) => {
      const cord = this.khipu?.cords[cordIndex];
      if (this.silent || !cord) return;
      // A cord that was never measured is drawn at a nominal length, which is not a pitch.
      this.audio.land(pan, cord.length ? length : null, cord.lightness, force, first);
    };

    const size = () => stage.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
    const resize = () => {
      size();
      this.layoutChanged();
    };
    size();
    if (this.hanging) {
      // the canvas arrived after the khipu
      stage.setKhipu(this.hanging);
      this.place();
    }

    // The hand. A mouse strums as it moves, and moves the view when it is dragged. A finger strums;
    // two fingers move the view and pinch it closer or further, and strum nothing.
    /** Where each pointer last was on the khipu. A stroke runs from there to where the pointer is now. */
    const strokes = new Map<number, { x: number; y: number; t: number }>();
    /** The fingers on the glass, in canvas pixels, in the order they came down. */
    const fingers = new Map<number, { x: number; y: number }>();
    let drag: { id: number; x: number; y: number } | null = null;

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    /** The point midway between the first two fingers, and how far apart they are. */
    const pinch = () => {
      const [a, b] = [...fingers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const down = (e: PointerEvent) => {
      this.audio.start();
      strokes.delete(e.pointerId); // a press begins a new stroke
      if (e.pointerType === 'mouse') {
        // Only the main button drags. The others open menus, and a menu can swallow the release.
        if (e.button !== 0) return;
        drag = { id: e.pointerId, ...local(e) };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
      } else if (e.pointerType === 'touch') {
        fingers.set(e.pointerId, local(e));
        if (fingers.size > 1) strokes.clear();
      }
    };
    const release = (e: PointerEvent) => {
      strokes.delete(e.pointerId);
      fingers.delete(e.pointerId);
      if (drag?.id === e.pointerId) {
        drag = null;
        canvas.style.cursor = '';
      }
    };
    const move = (e: PointerEvent) => {
      const at = local(e);
      if (drag?.id === e.pointerId) {
        if (!(e.buttons & 1)) {
          release(e); // the button came up without our hearing of it
          return;
        }
        stage.drag(drag.x, drag.y, at.x, at.y);
        drag.x = at.x;
        drag.y = at.y;
        this.viewChosen();
        return;
      }
      if (fingers.has(e.pointerId)) {
        if (fingers.size > 1) {
          // carry the view with the point between the fingers, and scale it as they spread
          const before = pinch();
          fingers.set(e.pointerId, at);
          const after = pinch();
          stage.drag(before.x, before.y, after.x, after.y);
          if (before.spread > 8 && after.spread > 8) stage.zoomAt(after.spread / before.spread, after.x, after.y);
          this.viewChosen();
          return;
        }
        fingers.set(e.pointerId, at);
      }
      const p = stage.toKhipu(at.x, at.y);
      if (!p) {
        strokes.delete(e.pointerId);
        return;
      }
      const t = e.timeStamp / 1000;
      const last = strokes.get(e.pointerId);
      if (last && this.hanging) {
        // how fast the hand is moving, as a share of a firm push; even a slow touch moves a cord a little
        const speed = (p.x - last.x) / Math.max(0.004, t - last.t);
        const firm = Math.max(4, this.hanging.layout.maxY - this.hanging.layout.minY) * 1.5;
        const push = Math.sign(speed) * clamp(Math.abs(speed) / firm, 0.25, 1);
        this.strum(last.x, p.x, p.y, push);
      }
      strokes.set(e.pointerId, { x: p.x, y: p.y, t });
    };
    const leave = (e: PointerEvent) => {
      strokes.delete(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = local(e);
      if (e.ctrlKey || e.metaKey) stage.zoomAt(Math.exp(-e.deltaY * 0.01), at.x, at.y);
      else stage.drag(at.x, at.y, at.x - e.deltaX, at.y - e.deltaY);
      this.viewChosen();
    };
    const refit = () => this.fit();
    const stir = () => {
      this.lastMoveAt = performance.now();
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', refit);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', stir, { passive: true });

    this.lastFrame = performance.now();
    this.frameRequest = requestAnimationFrame(this.frame);

    return () => {
      cancelAnimationFrame(this.frameRequest);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', release);
      canvas.removeEventListener('pointercancel', release);
      canvas.removeEventListener('lostpointercapture', release);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', refit);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', stir);
      stage.dispose();
      if (this.stage === stage) this.stage = null;
    };
  }
}

/** How much of a khipu has gone, 0 (whole) to 1 (bare): the share of its cords and of its knots no longer hanging. */
function erosionOf(hanging: HangingKhipu): number {
  const { archive, now } = hanging;
  const cords = archive.cords > 0 ? 1 - now.cords / archive.cords : 0;
  // a khipu with no knots wears only by its cords
  const knots = archive.knots > 0 ? 1 - now.knots / archive.knots : cords;
  return clamp(0.5 * (cords + knots), 0, 1);
}
