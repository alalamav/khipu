/**
 * How cords relate to one another inside a khipu.
 *
 * Two relationships are read straight from the record:
 *
 *   subsidiary — a cord tied onto another cord acts on the cord it hangs from;
 *   neighbour  — within a group, a cord acts on the cord hanging after it.
 *
 * A relation is directed: `from` acts on `to`. The operator voice turns each
 * one into a modulator (from) and the operator it modulates (to), but nothing
 * here knows about sound.
 */
import type { Cord } from './Khipu';

export type RelationKind = 'subsidiary' | 'neighbour';

export interface CordRelation {
  kind: RelationKind;
  from: Cord;
  to: Cord;
}

/** The cords that act directly on `cord`: the one before it in its group, then its subsidiaries. */
export function relationsInto(cord: Cord): CordRelation[] {
  const relations: CordRelation[] = [];
  const before = cord.previousInGroup;
  if (before) relations.push({ kind: 'neighbour', from: before, to: cord });
  for (const child of cord.children) relations.push({ kind: 'subsidiary', from: child, to: cord });
  return relations;
}

/**
 * The proportion between two quantities, always 1 or more: 3 for both 20:60
 * and 60:20. null when either is missing or zero, since nothing can then be
 * said about how they compare.
 */
export function proportion(a: number | null, b: number | null): number | null {
  if (!a || !b || !(a > 0) || !(b > 0)) return null;
  return a > b ? a / b : b / a;
}
