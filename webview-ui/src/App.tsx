import { useCallback, useEffect, useRef, useState } from 'react';

import { toMajorMinor } from './changelogData.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { ConnectionIndicator } from './components/ConnectionIndicator.js';
import { IntroBubble } from './components/IntroBubble.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import { Tooltip } from './components/Tooltip.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZOOM_MIN } from './constants.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { useIntroTour } from './hooks/useIntroTour.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { OfficeState } from './office/engine/officeState.js';
import { isE2E } from './runtime.js';
import { installTestHooks } from './testHooks.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };

// Test-only observability hooks (message/sound logs, addAgent wrapper, selectAgent).
// Installed only under the e2e harness so they never patch prototypes or grow
// unbounded logs in a real user's session.
if (isE2E) installTestHooks(officeStateRef);

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    // browserMock is for Vite dev mode only (UI prototyping without a server).
    // In standalone server mode, the server sends all state over WebSocket.
    if (import.meta.env.DEV) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const [zoom, setZoom] = useState(ZOOM_MIN);
  const panRef = useRef({ x: 0, y: 0 });

  const {
    agents,
    setSelectedAgent,
    agentTools,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    lastSeenVersion,
    extensionVersion,
    hooksEnabled,
    hooksInstalled,
    hooksStatusSeq,
    hooksInfoShown,
    consentRequest,
    dismissConsentRequest,
  } = useExtensionMessages(getOfficeState);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);

  const currentMajorMinor = toMajorMinor(extensionVersion);

  const handleWhatsNewDismiss = useCallback(() => {
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // The Intro's wire-facing state machine — which asks survive being mooted,
  // when a hooksStatus is this tour's install verdict — lives in useIntroTour
  // (pure reducer in introTourState.ts); the App only wires it to the bubble.
  const {
    intro,
    installFailed,
    installPending,
    onChoice: handleConsentChoice,
    onClose: handleIntroClose,
  } = useIntroTour({ consentRequest, hooksInstalled, hooksStatusSeq, dismissConsentRequest });

  // The hooks tooltip binds to the Claude row of the per-provider install-state map.
  const claudeHooksInstalled = hooksInstalled['claude'] === true;

  const containerRef = useRef<HTMLDivElement>(null);

  const handleCloseAgent = useCallback((id: number) => {
    transport.send({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback(
    (agentId: number) => {
      // If clicked agent is a sub-agent, select the parent instead
      const os = getOfficeState();
      const meta = os.subagentMeta.get(agentId);
      const focusId = meta ? meta.parentAgentId : agentId;
      setSelectedAgent(focusId);
    },
    [setSelectedAgent],
  );

  const officeState = getOfficeState();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        onZoomChange={setZoom}
        panRef={panRef}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'var(--vignette)' }}
      />

      <ToolOverlay
        officeState={officeState}
        agents={agents}
        agentTools={agentTools}
        subagentTools={subagentTools}
        subagentCharacters={subagentCharacters}
        containerRef={containerRef}
        zoom={zoom}
        panRef={panRef}
        onCloseAgent={handleCloseAgent}
      />

      {/* Hooks first-run tooltip. Gated on hooksInstalled (the hooksStatus
          message), NOT the hooksEnabled preference: hooksEnabled defaults true
          while first-run consent is still pending, and announcing "Instant
          Detection Active" before anything is installed would be a lie. */}
      {hooksEnabled && claudeHooksInstalled && !hooksInfoShown && !hooksTooltipDismissed && (
        <Tooltip
          title="Instant Detection Active"
          position="top-right"
          onDismiss={() => {
            setHooksTooltipDismissed(true);
            transport.send({ type: 'setHooksInfoShown' });
          }}
        >
          <span className="text-sm text-text leading-none">
            Your agents now respond in real-time.{' '}
            <span
              className="text-accent cursor-pointer underline"
              onClick={() => {
                setIsHooksInfoOpen(true);
                setHooksTooltipDismissed(true);
                transport.send({ type: 'setHooksInfoShown' });
              }}
            >
              View more
            </span>
          </span>
        </Tooltip>
      )}

      {/* Hooks info modal */}
      <Modal
        isOpen={isHooksInfoOpen}
        onClose={() => setIsHooksInfoOpen(false)}
        title="Instant Detection is ON"
        zIndex={52}
      >
        <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
          <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
          <ul className="mb-8 pl-18 list-disc m-0">
            <li className="text-sm mb-2">Permission prompts appear instantly</li>
            <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
            <li className="text-sm mb-2">Sound notifications play immediately</li>
          </ul>
          <p className="mb-12 text-text-muted">
            This works through Claude Code Hooks, small event listeners that notify Pixel Agents
            whenever something happens in your Claude sessions.
          </p>
          <div className="text-center">
            <button
              onClick={() => setIsHooksInfoOpen(false)}
              className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
            >
              Got it
            </button>
          </div>
          <p className="mt-8 text-xs text-text-muted text-center">
            To remove the hooks, run pixel-agents --uninstall-hooks
          </p>
        </div>
      </Modal>

      <VersionIndicator
        currentVersion={extensionVersion}
        lastSeenVersion={lastSeenVersion}
        onDismiss={handleWhatsNewDismiss}
        onOpenChangelog={handleOpenChangelog}
      />

      <ConnectionIndicator />

      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
        currentVersion={extensionVersion}
      />

      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
      )}

      {intro && (
        <IntroBubble
          officeState={officeState}
          headline={intro.headline}
          disclosure={intro.disclosure}
          containerRef={containerRef}
          zoom={zoom}
          panRef={panRef}
          installFailed={installFailed}
          installPending={installPending}
          onChoice={handleConsentChoice}
          onClose={handleIntroClose}
          escapeSuppressed={isChangelogOpen || isHooksInfoOpen || showMigrationNotice}
        />
      )}
    </div>
  );
}

export default App;
