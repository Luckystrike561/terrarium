import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { isBrowserRuntime } from '../runtime.js';
import { transport } from '../transport/index.js';
import { AGENT_ICON, LAYOUT_ICON, SETTINGS_ICON } from './hudIcons.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';
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
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
}

export function BottomToolbar({
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
}: BottomToolbarProps) {
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    transport.send({ type: 'launchAgent', folderPath: folder.path, bypassPermissions });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      transport.send({ type: 'launchAgent', bypassPermissions });
    }
  };

  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 wood-plank py-6 px-14">
      <PlankNail position="top-3 left-3" />
      <PlankNail position="top-3 right-3" />
      <PlankNail position="bottom-3 left-3" />
      <PlankNail position="bottom-3 right-3" />
      {/* Hide + Agent in standalone browser mode (no terminal to interact with) */}
      {!isBrowserRuntime && (
        <div
          ref={folderPickerRef}
          className="relative"
          onMouseEnter={handleAgentHover}
          onMouseLeave={handleAgentLeave}
        >
          <PlankButton
            icon={AGENT_ICON}
            label="+ Agent"
            highlight
            pressed={isFolderPickerOpen || isBypassMenuOpen}
            onClick={handleAgentClick}
          />
          <Dropdown isOpen={isBypassMenuOpen}>
            <DropdownItem onClick={() => handleBypassSelect(true)}>
              Skip permissions mode <span className="text-2xs text-warning">⚠</span>
            </DropdownItem>
          </Dropdown>
          <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
            {workspaceFolders.map((folder) => (
              <DropdownItem
                key={folder.path}
                onClick={() => handleFolderSelect(folder)}
                className="text-base"
              >
                {folder.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      )}
      <PlankButton
        icon={LAYOUT_ICON}
        label="Layout"
        pressed={isEditMode}
        onClick={onToggleEditMode}
        title="Edit office layout"
      />
      <PlankButton
        icon={SETTINGS_ICON}
        label="Settings"
        pressed={isSettingsOpen}
        onClick={onToggleSettings}
        title="Settings"
      />
    </div>
  );
}
