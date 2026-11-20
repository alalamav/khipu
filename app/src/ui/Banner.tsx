import { fmt } from './bits';

/** Shown when nothing hangs any more: the archive is all that is left. */
export function Banner({
  archive,
  onRetie,
}: {
  archive: { cords: number; knots: number; value: number };
  onRetie: () => void;
}) {
  return (
    <div
      role="status"
      className="pointer-events-auto absolute top-[42%] left-1/2 w-[min(520px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-line bg-ground-raised/85 px-6 py-5 text-center backdrop-blur-sm"
    >
      <p className="mb-3.5 text-[17px] text-ink-bright">
        Nothing hangs from the main cord.
        <br />
        The archive still says {fmt(archive.cords)} cords, {fmt(archive.knots)} knots, a sum of {fmt(archive.value)}.
      </p>
      <button className="btn btn-primary" onClick={onRetie}>
        Re-tie from the archive
      </button>
    </div>
  );
}
