/**
 * Cords as ropes.
 *
 * Each cord is a chain of particles joined by segments of fixed length
 * (position-based dynamics with Verlet integration). A chain is limp: it
 * swings when it is pushed, folds when it lands, and lies where it falls.
 *
 * Units are centimetres and seconds; y points up. The simulation knows
 * nothing about khipus or drawing. It is given ropes, told when one is
 * pushed, cut or let go, and asked where their points are.
 *
 * Ropes that have stopped moving are put to sleep and cost nothing until
 * something disturbs them, so a still khipu is free and a large one stays
 * cheap while it is read.
 */

/** Fixed time step, seconds. */
const STEP = 1 / 60;
/** At most this many steps are taken per call, however much time has passed. */
const MAX_STEPS = 4;
/** Passes over the length constraints per step: more is stiffer. */
const ITERATIONS = 8;
/** Two points one apart along a rope may not come closer than this share of their full spacing. */
const MIN_FOLD = 0.5;
/** Share of velocity kept per step: tied on, falling, and sliding on the floor. */
const DRAG_TIED = 0.985;
const DRAG_FREE = 0.996;
const FLOOR_GRIP = 0.45;
/**
 * The share of velocity a tied rope keeps per step, for its swing to die away to about a thirtieth
 * (3%) in `seconds`. Measured, not derived: the length constraints take a little motion out too, so a
 * rope comes to rest about 1.3 times sooner than its drag alone would have it. At 6 s this is DRAG_TIED.
 */
export function tiedDrag(seconds: number): number {
  return 1 - 0.09 / Math.max(0.5, seconds);
}

/** A rope moving less than this per step (cm) is still… */
const STILL = 0.0035;
/** …and after this many still steps it sleeps. */
const CALM_STEPS = 40;

/** A fixed place in space. */
export interface PointAnchor {
  rope: null;
  x: number;
  y: number;
  z: number;
}

/** A place on another rope, `arc` cm along it. */
export interface RopeAnchor {
  rope: Rope;
  arc: number;
}

export type Anchor = PointAnchor | RopeAnchor;

export class Rope {
  /** Number of points in use. Shrinks when the rope is cut. */
  n: number;
  /** Positions, xyz per point. */
  readonly p: Float32Array;
  /** Positions one step ago. */
  readonly q: Float32Array;
  /** rest[i] is the length of the segment from point i-1 to point i. */
  readonly rest: Float32Array;
  /**
   * 1 when the first segment is a rigid stand-off that holds the rope clear
   * of what it is tied to. Distances along the rope are measured from point
   * `lead`.
   */
  lead: 0 | 1 = 0;
  /** What the first point is tied to; null when the rope is loose. */
  anchor: Anchor | null = null;
  /** With an anchor: where point 1 is held, relative to point 0. */
  standoff: [number, number, number] | null = null;
  /** -1 while a rope that is drawn upward is still tied on. */
  gravity: 1 | -1 = 1;
  /** Share of velocity kept per step while the rope is tied on. See `tiedDrag`. */
  drag = DRAG_TIED;
  /** No longer hanging: falling, or lying on the floor. */
  free = false;
  awake = false;
  /** Lying still on the floor, for good. */
  settled = false;
  /** Ropes tied to this one. */
  readonly dependents: Rope[] = [];
  /** For the owner's use. */
  tag = -1;
  /** 1 for each point that has touched the floor since the rope came loose. */
  readonly touched: Uint8Array;
  /** How many of its points have touched the floor. */
  landed = 0;

  /** @internal */ calm = 0;

  /** `points` is xyz per point, in order from the tied end. */
  constructor(points: ArrayLike<number>) {
    this.n = Math.floor(points.length / 3);
    this.p = Float32Array.from(points);
    this.q = Float32Array.from(points);
    this.rest = new Float32Array(this.n);
    this.touched = new Uint8Array(this.n);
    for (let i = 1; i < this.n; i++) {
      this.rest[i] = Math.hypot(
        this.p[3 * i] - this.p[3 * i - 3],
        this.p[3 * i + 1] - this.p[3 * i - 2],
        this.p[3 * i + 2] - this.p[3 * i - 1],
      );
    }
  }

