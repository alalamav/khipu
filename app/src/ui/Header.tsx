import type { Ref } from 'react';
import type { HeaderView } from '../piece/views';
import { Recorded } from './bits';

/** Top left: the title, and the catalogue line of the khipu that is hanging. */
export function Header({ header, loading, ref }: { header: HeaderView | null; loading: boolean; ref?: Ref<HTMLElement> }) {
  return (
    <header ref={ref} className="absolute top-3 left-3.5 sm:top-[18px] max-w-[90vw] desk:left-6 desk:max-w-[min(56vw,640px)]">
      <h1 className="text-[22px] leading-tight sm:text-[26px] tracking-[0.01em] text-ink-bright">Just Ends</h1>
      {header ? (
        <>
          <p className="mt-1 font-mono text-xs sm:mt-1.5">
            <span className="text-ink-bright">{header.id}</span>
            {header.investigatorId && ` (${header.investigatorId})`} · from <Recorded>{header.provenance}</Recorded> · held:{' '}
            <Recorded>{header.held}</Recorded>
          </p>
          {/* On a small screen these are in the ledger, with the rest of the khipu's record. */}
          <p className="mt-0.5 font-mono text-[11px] text-ink-dim max-sm:hidden">{header.facts.join(' · ')}</p>
        </>
      ) : (
        loading && <p className="mt-1.5 font-mono text-xs text-ink-dim">opening the archive…</p>
      )}
    </header>
  );
}
