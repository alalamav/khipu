import type { ReactNode, Ref } from 'react';
import type { Coded, CordRowView, KhipuRecordView, LedgerView } from '../piece/views';
import { NotRecorded, Recorded, Swatch, fmt } from './bits';

const TITLE = 'mb-2 font-serif text-base text-ink-bright italic';
const SUBTITLE = 'ml-1.5 font-mono text-[11px] text-ink-dim not-italic';
const QUOTE = 'mt-2.5 font-serif text-[13px] leading-snug text-ink-bright italic';
const NOTE = 'mt-1.5 font-serif text-xs leading-snug text-ink-dim italic';

/** One field of a row. With `now`, the archive and the present stand side by side. */
function Row({ label, archive, now, lost }: { label: string; archive: ReactNode; now?: ReactNode; lost?: boolean }) {
  return (
    <tr className="border-t border-line align-top">
      <td className="w-[74px] py-[3px] pr-1.5 text-ink-dim">{label}</td>
      <td className="py-[3px] pr-1.5" colSpan={now === undefined ? 2 : 1}>
        {archive}
      </td>
      {now !== undefined && (
        <td className="w-[76px] py-[3px] text-ink-bright">
          <span className={lost ? 'lost' : undefined}>{now}</span>
        </td>
      )}
    </tr>
  );
}

/** A code from the database and the archive's word for it. */
function Term({ term }: { term: Coded | null }) {
  if (!term) return <NotRecorded />;
  return (
    <>
      <span className="inline-block min-w-5 text-ink-bright">{term.code}</span> {term.label}
    </>
  );
}

function KhipuRecord({ record }: { record: KhipuRecordView }) {
  return (
    <>
      <h3 className={TITLE}>
        {record.id}
        <small className={SUBTITLE}>the khipu record</small>
      </h3>
      <table className="w-full border-collapse">
        <tbody>
          <Row label="from" archive={<Recorded>{record.provenance}</Recorded>} />
          <Row label="found by" archive={<Recorded>{record.discoveredBy}</Recorded>} />
          <Row label="found on" archive={<Recorded>{record.discoveredOn}</Recorded>} />
          <Row label="held" archive={<Recorded>{record.held}</Recorded>} />
          <Row label="named" archive={<Recorded>{record.investigatorId}</Recorded>} />
          <Row label="cords" archive={fmt(record.cords)} />
          <Row label="knots" archive={fmt(record.knots)} />
          <Row label="sum" archive={fmt(record.value)} />
        </tbody>
      </table>
      {record.quote && <p className={QUOTE}>“{record.quote}”</p>}
      {record.note && <p className={NOTE}>{record.note}</p>}
      {!record.quote && !record.note && record.cords > 0 && (
        <p className={NOTE}>Move across the cords. This panel shows each cord’s row: what the archive says, and what is left.</p>
      )}
    </>
  );
}

function CordRow({ row }: { row: CordRowView }) {
  const { colour, voice } = row;
  return (
    <>
      <h3 className={TITLE}>
        cord {row.number}
        <small className={SUBTITLE}>
          of {fmt(row.total)} · {row.cordKind}
        </small>
      </h3>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.08em] text-ink-faint uppercase">
            <th />
            <th className="pb-1 font-normal">archive</th>
            <th className="pb-1 font-normal">now</th>
          </tr>
        </thead>
        <tbody>
          <Row
            label="length"
            archive={row.length.archive ? `${row.length.archive} cm` : <NotRecorded />}
            now={row.length.now}
            lost={row.length.lost}
          />
          <Row
            label="colour"
            archive={
              colour ? (
                <>
                  <Swatch rgb={colour.rgb} />
                  <span className="inline-block min-w-5 text-ink-bright">{colour.code}</span> {colour.name}
                  {colour.code2 && (
                    <>
                      <br />
                      {colour.operator} <Swatch rgb={colour.rgb2} />
                      {colour.code2}
                    </>
                  )}
                </>
              ) : (
                <NotRecorded />
              )
            }
          />
          <Row label="fiber" archive={<Term term={row.fiber} />} />
          <Row label="twist" archive={<Recorded>{row.twist}</Recorded>} />
          <Row label="attached" archive={<Term term={row.attachment} />} />
          <Row label="ends" archive={<Term term={row.ending.archive} />} now={row.ending.now} lost={row.ending.lost} />
          <Row
            label="knots"
            archive={row.knots.archive.length ? row.knots.archive.map((knot, i) => <div key={i}>{knot}</div>) : 'none'}
            now={row.knots.now}
            lost={row.knots.lost}
          />
          <Row label="value" archive={fmt(row.value.archive)} now={fmt(row.value.now)} lost={row.value.lost} />
        </tbody>
      </table>

      {voice && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-ink-dim">{voice.title}</p>
          {voice.lines.map((line, i) => (
            <p key={i} style={{ paddingLeft: 10 + 12 * line.level }}>
              {line.level > 0 && <span className="text-ink-faint">└ </span>}
              {line.text}
            </p>
          ))}
        </div>
      )}

      {row.definition && <p className={QUOTE}>“{row.definition}”</p>}
      {row.note && <p className={NOTE}>note: {row.note}</p>}
    </>
  );
}

/**
 * The ledger: the row of the cord under the hand, with what the archive says
 * beside what is left; or, before any cord is touched, the khipu's own record.
 */
export function Ledger({ ledger, ref }: { ledger: LedgerView | null; ref?: Ref<HTMLElement> }) {
  if (!ledger) return null;
  return (
    <aside
      ref={ref}
      aria-live="off"
      className="pointer-events-auto absolute right-3 bottom-2 left-3 h-[30vh] overflow-auto rounded-sm border border-line bg-ground-raised/85 px-4 pt-3.5 pb-3 font-mono text-[11.5px] leading-[1.45] backdrop-blur-sm desk:top-[18px] desk:right-[18px] desk:bottom-auto desk:left-auto desk:h-auto desk:max-h-[calc(100%-30px)] desk:w-[316px]"
    >
      {ledger.kind === 'khipu' ? <KhipuRecord record={ledger} /> : <CordRow row={ledger} />}
    </aside>
  );
}
