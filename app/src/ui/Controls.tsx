import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { SHOWN_VOICES, type VoiceKind } from '../audio/cordSound';
import type { PieceState } from '../piece/Piece';
import { usePiece } from './usePiece';

const ALL_VOICES: readonly { kind: VoiceKind; title: string }[] = [
  { kind: 'string', title: 'The row as measurements: each cord is a string as long as its length' },
  {
    kind: 'operator',
    title: 'The row as relationships: each cord is a sine tone, bent by the cords tied to it and the cord before it',
  },
  { kind: 'resonator', title: 'The row as numbers: each cord strikes a bank of resonant filters tuned by its knot values' },
];
/** The voices that can be chosen here. One that is hidden (see SHOWN_VOICES) keeps its entry above. */
const VOICES = ALL_VOICES.filter(({ kind }) => SHOWN_VOICES.includes(kind));

/**
 * How much of the bar is laid out in the open. Below COMPACT_BELOW only what the instrument cannot be played
 * without; from ROOMY_FROM up, everything. In between, and below, the rest is in the settings menu.
 */
const COMPACT_BELOW = 720;
const ROOMY_FROM = 1360;
/** In between, the wear slider is the first to come out of the menu, once there is room for it. */
const WEAR_FROM = 1040;

/** Whether the window matches a media query, kept up to date. */
function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (changed: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', changed);
      return () => media.removeEventListener('change', changed);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** Controls that belong together and stay together. */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

/** One line of the settings menu: what it sets, and the controls that set it. */
function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-11 shrink-0 text-ink-dim">{label}</span>
      {children}
    </div>
  );
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
  menu = false,
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
  /** In the settings menu: the slider takes the whole line, and the labels line up. */
  menu?: boolean;
}) {
  const end = 'text-[10px] text-ink-faint';
  return (
    <label className={'flex items-center gap-1.5' + (menu ? ' w-full' : '')} title={title}>
      <span className={'text-ink-dim' + (menu ? ' w-11 shrink-0' : '')}>{label}</span>
      {from && <span className={end}>{from}</span>}
      <input
        type="range"
        className={'slider ' + (menu ? 'min-w-0 flex-1' : 'w-[92px]')}
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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M1.5 4.5h6.5M12 4.5h2.5M1.5 11.5H4M8 11.5h6.5" />
      <circle cx="10" cy="4.5" r="2" />
      <circle cx="6" cy="11.5" r="2" />
    </svg>
  );
}

