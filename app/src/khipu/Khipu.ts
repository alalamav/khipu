/**
 * A khipu as the archive records it.
 *
 * Khipu, Cord and Knot wrap one KhipuData file as a tree of objects that can
 * be walked in both directions. They are immutable: this is the record, and
 * the record does not change. What happens to a khipu while it is being read
 * lives in HangingKhipu.
 */
import type {
  AttachmentCode,
  BeginningCode,
  ColorCode,
  ColorDefinition,
  ColorOperatorCode,
  CordData,
  FiberCode,
  KhipuData,
  KnotData,
  KnotDirection,
  KnotTypeCode,
  TerminationCode,
  TwistCode,
} from './schema';

export type Rgb = readonly [number, number, number];
export type Palette = Readonly<Record<ColorCode, ColorDefinition>>;

/** Lightness assumed for a cord whose colour was not recorded. */
const UNRECORDED_LIGHTNESS = 0.4;

function lightnessOf(rgb: Rgb): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/** A cluster of like knots at one place on a cord. */
export class Knot {
  readonly cord: Cord;
  /** Place in the cord's list of knots, from the top. */
  readonly index: number;
  readonly position: number | null;
  readonly type: KnotTypeCode | null;
  readonly count: number;
  readonly value: number;
  readonly direction: KnotDirection | null;

  constructor(cord: Cord, index: number, data: KnotData) {
    this.cord = cord;
    this.index = index;
    this.position = data.position;
    this.type = data.type;
    this.count = data.count;
    this.value = data.value;
    this.direction = data.direction;
  }

  /** Long knots and their rarer relatives count units by their turns. */
  get isLong(): boolean {
    return this.type === 'L' || this.type === 'LL' || this.type === 'BL' || this.type === 'SP';
  }

  get isFigureEight(): boolean {
    return this.type === 'E' || this.type === 'EE';
  }

  /** What one knot of the cluster counts: 10, 100, … for single knots; the turns of a long knot. */
  get unitValue(): number {
    return this.count > 0 ? this.value / this.count : 0;
  }

  /** Turns of a long knot as it is drawn and sounded, kept between 2 and 11. */
  get turns(): number {
    return Math.max(2, Math.min(Math.round(this.unitValue) || 2, 11));
  }
}

export class Cord {
  readonly khipu: Khipu;
  /** Place in Khipu.cords. Parents come before their children. */
  readonly index: number;
  /** The cord this one hangs from; null when it hangs from the main cord. */
  readonly parent: Cord | null;
  /** Cords hanging from this one, in the archive's order. */
  readonly children: readonly Cord[];
  readonly knots: readonly Knot[];

  readonly level: number;
  readonly up: boolean;
  readonly position: number | null;
  readonly positionRecorded: boolean;
  readonly length: number | null;
  readonly color: ColorCode | null;
  readonly colorOperator: ColorOperatorCode | null;
  readonly color2: ColorCode | null;
  readonly termination: TerminationCode | null;
  readonly twist: TwistCode | null;
  readonly attachment: AttachmentCode | null;
  readonly fiber: FiberCode | null;
  readonly group: number | null;
  readonly note: string;

  /** The cord's colour as sRGB, when the archive names one. */
  readonly rgb: Rgb | null;
  readonly rgb2: Rgb | null;
  /** 0 (black) to 1 (white). */
  readonly lightness: number;
  /** Sum of the cord's knot values. */
  readonly value: number;
  /** Number of individual knots on the cord. */
  readonly knotCount: number;

  constructor(khipu: Khipu, index: number, data: CordData, parent: Cord | null, children: readonly Cord[], palette: Palette) {
    this.khipu = khipu;
    this.index = index;
    this.parent = parent;
    this.children = children;

    this.level = data.level;
    this.up = data.up;
    this.position = data.position;
    this.positionRecorded = data.positionRecorded;
    this.length = data.length;
    this.color = data.color;
    this.colorOperator = data.colorOperator;
    this.color2 = data.color2;
    this.termination = data.termination;
    this.twist = data.twist;
    this.attachment = data.attachment;
    this.fiber = data.fiber;
    this.group = data.group;
    this.note = data.note;

    this.rgb = (data.color !== null && palette[data.color]?.rgb) || null;
    this.rgb2 = (data.color2 !== null && palette[data.color2]?.rgb) || null;
    this.lightness = this.rgb ? lightnessOf(this.rgb) : UNRECORDED_LIGHTNESS;

    this.knots = data.knots.map((k, i) => new Knot(this, i, k));
    this.value = this.knots.reduce((sum, k) => sum + k.value, 0);
    this.knotCount = this.knots.reduce((sum, k) => sum + k.count, 0);
  }

