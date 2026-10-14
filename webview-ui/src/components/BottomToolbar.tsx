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
    ? 'bg-confirm text-white border-ink hover:bg-confirm-hover'
    : 'bg-btn-bg text-ink border-ink hover:bg-btn-hover';
  const look = pressed ? 'bg-active-bg text-ink border-ink' : idle;
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={pressed}
      className={`flex items-center gap-6 py-3 px-10 text-lg border-2 rounded cursor-pointer ${look}`}
    >
      <PixelIcon rows={icon} />
      <span>{label}</span>
    </button>
  );
}

interface BottomToolbarProps {
  isConnectionsOpen: boolean;
  onToggleConnections: () => void;
}

export function BottomToolbar({ isConnectionsOpen, onToggleConnections }: BottomToolbarProps) {
  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 hud-window shadow-pixel py-6 px-10">
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