/**
 * The bar along the bottom. It shows as much as the window has room for: on a small screen only the khipu,
 * Read, and the way to the rest; on a large one everything. What is not in the bar is in the settings menu.
 */
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
  const compact = !useMedia(`(min-width: ${COMPACT_BELOW}px)`);
  const roomy = useMedia(`(min-width: ${ROOMY_FROM}px)`);
  const wearInBar = useMedia(`(min-width: ${WEAR_FROM}px)`);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const open = menuOpen && !roomy;

  // The menu closes on Escape, and on a press anywhere outside it: the khipu is played with the menu out of the way.
  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !menuButton.current?.contains(target)) setMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

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

  // Each of these is placed once: in the bar where there is room for it, in the menu where there is not.
  const retie = (
    <button
      className="btn"
      onClick={() => {
        piece.retie();
        setMenuOpen(false);
      }}
      title="Tie it again from the database rows"
    >
      Re-tie
    </button>
  );

  const voices = (
    <div role="radiogroup" aria-label="Voice" className="flex" onKeyDown={chooseWithArrows}>
      {VOICES.map(({ kind, title }, i) => (
        <button
          key={kind}
          role="radio"
          aria-checked={state.voice === kind}
          // (a link can start the piece in a voice that is not offered here: then the first one takes the focus)
          tabIndex={state.voice === kind || (i === 0 && !SHOWN_VOICES.includes(state.voice)) ? 0 : -1}
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
  );

  /** The slider that belongs to the chosen voice, if it has one. */
  const voiceSlider = (inMenu: boolean) =>
    state.voice === 'operator' ? (
      <Slider
        label="depth"
        title="How deeply cords modulate one another. At zero every cord is a bare sine tone."
        min={0}
        max={2}
        value={state.depth}
        onChange={(v) => piece.setDepth(v)}
        menu={inMenu}
      />
    ) : state.voice === 'resonator' ? (
      <Slider
        label="ring"
        title="How long the resonances ring"
        min={0.2}
        max={3}
        value={state.ring}
        onChange={(v) => piece.setRing(v)}
        menu={inMenu}
      />
    ) : null;

  const wear = (inMenu: boolean) => (
    <Slider
      label="wear"
      title="How much each touch wears the cords"
      min={0}
      max={1}
      value={state.wear}
      onChange={(v) => piece.setWear(v)}
      from="gloves"
      to="centuries"
      menu={inMenu}
    />
  );

  const volume = (inMenu: boolean) => (
    <Slider label="sound" title="Volume" min={0} max={1} value={state.volume} onChange={(v) => piece.setVolume(v)} menu={inMenu} />
  );

  const layers = (
    <>
      <button
        className={'btn' + (state.drone ? ' btn-on' : '')}
        aria-pressed={state.drone}
        onClick={() => piece.setDrone(!state.drone)}
        title="The low drone of the main cord, heard while a hand moves or a reading runs: on or off"
      >
        drone
      </button>
      <button
        className={'btn' + (state.clicks ? ' btn-on' : '')}
        aria-pressed={state.clicks}
        onClick={() => piece.setClicks(!state.clicks)}
        title="The snap of a cord parting and the crack of a broken or cut cord: on or off"
      >
        clicks
      </button>
      <button
        className={'btn' + (state.breath ? ' btn-on' : '')}
        aria-pressed={state.breath}
        onClick={() => piece.setBreath(!state.breath)}
        title="The breath heard where a length or an ending was not recorded, and on worn cords: on or off"
      >
        breath
      </button>
    </>
  );

  const fit = (
    <button className="btn" onClick={() => piece.fit()} title="See the whole khipu (f)">
      fit
    </button>
  );

  return (
    <nav
      className={
        'pointer-events-auto relative z-10 flex flex-wrap items-center gap-y-2 font-mono text-xs ' +
        // In between the two, the few groups in the bar are spread over its whole width, not bunched at the left.
        (compact ? 'gap-x-1.5' : roomy ? 'gap-x-4' : 'justify-between gap-x-4')
      }
    >
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
        {!compact && retie}
      </Group>

      {wearInBar && wear(false)}

      {!compact && (
        <Group>
          <span className="text-ink-dim">voice</span>
          {voices}
          {roomy && voiceSlider(false)}
        </Group>
      )}

      {roomy && (
        <>
          <Group>
            {volume(false)}
            {layers}
          </Group>
          {fit}
        </>
      )}

      <div className={'flex items-center gap-1.5' + (compact ? ' ml-auto' : ' relative')}>
        {!roomy && (
          <button
            ref={menuButton}
            className={'btn' + (open ? ' btn-on' : '')}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label="Settings"
            title="Sound and view settings"
            onClick={() => setMenuOpen((was) => !was)}
          >
            <SettingsIcon />
            {!compact && <span className="ml-1.5">Settings</span>}
          </button>
        )}
        <button className="btn" onClick={onAbout}>
          About
        </button>

        {/* Over the button that opens it; on a small screen, across the bar. */}
        {open && (
          <div
            ref={menu}
            id={menuId}
            role="group"
            aria-label="Settings"
            className={
              'absolute right-0 bottom-full mb-2 flex flex-col gap-2.5 rounded-sm border border-line bg-ground-raised/95 px-4 py-3.5 backdrop-blur-sm ' +
              (compact ? 'w-full max-w-[320px]' : 'w-[320px]')
            }
          >
            {compact && <MenuRow label="voice">{voices}</MenuRow>}
            {voiceSlider(true)}
            {!wearInBar && wear(true)}
            {volume(true)}
            <MenuRow label="hear">{layers}</MenuRow>
            <div className="flex gap-1.5 border-t border-line pt-2.5">
              {fit}
              {compact && retie}
            </div>
          </div>
        )}
      </div>

    </nav>
  );
}