  /** Hangs from the main cord: a pendant or a top cord. */
  get isPendant(): boolean {
    return this.parent === null;
  }

  /** Number of cords between this one and the main cord, plus one. */
  get depth(): number {
    let d = 1;
    for (let p = this.parent; p; p = p.parent) d++;
    return d;
  }

  /** "pendant", "top cord", or "subsidiary, level n". */
  get kind(): string {
    if (this.parent) return `subsidiary, level ${this.level}`;
    return this.up ? 'top cord' : 'pendant';
  }

  /** The cord hanging just before this one in the same group; null for the first of a group. */
  get previousInGroup(): Cord | null {
    return this.khipu.previousInGroup(this);
  }

  /** This cord and everything hanging from it, parents first. */
  *withDescendants(): Generator<Cord> {
    yield this;
    for (const child of this.children) yield* child.withDescendants();
  }
}

export interface PrimaryCord {
  readonly length: number | null;
  readonly color: ColorCode | null;
  readonly rgb: Rgb | null;
  readonly beginning: BeginningCode | null;
  readonly termination: TerminationCode | null;
  readonly notes: string;
}

/** Cords in the order they hang: by position, the unrecorded last, ties in the archive's order. */
function inHangingOrder(cords: readonly Cord[]): Cord[] {
  return cords.slice().sort((a, b) => {
    if (a.position === null || b.position === null) {
      return a.position === b.position ? 0 : a.position === null ? 1 : -1;
    }
    return a.position - b.position;
  });
}

export class Khipu {
  readonly id: string;
  /** The file this khipu was read from. */
  readonly data: KhipuData;
  readonly primary: PrimaryCord;
  /** Every cord. Parents come before their children. */
  readonly cords: readonly Cord[];
  /** Cords hanging from the main cord (pendants and top cords), in order along it. */
  readonly pendants: readonly Cord[];

  readonly cordCount: number;
  readonly knotCount: number;
  /** Sum of every knot value. */
  readonly totalValue: number;
  /** Share of the cords on the main cord whose position along it was recorded, 0 to 1. */
  readonly positionsRecorded: number;

  private readonly previous: (Cord | null)[];

  constructor(data: KhipuData, palette: Palette) {
    this.id = data.id;
    this.data = data;

    const pc = data.primaryCord;
    this.primary = {
      length: pc.length,
      color: pc.color,
      rgb: (pc.color !== null && palette[pc.color]?.rgb) || null,
      beginning: pc.beginning,
      termination: pc.termination,
      notes: pc.notes,
    };

    const childLists: Cord[][] = data.cords.map(() => []);
    const cords: Cord[] = [];
    data.cords.forEach((cordData, i) => {
      const parent = cordData.parent === null ? null : cords[cordData.parent];
      if (cordData.parent !== null && !parent) {
        throw new Error(`${data.id}: cord ${i} hangs from cord ${cordData.parent}, which does not come before it`);
      }
      const cord = new Cord(this, i, cordData, parent ?? null, childLists[i], palette);
      cords.push(cord);
      if (cordData.parent !== null) childLists[cordData.parent].push(cord);
    });
    this.cords = cords;
    this.pendants = inHangingOrder(cords.filter((c) => c.parent === null));

    this.cordCount = cords.length;
    this.knotCount = cords.reduce((sum, c) => sum + c.knotCount, 0);
    this.totalValue = cords.reduce((sum, c) => sum + c.value, 0);
    const recorded = this.pendants.filter((c) => c.positionRecorded).length;
    this.positionsRecorded = this.pendants.length ? recorded / this.pendants.length : 0;

    // Who hangs next to whom: within each run of cords that share a group.
    this.previous = cords.map(() => null);
    const link = (ordered: readonly Cord[]) => {
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1];
        const b = ordered[i];
        if (b.group !== null && a.group === b.group) this.previous[b.index] = a;
      }
    };
    link(this.pendants);
    for (const cord of cords) if (cord.children.length > 1) link(inHangingOrder(cord.children));
  }

  previousInGroup(cord: Cord): Cord | null {
    return this.previous[cord.index];
  }
}
