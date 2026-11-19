/** Small pieces shared across the interface. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Rgb } from '../khipu';

export const fmt = (n: number): string => n.toLocaleString('en-US');

/** The sign for a blank in the archive. */
export function NotRecorded() {
  return <span className="absent">not recorded</span>;
}

/** A figure from the archive's statistics, set in the database's type. An ellipsis until the archive is open. */
export function Stat({ children }: { children: number | string | null | undefined }) {
  return <span className="font-mono text-[0.92em]">{typeof children === 'number' ? fmt(children) : children || '…'}</span>;
}

/** A value, or the sign for its absence. */
export function Recorded({ children }: { children: ReactNode }) {
  return children === null || children === undefined || children === '' ? <NotRecorded /> : <>{children}</>;
}

/** A dot of a cord's recorded colour. Colour appears in the interface only here: it is data. */
export function Swatch({ rgb }: { rgb: Rgb | null }) {
  if (!rgb) return null;
  return (
    <span
      className="mr-1.5 inline-block size-[9px] rounded-full border border-white/25 align-[-1px]"
      style={{ background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` }}
    />
  );
}

/**
 * A panel over the stage, with a dimmed ground behind it. It is a modal dialog: while it is up the focus is
 * inside it and the page behind is out of reach (App makes that inert), and when it closes the focus goes
 * back to the control it was called from.
 */
export function Sheet({
  label,
  onDismiss,
  wide = false,
  children,
}: {
  /** The sheet's name, for a screen reader to say. */
  label: string;
  /** Called when the ground outside the panel is pressed. Leave out for a sheet that must be answered. */
  onDismiss?: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The control the sheet was called from. It is noted while rendering: by the time an effect runs, a control
  // inside the sheet that asks for the focus (autoFocus) has it already.
  const [opener] = useState(() => document.activeElement);
  /** The press now under way began on the ground outside the panel. */
  const pressedOutside = useRef(false);

  useEffect(() => {
    // The focus comes in. Where nothing inside asked for it the panel takes it, so that the keys scroll its text.
    if (!panel.current!.contains(document.activeElement)) panel.current!.focus();
    // And it goes back, if that control is still in the page and can be used. This has to be an effect, not a
    // layout effect: by now App has let the page behind be reached again; earlier the control could not take it.
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) opener.focus();
    };
  }, [opener]);

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      // The sheet closes when the click is complete, not at the press: the rest of a press would take the
      // focus away again from the control it has just gone back to. The press must have begun outside too,
      // so that dragging a selection out of the panel closes nothing.
      onClick={(e) => {
        if (pressedOutside.current && e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={
          'max-h-full overflow-auto rounded-sm border border-line bg-ground-raised px-8 pt-7 pb-6 max-sm:px-5 ' +
          (wide ? 'flex h-[min(760px,100%)] w-[min(860px,100%)] flex-col' : 'w-[min(560px,100%)]')
        }
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between">
      <h2 className="mb-3 text-3xl font-normal text-ink-bright italic">{title}</h2>
      <button className="btn text-base" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}