  /** Length from point `lead` to the end. */
  get length(): number {
    let sum = 0;
    for (let i = this.lead + 1; i < this.n; i++) sum += this.rest[i];
    return sum;
  }

  /**
   * The point `arc` cm along the rope, written to out[offset..offset+2]. With
   * `withTangent`, the unit direction of the rope there follows in the next
   * three slots.
   */
  sample(arc: number, out: Float32Array | number[], offset = 0, withTangent = false): void {
    const { p, rest, n, lead } = this;
    let i = lead + 1;
    let before = 0;
    while (i < n - 1 && before + rest[i] < arc) {
      before += rest[i];
      i++;
    }
    if (i >= n) i = n - 1;
    const a = 3 * (i - 1);
    const b = 3 * i;
    if (i <= lead) {
      // a rope of a single point
      out[offset] = p[3 * lead];
      out[offset + 1] = p[3 * lead + 1];
      out[offset + 2] = p[3 * lead + 2];
      if (withTangent) {
        out[offset + 3] = 0;
        out[offset + 4] = -1;
        out[offset + 5] = 0;
      }
      return;
    }
    const t = rest[i] > 1e-9 ? Math.max(0, Math.min(1, (arc - before) / rest[i])) : 0;
    out[offset] = p[a] + (p[b] - p[a]) * t;
    out[offset + 1] = p[a + 1] + (p[b + 1] - p[a + 1]) * t;
    out[offset + 2] = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
    if (withTangent) {
      const dx = p[b] - p[a];
      const dy = p[b + 1] - p[a + 1];
      const dz = p[b + 2] - p[a + 2];
      const d = Math.hypot(dx, dy, dz) || 1;
      out[offset + 3] = dx / d;
      out[offset + 4] = dy / d;
      out[offset + 5] = dz / d;
    }
  }
}

/**
 * The floor under the ropes: a grid of heights that rises where things come
 * to rest, so that what falls later lies on what fell before.
 */
export class Bed {
  readonly h: Float32Array;
  private readonly sx: number;
  private readonly sz: number;

  constructor(
    readonly x0: number,
    readonly x1: number,
    readonly z0: number,
    readonly z1: number,
    readonly nx: number,
    readonly nz: number,
  ) {
    this.h = new Float32Array(nx * nz);
    this.sx = (nx - 1) / (x1 - x0);
    this.sz = (nz - 1) / (z1 - z0);
  }

  /** Height of the heap at a place; 0 beyond the edges. */
  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) * this.sx;
    const fz = (z - this.z0) * this.sz;
    if (fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1) return 0;
    const ix = Math.min(this.nx - 2, Math.floor(fx));
    const iz = Math.min(this.nz - 2, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;
    const i = ix + iz * this.nx;
    const h = this.h;
    return (
      (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - tz) +
      (h[i + this.nx] * (1 - tx) + h[i + this.nx + 1] * tx) * tz
    );
  }

  /** Raise the heap at a place. */
  deposit(x: number, z: number, amount: number): void {
    const ix = Math.round((x - this.x0) * this.sx);
    const iz = Math.round((z - this.z0) * this.sz);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return;
    const i = ix + iz * this.nx;
    const h = this.h;
    h[i] += amount;
    const side = amount * 0.35;
    if (ix > 0) h[i - 1] += side;
    if (ix < this.nx - 1) h[i + 1] += side;
    if (iz > 0) h[i - this.nx] += side;
    if (iz < this.nz - 1) h[i + this.nx] += side;
  }

  clear(): void {
    this.h.fill(0);
  }
}

