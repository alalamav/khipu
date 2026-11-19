/**
 * Shown while the piece cannot be heard. A browser lets sound begin only from
 * a click or a key press, and a link that skips the opening text (?autostart,
 * ?panel=) has had neither: until then cords move and wear in silence.
 */
export function SoundHint() {
  return (
    <p role="status" className="text-[13px] leading-tight text-ink-bright italic">
      No sound yet: it starts with your first click or key press.
    </p>
  );
}
