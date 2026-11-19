import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/khipu';
import { Bed, Rope, RopeSim } from '../src/stage/RopeSim';

const STEP = 1 / 60;

/** A rope of `segments` segments hanging straight down from (x, 0, 0). */
function hanging(x: number, length: number, segments: number): Rope {
  const points: number[] = [];
  for (let i = 0; i <= segments; i++) points.push(x, (-length * i) / segments, 0);
  const rope = new Rope(points);
  rope.anchor = { rope: null, x, y: 0, z: 0 };
  return rope;
}

function sim(): RopeSim {
  const s = new RopeSim(mulberry32(11));
  s.gravity = 100;
  s.floorY = -70;
  s.bed = new Bed(-10, 90, -15, 15, 120, 16);
  return s;
}

function run(s: RopeSim, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) s.step(STEP);
}

/** Largest relative error in segment length. */
function stretch(rope: Rope): number {
  let worst = 0;
  for (let i = 1; i < rope.n; i++) {
    const d = Math.hypot(
      rope.p[3 * i] - rope.p[3 * i - 3],
      rope.p[3 * i + 1] - rope.p[3 * i - 2],
      rope.p[3 * i + 2] - rope.p[3 * i - 1],
    );
    if (rope.rest[i] > 1e-6) worst = Math.max(worst, Math.abs(d - rest(rope, i)) / rest(rope, i));
  }
  return worst;
}
const rest = (rope: Rope, i: number) => rope.rest[i];

describe('a hanging rope', () => {
  it('costs nothing while nobody touches it', () => {
    const s = sim();
    s.add(hanging(10, 40, 16));
    expect(s.anyAwake).toBe(false);
    expect(s.step(1)).toBe(false);
  });

  it('swings when pushed, keeps its length, and comes back to rest below its anchor', () => {
    const s = sim();
    const rope = s.add(hanging(10, 40, 16));
    s.kick(rope, 20, 30, 0, 6, 12);
    expect(rope.awake).toBe(true);

    let farthest = 0;
    let worst = 0;
    for (let t = 0; t < 1.5; t += STEP) {
      s.step(STEP);
      for (let i = 0; i < rope.n; i++) farthest = Math.max(farthest, Math.abs(rope.p[3 * i] - 10));
      worst = Math.max(worst, stretch(rope));
    }
    expect(farthest).toBeGreaterThan(1); // it visibly moved
    expect(worst).toBeLessThan(0.06); // and did not stretch like elastic
    // the top never leaves its anchor
    expect([rope.p[0], rope.p[1], rope.p[2]]).toEqual([10, 0, 0]);

    run(s, 30);
    expect(rope.awake).toBe(false);
    const end = 3 * (rope.n - 1);
    expect(Math.abs(rope.p[end] - 10)).toBeLessThan(0.3);
    expect(rope.p[end + 1]).toBeCloseTo(-40, 0);
  });
});

describe('a rope that is let go', () => {
  it('falls, lies on the floor without passing through it, and is not rigid', () => {
    const s = sim();
    const rope = s.add(hanging(40, 50, 20));
    let settled = 0;
    s.onSettle = () => settled++;
    s.release(rope, 8, 3, 2);
    expect(rope.free).toBe(true);

    // part-way down it is already no longer a straight line
    run(s, 1.2);
    let midFlight = 0;
    for (let i = 1; i < rope.n - 1; i++) {
      const k = 3 * i;
      // distance of this point from the straight line between the two ends, in x and z
      const t = i / (rope.n - 1);
      const lx = rope.p[0] + (rope.p[3 * (rope.n - 1)] - rope.p[0]) * t;
      const lz = rope.p[2] + (rope.p[3 * (rope.n - 1) + 2] - rope.p[2]) * t;
      midFlight = Math.max(midFlight, Math.hypot(rope.p[k] - lx, rope.p[k + 2] - lz));
    }
    expect(midFlight).toBeGreaterThan(0.05);

    run(s, 20);
    expect(rope.settled).toBe(true);
    expect(settled).toBe(1);
    expect(s.anyAwake).toBe(false);

    const floor = s.floorY + s.radius;
    let lowest = Infinity, highest = -Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < rope.n; i++) {
      lowest = Math.min(lowest, rope.p[3 * i + 1]);
      highest = Math.max(highest, rope.p[3 * i + 1]);
      minX = Math.min(minX, rope.p[3 * i]); maxX = Math.max(maxX, rope.p[3 * i]);
      minZ = Math.min(minZ, rope.p[3 * i + 2]); maxZ = Math.max(maxZ, rope.p[3 * i + 2]);
    }
    expect(lowest).toBeGreaterThanOrEqual(floor - 1e-3);
    expect(highest).toBeLessThan(floor + 1); // all of it is down
    expect(stretch(rope)).toBeLessThan(0.08);
    // It lies folded: it covers some ground, but far less than its 50 cm laid straight.
    const spread = Math.hypot(maxX - minX, maxZ - minZ);
    expect(spread).toBeGreaterThan(2);
    expect(spread).toBeLessThan(40);
    // and it raised the bed where it lies: under every one of its own points
    let leastRaised = Infinity;
    for (let i = 0; i < rope.n; i++) {
      leastRaised = Math.min(leastRaised, s.bed!.heightAt(rope.p[3 * i], rope.p[3 * i + 2]));
    }
    expect(leastRaised).toBeGreaterThan(0);
    expect(Math.max(...s.bed!.h)).toBeGreaterThan(0);
  });

  it('carries what is tied to it', () => {
    const s = sim();
    const parent = s.add(hanging(40, 50, 20));
    const child = new Rope([40, -20, 0, 40.4, -20.5, 0.1, 40.4, -30, 0.1, 40.4, -40, 0.1]);
    child.lead = 1;
    child.anchor = { rope: parent, arc: 20 };
    child.standoff = [0.4, -0.5, 0.1];
    s.add(child);
    expect(parent.dependents).toContain(child);

    s.release(parent, 5);
    expect(child.free).toBe(true);
    expect(child.awake).toBe(true);
    run(s, 0.8);
    // still tied on: the child's first point is where the parent's 20 cm mark is
    const at = [0, 0, 0];
    parent.sample(20, at);
    expect(child.p[0]).toBeCloseTo(at[0], 3);
    expect(child.p[1]).toBeCloseTo(at[1], 3);
    expect(child.p[1]).toBeLessThan(-22); // and it has fallen with it
    run(s, 25);
    expect(parent.settled && child.settled).toBe(true);
  });
});

