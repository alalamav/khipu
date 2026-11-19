import { useEffect, useRef, useState } from 'react';
import { usePiece } from './usePiece';

/** The canvas the khipu hangs in. The piece draws on it and listens to the hand on it. */
export function StageCanvas() {
  const piece = usePiece();
  const host = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // The canvas is made here rather than in the markup. A WebGL context cannot be
    // handed back once taken, so every mount gets a canvas of its own (in development
    // React mounts everything twice).
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full cursor-crosshair touch-none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A khipu drawn from archive measurements. Move across the cords to sound them.');
    host.current!.appendChild(canvas);

    let release: (() => void) | null = null;
    try {
      release = piece.attach(canvas);
    } catch (error) {
      console.error(error);
      setFailure('The khipu is drawn with WebGL, and this browser could not start it.');
    }
    return () => {
      release?.();
      canvas.remove();
    };
  }, [piece]);

  return (
    <div ref={host} className="fixed inset-0">
      {failure && (
        <p role="alert" className="absolute inset-x-6 top-1/3 text-center text-lg text-ink-bright italic">
          {failure}
        </p>
      )}
    </div>
  );
}
