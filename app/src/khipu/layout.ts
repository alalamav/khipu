/**
 * Where each cord hangs.
 *
 * The layout is a flat schematic in centimetres, in the proportions the
 * archive recorded: x runs along the main cord, y runs down from it. It is
 * the khipu at rest and untouched. What the cords do when they are plucked or
 * fall is the stage's business, which starts from these positions.
 */
import type { Cord, Khipu } from './Khipu';

export interface CordLayout {
  /** x of the hanging part of the cord. */
  x: number;
  /** y at which the hanging part starts (0 for a cord on the main cord). */
  top: number;
  /** 1 hangs down; -1 is drawn upward (top cords and their subsidiaries). */
  dir: 1 | -1;
  /** Where the cord is tied on: a point on the main cord, or on its parent. */
  attachX: number;
  attachY: number;
  /** Distance along the parent at which the cord is tied; null on the main cord. */
  attachAt: number | null;
  /**
   * Length the cord is drawn at: its recorded length, or the khipu's median
   * cord length when none was recorded.
   */
  drawLength: number;
}

export interface KhipuLayout {
  /** One entry per cord, indexed like Khipu.cords. */
  cords: readonly CordLayout[];
  /** Extent along the main cord. */
  width: number;
  /** Highest and lowest points reached by any cord (y, down positive). */
  minY: number;
  maxY: number;
  /** Median recorded cord length; stands in for lengths that were not recorded. */
  nominalLength: number;
  /** Typical spacing between neighbouring pendants. */
  pitch: number;
  /** Every cord, ordered by x. */
  byX: readonly Cord[];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function layoutKhipu(khipu: Khipu): KhipuLayout {
  const lengths: number[] = [];
  for (const c of khipu.cords) if (c.length) lengths.push(c.length);
  const nominalLength = median(lengths) || 20;

  const gaps: number[] = [];
  for (let i = 1; i < khipu.pendants.length; i++) {
    const gap = (khipu.pendants[i].position ?? 0) - (khipu.pendants[i - 1].position ?? 0);
    if (gap > 0) gaps.push(gap);
  }
  const pitch = Math.max(0.15, Math.min(0.9, median(gaps) || 0.5));

  const cords: CordLayout[] = [];
  let minY = 0;
  let maxY = 0;
  let maxX = 0;
  for (const c of khipu.cords) {
    // parents always precede children, so a parent's layout is ready here
    const drawLength = c.length || nominalLength;
    let at: CordLayout;
    if (!c.parent) {
      const x = c.position ?? 0;
      at = { x, top: 0, dir: c.up ? -1 : 1, attachX: x, attachY: 0, attachAt: null, drawLength };
    } else {
      const p = cords[c.parent.index];
      const attachAt = c.position !== null ? Math.min(c.position, p.drawLength) : p.drawLength * 0.3;
      // Subsidiaries stand off to the side of their parent so they can be told apart.
      const off = pitch * 0.3 * (1 + (c.parent.children.indexOf(c) % 6));
      const attachY = p.top + p.dir * attachAt;
      at = {
        x: p.x + off,
        top: attachY + p.dir * off * 1.3,
        dir: p.dir,
        attachX: p.x,
        attachY,
        attachAt,
        drawLength,
      };
    }
    cords.push(at);
    const end = at.top + at.dir * drawLength;
    if (end < minY) minY = end;
    if (end > maxY) maxY = end;
    if (at.top < minY) minY = at.top;
    if (at.x > maxX) maxX = at.x;
  }

  const width = Math.max(khipu.primary.length || 0, maxX + 1, 4);
  const byX = khipu.cords.slice().sort((a, b) => cords[a.index].x - cords[b.index].x);
  return { cords, width, minY, maxY, nominalLength, pitch, byX };
}
