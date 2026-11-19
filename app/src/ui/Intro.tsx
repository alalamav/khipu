import type { ArchiveStats } from '../khipu';
import { Sheet, Stat } from './bits';

/** The first thing shown. It must be answered: the click is also what lets the browser make sound. */
export function Intro({ stats, onEnter }: { stats: ArchiveStats | null; onEnter: () => void }) {
  return (
    <Sheet label="Just Ends">
      <h2 className="mb-3 text-3xl text-ink-bright italic">Just Ends</h2>
      <p className="mb-4 border-y border-line pt-2.5 pb-3 font-mono text-[13px]">
        <span className="mr-1.5 text-ink-bright">U</span> unfinished: <q>not knotted; not broken; not cut... just ends</q>
        <span className="mt-0.5 block text-[11px] text-ink-faint">termination code, Open Khipu Repository</span>
      </p>
      <div className="space-y-3 text-[16.5px]">
        <p>
          A khipu is a record made of knotted cord, written and read with the hands. Nobody living can read the ones that
          survive.
        </p>
        <p>
          <Stat>{stats?.khipus}</Stat> of them have been measured and typed into a database: <Stat>{stats?.cords}</Stat> cords,{' '}
          <Stat>{stats?.knots}</Stat> knots, <Stat>{stats && (stats.cordMetres / 1000).toFixed(1)}</Stat> kilometres of thread
          turned into rows.
        </p>
        <p>
          This is an instrument that plays the rows. Each cord is a string as long as its measurement. Each knot rings where it
          was tied. Each cord ends the way the archive says it ended. Where the archive has no length or no ending for a cord, you
          hear breath.
        </p>
        <p>
          Reading is touch, and touch wears things out. Every pass of the hand loosens knots, until the main cord hangs empty
          and only the database is left.
        </p>
      </div>
      <button className="btn btn-primary mt-5 h-auto px-[22px] py-2.5 text-[15px]" onClick={onEnter} autoFocus>
        Enter with sound
      </button>
      <p className="mt-3.5 text-[13px] text-ink-dim">
        Move across the cords to sound them. Press <span className="text-ink">Read</span> to pass a hand along the whole khipu.
        Three voices read the same rows: as measured strings, as relationships between cords, as numbers.
      </p>
    </Sheet>
  );
}
