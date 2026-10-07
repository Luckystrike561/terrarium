import type { ReactNode } from 'react';

import { Button } from './Button.js';

interface ClipboardProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}

/** Panel styled as a clipboard lifted off the office HUD plank, anchored
 *  above it at the bottom-left rather than centered over the office. */
export function Clipboard({ isOpen, onClose, title, children }: ClipboardProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed left-10 bottom-80 z-51 w-md max-w-[calc(100vw-20px)] wood-plank p-8 pt-18">
        <div aria-hidden className="absolute -top-8 left-1/2 -translate-x-1/2 w-88 h-20 metal-clip">
          <div className="mx-auto mt-4 w-40 h-6 bg-metal-dark" />
        </div>
        <div className="paper-sheet flex flex-col max-h-[calc(100vh-130px)]">
          <div className="flex items-center justify-between py-4 px-10 border-b-2 border-border">
            <span className="text-2xl">{title}</span>
            <Button variant="ghost" size="icon" onClick={onClose}>
              x
            </Button>
          </div>
          <div className="overflow-y-auto pixel-scrollbar py-4">{children}</div>
        </div>
      </div>
    </>
  );
}
