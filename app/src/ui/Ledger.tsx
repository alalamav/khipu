import { useId, type ReactNode, type Ref } from 'react';
import type { Coded, CordRowView, KhipuRecordView, LedgerView } from '../piece/views';
import { NotRecorded, Recorded, Swatch, fmt } from './bits';

/** Under the khipu, the strip above already says what this is: the title is for the ledger beside it. */
const TITLE = 'mb-2 font-serif text-base text-ink-bright max-desk:hidden';
const SUBTITLE = 'ml-1.5 font-mono text-[11px] text-ink-dim';
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

function KhipuRecord({ record, facts }: { record: KhipuRecordView; facts: readonly string[] }) {
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
      {/* On a small screen the header leaves these out; they are kept here. */}
      {facts.length > 0 && <p className={NOTE + ' not-italic sm:hidden'}>{facts.join(' · ')}</p>}
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

      {/* {row.definition && <p className={QUOTE}>“{row.definition}”</p>} */}
      {row.note && <p className={NOTE}>note: {row.note}</p>}
    </>
  );
}

/** The ledger in one line, for a small screen: which row this is, and for a cord what is left of it. */
function Summary({ ledger }: { ledger: LedgerView }) {
  if (ledger.kind === 'khipu') {
    return (
      <span className="min-w-0 flex-1 truncate">
        <span className="text-ink-bright">{ledger.id}</span> <span className="text-ink-dim">· the khipu record</span>
      </span>
    );
  }
  return (
    <>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-ink-bright">cord {ledger.number}</span>{' '}
        <span className="text-ink-dim">
          of {fmt(ledger.total)} · {ledger.cordKind}
        </span>
      </span>
      <span className="shrink-0 text-ink-dim">
        <span className={'text-ink-bright' + (ledger.length.lost ? ' lost' : '')}>{ledger.length.now}</span> · value{' '}
        <span className={'text-ink-bright' + (ledger.value.lost ? ' lost' : '')}>{fmt(ledger.value.now)}</span>
      </span>
    </>
  );
}

/**
 * The ledger: the row of the cord under the hand, with what the archive says
 * beside what is left; or, before any cord is touched, the khipu's own record.
 *
 * Beside the khipu, on a wide window, it is always open. Under it, on a small
 * screen, it is one line until it is opened, so the room goes to the khipu.
 */
export function Ledger({
  ledger,
  facts = [],
  open,
  onToggle,
  ref,
}: {
  ledger: LedgerView | null;
  /** The header's statements about the khipu, which a small screen shows here instead. */
  facts?: readonly string[];
  /** Opened by the visitor. Only a small screen asks: a wide one shows the whole ledger regardless. */
  open: boolean;
  onToggle: () => void;
  ref?: Ref<HTMLElement>;
}) {
  const bodyId = useId();
  if (!ledger) return null;
  return (
    <aside
      ref={ref}
      aria-live="off"
      className={
        'pointer-events-auto absolute right-3 bottom-2 left-3 flex flex-col overflow-hidden rounded-sm border border-line bg-ground-raised/85 font-mono text-[11.5px] leading-[1.45] backdrop-blur-sm desk:top-[18px] desk:right-[18px] desk:bottom-auto desk:left-auto desk:max-h-[calc(100%-30px)] desk:w-[316px]' +
        // A fixed height while open, so the khipu is not placed again for every cord the hand crosses.
        (open ? ' max-desk:h-[40vh]' : '')
      }
    >
      <button
        className="flex w-full shrink-0 cursor-pointer items-center gap-3 px-3.5 py-2 text-left hover:bg-white/5 desk:hidden"
        aria-expanded={open}
        aria-controls={bodyId}
        title={open ? 'Close the ledger' : 'Open the ledger: the whole row, archive beside now'}
        onClick={onToggle}
      >
        <Summary ledger={ledger} />
        <span aria-hidden="true" className="shrink-0 text-ink-dim">
          {open ? '▾' : '▴'}
        </span>
      </button>
      <div
        id={bodyId}
        className={
          'min-h-0 overflow-auto px-4 pb-3 max-desk:border-t max-desk:border-line max-desk:pt-2.5 desk:pt-3.5' +
          (open ? '' : ' max-desk:hidden')
        }
      >
        {ledger.kind === 'khipu' ? <KhipuRecord record={ledger} facts={facts} /> : <CordRow row={ledger} />}
      </div>
    </aside>
  );
}