describe('cutting a rope', () => {
  it('keeps the upper part hanging and lets the rest fall, with nothing lost', () => {
    const s = sim();
    const rope = s.add(hanging(20, 40, 16));
    const above = new Rope([20, -5, 0, 20.3, -5.4, 0, 20.3, -15, 0]);
    above.lead = 1; above.anchor = { rope, arc: 5 }; above.standoff = [0.3, -0.4, 0];
    const below = new Rope([20, -30, 0, 20.3, -30.4, 0, 20.3, -38, 0]);
    below.lead = 1; below.anchor = { rope, arc: 30 }; below.standoff = [0.3, -0.4, 0];
    s.add(above); s.add(below);

    const piece = s.cut(rope, 17.3)!;
    expect(piece).not.toBeNull();
    expect(rope.length).toBeCloseTo(17.3, 4);
    expect(piece.length).toBeCloseTo(40 - 17.3, 4);
    expect(piece.free).toBe(true);
    expect(rope.free).toBe(false);
    // the two ends meet at the cut
    expect(piece.p[1]).toBeCloseTo(-17.3, 4);
    expect(rope.p[3 * (rope.n - 1) + 1]).toBeCloseTo(-17.3, 4);
    // what was tied below the cut goes with the piece, re-measured from the cut
    expect(piece.dependents).toEqual([below]);
    expect(rope.dependents).toEqual([above]);
    expect(below.anchor).toEqual({ rope: piece, arc: 30 - 17.3 });
    expect(below.free).toBe(true);
    expect(above.free).toBe(false);

    run(s, 25);
    expect(piece.settled).toBe(true);
    expect(below.settled).toBe(true);
    expect(rope.settled).toBe(false);
    expect(rope.p[3 * (rope.n - 1) + 1]).toBeGreaterThan(-18.5); // still hanging from the top
    expect(s.cut(rope, 99)).toBeNull();
  });
});

describe('the bed', () => {
  it('rises where things are put and is flat beyond its edges', () => {
    const bed = new Bed(0, 10, -5, 5, 11, 11);
    expect(bed.heightAt(5, 0)).toBe(0);
    bed.deposit(5, 0, 1);
    expect(bed.heightAt(5, 0)).toBeCloseTo(1, 5);
    expect(bed.heightAt(6, 0)).toBeCloseTo(0.35, 5);
    expect(bed.heightAt(5.5, 0)).toBeCloseTo(0.675, 5);
    expect(bed.heightAt(-1, 0)).toBe(0);
    expect(bed.heightAt(5, 9)).toBe(0);
    bed.clear();
    expect(bed.heightAt(5, 0)).toBe(0);
  });

  it('holds later ropes up on earlier ones', () => {
    const s = sim();
    // a mound 3 cm high and wider than the rope will spread
    for (let x = 30; x <= 50; x += 0.4) for (let z = -8; z <= 8; z += 1) s.bed!.deposit(x, z, 0.6);
    expect(s.bed!.heightAt(40, 0)).toBeGreaterThan(2);
    const rope = s.add(hanging(40, 30, 12));
    s.release(rope, 4);
    run(s, 25);
    expect(rope.settled).toBe(true);
    let highest = -Infinity;
    for (let i = 0; i < rope.n; i++) highest = Math.max(highest, rope.p[3 * i + 1]);
    expect(highest).toBeGreaterThan(s.floorY + s.radius + 1);
  });
});
