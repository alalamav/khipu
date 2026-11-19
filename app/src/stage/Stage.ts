/**
 * The stage: the khipu hanging in space.
 *
 * The stage draws a HangingKhipu with three.js and gives its cords bodies.
 * Every cord is a rope (RopeSim) hung where the layout puts it. A cord that
 * is touched swings; one that parts or comes away falls as a rope, folds as
 * it lands, and stays on the bed under the khipu with the knots that fell
 * before it.
 *
 * Space is in centimetres. x runs along the main cord, y is up (so a cord
 * that the layout puts at depth d hangs at y = -d), z is towards the viewer.
 *
 * The stage decides nothing about the khipu. It is told what happened
 * (WearListener) and shows it.
 */
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Cord, CordLayout, HangingKhipu, Knot, Rgb, WearListener } from '../khipu';
import { CordLines, LINE_NO_MINIMUM, LINE_RIM, LineStyle, type ScreenUniforms } from './CordLines';
import { KnotShape, KnotSprites } from './KnotSprites';
import { Bed, Rope, RopeSim } from './RopeSim';

// ───────────────────────── how things look ─────────────────────────

/** Thickness of a cord, cm, and its least width on screen, CSS px. */
const CORD_WIDTH = 0.11;
const CORD_MIN_PX = 0.7;
/** The main cord and subsidiaries, as multiples of a pendant's width. */
const MAIN_WIDTH = 3.2;
const SUBSIDIARY_WIDTH = 0.8;
/** A knot's radius as a multiple of its cord's width. */
const KNOT_RADIUS = 1.15;

/** Neutral tones. The cords keep their recorded colours; everything the stage adds is grey. */
const PALE: Rgb = [238, 238, 238];
const UNRECORDED: Rgb = [160, 160, 160];
const MAIN_UNRECORDED: Rgb = [190, 190, 190];
const WRAP: Rgb = [225, 225, 225];
const MARK: Rgb = [10, 10, 10];

/** Camera: a long lens, looking slightly down so the bed under the khipu has depth. */
const FOV = 26;
const PITCH = (11 * Math.PI) / 180;

// ───────────────────────── how things move ─────────────────────────

/** Most segments in one cord's rope. */
const MAX_SEGMENTS = 26;
/**
 * A loose cord is drawn as a curve through its rope's points, each stretch in
 * this many pieces: finer for the few in the air than for the many at rest.
 */
const FALLING_STEPS = 4;
const FALLEN_STEPS = 3;
/**
 * Fallen cords kept on the bed. Beyond this the oldest are cleared away, a few
 * at a time so that the bed thins instead of emptying in patches.
 */
const MAX_DEBRIS = 2500;
const DEBRIS_CLEARED = 50;
/** Fallen grains kept, and how many of the oldest go at a time. */
const MAX_GRAINS = 20000;
const GRAINS_CLEARED = 400;

interface Look {
  rgb: Rgb;
  rgb2: Rgb;
  knot: Rgb;
  alpha: number;
  style: number;
  flags: number;
  width: number;
}

