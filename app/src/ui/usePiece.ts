import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Piece, PieceState } from '../piece/Piece';

export const PieceContext = createContext<Piece | null>(null);

/** The piece: call its methods to act on it. */
export function usePiece(): Piece {
  const piece = useContext(PieceContext);
  if (!piece) throw new Error('usePiece must be used inside a PieceContext');
  return piece;
}

/** What the piece currently shows. The component re-renders when it changes. */
export function usePieceState(): PieceState {
  const piece = usePiece();
  return useSyncExternalStore(piece.subscribe, piece.getState);
}
