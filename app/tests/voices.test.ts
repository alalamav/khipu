/**
 * The mappings from a cord to a sound, as far as they can be checked without
 * making any sound: what each voice decides to play. How it then comes out of
 * the loudspeaker is measured in the browser by src/selftest.ts.
 */
import { describe, expect, it } from 'vitest';
import { breathCurve, breathEnvelope } from '../src/audio/breath';
import { cordFrequency, landingHarmonic, ringTime, soundOf, type CordSound } from '../src/audio/cordSound';
import { endingOf } from '../src/audio/endings';
import { MAX_MODULATORS, buildOperatorPatch, operatorsOf } from '../src/audio/operatorPatch';
import { MAX_RESONANCES, buildResonatorPatch, valueFrequency } from '../src/audio/resonatorPatch';
import { HangingKhipu, mulberry32, type CordData } from '../src/khipu';
import { cord, khipuOf, knot, recorder } from './fixtures';

function cordSound(over: Partial<CordSound> = {}): CordSound {
  return { length: 40, lightness: 0.5, termination: 'K', knots: [], pan: 0, integrity: 1, seed: 1, ...over };
}

describe('what all voices share', () => {
  it('pitches a cord by its length, as a string: 6600 / cm, folded by octaves into 65 to 1568 Hz', () => {
    expect(cordFrequency(30)).toBeCloseTo(220);
    expect(cordFrequency(60)).toBeCloseTo(110);
    expect(cordFrequency(300)).toBeCloseTo(88); // 22 Hz, two octaves up
    expect(cordFrequency(2)).toBeCloseTo(825); // 3300 Hz, two octaves down
    expect(cordFrequency(null)).toBe(0);
    expect(cordFrequency(0)).toBe(0);
  });

  it('rings pale cords longer than dark ones', () => {
    expect(ringTime(1)).toBeGreaterThan(ringTime(0));
    expect(ringTime(1)).toBeCloseTo(7.5);
  });

  it('ends a sound the way the cord ends', () => {
    const end = (termination: CordSound['termination']) => endingOf(cordSound({ termination }), 220, mulberry32(1));
    expect(end('K').stop).toBeNull();
    expect(end('B').stop?.crack).toBeGreaterThan(0); // torn off
    expect(end('C').stop?.fade).toBeLessThan(0.005); // a clean edge, but not a click
    expect(end('C').stop!.fade).toBeLessThan(end('B').stop!.fade);
    expect(end('R').strands).toHaveLength(4); // the plies come apart
    expect(end('D').strands.map((s) => s.ratio)).toEqual([1, 0.5]); // doubled over: the octave below
    expect(end('TT').strands[0].ring).toBeLessThan(0.2); // wrapped: damped
    expect(end('U').stop).toMatchObject({ crack: 0 }); // just ends
    expect(end(null).breaths.length).toBeGreaterThan(0); // not recorded: breath
  });

  it('gives a cord of unrecorded length no pitch, only breath', () => {
    const ending = endingOf(cordSound({ length: null }), 0, mulberry32(1));
    expect(ending.strands).toEqual([]);
    expect(ending.breaths).toHaveLength(1);
  });

  it('breathes for as long as the cord swings, coming up slowly and dying away to nothing', () => {
    const [breath] = endingOf(cordSound({ length: null, lightness: 1 }), 0, mulberry32(1)).breaths;
    expect(breath.length).toBeGreaterThan(0.84 * ringTime(1));
    expect(breath.length).toBeLessThanOrEqual(ringTime(1));
    expect(breath.attack).toBeGreaterThanOrEqual(0.15);
    expect(breathEnvelope(breath, 0)).toBe(0);
    expect(breathEnvelope(breath, 0.02)).toBeLessThan(0.05); // no puff at the start
    expect(breathEnvelope(breath, breath.length)).toBe(0);
    const curve = breathCurve(breath);
    expect(Math.max(...curve)).toBeGreaterThan(0.8);
    expect(curve.indexOf(Math.max(...curve)) / curve.length).toBeLessThan(0.1); // the fall is the long part
  });

  it('gives each cord a breath of its own, and the same cord the same breath', () => {
    const breathOfSeed = (seed: number) => endingOf(cordSound({ termination: null, seed }), 220, mulberry32(seed)).breaths[0];
    expect(breathOfSeed(5)).toEqual(breathOfSeed(5));
    const a = breathOfSeed(5);
    const b = breathOfSeed(6);
    expect([a.centre, a.q, a.length, a.offset]).not.toEqual([b.centre, b.q, b.length, b.offset]);
    for (const breath of [a, b]) {
      expect(breath.centre / 440).toBeGreaterThan(0.87);
      expect(breath.centre / 440).toBeLessThan(1.15);
    }
  });

  it('lets the breath of a worn cord die away by the time a broken cord stops', () => {
    const ending = endingOf(cordSound({ termination: 'B', integrity: 0.5 }), 220, mulberry32(1));
    expect(ending.breaths[0].length).toBeLessThanOrEqual(ending.stop!.at);
  });

  it('hears a parted cord as broken, whatever the archive says of its end', () => {
    // a dozen like cords, worn until each parts or falls whole; some will part
    const khipu = khipuOf(Array.from({ length: 12 }, (_, i) => cord({ position: i, length: 40, termination: 'K' })));
    const hanging = new HangingKhipu(khipu);
    expect(soundOf(hanging, khipu.cords[0]).termination).toBe('K');
    for (const c of khipu.cords) {
      while (!hanging.state(c).snapped && !hanging.state(c).gone) hanging.wear(c, 1, recorder());
    }
    const parted = khipu.cords.filter((c) => hanging.state(c).snapped && !hanging.state(c).gone);
    expect(parted.length).toBeGreaterThan(0);
    for (const c of parted) {
      const sound = soundOf(hanging, c);
      expect(sound.termination).toBe('B');
      expect(sound.length).toBeLessThan(40);
    }
  });
});

