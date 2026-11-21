import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_KHIPU, WIDE_FROM, type Overlay } from './piece/Piece';
import { About } from './ui/About';
import { Banner } from './ui/Banner';
import { Catalogue } from './ui/Catalogue';
import { Controls } from './ui/Controls';
import { Header } from './ui/Header';
import { Intro } from './ui/Intro';
import { Ledger } from './ui/Ledger';
import { SoundHint } from './ui/SoundHint';
import { StageCanvas } from './ui/StageCanvas';
import { Tally } from './ui/Tally';
import { usePiece, usePieceState } from './ui/usePiece';

/**
 * What kind of control a key press lands on, for the controls that keep keys to themselves. A box for text, a
 * menu and editable text keep them all; a slider keeps the arrows; a radio button keeps the arrows and space;
 * any other button keeps space.
 */
function focusKind(target: EventTarget | null): 'text' | 'slider' | 'radio' | 'button' | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target instanceof HTMLInputElement) return target.type === 'range' ? 'slider' : 'text';
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return 'text';
  if (target.getAttribute('role') === 'radio') return 'radio';
  return target instanceof HTMLButtonElement ? 'button' : null;
}

/**
 * The interface: words and controls laid over the stage.
 *
 * Everything here is a view of the piece's state (usePieceState) or a call to
 * one of its methods. Which sheet is open is the only state the interface
 * keeps for itself.
 */
export function App() {
  const piece = usePiece();
  const state = usePieceState();
  const { params } = piece;
  const [overlay, setOverlay] = useState<Overlay>(() => params.panel ?? (params.autostart || params.play ? null : 'intro'));

  const header = useRef<HTMLElement>(null);
  const ledger = useRef<HTMLElement>(null);
  const footer = useRef<HTMLElement>(null);
  // Under the khipu, on a small screen, the ledger is one line until the visitor opens it.
  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Open the archive, and follow the address: #KH0438 names the khipu to hang.
  useEffect(() => {
    void piece.open(import.meta.env.BASE_URL + 'data', window.location.hash.slice(1) || DEFAULT_KHIPU);
    const followAddress = () => {
      const id = window.location.hash.slice(1);
      if (piece.archive?.has(id) && id !== piece.getState().khipuId) void piece.load(id);
    };
    window.addEventListener('hashchange', followAddress);
    return () => window.removeEventListener('hashchange', followAddress);
  }, [piece]);

  // Tell the piece how much room the interface leaves, so the khipu is fitted into what is free.
  useLayoutEffect(() => {
    piece.margins = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const wide = width >= WIDE_FROM;
      const head = header.current?.getBoundingClientRect();
      const side = ledger.current?.getBoundingClientRect();
      const foot = footer.current?.getBoundingClientRect();
      // Beside the khipu on a wide window, the ledger takes room on the right; under it, at the bottom.
      const under = wide ? foot : (side ?? foot);
      return {
        left: 40,
        right: wide && side ? width - side.left + 24 : 40,
        top: (head ? head.bottom : 90) + 22,
        bottom: (under ? height - under.top : 110) + 14,
      };
    };
    return () => {
      piece.margins = null;
    };
  }, [piece]);

  // The words around the khipu change size with each khipu, and the ledger under it when it is opened or
  // closed, so place it again once they are in.
  useLayoutEffect(() => {
    piece.layoutChanged();
  }, [piece, state.header, ledgerOpen]);

  // The bar at the bottom changes height too: it shows more or less of itself as the window allows.
  useEffect(() => {
    if (!footer.current) return;
    const observer = new ResizeObserver(() => piece.layoutChanged());
    observer.observe(footer.current);
    return () => observer.disconnect();
  }, [piece]);

  // A link that skips the opening text has had no click, and a browser makes no sound before one.
  // So the first click or key press anywhere starts it. (While the opening text is up, its button does.)
  const silent = !state.audible && overlay !== 'intro';
  useEffect(() => {
    if (!silent) return;
    const start = () => piece.enter();
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('keydown', start, true);
    return () => {
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('keydown', start, true);
    };
  }, [piece, silent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOverlay((open) => (open === 'intro' ? open : null)); // the intro has to be answered
        return;
      }
      if (overlay || e.metaKey || e.ctrlKey || e.altKey) return;
      const focus = focusKind(e.target);
      if (focus === 'text') return; // every key belongs to the box
      if (e.key === ' ') {
        if (focus === 'button' || focus === 'radio') return; // space presses the button that has the focus
        e.preventDefault();
        if (!e.repeat) piece.toggleReading(); // a key held down is one press
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (focus === 'slider' || focus === 'radio') return; // the arrows move the slider, or choose within the radio group
        piece.go(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'f') piece.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [piece, overlay]);

  const close = () => setOverlay(null);
  const stats = piece.archive?.stats ?? null;
  // The sheet that is up. Not always the one asked for: the opening text gives way to an error, and the
  // catalogue waits for the archive.
  const sheet = (overlay === 'intro' && state.error) || (overlay === 'catalogue' && !piece.archive) ? null : overlay;

  return (
    <>
      {/* While a sheet is up, all that is behind it is out of reach: of the keys, the pointer and a screen reader. */}
      <div inert={sheet !== null}>
        <StageCanvas />

        <div className="pointer-events-none fixed inset-0 z-[1] grid grid-rows-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Header ref={header} header={state.header} loading={state.status === 'loading'} />
            <Ledger
              ref={ledger}
              ledger={state.ledger}
              facts={state.header?.facts}
              open={ledgerOpen}
              onToggle={() => setLedgerOpen((was) => !was)}
            />
            {state.error && (
              <p
                role="alert"
                className="pointer-events-auto absolute top-1/3 left-1/2 w-[min(560px,calc(100%-24px))] -translate-x-1/2 rounded-sm border border-line bg-ground-raised px-6 py-5 font-mono text-xs text-ink-bright"
              >
                {state.error}
              </p>
            )}
            {state.finished && <Banner archive={state.finished} onRetie={() => piece.retie()} />}
          </div>

          <footer
            ref={footer}
            className="bg-linear-to-t from-black/90 via-black/60 via-70% to-transparent px-3 pt-5 pb-2.5 desk:px-6 desk:pb-3"
          >
            <div className="mb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <Tally tally={state.tally} />
              {silent && state.status === 'ready' && <SoundHint />}
            </div>
            <Controls state={state} onCatalogue={() => setOverlay('catalogue')} onAbout={() => setOverlay('about')} />
          </footer>
        </div>
      </div>

      {sheet === 'intro' && (
        <Intro
          stats={stats}
          onEnter={() => {
            piece.enter();
            close();
          }}
        />
      )}
      {sheet === 'catalogue' && piece.archive && (
        <Catalogue
          archive={piece.archive}
          current={state.khipuId}
          onClose={close}
          onChoose={(id) => {
            close();
            void piece.load(id);
          }}
        />
      )}
      {sheet === 'about' && <About stats={stats} onClose={close} />}
    </>
  );
}
