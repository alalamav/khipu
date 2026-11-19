import type { TallyView } from '../piece/views';
import { fmt } from './bits';

function Count({ label, now, archive }: { label: string; now: number; archive: number }) {
  return (
    <span>
      {label} <span className={now < archive ? 'lost text-ink-bright' : 'text-ink'}>{fmt(now)}</span> of {fmt(archive)}
    </span>
  );
}

/** What is still hanging, against what the archive says. */
export function Tally({ tally }: { tally: TallyView | null }) {
  if (!tally) return null;
  const [cordsNow, cords] = tally.cords;
  const [knotsNow, knots] = tally.knots;
  const [valueNow, value] = tally.value;
  return (
    <p className="font-mono text-[10.5px] text-ink-dim desk:text-[11.5px]">
      <Count label="cords" now={cordsNow} archive={cords} /> · <Count label="knots" now={knotsNow} archive={knots} /> ·{' '}
      <Count label="sum" now={valueNow} archive={value} /> · read {tally.readings}×
      {tally.reties > 0 && ` · re-tied ${tally.reties}×`}
      {tally.debug && ` · ${tally.debug}`}
    </p>
  );
}
