/**
 * The resonator voice: the khipu as numbers.
 *
 * A cord is struck, and what rings is a bank of resonant filters tuned by the
 * values knotted on it. The length of the cord plays no part in the pitch.
 *
 *   knot value     one resonance per cluster of knots, tuned like a slide
 *                  rule: the digits 1 to 9 are spread across one octave by
 *                  their logarithm, and each power of ten is an octave
 *                  higher. 3, 30 and 300 are the same note in three octaves,
 *                  as the same knots count different amounts by their place
 *                  on the cord. A cord reading 253 is the chord 200 + 50 + 3.
 *                  A ravelled or doubled cord rings each number on each of
 *                  its strands. One touch rings at most twelve filters, and
 *                  they are shared out so that every number has one before
 *                  any has a second: strands are thinned, numbers are not.
 *   knot count     single knots strike their resonance once each (nine
 *                  times at most); a long knot of n turns is a roll of n
 *                  strikes (two to eleven); a figure-eight knot is a pair of
 *                  resonances beating against each other.
 *   position       when the knot is struck: the cord is read from the top.
 *   direction      S to the left, Z to the right.
 *   colour         how long the resonances ring.
 *   termination    how the sound ends, as in the other voices. A knot
 *                  that would be struck after a broken, cut or unfinished
 *                  cord has stopped is not struck.
 *   no knots       no resonance: only the dull tap of the strike.
 *
 * Equal numbers sound the same wherever they are in the archive.
 *
 * This file only decides the patch (pure); ResonatorVoice plays it.
 */
import { mulberry32 } from '../khipu';
import type { CordSound } from './cordSound';
import { endingOf, type Ending } from './endings';

/** The resonance of the value 1, in Hz. 10 is an octave above, 100 two. */
export const UNIT_HZ = 110;
/** Most resonances one touch may ring. */
export const MAX_RESONANCES = 12;

// Limits for the scale. Nothing in the archive reaches either: its values run from 1 (110 Hz) to 300,000 (4900 Hz).
const MIN_HZ = 40;
const MAX_HZ = 9000;

/** Frequency of a knot value on the slide-rule scale; 0 for no value. */
export function valueFrequency(value: number): number {
  if (!(value > 0)) return 0;
  return Math.min(MAX_HZ, Math.max(MIN_HZ, UNIT_HZ * Math.pow(2, Math.log10(value))));
}

export interface Strike {
  /** Seconds after the cord is touched. */
  at: number;
  /** 0 to 1. */
  level: number;
}

export interface Resonance {
  /** The knot value this resonance stands for. */
  value: number;
  frequency: number;
  /** Seconds to fall by 60 dB. */
  ring: number;
  /** Share of the voice's level, relative to the other resonances. */
  level: number;
  pan: number;
  strikes: Strike[];
}

/** What became of one cluster of knots: the ledger reads these. */
export interface ClusterSound {
  value: number;
  /** Hz on the slide-rule scale; 0 when the archive gives the cluster no value. */
  frequency: number;
  /** Strikes that are heard. */
  strikes: number;
  /** Filters that ring for it: more than one on a ravelled or doubled cord, and for a figure-eight knot. */
  filters: number;
  /** Why nothing rings for it, when nothing does. */
  silent: 'no value' | 'struck after the cord stops' | 'beyond the limit' | null;
}

export interface ResonatorPatch {
  resonances: Resonance[];
  /** One for each cluster of knots still on the cord, from the top. */
  clusters: ClusterSound[];
  /** Centre frequency of the dry tap that every touch makes. */
  tapHz: number;
  ending: Ending;
}

/**
 * The patch for a cord as it is now. `ring` scales how long the resonances
 * ring: 1 is the default.
 */
export function buildResonatorPatch(sound: CordSound, ring: number): ResonatorPatch {
  const random = mulberry32(sound.seed || 1);
  // Pitch here comes from the knots, never from the cord's length, so the
  // ending is asked for as if the cord had a pitch whether or not its length
  // was recorded. The frequency passed only places the breath of an
  // unrecorded termination.
  const ending = endingOf(sound, 2 * UNIT_HZ, random);
  const length = sound.length || 0;
  // A cord that stops (broken, cut, unfinished) is not heard after it has stopped, and no sound outlasts its length.
  const heardUntil = ending.stop ? ending.stop.at : ending.duration;

  const clusters: ClusterSound[] = [];
  /** For each cluster that will ring, the filters it asks for: its plain resonance first. */
  const asked: { cluster: ClusterSound; filters: Resonance[] }[] = [];

  for (const knot of sound.knots) {
    const frequency = valueFrequency(knot.value);
    const cluster: ClusterSound = { value: knot.value, frequency, strikes: 0, filters: 0, silent: null };
    clusters.push(cluster);
    if (!frequency) {
      cluster.silent = 'no value';
      continue;
    }
    const p = knot.position;
    const along = p && length ? Math.min(1, p / length) : random();
    const t0 = 0.05 + 0.45 * along; // read from the top of the cord downward
    const turn = knot.direction === 'Z' ? 0.4 : knot.direction === 'S' ? -0.4 : 0;
    const pan = Math.max(-1, Math.min(1, 0.6 * sound.pan + turn));
    const unit = knot.count > 0 ? knot.value / knot.count : 0;

    const struck: Strike[] = [];
    const frequencies = [frequency];
    if (knot.type === 'L' || knot.type === 'LL' || knot.type === 'BL' || knot.type === 'SP') {
      // a roll, one strike for each turn of the knot, rising to the last
      const turns = Math.max(2, Math.min(Math.round(unit) || 2, 11));
      for (let j = 0; j < turns; j++) struck.push({ at: t0 + j * 0.034, level: j === turns - 1 ? 1 : 0.55 + 0.04 * j });
    } else if (knot.type === 'E' || knot.type === 'EE') {
      struck.push({ at: t0, level: 1 });
      frequencies.push(frequency * 1.012 + 2);
    } else {
      const count = Math.max(1, Math.min(knot.count || 1, 9));
      for (let j = 0; j < count; j++) struck.push({ at: t0 + j * 0.075, level: 1 });
    }
    const strikes = struck.filter((strike) => strike.at < heardUntil);
    cluster.strikes = strikes.length;
    if (!strikes.length) {
      cluster.silent = 'struck after the cord stops';
      continue;
    }

    const filters: Resonance[] = [];
    for (const strand of ending.strands) {
      for (const f of frequencies) {
        filters.push({
          value: knot.value,
          frequency: f * strand.ratio,
          ring: strand.ring * ring,
          level: strand.level / frequencies.length,
          pan,
          strikes,
        });
      }
    }
    asked.push({ cluster, filters });
  }

  // Share the filters out a round at a time: every number gets its first before any gets a second.
  // On a ravelled cord with many knots it is the strands that are thinned, never the numbers.
  const resonances: Resonance[] = [];
  for (let round = 0, more = true; more && resonances.length < MAX_RESONANCES; round++) {
    more = false;
    for (const { cluster, filters } of asked) {
      if (round >= filters.length || resonances.length >= MAX_RESONANCES) continue;
      resonances.push(filters[round]);
      cluster.filters++;
      more = true;
    }
  }
  for (const { cluster } of asked) if (!cluster.filters) cluster.silent = 'beyond the limit';

  return { resonances, clusters, tapHz: 220 + 520 * Math.max(0, Math.min(1, sound.lightness)), ending };
}