export interface FitMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function mix(c: Rgb, t: number, to: Rgb = PALE): Rgb {
  return [c[0] + (to[0] - c[0]) * t, c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A small fixed offset in depth per cord, so that cords do not hang in one perfect plane. */
function depthOf(index: number): number {
  return (((Math.imul(index + 1, 0x9e3779b1) >>> 0) / 4294967296) - 0.5) * 0.12;
}

/**
 * One coordinate of the Catmull-Rom curve from b (t = 0) to c (t = 1), where
 * a and d are the points before and after. The curve passes through every
 * point it is given.
 */
function spline(a: number, b: number, c: number, d: number, t: number): number {
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
}

export class Stage implements WearListener {
  /** Called when a fallen grain reaches the bed: where (-1 left to 1 right) and how light the cord was. */
  onGrainLanded: ((pan: number, lightness: number) => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 1, 5000);
  private readonly screen: ScreenUniforms = {
    uViewport: { value: new Vector2(1, 1) },
    uPixelRatio: { value: 1 },
  };

  // drawn in this order, back to front
  private readonly paper: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly fallenLines: CordLines;
  private readonly fallenGrains: KnotSprites;
  private readonly fallingLines: CordLines;
  private readonly beam: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly cordLines: CordLines;
  private readonly knots: KnotSprites;
  private readonly flyingGrains: KnotSprites;

  private readonly sim = new RopeSim();
  private hanging: HangingKhipu | null = null;
  private ropes: (Rope | null)[] = [];
  private looks: Look[] = [];
  private glow = new Float32Array(0);
  private glowing = false;
  /** Places on the main cord where a pendant used to hang. */
  private marks: number[] = [];
  /** Loose ropes that have come to rest, oldest first. */
  private debris: Rope[] = [];
  /** Fallen grains at rest: x, y, z, r, g, b per grain. */
  private landed: number[] = [];
  /** Grains in the air: x, y, z, vx, vy, vz, r, g, b, lightness per grain. */
  private flying: number[] = [];

  // the scale of the khipu on stage
  private width = 4;
  private topY = 0;
  private floorY = -10;
  private height = 4;
  private bedDepth = 6;
  private grain = 0.1;

  private readonly view = { x: 0, y: 0, distance: 100, fitScale: 1 };
  private cssWidth = 1;
  private cssHeight = 1;
  private hand: number | null = null;

  private cordsDirty = true;
  private fallenDirty = true;
  private readonly tmp = new Float32Array(6);
  private readonly v0 = new Vector3();
  private readonly v1 = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    // Everything is drawn back to front in the order it was added, so no depth (or stencil) buffer is asked for.
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      depth: false,
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.sortObjects = false;

    this.paper = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.03, depthTest: false, depthWrite: false, side: DoubleSide }),
    );
    this.paper.rotation.x = -Math.PI / 2;
    this.fallenLines = new CordLines(this.screen, CORD_WIDTH, CORD_MIN_PX);
    this.fallenGrains = new KnotSprites(this.screen, { radius: 0.08, minPx: 0.6, maxPx: 2 });
    this.fallingLines = new CordLines(this.screen, CORD_WIDTH, CORD_MIN_PX);
    this.beam = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec2 vUv; void main() { float a = 0.085 * (1.0 - abs(vUv.x * 2.0 - 1.0)); gl_FragColor = vec4(vec3(0.92) * a, a); }',
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.beam.visible = false;
    this.cordLines = new CordLines(this.screen, CORD_WIDTH, CORD_MIN_PX);
    this.knots = new KnotSprites(this.screen, { radius: CORD_WIDTH * KNOT_RADIUS, minPx: 0.9, fadeBelow: 0.9 });
    this.flyingGrains = new KnotSprites(this.screen, { radius: 0.08, minPx: 0.6, maxPx: 2 });

    this.scene.add(
      this.paper,
      this.fallenLines.mesh,
      this.fallenGrains.mesh,
      this.fallingLines.mesh,
      this.beam,
      this.cordLines.mesh,
      this.knots.mesh,
      this.flyingGrains.mesh,
    );

    this.sim.onSettle = (rope) => {
      this.debris.push(rope);
      this.fallenDirty = true;
    };

    // Build every shader now, while nothing is moving, instead of at the first reading, the first
    // fall and the first grain. A shader is only finished when it is first used, so the scene,
    // still empty, is drawn once with every layer in it. (The sheet and the beam are a quad each:
    // they are never culled, or this first draw, made before they have a place, would skip them.)
    this.paper.frustumCulled = false;
    this.beam.frustumCulled = false;
    this.beam.visible = true;
    this.renderer.render(this.scene, this.camera);
    this.beam.visible = false;
  }

  // ───────────────────────── the khipu ─────────────────────────

  /**
   * Hang a khipu. With `fresh`, the bed is swept first; without it (a
   * re-tying), whatever has already fallen stays where it lies.
   */
  setKhipu(hanging: HangingKhipu | null, fresh: boolean): void {
    this.hanging = hanging;
    this.marks = [];
    this.hand = null;
    this.cordsDirty = true;
    this.fallenDirty = true;

    if (fresh || !hanging) {
      this.sim.clear();
      this.debris = [];
      this.landed = [];
      this.flying = [];
    } else {
      // cords still tied are taken down; what is loose keeps falling
      this.sim.prune((rope) => rope.free);
    }
    this.ropes = [];
    this.looks = [];
    if (!hanging) {
      // nothing to show: empty every layer
      for (const layer of [this.fallenLines, this.fallingLines, this.cordLines, this.knots, this.fallenGrains, this.flyingGrains]) {
        layer.begin();
        layer.commit();
      }
      this.beam.visible = false;
      this.paper.visible = false;
      return;
    }
    this.paper.visible = true;

    const { layout, khipu } = hanging;
    this.width = layout.width;
    this.height = Math.max(4, layout.maxY - layout.minY);
    this.topY = -layout.minY;
    this.floorY = -(layout.maxY + Math.max(2, this.height * 0.08));
    this.grain = Math.max(0.04, this.height * 0.0035);
    this.bedDepth = clamp(this.height * 0.42, 6, 60);

    const sim = this.sim;
    sim.gravity = Math.max(60, this.height * 3);
    sim.floorY = this.floorY;
    sim.radius = CORD_WIDTH * 0.5;
    sim.depositPerPoint = this.grain * 0.22;
    if (fresh || !sim.bed) {
      const x0 = -this.width * 0.04;
      const x1 = this.width * 1.04;
      const cell = clamp(this.height / 60, 0.4, 2.5);
      sim.bed = new Bed(
        x0, x1, -this.bedDepth / 2, this.bedDepth / 2,
        clamp(Math.round((x1 - x0) / cell), 24, 400),
        clamp(Math.round(this.bedDepth / (cell * 1.6)), 8, 40),
      );
    }
    for (const sprites of [this.fallenGrains, this.flyingGrains]) sprites.radius = this.grain * 0.8;

    this.paper.scale.set(this.width * 1.08, this.bedDepth, 1);
    this.paper.position.set(this.width * 0.5, this.floorY, 0);

    // one rope per cord; parents come first, so a cord's parent already has its rope
    const segment = clamp(this.height / MAX_SEGMENTS, 1, 4);
    this.glow = new Float32Array(khipu.cords.length);
    this.glowing = false;
    for (const cord of khipu.cords) {
      this.looks.push(lookOf(cord));
      this.ropes.push(sim.add(this.ropeFor(cord, layout.cords[cord.index], segment)));
    }
  }

  private ropeFor(cord: Cord, at: CordLayout, segment: number): Rope {
    const n = clamp(Math.ceil(at.drawLength / segment), 1, MAX_SEGMENTS);
    const z = depthOf(cord.index) + (cord.parent ? 0.18 * (cord.depth - 1) : 0);
    const points: number[] = [];
    const parent = cord.parent ? this.ropes[cord.parent.index] : null;
    let parentZ = 0;
    if (parent) {
      parentZ = parent.p[3 * parent.lead + 2];
      points.push(at.attachX, -at.attachY, parentZ);
    }
    for (let i = 0; i <= n; i++) points.push(at.x, -(at.top + (at.dir * at.drawLength * i) / n), z);

    const rope = new Rope(points);
    rope.tag = cord.index;
    // Top cords are drawn upward from the main cord, as khipu schematics draw them.
    rope.gravity = at.dir === 1 ? 1 : -1;
    if (parent) {
      rope.lead = 1;
      rope.anchor = { rope: parent, arc: at.attachAt ?? 0 };
      rope.standoff = [at.x - at.attachX, -(at.top - at.attachY), z - parentZ];
    } else {
      rope.anchor = { rope: null, x: at.x, y: 0, z };
    }
    return rope;
  }

  // ───────────────────────── what happens to it ─────────────────────────

  /**
   * A hand passes over a cord. `y` is how far down the khipu the touch was
   * (layout units; null for the middle of the cord) and `push` its sideways
   * speed, as a share of the strongest push: -1 to 1.
   */
  touch(cord: Cord, y: number | null, push: number): void {
    const hanging = this.hanging;
    const rope = this.ropes[cord.index];
    if (!hanging || !rope || rope.free) return;
    this.glow[cord.index] = 1;
    this.glowing = true;
    const at = hanging.layout.cords[cord.index];
    const length = hanging.state(cord).hangingLength;
    const arc = y === null ? length * 0.5 : clamp((y - at.top) * at.dir, 0, length);
    const speed = clamp(push, -1, 1) * this.height * 0.3;
    this.sim.kick(rope, arc, speed, 0, (Math.random() - 0.5) * Math.abs(speed) * 0.6, Math.max(2, length * 0.3));
  }

  /** Show a cord as just touched without pushing it. */
  highlight(cord: Cord): void {
    if (cord.index < this.glow.length) {
      this.glow[cord.index] = 1;
      this.glowing = true;
    }
  }

  knotFell(cord: Cord, knot: Knot): void {
    const hanging = this.hanging;
    const rope = this.ropes[cord.index];
    if (!hanging || !rope) return;
    const length = hanging.state(cord).hangingLength;
    const arc = knot.position !== null ? Math.min(knot.position, length) : length * 0.5;
    const at = this.tmp;
    rope.sample(arc, at, 0, true);
    const rgb = cord.rgb ?? UNRECORDED;
    const g = this.grain;
    const h = this.height;
    const pieces = Math.min(knot.count, 5);
    for (let j = 0; j < pieces; j++) {
      this.flying.push(
        at[0] + (Math.random() - 0.5) * g * 3 + at[3] * j * g * 2,
        at[1] + at[4] * j * g * 2,
        at[2] + (Math.random() - 0.5) * g * 3,
        (Math.random() - 0.5) * h * 0.08,
        Math.random() * h * 0.07,
        (Math.random() - 0.5) * h * 0.08,
        rgb[0], rgb[1], rgb[2],
        cord.lightness,
      );
    }
    this.cordsDirty = true;
  }

  cordSnapped(cord: Cord, _lost: number): void {
    const hanging = this.hanging;
    const rope = this.ropes[cord.index];
    if (!hanging || !rope) return;
    const keep = hanging.state(cord).hangingLength;
    const piece = this.sim.cut(rope, keep);
    const h = this.height;
    if (piece) this.sim.release(piece, h * 0.12, (Math.random() - 0.5) * h * 0.08, (Math.random() - 0.5) * h * 0.1);
    // what is left springs back a little
    if (!rope.free) this.sim.kick(rope, keep, (Math.random() - 0.5) * h * 0.15, h * 0.12 * rope.gravity, 0, Math.max(2, keep * 0.4));
    this.cordsDirty = true;
  }

  cordFell(cord: Cord): void {
    const hanging = this.hanging;
    const rope = this.ropes[cord.index];
    if (!hanging || !rope) return;
    // A cord that is carried down by the cord it hangs from is already loose.
    if (!rope.free) {
      const h = this.height;
      this.sim.release(rope, h * 0.1, (Math.random() - 0.5) * h * 0.07, (Math.random() - 0.5) * h * 0.1);
    }
    if (!cord.parent) this.marks.push(hanging.layout.cords[cord.index].x);
    this.glow[cord.index] = 0;
    this.cordsDirty = true;
  }

  /** Where the reading hand is along the main cord; null when nobody is reading. */
  setHand(x: number | null): void {
    this.hand = x;
  }

  // ───────────────────────── time ─────────────────────────

  /** Something is still moving: a cord swinging or falling, or a grain in the air. */
  get moving(): boolean {
    return this.sim.anyAwake || this.flying.length > 0;
  }

  step(dt: number): void {
    if (!this.hanging) return;
    this.sim.step(dt);

    if (this.glowing) {
      const fade = Math.exp(-dt * 2.4);
      let any = false;
      for (let i = 0; i < this.glow.length; i++) {
        if (this.glow[i] > 0) {
          this.glow[i] = this.glow[i] * fade < 0.02 ? 0 : this.glow[i] * fade;
          any = true;
        }
      }
      this.glowing = any;
      this.cordsDirty = true;
    }
    this.stepGrains(dt);
  }

  private stepGrains(dt: number): void {
    const f = this.flying;
    if (!f.length) return;
    const g = this.sim.gravity;
    const bed = this.sim.bed;
    const slow = 1 - 1.2 * dt;
    let w = 0;
    for (let i = 0; i < f.length; i += 10) {
      f[i + 4] -= g * dt;
      f[i + 3] *= slow;
      f[i + 5] *= slow;
      f[i] += f[i + 3] * dt;
      f[i + 1] += f[i + 4] * dt;
      f[i + 2] += f[i + 5] * dt;
      const ground = this.floorY + (bed ? bed.heightAt(f[i], f[i + 2]) : 0);
      if (f[i + 1] <= ground) {
        bed?.deposit(f[i], f[i + 2], this.grain * 0.3);
        const c = mix([f[i + 6], f[i + 7], f[i + 8]], 0.15);
        this.landed.push(f[i], ground, f[i + 2], c[0], c[1], c[2]);
        this.fallenDirty = true;
        this.onGrainLanded?.((f[i] / this.width) * 1.4 - 0.7, f[i + 9]);
      } else {
        if (w !== i) for (let k = 0; k < 10; k++) f[w + k] = f[i + k];
        w += 10;
      }
    }
    f.length = w;
  }

  // ───────────────────────── drawing ─────────────────────────

  render(): void {
    if (this.hanging) {
      const moving = this.sim.anyAwake;
      if (this.fallenDirty) this.writeFallen();
      if (moving || this.cordsDirty) {
        this.writeCords();
        this.writeFalling();
      }
      this.writeFlying();
      this.placeBeam();
      this.cordsDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Everything hanging: the main cord, the cords still tied to it, their knots and endings. */
  private writeCords(): void {
    const hanging = this.hanging!;
    const { khipu } = hanging;
    const lines = this.cordLines;
    const knots = this.knots;
    const t = this.tmp;
    lines.begin();
    knots.begin();

    const main = khipu.primary.rgb ? mix(khipu.primary.rgb, 0.12) : MAIN_UNRECORDED;
    lines.add(0, 0, 0, this.width, 0, 0, main[0], main[1], main[2], 1, 0, 0, 0, 0, MAIN_WIDTH, LineStyle.plied, 0);
    // "…was probably present as indicated by the discoloration on the main cord"
    const half = CORD_WIDTH * MAIN_WIDTH * 0.5;
    for (const x of this.marks) {
      lines.add(x, half, 0.2, x, -half, 0.2, MARK[0], MARK[1], MARK[2], 0.6, 0, 0, 0, 0, 1, LineStyle.solid, 0);
    }

    for (const cord of khipu.cords) {
      const rope = this.ropes[cord.index];
      if (!rope || rope.free) continue;
      const look = this.looks[cord.index];
      const state = hanging.state(cord);
      const alpha = look.alpha * (0.4 + 0.6 * clamp(state.integrity, 0, 1));
      const glow = this.glow[cord.index];
      const rgb = glow > 0 && cord.rgb ? mix(look.rgb, glow * 0.6) : look.rgb;
      this.writeRope(lines, rope, rgb, look.rgb2, alpha, look.width, look.style, look.flags);

      // knots still tied
      const length = state.hangingLength;
      const count = cord.knots.length;
      for (const knot of cord.knots) {
        if (!hanging.isTied(knot)) continue;
        let at = knot.position !== null ? knot.position : (length * (knot.index + 1)) / (count + 1);
        if (at > length) at = length;
        rope.sample(at, t, 0, true);
        const a = knot.position === null ? alpha * 0.55 : alpha;
        const k = look.knot;
        if (knot.isLong) {
          const slant = knot.direction === 'S' ? 1 : knot.direction === 'Z' ? -1 : 0;
          knots.add(t[0], t[1], t[2], t[3], t[4], t[5], k[0], k[1], k[2], a, KnotShape.long, knot.turns, slant, look.width);
        } else if (knot.isFigureEight) {
          knots.add(t[0], t[1], t[2], t[3], t[4], t[5], k[0], k[1], k[2], a, KnotShape.ring, 1, 0, look.width);
        } else {
          knots.add(t[0], t[1], t[2], t[3], t[4], t[5], k[0], k[1], k[2], a, KnotShape.singles, Math.min(knot.count, 9), 0, look.width);
        }
      }

      // the end of the cord, as the row says it ends (or as it has since broken)
      const ending = state.snapped ? 'B' : cord.termination;
      if (ending === 'B' || ending === 'R' || ending === 'TT' || ending === 'D') {
        rope.sample(length, t, 0, true);
        const ex = t[0], ey = t[1], ez = t[2];
        const dx = t[3], dy = t[4], dz = t[5];
        if (ending === 'D') {
          knots.add(ex, ey, ez, dx, dy, dz, rgb[0], rgb[1], rgb[2], alpha, KnotShape.fineRing, 1, 0, look.width * 0.74);
        } else if (ending === 'TT') {
          rope.sample(Math.max(0, length - 0.45), t);
          lines.add(t[0], t[1], t[2], ex, ey, ez, WRAP[0], WRAP[1], WRAP[2], alpha, 0, 0, 0, 0, look.width * 2, LineStyle.solid, LINE_NO_MINIMUM);
        } else {
          // frayed: three hairs, spread wider when the plies are coming apart
          const spread = ending === 'R' ? 1.6 : 0.9;
          const e = 0.5;
          let px = -dy, py = dx;
          const pl = Math.hypot(px, py) || 1;
          px /= pl; py /= pl;
          const hair = (along: number, side: number) =>
            lines.add(ex, ey, ez, ex + (dx * along + px * side) * e, ey + (dy * along + py * side) * e, ez + dz * along * e,
              rgb[0], rgb[1], rgb[2], alpha, 0, 0, 0, 0, look.width * 0.5, LineStyle.solid, LINE_NO_MINIMUM);
          hair(1.0, -0.5 * spread);
          hair(1.2, 0.15);
          hair(0.8, 0.55 * spread);
        }
      }
    }
    lines.commit();
    knots.commit();
  }

  /**
   * One rope as a run of segments. With `steps` above 1 a curve is passed
   * through the rope's points and each stretch between two of them is drawn
   * in that many pieces, so that a loose cord bends like thread rather than
   * like a folding rule.
   */
  private writeRope(
    lines: CordLines, rope: Rope, rgb: Rgb, rgb2: Rgb, alpha: number, width: number, style: number, flags: number, steps = 1,
  ): void {
    const p = rope.p;
    const last = rope.n - 1;
    let arc = 0;
    for (let i = 1; i <= last; i++) {
      const a = 3 * (i - 1);
      const b = 3 * i;
      const rest = i > rope.lead ? rope.rest[i] : 0;
      if (steps <= 1) {
        lines.add(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2],
          rgb[0], rgb[1], rgb[2], alpha, rgb2[0], rgb2[1], rgb2[2], arc, width, style, flags);
      } else {
        // the points before and after this stretch shape the curve through it
        const before = 3 * Math.max(0, i - 2);
        const after = 3 * Math.min(last, i + 1);
        let x0 = p[a], y0 = p[a + 1], z0 = p[a + 2];
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const x1 = spline(p[before], p[a], p[b], p[after], t);
          const y1 = spline(p[before + 1], p[a + 1], p[b + 1], p[after + 1], t);
          const z1 = spline(p[before + 2], p[a + 2], p[b + 2], p[after + 2], t);
          lines.add(x0, y0, z0, x1, y1, z1,
            rgb[0], rgb[1], rgb[2], alpha, rgb2[0], rgb2[1], rgb2[2], arc + (rest * (s - 1)) / steps, width, style, flags);
          x0 = x1; y0 = y1; z0 = z1;
        }
      }
      arc += rest;
    }
  }

  /** Cords in the air. */
  private writeFalling(): void {
    const lines = this.fallingLines;
    lines.begin();
    for (const rope of this.sim.ropes) {
      if (!rope.free || rope.settled) continue;
      const look = this.looks[rope.tag];
      if (look) {
        this.writeRope(lines, rope, look.rgb, look.rgb2, look.alpha, SUBSIDIARY_WIDTH, LineStyle.solid, look.flags & LINE_RIM, FALLING_STEPS);
      }
    }
    lines.commit();
  }

  /** What lies on the bed: the edge of the sheet, the cords that have come to rest, and the grains. */
  private writeFallen(): void {
    this.fallenDirty = false;

    if (this.debris.length > MAX_DEBRIS) {
      const batches = Math.ceil((this.debris.length - MAX_DEBRIS) / DEBRIS_CLEARED);
      const gone = new Set(this.debris.splice(0, batches * DEBRIS_CLEARED));
      this.sim.prune((rope) => !gone.has(rope));
    }
    if (this.landed.length > MAX_GRAINS * 6) {
      const batches = Math.ceil((this.landed.length / 6 - MAX_GRAINS) / GRAINS_CLEARED);
      this.landed.splice(0, batches * GRAINS_CLEARED * 6);
    }

    const lines = this.fallenLines;
    lines.begin();
    // the sheet under the khipu
    const x0 = -this.width * 0.04, x1 = this.width * 1.04;
    const z0 = -this.bedDepth / 2, z1 = this.bedDepth / 2;
    const y = this.floorY;
    const edge = (ax: number, az: number, bx: number, bz: number) =>
      lines.add(ax, y, az, bx, y, bz, 255, 255, 255, 0.1, 0, 0, 0, 0, 0.6, LineStyle.solid, 0);
    edge(x0, z0, x1, z0);
    edge(x1, z0, x1, z1);
    edge(x1, z1, x0, z1);
    edge(x0, z1, x0, z0);
    for (const rope of this.debris) {
      const look = this.looks[rope.tag];
      if (look) {
        this.writeRope(lines, rope, look.rgb, look.rgb2, look.alpha * 0.75, SUBSIDIARY_WIDTH, LineStyle.solid, look.flags & LINE_RIM, FALLEN_STEPS);
      }
    }
    lines.commit();

    const grains = this.fallenGrains;
    const l = this.landed;
    grains.begin();
    for (let i = 0; i < l.length; i += 6) {
      grains.add(l[i], l[i + 1], l[i + 2], 0, -1, 0, l[i + 3], l[i + 4], l[i + 5], 0.9, KnotShape.dot, 1, 0, 1);
    }
    grains.commit();
  }

  private writeFlying(): void {
    const grains = this.flyingGrains;
    const f = this.flying;
    if (!f.length && !grains.count) return;
    grains.begin();
    for (let i = 0; i < f.length; i += 10) {
      const c = mix([f[i + 6], f[i + 7], f[i + 8]], 0.35);
      grains.add(f[i], f[i + 1], f[i + 2], 0, -1, 0, c[0], c[1], c[2], 1, KnotShape.dot, 1, 0, 1);
    }
    grains.commit();
  }

  private placeBeam(): void {
    const beam = this.beam;
    beam.visible = this.hand !== null;
    if (this.hand === null) return;
    const top = this.topY + 14 / this.pxPerCm;
    beam.scale.set(92 / this.pxPerCm, top - this.floorY, 1);
    beam.position.set(this.hand, (top + this.floorY) / 2, 0);
  }

  // ───────────────────────── the view ─────────────────────────

  resize(width: number, height: number, pixelRatio: number): void {
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);
    this.screen.uViewport.value.set(this.cssWidth * pixelRatio, this.cssHeight * pixelRatio);
    this.screen.uPixelRatio.value = pixelRatio;
    this.camera.aspect = this.cssWidth / this.cssHeight;
    this.placeCamera();
  }

  /** CSS pixels per centimetre, in the plane the khipu hangs in. */
  get pxPerCm(): number {
    return this.cssHeight / (2 * this.view.distance * Math.tan((FOV * Math.PI) / 360));
  }

  /** Show the whole khipu and the bed under it, inside the margins left free by the interface. */
  fit(margins: FitMargins): void {
    if (!this.hanging) return;
    const freeW = Math.max(40, this.cssWidth - margins.left - margins.right);
    const freeH = Math.max(40, this.cssHeight - margins.top - margins.bottom);
    // height on screen: the hanging cords, plus the near half of the bed seen from above
    const tall = (this.topY - this.floorY) * Math.cos(PITCH) + this.bedDepth * 0.5 * Math.sin(PITCH);
    const scale = Math.max(0.05, Math.min(freeW / this.width, freeH / tall));
    this.view.fitScale = scale;
    this.setScale(scale);
    this.view.x = this.width / 2;
    this.view.y = (this.topY + this.floorY) / 2;
    this.placeCamera();
    // slide what is drawn into the middle of the free area
    const a = this.project(0, this.topY, 0, this.v0);
    const ax = a.x, ay = a.y;
    const b = this.project(this.width, this.floorY, this.bedDepth / 2, this.v0);
    const cx = (ax + b.x) / 2, cy = (ay + b.y) / 2;
    this.drag(cx, cy, margins.left + freeW / 2, margins.top + freeH / 2);
  }

  /** Come closer (factor > 1) or step back, keeping the point under (x, y) where it is. */
  zoomAt(factor: number, x: number, y: number): void {
    const s = this.pxPerCm;
    const next = clamp(s * factor, this.view.fitScale * 0.5, Math.max(this.view.fitScale * 40, 60));
    if (!this.planePoint(x, y, this.v0)) {
      this.setScale(next);
      this.placeCamera();
      return;
    }
    const px = this.v0.x, py = this.v0.y;
    this.setScale(next);
    this.placeCamera();
    if (this.planePoint(x, y, this.v1)) {
      this.view.x += px - this.v1.x;
      this.view.y += py - this.v1.y;
      this.placeCamera();
    }
  }

  /** Move the view so that what was under (x0, y0) is under (x1, y1). Canvas pixels. */
  drag(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.planePoint(x0, y0, this.v0) || !this.planePoint(x1, y1, this.v1)) return;
    this.view.x += this.v0.x - this.v1.x;
    this.view.y += this.v0.y - this.v1.y;
    this.placeCamera();
  }

  /**
   * The place in the khipu's layout under a point of the canvas: x along the
   * main cord and y down from it, in cm. null if the view does not reach it.
   */
  toKhipu(x: number, y: number): { x: number; y: number } | null {
    if (!this.planePoint(x, y, this.v0)) return null;
    return { x: this.v0.x, y: -this.v0.y };
  }

  private setScale(pxPerCm: number): void {
    this.view.distance = this.cssHeight / (2 * pxPerCm * Math.tan((FOV * Math.PI) / 360));
  }

  private placeCamera(): void {
    const { x, y, distance } = this.view;
    const camera = this.camera;
    camera.position.set(x, y + distance * Math.sin(PITCH), distance * Math.cos(PITCH));
    camera.lookAt(x, y, 0);
    camera.near = Math.max(0.1, distance * 0.02);
    camera.far = distance * 6 + 1000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** Where a point of the scene falls on the canvas, in CSS pixels. */
  private project(x: number, y: number, z: number, out: Vector3): Vector3 {
    out.set(x, y, z).project(this.camera);
    out.x = (out.x * 0.5 + 0.5) * this.cssWidth;
    out.y = (-out.y * 0.5 + 0.5) * this.cssHeight;
    return out;
  }

  /** The point of the plane the khipu hangs in (z = 0) under a point of the canvas. */
  private planePoint(x: number, y: number, out: Vector3): boolean {
    const camera = this.camera;
    out.set((x / this.cssWidth) * 2 - 1, -(y / this.cssHeight) * 2 + 1, 0.5).unproject(camera);
    const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
    const dz = out.z - oz;
    if (Math.abs(dz) < 1e-9) return false;
    const t = -oz / dz;
    if (!(t > 0)) return false;
    out.set(ox + (out.x - ox) * t, oy + (out.y - oy) * t, 0);
    return true;
  }

  dispose(): void {
    for (const part of [this.fallenLines, this.fallingLines, this.cordLines, this.knots, this.fallenGrains, this.flyingGrains]) {
      part.dispose();
    }
    for (const mesh of [this.paper, this.beam]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.renderer.dispose();
    // Browsers keep only so many WebGL contexts alive; hand this one back now rather than when it is collected.
    this.renderer.forceContextLoss();
  }
}

/** How a cord is drawn, from what its row records. */
function lookOf(cord: Cord): Look {
  const rgb = cord.rgb ?? UNRECORDED;
  let style: number = LineStyle.solid;
  if (!cord.length) style = LineStyle.dotted;
  else if (!cord.rgb) style = LineStyle.dashed;
  else if (cord.rgb2) style = cord.colorOperator === '-' ? LineStyle.barberPole : LineStyle.mottled;
  return {
    rgb,
    rgb2: cord.rgb2 ?? rgb,
    knot: mix(rgb, 0.5),
    alpha: cord.rgb ? 1 : 0.6,
    style,
    // a dark cord gets a pale rim so that it can be seen
    flags: cord.rgb && cord.lightness < 0.17 ? LINE_RIM : 0,
    width: cord.parent ? SUBSIDIARY_WIDTH : 1,
  };
}
