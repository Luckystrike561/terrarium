import type { ReactNode } from 'react';

import { CONNECTIONS_ICON } from './hudIcons.js';
import { PixelIcon } from './ui/PixelIcon.js';

interface PlankButtonProps {
  icon: readonly string[];
  label: ReactNode;
  pressed: boolean;
  highlight?: boolean;
  title?: string;
  onClick: () => void;
}

function PlankButton({ icon, label, pressed, highlight, title, onClick }: PlankButtonProps) {
  const idle = highlight
    ? 'bg-brass text-ink border-wood-dark hover:bg-paper'
    : 'bg-transparent text-paper border-transparent hover:bg-wood-light hover:border-wood-dark';
  const look = pressed ? 'bg-wood-dark text-brass border-brass' : idle;
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={pressed}
      className={`flex items-center gap-6 py-3 px-10 text-lg border-2 rounded-none cursor-pointer ${look}`}
    >
      <PixelIcon rows={icon} />
      <span>{label}</span>
    </button>
  );
}

function PlankNail({ position }: { position: string }) {
  return <span aria-hidden className={`absolute w-4 h-4 bg-metal ${position}`} />;
}

interface BottomToolbarProps {
  isConnectionsOpen: boolean;
  onToggleConnections: () => void;
}

export function BottomToolbar({ isConnectionsOpen, onToggleConnections }: BottomToolbarProps) {
  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 wood-plank py-6 px-14">
      <PlankNail position="top-3 left-3" />
      <PlankNail position="top-3 right-3" />
      <PlankNail position="bottom-3 left-3" />
      <PlankNail position="bottom-3 right-3" />
      <PlankButton
        icon={CONNECTIONS_ICON}
        label="Connections"
        pressed={isConnectionsOpen}
        onClick={onToggleConnections}
        title="Connections"
      />
    </div>
  );
}