describe('operator voice: the cord among its relations', () => {
  // A pendant of 20 with the pendant before it in its group (60) and two subsidiaries;
  // the second subsidiary (60) has a subsidiary of its own, with no knots. Apart from them, a cord alone.
  const cords: CordData[] = [
    cord({ position: 1, length: 60, knots: [knot({ value: 60 })] }), // 0  neighbour
    cord({ position: 2, length: 30, knots: [knot({ value: 20 })] }), // 1  the touched cord: 220 Hz
    cord({ parent: 1, position: 3, length: 15, knots: [knot({ value: 5 })] }), // 2  first subsidiary
    cord({ parent: 1, position: 6, length: 15, knots: [knot({ value: 60 })] }), // 3  second subsidiary
    cord({ parent: 3, level: 3, position: 2, length: 10 }), // 4  its subsidiary
    cord({ position: 9, length: 44, group: 2 }), // 5  alone
  ];
  const khipu = khipuOf(cords);
  const touched = khipu.cords[1];

  it('makes the touched cord the carrier, at its string pitch', () => {
    expect(buildOperatorPatch(new HangingKhipu(khipu), touched, 1).frequency).toBeCloseTo(220);
  });

  it('leaves a cord with no relations a bare sine tone', () => {
    const patch = buildOperatorPatch(new HangingKhipu(khipu), khipu.cords[5], 1);
    expect(patch.frequency).toBeCloseTo(150);
    expect(patch.modulators).toEqual([]);
  });

  it('modulates a cord by the cord before it in its group and by its subsidiaries', () => {
    const patch = buildOperatorPatch(new HangingKhipu(khipu), touched, 1);
    expect(patch.modulators.map((m) => [m.kind, m.cord])).toEqual([
      ['neighbour', 0],
      ['subsidiary', 2],
      ['subsidiary', 3],
    ]);
  });

  it('stacks the subsidiaries of a subsidiary on it, but not its neighbours', () => {
    const [, first, second] = buildOperatorPatch(new HangingKhipu(khipu), touched, 1).modulators;
    expect(first.modulators).toEqual([]);
    // cord 3 hangs after cord 2 in the same group, yet only its own subsidiary modulates it
    expect(second.modulators.map((m) => [m.kind, m.cord])).toEqual([['subsidiary', 4]]);
  });

  it('tunes a modulator by the proportion of the two numbers, or failing that of the two lengths', () => {
    const [neighbour, first, second] = buildOperatorPatch(new HangingKhipu(khipu), touched, 1).modulators;
    expect(neighbour).toMatchObject({ ratio: 3, ratioOf: 'values' }); // 60 against 20
    expect(neighbour.frequency).toBeCloseTo(660);
    expect(first).toMatchObject({ ratio: 4, ratioOf: 'values' }); // 5 against 20: larger over smaller
    expect(first.frequency).toBeCloseTo(880);
    // cord 4 has no knots: 10 cm against the 15 cm of the cord it hangs from
    expect(second.modulators[0]).toMatchObject({ ratio: 1.5, ratioOf: 'lengths' });
    expect(second.modulators[0].frequency).toBeCloseTo(second.frequency * 1.5);
  });

  it('uses a proportion of 1 where neither numbers nor lengths can be compared', () => {
    const bare = khipuOf([cord({ length: 30 }), cord({ parent: 0, length: null })]);
    const [modulator] = buildOperatorPatch(new HangingKhipu(bare), bare.cords[0], 1).modulators;
    expect(modulator).toMatchObject({ ratio: 1, ratioOf: 'nothing' });
    expect(modulator.frequency).toBeCloseTo(220);
  });

  it('sets the depth by the kind of tie and by how much of the pair’s number the modulator carries', () => {
    const [neighbour, first, second] = buildOperatorPatch(new HangingKhipu(khipu), touched, 1).modulators;
    expect(neighbour.index).toBeCloseTo(0.9 * (0.4 + 0.6 * (60 / 80)));
    expect(first.index).toBeCloseTo(2.2 * (0.4 + 0.6 * (5 / 25)));
    expect(second.index).toBeCloseTo(2.2 * (0.4 + 0.6 * (60 / 80)));
    expect(second.modulators[0].index).toBeCloseTo(2.2 * 0.4); // carries nothing
  });

  it('scales every depth with the depth setting, down to bare sine tones at zero', () => {
    const hanging = new HangingKhipu(khipu);
    const one = buildOperatorPatch(hanging, touched, 1).modulators;
    const half = buildOperatorPatch(hanging, touched, 0.5).modulators;
    expect(half).toHaveLength(one.length);
    half.forEach((m, i) => expect(m.index).toBeCloseTo(one[i].index * 0.5));
    expect(buildOperatorPatch(hanging, touched, 0).modulators).toEqual([]);
  });

  it('reads what is still hanging: a worn cord modulates less, a fallen one not at all', () => {
    const hanging = new HangingKhipu(khipu);
    const leaf = khipu.cords[4]; // no knots, so the first touch already frays it
    hanging.wear(leaf, 0.2, recorder());
    const integrity = hanging.state(leaf).integrity;
    expect(integrity).toBeLessThan(1);
    const frayed = buildOperatorPatch(hanging, touched, 1).modulators[2].modulators[0];
    expect(frayed.index).toBeCloseTo(2.2 * 0.4 * integrity);

    const second = khipu.cords[3];
    for (let i = 0; i < 500 && !hanging.state(second).gone; i++) hanging.wear(second, 1, recorder());
    expect(hanging.state(second).gone).toBe(true);
    const patch = buildOperatorPatch(hanging, touched, 1);
    expect(patch.modulators.map((m) => m.cord)).toEqual([0, 2]);
    expect([...operatorsOf(patch)]).toHaveLength(2);
  });

  it('follows the numbers as knots fall', () => {
    const hanging = new HangingKhipu(khipu);
    const neighbour = khipu.cords[0];
    while (hanging.valueNow(neighbour) > 0) hanging.wear(neighbour, 1, recorder());
    expect(hanging.state(neighbour).gone).toBe(false);
    // the neighbour has lost its 60: nothing is left to compare but the lengths, 60 cm against 30
    const [modulator] = buildOperatorPatch(hanging, touched, 1).modulators;
    expect(modulator).toMatchObject({ cord: 0, ratio: 2, ratioOf: 'lengths' });
    expect(modulator.index).toBeCloseTo(0.9 * 0.4 * hanging.state(neighbour).integrity);
  });

  it('brings in at most six modulators, the nearest relations first', () => {
    const many: CordData[] = [cord({ length: 30 })];
    for (let i = 0; i < 8; i++) many.push(cord({ parent: 0, position: i + 1, length: 20 }));
    for (let i = 0; i < 8; i++) many.push(cord({ parent: i + 1, level: 3, position: 1, length: 10 }));
    const crowded = khipuOf(many);
    const patch = buildOperatorPatch(new HangingKhipu(crowded), crowded.cords[0], 1);
    const all = [...operatorsOf(patch)];
    expect(all).toHaveLength(MAX_MODULATORS);
    expect(patch.modulators.map((m) => m.cord)).toEqual([1, 2, 3, 4, 5, 6]); // none left for the level below
  });

  it('stacks three deep and no deeper', () => {
    const chain = khipuOf([
      cord({ length: 30 }),
      cord({ parent: 0, length: 20 }),
      cord({ parent: 1, level: 3, length: 20 }),
      cord({ parent: 2, level: 4, length: 20 }),
      cord({ parent: 3, level: 5, length: 20 }),
    ]);
    const patch = buildOperatorPatch(new HangingKhipu(chain), chain.cords[0], 1);
    expect([...operatorsOf(patch)].map((m) => m.cord)).toEqual([1, 2, 3]);
  });

  it('keeps modulators below 6 kHz and their sidebands below 18 kHz', () => {
    // a 4.3 cm cord sounds 1535 Hz; a subsidiary five times its number would modulate at 7674 Hz
    const high = khipuOf([cord({ length: 4.3, knots: [knot({ value: 10 })] }), cord({ parent: 0, knots: [knot({ value: 50 })] })]);
    const patch = buildOperatorPatch(new HangingKhipu(high), high.cords[0], 2);
    const [modulator] = patch.modulators;
    expect(modulator.ratio).toBe(5);
    expect(modulator.octavesDown).toBe(1);
    expect(modulator.frequency).toBeCloseTo((patch.frequency * 5) / 2); // what sounds is 2.5 times the cord, not 5
    expect(patch.frequency + (modulator.index + 1) * modulator.frequency).toBeLessThanOrEqual(18000 + 1e-6);
    expect(modulator.index).toBeLessThan(2.2 * 2 * (0.4 + 0.6 * (50 / 60))); // held back
  });
});

