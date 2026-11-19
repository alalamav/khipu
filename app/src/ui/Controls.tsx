import type { KeyboardEvent, ReactNode } from 'react';
import type { VoiceKind } from '../audio/cordSound';
import type { PieceState } from '../piece/Piece';
import { usePiece } from './usePiece';

const VOICES: readonly { kind: VoiceKind; title: string }[] = [
  { kind: 'string', title: 'The row as measurements: each cord is a string as long as its length' },
  {
    kind: 'operator',
    title: 'The row as relationships: each cord is a sine tone, bent by the cords tied to it and the cord before it',
  },
  { kind: 'resonator', title: 'The row as numbers: each cord strikes a bank of resonant filters tuned by its knot values' },
];

/** Controls that belong together and stay together. */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

/**
 * Half of the bar. When the window is too narrow for both halves side by
 * side, the second goes under the first whole, before either breaks up.
 */
function Half({ children }: { children: ReactNode }) {
  return <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 max-desk:gap-x-2.5 max-desk:gap-y-1.5">{children}</div>;
}

function Slider({
  label,
  title,
  min,
  max,
  value,
  onChange,
  from,
  to,
}: {
  label: string;
  title: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  /** Words for the two ends of the slider. */
  from?: string;
  to?: string;
}) {
  const end = 'text-[10px] text-ink-faint max-desk:hidden';
  return (
    <label className="flex items-center gap-1.5" title={title}>
      <span className="text-ink-dim">{label}</span>
      {from && <span className={end}>{from}</span>}
      <input
        type="range"
        className="slider w-20 desk:w-[92px]"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {to && <span className={end}>{to}</span>}
    </label>
  );
}

/** The bar along the bottom: the khipu and its reading on the left, sound and view on the right. */
export function Controls({
  state,
  onCatalogue,
  onAbout,
}: {
  state: PieceState;
  onCatalogue: () => void;
  onAbout: () => void;
}) {
  const piece = usePiece();

  // The voices behave as radio buttons do: Tab stops once, on the chosen voice, and the arrow keys choose the
  // next one or the one before, taking the focus along and going round at the ends.
  const chooseWithArrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || e.metaKey || e.ctrlKey || e.altKey) return;
    // The key is used up here. It must not go on to the window, where left and right change the khipu.
    e.preventDefault();
    e.stopPropagation();
    const radios = [...e.currentTarget.children] as HTMLElement[];
    const next = (radios.indexOf(e.target as HTMLElement) + step + radios.length) % radios.length;
    piece.setVoice(VOICES[next].kind);
    radios[next].focus();
  };

  return (
    <nav className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs max-desk:gap-x-2.5 max-desk:gap-y-1.5">
      <Half>
        <Group>
          <button className="btn" onClick={() => piece.go(-1)} title="Previous khipu (←)" aria-label="Previous khipu">
            ‹
          </button>
          <button className="btn min-w-[76px] tracking-[0.04em]" onClick={onCatalogue} title="Choose a khipu">
            {state.khipuId}
          </button>
          <button className="btn" onClick={() => piece.go(1)} title="Next khipu (→)" aria-label="Next khipu">
            ›
          </button>
        </Group>

        <Group>
          <button
            className="btn btn-primary min-w-[68px]"
            onClick={() => piece.toggleReading()}
            title="Pass a hand along the main cord (space)"
          >
            {state.reading ? 'Pause' : 'Read'}
          </button>
          <button className="btn" onClick={() => piece.retie()} title="Tie it again from the database rows">
            Re-tie
          </button>
        </Group>

        <Slider
          label="wear"
          title="How much each touch wears the cords"
          min={0}
          max={1}
          value={state.wear}
          onChange={(v) => piece.setWear(v)}
          from="gloves"
          to="centuries"
        />
      </Half>

      <Half>
        <Group>
          <span className="text-ink-dim">voice</span>
          <div role="radiogroup" aria-label="Voice" className="flex" onKeyDown={chooseWithArrows}>
            {VOICES.map(({ kind, title }, i) => (
              <button
                key={kind}
                role="radio"
                aria-checked={state.voice === kind}
                tabIndex={state.voice === kind ? 0 : -1}
                title={title}
                onClick={() => piece.setVoice(kind)}
                className={
                  'btn rounded-none' +
                  (i === 0 ? ' rounded-l-sm' : ' -ml-px') +
                  (i === VOICES.length - 1 ? ' rounded-r-sm' : '') +
                  (state.voice === kind ? ' btn-on relative' : '')
                }
              >
                {kind}
              </button>
            ))}
          </div>
          {state.voice === 'operator' && (
            <Slider
              label="depth"
              title="How deeply cords modulate one another. At zero every cord is a bare sine tone."
              min={0}
              max={2}
              value={state.depth}
              onChange={(v) => piece.setDepth(v)}
            />
          )}
          {state.voice === 'resonator' && (
            <Slider
              label="ring"
              title="How long the resonances ring"
              min={0.2}
              max={3}
              value={state.ring}
              onChange={(v) => piece.setRing(v)}
            />
          )}
        </Group>

        <Slider label="sound" title="Volume" min={0} max={1} value={state.volume} onChange={(v) => piece.setVolume(v)} />

        <Group>
          <button className="btn" onClick={() => piece.zoom(1 / 1.5)} title="Step back" aria-label="Zoom out">
            −
          </button>
          <button className="btn" onClick={() => piece.fit()} title="See the whole khipu (f)">
            fit
          </button>
          <button className="btn" onClick={() => piece.zoom(1.5)} title="Come closer" aria-label="Zoom in">
            +
          </button>
        </Group>

        <button className="btn" onClick={onAbout}>
          About
        </button>
      </Half>
    </nav>
  );
}
