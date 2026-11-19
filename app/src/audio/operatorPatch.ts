/**
 * The operator voice: the khipu as a set of relationships.
 *
 * Every cord is a sine operator. The cord that is touched is the carrier, and
 * the only thing heard directly. It is frequency-modulated by the cords that
 * act on it in the record:
 *
 *   who modulates whom   the cords tied onto it (its subsidiaries, and theirs
 *                        in turn, stacked), and the cord hanging before it in
 *                        its group.
 *   tuning               the proportion between the two cords' numbers: a
 *                        cord carrying 60 modulates one carrying 20 at three
 *                        times its frequency. Simple proportions give harmonic
 *                        timbres, others give bell-like ones. Where either
 *                        cord carries no number (no knots, or knots the
 *                        archive gives no value), the proportion between
 *                        their lengths is used instead; where the lengths
 *                        cannot be compared either, 1. A modulator that would
 *                        sound above 6 kHz is lowered by octaves until it
 *                        does not, which halves its proportion each time.
 *   depth                the kind of tie (a subsidiary acts more strongly than
 *                        a neighbour), how much of the pair's number the
 *                        modulating cord carries, and how sound it still is.
 *
 * All of it is read from what is still hanging: a fallen cord modulates
 * nothing, and a cord left with no relations is a bare sine tone.
 *
 * This file only decides the patch. It is pure, so the mapping can be tested
 * and changed without touching audio code; OperatorVoice plays it.
 */
import { proportion, relationsInto, type Cord, type HangingKhipu, type RelationKind } from '../khipu';
import { clamp01, cordFrequency } from './cordSound';

/** Most modulators one touch may bring in, over all levels. */
export const MAX_MODULATORS = 6;
/** Deepest stack: a subsidiary of a subsidiary of a subsidiary. */
const MAX_LEVEL = 3;
/** Modulation index of each kind of tie at full strength, before `depth`. */
const INDEX: Readonly<Record<RelationKind, number>> = { subsidiary: 2.2, neighbour: 0.9 };
/** Modulators are folded down by octaves until they are below this. */
const MAX_MODULATOR_HZ = 6000;
/** Sidebands that matter are kept below this, so they do not fold back as aliases. */
const CEILING_HZ = 18000;
/** Below this a modulator cannot be heard and is left out. */
const MIN_INDEX = 0.01;

export interface Operator {
  /** Index of the cord this operator stands for. */
  cord: number;
  kind: RelationKind;
  /** Proportion between this cord and the one it modulates, as the record gives it; 1 when nothing relates them. */
  ratio: number;
  /** What the proportion was taken between. */
  ratioOf: 'values' | 'lengths' | 'nothing';
  /**
   * Octaves the modulator was lowered by to stay under MAX_MODULATOR_HZ. The
   * proportion that sounds is `ratio` halved this many times.
   */
  octavesDown: number;
  /** Hz, as it sounds: after any lowering. */
  frequency: number;
  /** Modulation index at the moment of touch. */
  index: number;
  /** Operators that modulate this one in turn. */
  modulators: Operator[];
}

export interface OperatorPatch {
  /** Carrier frequency in Hz; 0 when the cord has no pitch. */
  frequency: number;
  modulators: Operator[];
}

/**
 * The patch for touching `cord` now. `depth` scales every modulation index:
 * 0 leaves bare sine tones, 1 is the default.
 */
export function buildOperatorPatch(hanging: HangingKhipu, cord: Cord, depth: number): OperatorPatch {
  const frequency = cordFrequency(hanging.state(cord).length);
  if (!frequency || !(depth > 0)) return { frequency, modulators: [] };
  const budget = { left: MAX_MODULATORS };
  return { frequency, modulators: modulatorsOf(hanging, cord, frequency, depth, 1, budget) };
}

function modulatorsOf(
  hanging: HangingKhipu,
  target: Cord,
  targetHz: number,
  depth: number,
  level: number,
  budget: { left: number },
): Operator[] {
  const found: { op: Operator; cord: Cord }[] = [];
  const targetState = hanging.state(target);
  const targetValue = hanging.valueNow(target);

  for (const relation of relationsInto(target)) {
    if (budget.left <= 0) break;
    // Only the touched cord hears its neighbour; a modulator's own neighbours are left out.
    if (relation.kind === 'neighbour' && level > 1) continue;
    const from = relation.from;
    const state = hanging.state(from);
    if (state.gone) continue;

    const value = hanging.valueNow(from);
    let ratio = proportion(value, targetValue);
    let ratioOf: Operator['ratioOf'] = 'values';
    if (ratio === null) {
      ratio = proportion(state.length, targetState.length);
      ratioOf = 'lengths';
    }
    if (ratio === null) {
      ratio = 1;
      ratioOf = 'nothing';
    }
    let frequency = targetHz * ratio;
    let octavesDown = 0;
    while (frequency > MAX_MODULATOR_HZ) {
      frequency /= 2;
      octavesDown++;
    }

    const share = value > 0 ? value / (value + targetValue) : 0;
    let index = INDEX[relation.kind] * depth * (0.4 + 0.6 * share) * clamp01(state.integrity);
    index = Math.min(index, Math.max(0, (CEILING_HZ - targetHz) / frequency - 1));
    if (index < MIN_INDEX) continue;

    budget.left--;
    found.push({
      cord: from,
      op: { cord: from.index, kind: relation.kind, ratio, ratioOf, octavesDown, frequency, index, modulators: [] },
    });
  }

  // One level at a time, so a deep chain cannot use up what its siblings need.
  if (level < MAX_LEVEL) {
    for (const { op, cord } of found) {
      if (budget.left <= 0) break;
      if (op.kind === 'subsidiary') op.modulators = modulatorsOf(hanging, cord, op.frequency, depth, level + 1, budget);
    }
  }
  return found.map((f) => f.op);
}

/** Every operator in a patch, modulators before the operators that modulate them in turn. */
export function* operatorsOf(patch: OperatorPatch): Generator<Operator> {
  function* walk(list: Operator[]): Generator<Operator> {
    for (const op of list) {
      yield op;
      yield* walk(op.modulators);
    }
  }
  yield* walk(patch.modulators);
}
