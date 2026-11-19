/**
 * A khipu while it is being read.
 *
 * Two states are kept side by side and never merged:
 *
 *   archive — what the database says: the Khipu. It does not change.
 *   now     — what is still hanging: this object. It only ever gets smaller.
 *
 * It also holds the one rule of the piece: touch wears things out. Each touch
 * may loosen each knot on a cord; a cord with no knots left begins to part.
 */
import type { Cord, Khipu, Knot } from './Khipu';
import { layoutKhipu, type KhipuLayout } from './layout';
import { mulberry32 } from './random';

export interface Totals {
  cords: number;
  knots: number;
  value: number;
}

/** What is left of one cord. */
export interface CordState {
  /** Present length in cm; null when the archive never recorded one. */
  length: number | null;
  /** Length that is still hanging, in the units the cord is drawn in. */
  hangingLength: number;
  /** 1 is sound; the cord parts when this reaches 0. */
  integrity: number;
  /** The cord is on the floor. */
  gone: boolean;
  /** The cord has parted once already and ends in a break. */
  snapped: boolean;
  /** Goes up every time anything about the cord changes. */
  version: number;
}

/** Told about each loss as it happens. */
export interface WearListener {
  /** A cluster of knots has let go. */
  knotFell(cord: Cord, knot: Knot): void;
  /** The cord has parted; `lost` cm of it are falling, the rest still hangs. */
  cordSnapped(cord: Cord, lost: number): void;
  /** The whole cord has come away. Called for a cord before the cords hanging from it. */
  cordFell(cord: Cord): void;
}

export class HangingKhipu {
  readonly khipu: Khipu;
  readonly layout: KhipuLayout;
  /** Totals the database gives. */
  readonly archive: Readonly<Totals>;
  /** Totals still hanging. */
  readonly now: Totals;
  /** Complete passes of the reading hand. */
  readings = 0;
  /** Touches so far. */
  touches = 0;

  private readonly states: CordState[];
  private readonly tied: boolean[][];
  private readonly random: () => number;

  constructor(khipu: Khipu, layout: KhipuLayout = layoutKhipu(khipu)) {
    this.khipu = khipu;
    this.layout = layout;
    this.archive = { cords: khipu.cordCount, knots: khipu.knotCount, value: khipu.totalValue };
    this.now = { ...this.archive };
    this.states = khipu.cords.map((c) => ({
      length: c.length,
      hangingLength: layout.cords[c.index].drawLength,
      integrity: 1,
      gone: false,
      snapped: false,
      version: 0,
    }));
    this.tied = khipu.cords.map((c) => c.knots.map(() => true));
    // Seeded by the khipu's number: the same touches wear a khipu the same way.
    this.random = mulberry32(parseInt(khipu.id.replace(/\D/g, ''), 10) || 1);
  }

  state(cord: Cord): Readonly<CordState> {
    return this.states[cord.index];
  }

  /** Whether a knot is still on its cord. */
  isTied(knot: Knot): boolean {
    return this.tied[knot.cord.index][knot.index];
  }

  /** The knots still on a cord. */
  tiedKnots(cord: Cord): Knot[] {
    const tied = this.tied[cord.index];
    return cord.knots.filter((k) => tied[k.index]);
  }

  /** Sum of the knot values still on a cord. */
  valueNow(cord: Cord): number {
    const tied = this.tied[cord.index];
    let sum = 0;
    for (const k of cord.knots) if (tied[k.index]) sum += k.value;
    return sum;
  }

  /** Nothing hangs from the main cord. */
  get isEmpty(): boolean {
    return this.now.cords <= 0;
  }

  /**
   * Touch a cord. `amount` runs from 0 (gloves: nothing is lost) to 1.
   * Returns without effect for a cord that has already fallen.
   */
  wear(cord: Cord, amount: number, listener: WearListener): void {
    const s = this.states[cord.index];
    if (s.gone || !(amount > 0)) return;
    const rnd = this.random;
    const tied = this.tied[cord.index];
    let left = 0;
    let changed = false;
    this.touches++;
    for (const k of cord.knots) {
      if (!tied[k.index]) continue;
      if (rnd() < amount * 0.5) {
        this.dropKnot(k, listener);
        changed = true;
      } else {
        left++;
      }
    }
    if (left === 0) {
      // nothing left to loosen: now the cord itself gives way
      s.integrity -= amount * (0.4 + 0.6 * rnd());
      changed = true;
      if (s.integrity <= 0) {
        if (s.hangingLength > 5 && rnd() < 0.5) {
          const before = s.hangingLength;
          const keep = before * (0.3 + 0.45 * rnd());
          s.hangingLength = keep;
          if (s.length) s.length = (s.length * keep) / before;
          s.snapped = true;
          s.integrity = 0.5;
          listener.cordSnapped(cord, before - keep);
          for (const child of cord.children) {
            if ((this.layout.cords[child.index].attachAt ?? 0) > keep) this.dropCord(child, listener);
          }
        } else {
          this.dropCord(cord, listener);
          return;
        }
      }
    }
    if (changed) s.version++;
  }

  private dropKnot(knot: Knot, listener: WearListener): void {
    this.tied[knot.cord.index][knot.index] = false;
    this.now.knots -= knot.count;
    this.now.value -= knot.value;
    listener.knotFell(knot.cord, knot);
  }

  private dropCord(cord: Cord, listener: WearListener): void {
    const s = this.states[cord.index];
    if (s.gone) return;
    const tied = this.tied[cord.index];
    for (const k of cord.knots) if (tied[k.index]) this.dropKnot(k, listener);
    s.gone = true;
    s.version++;
    this.now.cords--;
    listener.cordFell(cord);
    for (const child of cord.children) this.dropCord(child, listener);
  }
}
