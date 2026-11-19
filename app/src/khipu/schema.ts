/**
 * The khipu data model, schema version 2.
 *
 * These interfaces describe the JSON files under public/data, which
 * tools/build_data.py writes from the Open Khipu Repository database. The two
 * must be changed together, and SCHEMA_VERSION bumped when they are.
 *
 * Two rules hold everywhere:
 *
 *   - null means "the archive did not record this". The database's several
 *     markers for unknown never reach this model: the empty string anywhere,
 *     'U' for twist, attachment and knot direction, 'X' for fibre. (The same
 *     letters are real codes elsewhere and are kept: a termination 'U' is
 *     "unfinished", a main-cord beginning 'X' is "affixed to other cord".)
 *   - Lengths and positions are centimetres, as measured.
 *
 * The model is a projection of the database, not all of it. Among what is
 * not carried: cord thickness (recorded for about one cord in ten), twist
 * angle, colour changes along a cord after the first span and third colours,
 * a knot's axis orientation, the database's own classification of cords and
 * of groups, museum numbers, and the recorders' login names.
 */

export const SCHEMA_VERSION = 2;

// ───────────────────────── codes ─────────────────────────
// Each set is the corresponding dictionary table of the database.

/** How a cord ends (termination_dc). */
export type TerminationCode = 'K' | 'B' | 'C' | 'R' | 'D' | 'U' | 'TT';

/** Direction in which a cord is spun and plied. */
export type TwistCode = 'S' | 'Z';

/** How a cord is looped onto the cord it hangs from (attachment_dc). */
export type AttachmentCode = 'R' | 'V' | 'H';

/** Fibre (fiber_dc). */
export type FiberCode = 'A' | 'L' | 'CN' | 'W' | 'V' | 'CL' | 'CC' | 'CW' | 'H' | 'AH';

/** Kind of knot (knot_type_dc). */
export type KnotTypeCode = 'S' | 'L' | 'E' | 'EE' | 'LL' | 'BL' | 'SP' | 'TF';

/** Direction in which a knot is tied. */
export type KnotDirection = 'S' | 'Z';

/** How two colours are combined in one cord (color_operator_dc). */
export type ColorOperatorCode = '-' | ':' | '*' | '**' | '*_' | '%';

/** How the main cord begins (beginning_dc). */
export type BeginningCode = 'B' | 'D' | 'K' | 'NB' | 'WB' | 'X' | 'T' | 'TL' | 'R';

/** A colour code from the archive's colour chart, e.g. 'AB'. See ArchiveIndex.colors. */
export type ColorCode = string;

// ───────────────────────── one khipu ─────────────────────────

/** A cluster of like knots at one place on a cord. */
export interface KnotData {
  /** Distance from the top of the cord. */
  position: number | null;
  type: KnotTypeCode | null;
  /** How many knots are in the cluster. */
  count: number;
  /**
   * What the cluster counts in the decimal reading (Locke 1912): single
   * knots are tens, hundreds, … by their place on the cord; a long knot is
   * 2 to 9 by its turns; a figure-eight knot is 1.
   */
  value: number;
  direction: KnotDirection | null;
}

export interface CordData {
  /**
   * Index, in KhipuData.cords, of the cord this one hangs from; null when it
   * hangs from the main cord. A parent always comes before its children.
   */
  parent: number | null;
  /**
   * Level as recorded: 1 for a pendant, 2 for its subsidiary, and so on.
   * A few cords name a parent the archive does not contain; they keep their
   * recorded level and hang from the main cord (parent is null).
   */
  level: number;
  /**
   * The cord leaves the main cord upward: a top cord, or a subsidiary of one.
   * This is the sign of the database's CORD_LEVEL, which marks 154 top cords.
   * The database's CORD_CLASSIFICATION marks 249; the 95 it marks whose level
   * is positive hang down here. Which of the two is right is not known.
   */
  up: boolean;
  /**
   * Where the cord is attached: along the main cord for a cord hanging from
   * it, along its parent otherwise.
   */
  position: number | null;
  /**
   * False when the archive has no position for this cord. For a cord on the
   * main cord, `position` is then an estimate made by the build tool so that
   * the cord can be drawn; it is not a measurement.
   */
  positionRecorded: boolean;
  length: number | null;
  /** Colour of the cord where it starts. */
  color: ColorCode | null;
  colorOperator: ColorOperatorCode | null;
  color2: ColorCode | null;
  termination: TerminationCode | null;
  twist: TwistCode | null;
  attachment: AttachmentCode | null;
  fiber: FiberCode | null;
  /**
   * Ordinal of the cord group this cord belongs to on the cord it hangs
   * from. Groups are runs of cords set apart by spacing.
   */
  group: number | null;
  knots: KnotData[];
  /** The recorder's note on this cord; empty when there is none. */
  note: string;
}

export interface PrimaryCordData {
  length: number | null;
  color: ColorCode | null;
  beginning: BeginningCode | null;
  termination: TerminationCode | null;
  notes: string;
}

export interface CollectionData {
  name: string | null;
  city: string | null;
  country: string | null;
}

export interface KhipuData {
  schema: number;
  /** Open Khipu Repository number, e.g. 'KH0279'. */
  id: string;
  /** Earlier names, built from investigators' initials, e.g. 'UR049'. */
  investigatorId: string;
  provenance: string | null;
  discoveredBy: string | null;
  discoveredOn: string | null;
  collection: CollectionData;
  notes: string;
  primaryCord: PrimaryCordData;
  cords: CordData[];
}

// ───────────────────────── the archive ─────────────────────────

/** One line of the catalogue. */
export interface KhipuSummary {
  id: string;
  investigatorId: string;
  provenance: string | null;
  collection: string | null;
  country: string | null;
  cords: number;
  knots: number;
  /** Sum of every knot value on the khipu. */
  value: number;
  /** Share of cords recorded as broken, 0 to 1. */
  brokenShare: number;
  /** Share of per-cord fields the archive left empty, 0 to 1. */
  unrecordedShare: number;
  longestCord: number;
}

export interface ColorDefinition {
  /** sRGB, 0 to 255. */
  rgb: [number, number, number];
  name: string;
}

/** A count per code, with what was not recorded under 'notRecorded'. */
export type Tally<Code extends string> = Partial<Record<Code | 'notRecorded', number>>;

export interface ArchiveStats {
  khipus: number;
  cords: number;
  knots: number;
  /** Total recorded cord length, metres. */
  cordMetres: number;
  khipusWithoutProvenance: number;
  khipusWithoutDiscoverer: number;
  khipusWithoutDate: number;
  khipusWithoutCords: number;
  cordsWithoutKnots: number;
  /** Cords for which each field is empty. */
  notRecorded: {
    termination: number;
    twist: number;
    attachment: number;
    fiber: number;
    length: number;
    colour: number;
  };
  terminations: Tally<TerminationCode>;
  knotTypes: Tally<KnotTypeCode>;
  knotDirections: Tally<KnotDirection>;
  /** Khipus by the country that holds them. */
  countries: Record<string, number>;
  /** Khipus by collection: the fifteen collections that hold the most, largest first. */
  collections: Record<string, number>;
}

export interface ArchiveIndex {
  schema: number;
  /** Citation for the data. */
  source: string;
  stats: ArchiveStats;
  colors: Record<ColorCode, ColorDefinition>;
  khipus: KhipuSummary[];
}