export class RopeSim {
  /** cm/s², downward. */
  gravity = 100;
  /** Height of the bare floor. */
  floorY = 0;
  /** Half the thickness of a rope: how far above the floor its points rest. */
  radius = 0.06;
  /** How much a rope raises the bed where it comes to rest, per point. */
  depositPerPoint = 0.05;
  bed: Bed | null = null;
  readonly ropes: Rope[] = [];
  /** Called when a loose rope comes to rest for good. */
  onSettle: ((rope: Rope) => void) | null = null;
  /**
   * Called the first time each point of a loose rope touches the floor: which point, and how
   * fast it was coming down (cm/s). `rope.landed` already counts it, so 1 means the rope has just arrived.
   */
  onTouchdown: ((rope: Rope, point: number, speed: number) => void) | null = null;

  private pending = 0;
  private awakeCount = 0;
  private readonly random: () => number;
  private readonly scratch = new Float32Array(3);
  /** How far down each point of the rope in hand set out to move this step, before anything stopped it. */
  private drop = new Float32Array(64);

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  add(rope: Rope): Rope {
    this.ropes.push(rope);
    if (rope.anchor?.rope) rope.anchor.rope.dependents.push(rope);
    if (rope.awake) this.awakeCount++;
    return rope;
  }

  /** Remove ropes for which `keep` is false. Their dependents should go with them. */
  prune(keep: (rope: Rope) => boolean): void {
    let w = 0;
    for (const rope of this.ropes) {
      if (keep(rope)) this.ropes[w++] = rope;
      else if (rope.awake) this.awakeCount--;
    }
    this.ropes.length = w;
  }

  clear(): void {
    this.ropes.length = 0;
    this.awakeCount = 0;
    this.pending = 0;
  }

  get anyAwake(): boolean {
    return this.awakeCount > 0;
  }

  /** Wake a rope and everything tied to it. */
  wake(rope: Rope): void {
    if (rope.settled) return;
    if (!rope.awake) {
      rope.awake = true;
      this.awakeCount++;
    }
    rope.calm = 0;
    for (const d of rope.dependents) this.wake(d);
  }

  /**
   * Push a rope: add velocity (cm/s) around the point `arc` cm along it,
   * falling away over `spread` cm.
   */
  kick(rope: Rope, arc: number, vx: number, vy: number, vz: number, spread: number): void {
    if (rope.settled) return;
    const first = rope.anchor ? (rope.standoff ? 2 : 1) : 0;
    let along = 0;
    for (let i = rope.lead + 1; i < rope.n; i++) {
      along += rope.rest[i];
      if (i < first) continue;
      const u = (along - arc) / spread;
      const w = Math.exp(-u * u) * STEP;
      rope.q[3 * i] -= vx * w;
      rope.q[3 * i + 1] -= vy * w;
      rope.q[3 * i + 2] -= vz * w;
    }
    this.wake(rope);
  }

  /**
   * Let a rope go. It falls with everything tied to it. `scatter` (cm/s)
   * gives its points small, different velocities so that it does not come
   * down as a straight line.
   */
  release(rope: Rope, scatter: number, driftX = 0, driftZ = 0): void {
    const anchor = rope.anchor;
    if (anchor?.rope) {
      const list = anchor.rope.dependents;
      const i = list.indexOf(rope);
      if (i >= 0) list.splice(i, 1);
    }
    rope.anchor = null;
    rope.standoff = null;
    this.markFree(rope);
    for (let i = 0; i < rope.n; i++) {
      rope.q[3 * i] -= (driftX + (this.random() - 0.5) * scatter) * STEP;
      rope.q[3 * i + 1] -= (this.random() - 0.5) * scatter * 0.3 * STEP;
      rope.q[3 * i + 2] -= (driftZ + (this.random() - 0.5) * scatter) * STEP;
    }
    this.wake(rope);
  }

  private markFree(rope: Rope): void {
    rope.free = true;
    rope.gravity = 1;
    for (const d of rope.dependents) this.markFree(d);
  }

