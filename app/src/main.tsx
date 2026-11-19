import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { Piece } from './piece/Piece';
import { PieceContext } from './ui/usePiece';

const piece = new Piece(window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PieceContext value={piece}>
      <App />
    </PieceContext>
  </StrictMode>,
);
