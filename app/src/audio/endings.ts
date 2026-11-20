/**
 * How a cord's sound ends, for the voices that play live.
 *
 * The string voice bakes its ending into the buffer it renders. The operator
 * and resonator voices are built from running audio nodes, so they are given
 * the same endings as a plan: which strands sound, how long each rings, and
 * whether the sound is cut off. The numbers match the string voice.
 */
import type { TerminationCode } from '../khipu';
import { UNPITCHED_DURATION, durationOf, ringTime, type CordSound } from './cordSound';

/** One sounding component of a cord. A plain cord has one; a ravelled one has four. */
export interface Strand {
  /** Frequency as a multiple of the cord's pitch. */
  ratio: number;
  level: number;
  /** Seconds to fall by 60 dB. */
  ring: number;
}

/** A burst of filtered noise: what stands in for whatever was not recorded. */
export interface Breath {
  level: number;
  centre: number;
  length: number;
}

export interface Ending {
  /** Seconds the whole sound lasts. */
  duration: number;
  strands: Strand[];
  /** The sound is cut off at `at` seconds, over `fade` seconds, with a crack. */
  stop: { at: number; fade: number; crack: number } | null;
  breaths: Breath[];
}

/**
 * The ending of a cord whose pitch is `f0` Hz (0: no pitch).
 *
 *   knotted     rings out
 *   broken      torn off, with a crack
 *   cut         a clean edge
 *   ravelled    the plies come apart into separate, drifting strands
 *   doubled     folded back on itself: the octave below joins
 *   canutito    wrapped in thread: damped and short
 *   unfinished  hardly decays at all, then just ends
 *   (null)      not recorded: barely there, under breath
 */
export function endingOf(sound: CordSound, f0: number, random: () => number): Ending {
  const term: TerminationCode | null = sound.termination;
  const t60 = ringTime(sound.lightness);
  const breaths: Breath[] = [];

  if (!f0) {
    // length not recorded: no pitch, only breath
    return {
      duration: UNPITCHED_DURATION,
      strands: [],
      stop: null,
      breaths: [{ level: 0.55, centre: 500 + 900 * random(), length: 1.1 }],
    };
  }

  const duration = durationOf(term, sound.lightness);
  let strands: Strand[] = [{ ratio: 1, level: 0.8, ring: t60 }];
  let stop: Ending['stop'] = null;

  switch (term) {
    case null:
      strands = [{ ratio: 1, level: 0.3, ring: t60 * 0.5 }];
      breaths.push({ level: 0.4, centre: f0 * 2, length: 1.2 });
      break;
    case 'TT':
      strands = [{ ratio: 1, level: 0.9, ring: 0.16 }];
      break;
    case 'U':
      strands = [{ ratio: 1, level: 0.6, ring: t60 * 5 }];
      stop = { at: 0.62 * duration, fade: 0.02, crack: 0 };
      break;
    case 'R':
      strands = [
        { ratio: 1, level: 0.5, ring: t60 },
        { ratio: 1.011, level: 0.34, ring: t60 * 0.9 },
        { ratio: 0.985, level: 0.34, ring: t60 * 0.8 },
        { ratio: 1.027, level: 0.22, ring: t60 * 0.7 },
      ];
      break;
    case 'D':
      strands = [
        { ratio: 1, level: 0.6, ring: t60 },
        { ratio: 0.5, level: 0.5, ring: t60 * 1.1 },
      ];
      break;
    case 'B':
      stop = { at: (0.36 + 0.2 * random()) * duration, fade: 0.008, crack: 0.5 };
      break;
    case 'C':
      stop = { at: 0.24 * duration, fade: 0.004, crack: 0.2 };
      break;
    case 'K':
      break;
  }

  // a worn cord carries noise in proportion to its wear
  if (sound.integrity < 1) {
    breaths.push({ level: 0.35 * (1 - Math.max(0, sound.integrity)), centre: 1200, length: Math.min(duration, 0.9) });
  }
  return { duration, strands, stop, breaths };
}
