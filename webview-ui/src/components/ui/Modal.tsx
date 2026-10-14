import type { ReactNode } from 'react';

import { Button } from './Button.js';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** z-index for backdrop (modal gets +1). Default 49 */
  zIndex?: number;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  zIndex = 50,
  className = '',
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50" style={{ zIndex }} onClick={onClose} />
      <div
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hud-window shadow-pixel min-w-xs ${className}`}
        style={{ zIndex: zIndex + 1 }}
      >
        <div className="hud-titlebar flex items-center justify-between py-4 px-10">
          <span className="text-2xl">{title}</span>
          <Button variant="titlebar" size="icon" onClick={onClose}>
            x
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </>
  );
}
