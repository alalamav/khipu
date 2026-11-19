import { useMemo, useState } from 'react';
import type { CatalogueOrder, KhipuArchive } from '../khipu';
import { NotRecorded, Sheet, SheetHead, fmt } from './bits';

const ORDERS: readonly { value: CatalogueOrder; label: string }[] = [
  { value: 'id', label: 'by KH number' },
  { value: 'cords', label: 'most cords' },
  { value: 'knots', label: 'most knots' },
  { value: 'brokenShare', label: 'most broken' },
  { value: 'unrecordedShare', label: 'least recorded' },
];

/** Number, from, held, cords, knots, broken. On a narrow screen "held" and "knots" are left out. */
const COLUMNS = 'grid grid-cols-[62px_1fr_56px_70px] gap-2.5 px-1 py-1.5 desk:grid-cols-[62px_1.2fr_1.4fr_56px_56px_96px]';

/** The catalogue: every khipu in the archive, to filter, sort and choose from. */
export function Catalogue({
  archive,
  current,
  onChoose,
  onClose,
}: {
  archive: KhipuArchive;
  /** The khipu that is hanging now. */
  current: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<CatalogueOrder>('id');
  const found = useMemo(() => archive.search(query, order), [archive, query, order]);

  return (
    <Sheet wide label="The archive" onDismiss={onClose}>
      <SheetHead title="The archive" onClose={onClose} />
      <div className="mb-2.5 flex items-center gap-2.5 font-mono text-xs">
        <input
          type="search"
          className="field min-w-0 flex-1"
          aria-label="Filter the archive"
          placeholder="filter by number, place or collection"
          autoComplete="off"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="field cursor-pointer" aria-label="Sort" value={order} onChange={(e) => setOrder(e.target.value as CatalogueOrder)}>
          {ORDERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="whitespace-nowrap text-ink-dim">
          {found.length} of {archive.ids.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-line font-mono text-xs">
        <div className={COLUMNS + ' sticky top-0 z-[1] bg-ground-raised text-[10px] tracking-[0.08em] text-ink-faint uppercase'}>
          <span>number</span>
          <span>from</span>
          <span className="max-desk:hidden">held</span>
          <span className="text-right">cords</span>
          <span className="text-right max-desk:hidden">knots</span>
          <span className="text-right">broken</span>
        </div>
        <ul>
          {found.map((k) => (
            <li key={k.id}>
              <button
                onClick={() => onChoose(k.id)}
                aria-current={k.id === current || undefined}
                className={
                  COLUMNS +
                  ' w-full cursor-pointer border-b border-line text-left text-ink-dim hover:bg-white/[0.07] hover:text-ink' +
                  (k.id === current ? ' bg-white/[0.05]' : '')
                }
              >
                <span className="text-ink-bright">{k.id}</span>
                <span className="truncate">{k.provenance ?? <NotRecorded />}</span>
                <span className="truncate max-desk:hidden">{[k.collection, k.country].filter(Boolean).join(', ')}</span>
                <span className="text-right">{fmt(k.cords)}</span>
                <span className="text-right max-desk:hidden">{fmt(k.knots)}</span>
                <span className="relative block">
                  {/* a bar as long as the share of this khipu's cords that are recorded as broken */}
                  <i className="absolute top-[5px] left-0 h-1.5 bg-ink-dim/70" style={{ width: `${Math.round(k.brokenShare * 60)}%` }} />
                  <span className="absolute right-0">{Math.round(k.brokenShare * 100)}%</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
