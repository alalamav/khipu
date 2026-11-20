/**
 * How a cord's sound ends, for the voices that play live.
 *
 * The string voice bakes its ending into the buffer it renders. The operator
 * and resonator voices are built from running audio nodes, so they are given
 * the same endings as a plan: which strands sound, how long each rings, and
 * whether the sound is cut off. The numbers match the string voice.
 */
import type { TerminationCode } from '../khipu';
import { mulberry32 } from '../khipu/random';
import { breathOf, breathSeed, type Breath } from './breath';
import { durationOf, ringTime, unpitchedDuration, type CordSound } from './cordSound';

export type { Breath };

/** One sounding component of a cord. A plain cord has one; a ravelled one has four. */
export interface Strand {
  /** Frequency as a multiple of the cord's pitch. */
  ratio: number;
  level: number;
  /** Seconds to fall by 60 dB. */
  ring: number;
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
  /** What makes this cord's breath its own. Drawn apart from `random`, which the rest of the sound depends on. */
  const vary = mulberry32(breathSeed(sound.seed));

  if (!f0) {
    // length not recorded: no pitch, only breath, for as long as the cord swings
    const duration = unpitchedDuration(sound.lightness);
    return {
      duration,
      strands: [],
      stop: null,
      breaths: [breathOf(0.4, 500 + 900 * random(), duration, vary)],
    };
  }

  const duration = durationOf(term, sound.lightness);
  let strands: Strand[] = [{ ratio: 1, level: 0.8, ring: t60 }];
  let stop: Ending['stop'] = null;

  switch (term) {
    case null:
      strands = [{ ratio: 1, level: 0.3, ring: t60 * 0.5 }];
      breaths.push(breathOf(0.3, f0 * 2, duration, vary));
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
    // on a cord that stops, it has died away by then
    breaths.push(breathOf(0.28 * (1 - Math.max(0, sound.integrity)), 1200, stop ? stop.at : duration, vary));
  }
  return { duration, strands, stop, breaths };
}
