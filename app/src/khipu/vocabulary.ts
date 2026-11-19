/**
 * The archive's own words.
 *
 * Labels and definitions are quoted from the database's dictionary tables
 * (termination_dc, fiber_dc, attachment_dc, knot_type_dc, color_operator_dc).
 * Five labels are not letter for letter what the tables have: "Spiral Knot"
 * and "double long " are tidied, "turfted knot" is spelt "tufted knot", and
 * the fibres W and V use the fuller wording of the tables' notes where the
 * labels say only "wool" and "vegetal".
 */
import type {
  AttachmentCode,
  ColorOperatorCode,
  FiberCode,
  KnotTypeCode,
  TerminationCode,
} from './schema';

export interface Term {
  label: string;
  definition: string;
}

export const TERMINATION: Readonly<Record<TerminationCode, Term>> = {
  K: { label: 'knotted', definition: 'cord ends with a knot near the bottom' },
  B: { label: 'broken', definition: 'cord has been broken' },
  C: { label: 'cut', definition: 'cord has been cut (sharper end than broken)' },
  R: { label: 'ravelled', definition: 'plies are coming apart' },
  D: { label: 'doubled', definition: 'end of cord is doubled over' },
  U: { label: 'unfinished', definition: 'not knotted; not broken; not cut... just ends' },
  TT: { label: 'canutito', definition: 'end of cord is wrapped with colored thread' },
};

export const FIBER: Readonly<Record<FiberCode, string>> = {
  A: 'alpaca',
  L: 'llama',
  CN: 'cotton',
  W: "wool (sheep's wool)",
  V: 'vegetal fiber, undetermined',
  CL: 'camelid: llama or alpaca',
  CC: 'cotton & camelid',
  CW: 'cotton & wool',
  H: 'human hair',
  AH: 'animal hair',
};

export const ATTACHMENT: Readonly<Record<AttachmentCode, string>> = {
  R: 'recto',
  V: 'verso',
  H: 'overhand knot',
};

export const KNOT_TYPE: Readonly<Record<KnotTypeCode, string>> = {
  S: 'single',
  L: 'long',
  E: 'figure eight',
  EE: 'double figure 8',
  LL: 'double long',
  BL: 'belted long knot',
  SP: 'spiral knot',
  TF: 'tufted knot',
};

/** Operators the database describes only as "special" have no entry. */
export const COLOR_OPERATOR: Readonly<Partial<Record<ColorOperatorCode, string>>> = {
  '-': 'barber pole',
  ':': 'mottled',
  '%': 'con elemento',
};
