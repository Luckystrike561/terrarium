import type { ReactNode } from 'react';

import { Button } from './Button.js';

interface ClipboardProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}

/** Panel styled as a Habbo window, anchored above the toolbar at the
 *  bottom-left rather than centered over the office. */
export function Clipboard({ isOpen, onClose, title, children }: ClipboardProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed left-10 bottom-80 z-51 w-md max-w-[calc(100vw-20px)] hud-window shadow-pixel flex flex-col max-h-[calc(100vh-130px)]">
        <div className="hud-titlebar flex items-center justify-between py-4 px-10 shrink-0">
          <span className="text-2xl">{title}</span>
          <Button variant="titlebar" size="icon" onClick={onClose}>
            x
          </Button>
        </div>
        <div className="overflow-y-auto pixel-scrollbar py-4 flex-1">{children}</div>
      </div>
    </>
  );
}