  /**
   * Part a rope `arc` cm along it. The rope keeps what is above the cut; the
   * rest is returned as a new, loose rope (already added), carrying whatever
   * was tied on below the cut. null if there is nothing below `arc`.
   */
  cut(rope: Rope, arc: number): Rope | null {
    const { p, q, rest, lead } = rope;
    let i = lead + 1;
    let before = 0;
    while (i < rope.n && before + rest[i] < arc) {
      before += rest[i];
      i++;
    }
    if (i >= rope.n || arc <= 0) return null;
    const t = rest[i] > 1e-9 ? (arc - before) / rest[i] : 0;
    const a = 3 * (i - 1);
    const b = 3 * i;

    const below = rope.n - i;
    const points = new Float32Array(3 * (below + 1));
    const prev = new Float32Array(3 * (below + 1));
    for (let k = 0; k < 3; k++) {
      points[k] = p[a + k] + (p[b + k] - p[a + k]) * t;
      prev[k] = q[a + k] + (q[b + k] - q[a + k]) * t;
    }
    points.set(p.subarray(b, 3 * rope.n), 3);
    prev.set(q.subarray(b, 3 * rope.n), 3);
    const piece = new Rope(points);
    piece.q.set(prev);
    piece.rest[1] = (1 - t) * rest[i];
    for (let k = 2; k <= below; k++) piece.rest[k] = rest[i + k - 1];
    piece.free = true;
    piece.tag = rope.tag;

    // the rope now ends at the cut
    for (let k = 0; k < 3; k++) {
      p[b + k] = points[k];
      q[b + k] = prev[k];
    }
    rest[i] = t * rest[i];
    rope.n = i + 1;

    // what was tied on below the cut goes with the piece
    for (let d = rope.dependents.length - 1; d >= 0; d--) {
      const dep = rope.dependents[d];
      const at = dep.anchor;
      if (at?.rope === rope && at.arc > arc) {
        rope.dependents.splice(d, 1);
        dep.anchor = { rope: piece, arc: at.arc - arc };
        piece.dependents.push(dep);
        this.markFree(dep);
      }
    }

    this.ropes.push(piece);
    this.wake(piece);
    this.wake(rope);
    return piece;
  }

  /** Advance by `dt` seconds. Returns true if anything is still moving. */
  step(dt: number): boolean {
    this.pending = Math.min(this.pending + dt, STEP * MAX_STEPS);
    while (this.pending >= STEP) {
      this.pending -= STEP;
      if (this.awakeCount > 0) this.stepOnce();
    }
    return this.awakeCount > 0;
  }

