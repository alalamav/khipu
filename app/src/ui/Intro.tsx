import type { ArchiveStats } from '../khipu';
import { Sheet, Stat } from './bits';

/** The first thing shown. It must be answered: the click is also what lets the browser make sound. */
export function Intro({ stats, onEnter }: { stats: ArchiveStats | null; onEnter: () => void }) {
  return (
    <Sheet label="Just Ends">
      <h2 className="mb-4 text-3xl text-ink-bright">Just Ends</h2>
      {/* <p className="mb-4 border-y border-line pt-2.5 pb-3 font-mono text-[13px]">
        <span className="mr-1.5 text-ink-bright">U</span> unfinished: <q>not knotted; not broken; not cut... just ends</q>
        <span className="mt-0.5 block text-[11px] text-ink-faint">termination code, Open Khipu Repository</span>
      </p> */}
      <div className="space-y-3 text-[16.5px]">
        <p>
          A khipu is an ancient Andean record made of knotted cord, tied and read tactilely and visually. Those that survive
          remain mostly undeciphered: we can calculate many of their numbers, but rarely their words and subjects.
        </p>
        <p>
          <Stat>{stats?.khipus}</Stat> khipus have been measured and typed into a database: <Stat>{stats?.cords}</Stat> cords,{' '}
          <Stat>{stats?.knots}</Stat> knots, <Stat>{stats && (stats.cordMetres / 1000).toFixed(1)}</Stat> kilometres of thread
          turned into rows.
        </p>
        <p>
          This is an instrument that plays those rows. Each cord sounds at its measured length; each knot rings where it was
          tied; each cord ends as the archive describes. Where length or ending is missing from the record, you hear breath.
        </p>
        <p>
          Touch reads, and touch erodes. With every pass, the knots loosen until the primary cord hangs bare and only the
          database remains.
        </p>
      </div>
      <button className="btn btn-primary mt-5 h-auto px-[22px] py-2.5 text-[15px]" onClick={onEnter} autoFocus>
        Enter with sound
      </button>
      <p className="mt-3.5 text-[13px] text-ink-dim">
        Move across the cords to sound them. Press <span className="text-ink">Read</span> to pass a hand along the whole khipu.
        Two voices read the same rows: as relationships between cords, and as numbers.
      </p>
    </Sheet>
  );
}
