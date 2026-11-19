/**
 * What every voice is given, and what they all agree on.
 *
 * A CordSound is one cord at the moment it is touched: the fields of its row
 * that can be heard, as they are now. The three voices read it differently
 * (string: measurements; operator: relationships; resonator: numbers) but
 * share the rules below, so that switching voice changes the reading and not
 * the cord.
 */
import type { Cord, HangingKhipu, KnotDirection, KnotTypeCode, TerminationCode } from '../khipu';

export type VoiceKind = 'string' | 'operator' | 'resonator';

export const VOICE_KINDS: readonly VoiceKind[] = ['string', 'operator', 'resonator'];

/** A cluster of knots still tied on the cord. `Knot` satisfies this. */
export interface KnotSound {
  position: number | null;
  type: KnotTypeCode | null;
  count: number;
  value: number;
  direction: KnotDirection | null;
}

export interface CordSound {
  /** Present length in cm. null: never recorded, so the cord has no pitch. */
  length: number | null;
  /** 0 (black) to 1 (white). */
  lightness: number;
  /** How the cord ends now. null: not recorded. */
  termination: TerminationCode | null;
  /** Knots still on the cord, from the top. */
  knots: readonly KnotSound[];
  /** Where the cord hangs along the main cord: -0.7 at its left end to 0.7 at its right. (-1 and 1 are hard left and right.) */
  pan: number;
  /** 1 is sound; a worn cord carries noise. */
  integrity: number;
  /** Makes the noise in a sound repeatable. */
  seed: number;
}

/** A cord as it sounds now: what is still tied on it, how long it still is, how it now ends. */
export function soundOf(hanging: HangingKhipu, cord: Cord): CordSound {
  const state = hanging.state(cord);
  const at = hanging.layout.cords[cord.index];
  return {
    length: state.length,
    lightness: cord.lightness,
    termination: state.snapped ? 'B' : cord.termination,
    knots: hanging.tiedKnots(cord),
    pan: (at.x / hanging.layout.width) * 1.4 - 0.7,
    integrity: state.integrity,
    seed: cord.index * 7919 + state.version * 13 + 1,
  };
}

/** Hz·cm. A cord is treated as a string: a 30 cm cord sounds 220 Hz. */
export const PITCH_K = 6600;
const F_MIN = 65;
const F_MAX = 1568;

/**
 * Pitch of a cord from its length, folded by octaves into 65–1568 Hz.
 * 0 when the length was not recorded: such a cord has no pitch.
 */
export function cordFrequency(lengthCm: number | null): number {
  if (!lengthCm || !(lengthCm > 0)) return 0;
  let f = PITCH_K / lengthCm;
  while (f < F_MIN) f *= 2;
  while (f > F_MAX) f /= 2;
  return f;
}

/** Seconds of sound for each way of ending; '' is "not recorded". */
export const DURATION: Readonly<Record<TerminationCode | '', number>> = {
  K: 2.4,
  B: 1.5,
  C: 0.9,
  R: 2.6,
  U: 1.7,
  D: 2.6,
  TT: 0.75,
  '': 1.4,
};

/** Seconds of sound for a cord with no pitch at all. */
export const UNPITCHED_DURATION = 1.2;

/** Seconds a cord of this lightness rings: pale cotton rings longer. */
export function ringTime(lightness: number): number {
  return 0.9 + 1.6 * lightness;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