  private stepOnce(): void {
    const fall = this.gravity * STEP * STEP;
    const floor = this.floorY + this.radius;
    const bed = this.bed;
    const s = this.scratch;

    for (const rope of this.ropes) {
      if (!rope.awake) continue;
      const { p, q, rest, n } = rope;

      // ---- what the rope is tied to --------------------------------
      let first = 0;
      const anchor = rope.anchor;
      if (anchor) {
        if (anchor.rope) {
          anchor.rope.sample(anchor.arc, s);
        } else {
          s[0] = anchor.x;
          s[1] = anchor.y;
          s[2] = anchor.z;
        }
        p[0] = q[0] = s[0];
        p[1] = q[1] = s[1];
        p[2] = q[2] = s[2];
        first = 1;
        if (rope.standoff && n > 1) {
          p[3] = q[3] = s[0] + rope.standoff[0];
          p[4] = q[4] = s[1] + rope.standoff[1];
          p[5] = q[5] = s[2] + rope.standoff[2];
          first = 2;
        }
      }

      // ---- move ---------------------------------------------------
      const drag = rope.free ? DRAG_FREE : rope.drag;
      const gy = -fall * rope.gravity;
      if (this.drop.length < n) this.drop = new Float32Array(n * 2);
      const drop = this.drop;
      for (let i = first; i < n; i++) {
        const k = 3 * i;
        const vx = (p[k] - q[k]) * drag;
        const vy = (p[k + 1] - q[k + 1]) * drag;
        const vz = (p[k + 2] - q[k + 2]) * drag;
        q[k] = p[k];
        q[k + 1] = p[k + 1];
        q[k + 2] = p[k + 2];
        p[k] += vx;
        p[k + 1] += vy + gy;
        drop[i] = -(vy + gy);
        p[k + 2] += vz;
      }

      // ---- keep its shape -----------------------------------------
      for (let it = 0; it < ITERATIONS; it++) {
        // every segment keeps its length
        for (let i = Math.max(1, first); i < n; i++) {
          const a = 3 * (i - 1);
          const b = 3 * i;
          const dx = p[b] - p[a];
          const dy = p[b + 1] - p[a + 1];
          const dz = p[b + 2] - p[a + 2];
          const d = Math.hypot(dx, dy, dz);
          if (d < 1e-9) continue;
          const diff = (d - rest[i]) / d;
          if (i - 1 < first) {
            // the upper point is held: only the lower one gives
            p[b] -= dx * diff;
            p[b + 1] -= dy * diff;
            p[b + 2] -= dz * diff;
          } else {
            const h = diff * 0.5;
            p[a] += dx * h;
            p[a + 1] += dy * h;
            p[a + 2] += dz * h;
            p[b] -= dx * h;
            p[b + 1] -= dy * h;
            p[b + 2] -= dz * h;
          }
        }
        // a rope does not fold flat on itself
        for (let i = Math.max(2, first); i < n; i++) {
          const a = 3 * (i - 2);
          const b = 3 * i;
          const least = MIN_FOLD * (rest[i - 1] + rest[i]);
          const dx = p[b] - p[a];
          const dy = p[b + 1] - p[a + 1];
          const dz = p[b + 2] - p[a + 2];
          const d = Math.hypot(dx, dy, dz);
          if (d >= least) continue;
          if (d < 1e-6) {
            // exactly folded: nudge it open in some direction
            p[b] += (this.random() - 0.5) * least * 0.2;
            p[b + 2] += (this.random() - 0.5) * least * 0.2;
            continue;
          }
          const diff = (d - least) / d;
          if (i - 2 < first) {
            p[b] -= dx * diff;
            p[b + 1] -= dy * diff;
            p[b + 2] -= dz * diff;
          } else {
            const h = diff * 0.5;
            p[a] += dx * h;
            p[a + 1] += dy * h;
            p[a + 2] += dz * h;
            p[b] -= dx * h;
            p[b + 1] -= dy * h;
            p[b + 2] -= dz * h;
          }
        }
        // nothing goes through the floor
        if (rope.free) {
          for (let i = first; i < n; i++) {
            const k = 3 * i;
            const ground = floor + (bed ? bed.heightAt(p[k], p[k + 2]) : 0);
            if (p[k + 1] < ground) p[k + 1] = ground;
          }
        }
      }

      // ---- what touches the floor stops falling and grips it ---------
      if (rope.free) {
        for (let i = first; i < n; i++) {
          const k = 3 * i;
          const ground = floor + (bed ? bed.heightAt(p[k], p[k + 2]) : 0);
          if (p[k + 1] <= ground + 1e-3) {
            if (!rope.touched[i]) {
              rope.touched[i] = 1;
              rope.landed++;
              // (the floor has already stopped it: its speed is what it set out with)
              this.onTouchdown?.(rope, i, Math.max(0, drop[i] / STEP));
            }
            q[k + 1] = p[k + 1];
            q[k] = p[k] - (p[k] - q[k]) * FLOOR_GRIP;
            q[k + 2] = p[k + 2] - (p[k + 2] - q[k + 2]) * FLOOR_GRIP;
          }
        }
      }

      // ---- has it stopped? ----------------------------------------
      let most = 0;
      for (let i = first; i < n; i++) {
        const k = 3 * i;
        const m = Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]);
        if (m > most) most = m;
      }
      rope.calm = most < STILL ? rope.calm + 1 : 0;
      const holder = rope.anchor?.rope;
      if (rope.calm > CALM_STEPS && (!holder || !holder.awake)) {
        rope.awake = false;
        this.awakeCount--;
        if (rope.free) this.settle(rope);
      }
    }
  }

  private settle(rope: Rope): void {
    rope.settled = true;
    if (this.bed) {
      for (let i = 0; i < rope.n; i++) this.bed.deposit(rope.p[3 * i], rope.p[3 * i + 2], this.depositPerPoint);
    }
    this.onSettle?.(rope);
  }
}