describe('resonator voice: the cord as its numbers', () => {
  it('tunes numbers like a slide rule: the digits across an octave, each power of ten an octave up', () => {
    expect(valueFrequency(1)).toBeCloseTo(110);
    expect(valueFrequency(10)).toBeCloseTo(220);
    expect(valueFrequency(100)).toBeCloseTo(440);
    expect(valueFrequency(1000)).toBeCloseTo(880);
    expect(valueFrequency(30) / valueFrequency(3)).toBeCloseTo(2);
    expect(valueFrequency(300) / valueFrequency(30)).toBeCloseTo(2);
    expect(valueFrequency(5)).toBeGreaterThan(valueFrequency(4));
    expect(valueFrequency(0)).toBe(0);
    expect(valueFrequency(1e9)).toBe(9000); // held under a ceiling
  });

  const twenty = knot({ position: 10, count: 2, value: 20, direction: 'S' });
  const five = knot({ position: 20, type: 'L', value: 5, direction: 'Z' });

  it('rings one resonance for each cluster of knots, at the pitch of its value', () => {
    const { resonances } = buildResonatorPatch(cordSound({ knots: [twenty, five] }), 1);
    expect(resonances.map((r) => r.value)).toEqual([20, 5]);
    expect(resonances[0].frequency).toBeCloseTo(valueFrequency(20));
    expect(resonances[1].frequency).toBeCloseTo(valueFrequency(5));
  });

  it('takes no account of the length of the cord', () => {
    const pitches = (length: number | null) =>
      buildResonatorPatch(cordSound({ length, knots: [twenty, five] }), 1).resonances.map((r) => r.frequency);
    expect(pitches(80)).toEqual(pitches(40));
    expect(pitches(null)).toEqual(pitches(40)); // a cord of unrecorded length still rings its numbers
  });

  it('strikes once for each single knot, and once for each turn of a long knot', () => {
    const [singles, long] = buildResonatorPatch(cordSound({ knots: [twenty, five] }), 1).resonances;
    expect(singles.strikes).toHaveLength(2);
    expect(singles.strikes[1].at - singles.strikes[0].at).toBeCloseTo(0.075);
    expect(long.strikes).toHaveLength(5);
    expect(long.strikes[1].at - long.strikes[0].at).toBeCloseTo(0.034);
    expect(long.strikes.at(-1)?.level).toBe(1); // the roll rises to its last turn
    expect(long.strikes[0].level).toBeLessThan(1);
  });

  it('makes a figure-eight knot two resonances that beat', () => {
    const eight = knot({ position: 5, type: 'E', value: 1 });
    const { resonances } = buildResonatorPatch(cordSound({ knots: [eight] }), 1);
    expect(resonances).toHaveLength(2);
    const beat = resonances[1].frequency - resonances[0].frequency;
    expect(beat).toBeGreaterThan(2);
    expect(beat).toBeLessThan(5);
    expect(resonances[0].level).toBeCloseTo(resonances[1].level);
  });

  it('reads the cord from the top: a knot further down is struck later', () => {
    const [first, second] = buildResonatorPatch(cordSound({ knots: [twenty, five] }), 1).resonances;
    expect(first.strikes[0].at).toBeCloseTo(0.05 + 0.45 * (10 / 40));
    expect(second.strikes[0].at).toBeCloseTo(0.05 + 0.45 * (20 / 40));
  });

  it('puts S knots to the left and Z knots to the right of where the cord hangs', () => {
    const [s, z] = buildResonatorPatch(cordSound({ pan: 0.5, knots: [twenty, five] }), 1).resonances;
    expect(s.pan).toBeCloseTo(0.3 - 0.4);
    expect(z.pan).toBeCloseTo(0.3 + 0.4);
  });

  it('rings for as long as the colour of the cord and the ring setting say', () => {
    const ring = (lightness: number, setting: number) =>
      buildResonatorPatch(cordSound({ lightness, knots: [twenty] }), setting).resonances[0].ring;
    expect(ring(0.5, 1)).toBeCloseTo(ringTime(0.5));
    expect(ring(0.5, 2)).toBeCloseTo(2 * ringTime(0.5));
    expect(ring(1, 1)).toBeGreaterThan(ring(0, 1));
  });

  it('splits every number of a ravelled cord into its drifting plies', () => {
    const { resonances } = buildResonatorPatch(cordSound({ termination: 'R', knots: [twenty] }), 1);
    expect(resonances).toHaveLength(4);
    expect(resonances.map((r) => r.frequency / valueFrequency(20))).toEqual([1, 1.011, 0.985, 1.027].map((x) => expect.closeTo(x)));
  });

  it('rings nothing for a cord with no knots', () => {
    const patch = buildResonatorPatch(cordSound(), 1);
    expect(patch.resonances).toEqual([]);
    expect(patch.tapHz).toBeGreaterThan(200);
  });

  it('rings at most twelve filters at once, and thins the plies before it drops a number', () => {
    // nine numbers on a ravelled cord ask for 36 filters
    const knots = Array.from({ length: 9 }, (_, i) => knot({ position: i + 1, value: (i + 1) * 10 }));
    const { resonances, clusters } = buildResonatorPatch(cordSound({ termination: 'R', knots }), 1);
    expect(resonances).toHaveLength(MAX_RESONANCES);
    expect(new Set(resonances.map((r) => r.value)).size).toBe(9); // every number still rings
    expect(clusters.map((c) => c.filters)).toEqual([2, 2, 2, 1, 1, 1, 1, 1, 1]);
    expect(clusters.every((c) => c.silent === null)).toBe(true);
  });

  it('says so when a cord carries more numbers than there are filters', () => {
    const knots = Array.from({ length: 14 }, (_, i) => knot({ position: i + 1, value: i + 1 }));
    const { resonances, clusters } = buildResonatorPatch(cordSound({ knots }), 1);
    expect(resonances.map((r) => r.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(clusters.map((c) => c.silent)).toEqual([...Array(12).fill(null), 'beyond the limit', 'beyond the limit']);
  });

  it('does not strike a knot after a cut cord has stopped', () => {
    // a cut cord lasts 0.9 s and stops at 0.24 of that: 0.216 s
    const early = knot({ position: 10, count: 2, value: 20 }); // struck at 0.1625 s and 0.2375 s
    const late = knot({ position: 20, value: 3 }); // would be struck at 0.275 s
    const { resonances, clusters } = buildResonatorPatch(cordSound({ termination: 'C', knots: [early, late] }), 1);
    expect(resonances.map((r) => r.value)).toEqual([20]);
    expect(resonances[0].strikes).toHaveLength(1);
    expect(clusters).toEqual([
      { value: 20, frequency: expect.closeTo(valueFrequency(20)), strikes: 1, filters: 1, silent: null },
      { value: 3, frequency: expect.closeTo(valueFrequency(3)), strikes: 0, filters: 0, silent: 'struck after the cord stops' },
    ]);
  });

  it('gives an account of every cluster of knots, ringing or not', () => {
    const unvalued = knot({ position: 5, value: 0 });
    const eight = knot({ position: 6, type: 'E', value: 1 });
    const { resonances, clusters } = buildResonatorPatch(cordSound({ knots: [unvalued, eight, twenty] }), 1);
    expect(resonances).toHaveLength(3);
    expect(clusters.map((c) => [c.value, c.strikes, c.filters, c.silent])).toEqual([
      [0, 0, 0, 'no value'],
      [1, 1, 2, null],
      [20, 2, 1, null],
    ]);
  });
});

describe('a cord landing', () => {
  it('knocks at a harmonic of the drone, from the sixth to the twelfth, whatever the cord and the drone', () => {
    for (const drone of [42, 55, 83.5]) {
      for (let cm = 0.5; cm < 420; cm *= 1.07) {
        const h = landingHarmonic(cm, 0.5, drone);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(6);
        expect(h).toBeLessThanOrEqual(12);
      }
    }
  });

  it('keeps the pitch of the cord, by octaves', () => {
    // a 30 cm cord is 220 Hz: its octave is the eighth harmonic of a 55 Hz drone
    expect(landingHarmonic(30, 0.5, 55)).toBe(8);
    // a 15 cm cord is the octave above, and lands on the same harmonic
    expect(landingHarmonic(15, 0.5, 55)).toBe(8);
    // a 40 cm cord is 165 Hz: the sixth
    expect(landingHarmonic(40, 0.5, 55)).toBe(6);
    // a piece that broke off is shorter than the cord was, and lands higher: 24 cm is 275 Hz, the tenth
    expect(landingHarmonic(24, 0.5, 55)).toBe(10);
  });

  it('lands lower the darker it is, when the cord was never measured', () => {
    expect(landingHarmonic(null, 0, 55)).toBe(6);
    expect(landingHarmonic(null, 0.5, 55)).toBe(9);
    expect(landingHarmonic(null, 1, 55)).toBe(11);
    expect(landingHarmonic(0, 0.2, 55)).toBe(7);
  });
});
