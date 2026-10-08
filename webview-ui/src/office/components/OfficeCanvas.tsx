import { useCallback, useEffect, useRef } from 'react';

import { CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_SNAP_THRESHOLD, ZOOM_MIN } from '../../constants.js';
import { unlockAudio } from '../../notificationSound.js';
import { transport } from '../../transport/index.js';
import { startGameLoop } from '../engine/gameLoop.js';
import type { OfficeState } from '../engine/officeState.js';
import type { SelectionRenderState, WorldRenderState } from '../engine/sceneRenderer.js';
import { OfficeSceneRenderer } from '../engine/sceneRenderer.js';
import { isoToWorld, worldToIso } from '../iso.js';
import {
  boundsRect,
  centeredPan,
  clampPan,
  contentBounds,
  fitZoom,
  gridRect,
  panToCenter,
} from '../projection.js';
import { TILE_SIZE } from '../types.js';
import { computeNormalModeCursor } from './officeCanvasCursor.js';

interface OfficeCanvasProps {
  officeState: OfficeState;
  onClick: (agentId: number) => void;
  /** Reports the fit zoom the canvas derived from the viewport and layout. */
  onZoomChange: (zoom: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  /** Whether the area overlay + labels render (the Show Areas setting). */
  showAreas: boolean;
}

export function OfficeCanvas({
  officeState,
  onClick,
  onZoomChange,
  panRef,
  showAreas,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const officeRendererRef = useRef<OfficeSceneRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  // Middle-mouse pan state (imperative, no re-renders)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });

  // Zoom the canvas renders at. Derived every frame from the viewport, so the
  // render loop and hit-testing read it here instead of waiting a React render.
  const viewZoomRef = useRef(ZOOM_MIN);
  const hasViewRef = useRef(false);
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  // Resize canvas backing store to device pixels (no DPR transform on ctx)
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // No ctx.scale(dpr): Pixi renders directly in device pixels (resolution: 1)
    officeRendererRef.current?.resize(canvas.width, canvas.height);
  }, []);

  // Snapshot of the props the persistent render loop reads every frame. The
  // mount effect below creates the Pixi Application exactly once; recreating
  // it on every prop change would tear down and rebuild the WebGL context (and
  // every retained sprite), so the loop reads these through a ref instead of
  // closing over props and re-running the effect when they change.
  const frameParamsRef = useRef({ officeState, showAreas });
  frameParamsRef.current = { officeState, showAreas };

  const clampToView = useCallback((pan: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return pan;
    const layout = frameParamsRef.current.officeState.getLayout();
    const view = boundsRect(contentBounds(layout));
    return clampPan(pan, gridRect(layout), view, viewZoomRef.current, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const officeRenderer = new OfficeSceneRenderer(canvas);
    officeRendererRef.current = officeRenderer;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    let cancelled = false;
    void officeRenderer.init().then(() => {
      if (cancelled) {
        officeRenderer.destroy();
        return;
      }
      officeRenderer.resize(canvas.width, canvas.height);
    });

    const stop = startGameLoop({
      update: (dt) => {
        frameParamsRef.current.officeState.update(dt);
      },
      render: () => {
        const { officeState, showAreas } = frameParamsRef.current;
        const layout = officeState.getLayout();

        if (canvas.width > 0 && canvas.height > 0) {
          const view = boundsRect(contentBounds(layout));
          const target = fitZoom(view, canvas.width, canvas.height);
          if (!hasViewRef.current) {
            hasViewRef.current = true;
            viewZoomRef.current = target;
            panRef.current = centeredPan(
              gridRect(layout),
              view,
              target,
              canvas.width,
              canvas.height,
            );
            onZoomChangeRef.current(target);
          } else if (target !== viewZoomRef.current) {
            // Scale the pan with the zoom so the world point under the canvas
            // center stays put.
            const ratio = target / viewZoomRef.current;
            panRef.current = { x: panRef.current.x * ratio, y: panRef.current.y * ratio };
            viewZoomRef.current = target;
            onZoomChangeRef.current(target);
          }
        }
        const zoom = viewZoomRef.current;

        // Camera: smoothly center on the followed agent, or while the greeter
        // is speaking the Intro, on the character+bubble center the IntroBubble
        // overlay feeds via greeterCameraTarget. An explicit follow (clicking an
        // agent) outranks the greeter target; a manual pan cancels both.
        const followCh =
          officeState.cameraFollowId !== null
            ? officeState.characters.get(officeState.cameraFollowId)
            : undefined;
        const cameraFocus = followCh ?? officeState.greeterCameraTarget;
        if (cameraFocus) {
          const target = clampToView(
            panToCenter(
              worldToIso(cameraFocus.x, cameraFocus.y),
              gridRect(layout),
              zoom,
              canvas.width,
              canvas.height,
            ),
          );
          const targetX = target.x;
          const targetY = target.y;
          const dx = targetX - panRef.current.x;
          const dy = targetY - panRef.current.y;
          if (
            Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD &&
            Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD
          ) {
            panRef.current = { x: targetX, y: targetY };
          } else {
            panRef.current = {
              x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
              y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
            };
          }
        }
        panRef.current = clampToView(panRef.current);

        // Build selection render state
        const selectionRender: SelectionRenderState = {
          selectedAgentId: officeState.selectedAgentId,
          hoveredAgentId: officeState.hoveredAgentId,
          hoveredTile: officeState.hoveredTile,
          seats: officeState.seats,
          characters: officeState.characters,
        };

        const worldState: WorldRenderState = {
          layout,
          tileMap: officeState.tileMap,
          furniture: officeState.furniture,
          characters: officeState.getCharacters(),
          zoom,
          panX: panRef.current.x,
          panY: panRef.current.y,
          selection: selectionRender,
          tileColors: layout.tileColors,
          layoutCols: layout.cols,
          layoutRows: layout.rows,
          carpetTiles: layout.carpetTiles,
          areas: layout.areas,
          areaTiles: layout.areaTiles,
          showAreas,
          pets: officeState.pets,
        };
        const { offsetX, offsetY } = officeRenderer.renderFrame(worldState);
        offsetRef.current = { x: offsetX, y: offsetY };
      },
    });

    return () => {
      cancelled = true;
      stop();
      observer.disconnect();
      officeRendererRef.current = null;
      officeRenderer.destroy();
    };
  }, [resizeCanvas, panRef, clampToView]);

  // Convert CSS mouse coords to world (sprite pixel) coords
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // CSS coords relative to canvas
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    // Convert to device pixels
    const deviceX = cssX * dpr;
    const deviceY = cssY * dpr;
    // Device px → iso local (unscaled sprite px) → top-down world px
    const zoom = viewZoomRef.current;
    const isoX = (deviceX - offsetRef.current.x) / zoom;
    const isoY = (deviceY - offsetRef.current.y) / zoom;
    const world = isoToWorld(isoX, isoY);
    return {
      worldX: world.x,
      worldY: world.y,
      isoX,
      isoY,
      screenX: cssX,
      screenY: cssY,
      deviceX,
      deviceY,
    };
  }, []);

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToWorld(clientX, clientY);
      if (!pos) return null;
      const col = Math.floor(pos.worldX / TILE_SIZE);
      const row = Math.floor(pos.worldY / TILE_SIZE);
      const layout = officeState.getLayout();
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return null;
      return { col, row };
    },
    [screenToWorld, officeState],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle middle-mouse panning
      if (isPanningRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const dx = (e.clientX - panStartRef.current.mouseX) * dpr;
        const dy = (e.clientY - panStartRef.current.mouseY) * dpr;
        panRef.current = clampToView({
          x: panStartRef.current.panX + dx,
          y: panStartRef.current.panY + dy,
        });
        return;
      }

      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const hitId = officeState.getCharacterAt(pos.isoX, pos.isoY);
      // Only run pet hit-test if no character was hit (avoids redundant work).
      const petId = hitId === null ? officeState.getPetAt(pos.isoX, pos.isoY) : null;
      const tile = screenToTile(e.clientX, e.clientY);
      officeState.hoveredTile = tile;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = computeNormalModeCursor({
          hitId,
          petId,
          selectedAgentId: officeState.selectedAgentId,
          tile,
          getSeatAtTile: (col, row) => officeState.getSeatAtTile(col, row),
          getSeat: (seatId) => officeState.seats.get(seatId),
          getCharacter: (id) => officeState.characters.get(id),
        });
      }
      officeState.hoveredAgentId = hitId;
    },
    [officeState, screenToWorld, screenToTile, panRef, clampToView],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      unlockAudio();
      if (e.button !== 1) return;
      // Middle mouse button starts panning
      e.preventDefault();
      // Break camera follow + greeter centering on manual pan
      officeState.cameraFollowId = null;
      officeState.cancelGreeterCamera();
      isPanningRef.current = true;
      panStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = 'grabbing';
    },
    [officeState, panRef],
  );

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return;
    isPanningRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'default';
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;

      const hitId = officeState.getCharacterAt(pos.isoX, pos.isoY);
      if (hitId !== null) {
        // Dismiss any active bubble on click
        officeState.dismissBubble(hitId);
        // Toggle selection: click same agent deselects, different agent selects
        if (officeState.selectedAgentId === hitId) {
          officeState.selectedAgentId = null;
          officeState.cameraFollowId = null;
        } else {
          officeState.selectedAgentId = hitId;
          officeState.cameraFollowId = hitId;
        }
        onClick(hitId); // still focus terminal
        return;
      }

      // Pet hit: toggle the heart bubble.
      const petId = officeState.getPetAt(pos.isoX, pos.isoY);
      if (petId !== null) {
        const pet = officeState.pets.find((p) => p.id === petId);
        if (pet?.bubbleType) {
          officeState.dismissPetBubble(petId);
        } else {
          officeState.showPetBubble(petId);
        }
        return;
      }

      // No agent hit — check seat click while agent is selected
      if (officeState.selectedAgentId !== null) {
        const selectedCh = officeState.characters.get(officeState.selectedAgentId);
        // Skip seat reassignment for sub-agents
        if (selectedCh && !selectedCh.isSubagent) {
          const tile = screenToTile(e.clientX, e.clientY);
          if (tile) {
            const seatId = officeState.getSeatAtTile(tile.col, tile.row);
            if (seatId) {
              const seat = officeState.seats.get(seatId);
              if (seat && selectedCh) {
                if (selectedCh.seatId === seatId) {
                  // Clicked own seat — send agent back to it
                  officeState.sendToSeat(officeState.selectedAgentId);
                  officeState.selectedAgentId = null;
                  officeState.cameraFollowId = null;
                  return;
                } else if (!seat.assigned) {
                  // Clicked available seat — reassign
                  officeState.reassignSeat(officeState.selectedAgentId, seatId);
                  officeState.selectedAgentId = null;
                  officeState.cameraFollowId = null;
                  transport.send({
                    type: 'saveAgentSeats',
                    seats: officeState.getPersistableSeats(),
                  });
                  return;
                }
              }
            }
          }
        }
        // Clicked empty space — deselect
        officeState.selectedAgentId = null;
        officeState.cameraFollowId = null;
      }
    },
    [officeState, onClick, screenToWorld, screenToTile],
  );

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    officeState.hoveredAgentId = null;
    officeState.hoveredTile = null;
    // Reset the cursor so it doesn't stay a pointer after hovering a pet.
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'default';
    }
  }, [officeState]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Right-click to walk selected agent to tile
      if (officeState.selectedAgentId !== null) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          officeState.walkToTile(officeState.selectedAgentId, tile.col, tile.row);
        }
      }
    },
    [officeState, screenToTile],
  );

  // Wheel / trackpad scrolls the office. Ctrl+wheel (trackpad pinch) is
  // swallowed: the zoom is fixed to fit the viewport. Shift+wheel scrolls
  // horizontally for mice that only report vertical deltas.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return;
      const dpr = window.devicePixelRatio || 1;
      const horizontalOnly = e.shiftKey && e.deltaX === 0;
      const deltaX = horizontalOnly ? e.deltaY : e.deltaX;
      const deltaY = horizontalOnly ? 0 : e.deltaY;
      officeState.cameraFollowId = null;
      officeState.cancelGreeterCamera();
      panRef.current = clampToView({
        x: panRef.current.x - deltaX * dpr,
        y: panRef.current.y - deltaY * dpr,
      });
    },
    [officeState, panRef, clampToView],
  );

  // Attach wheel listener with { passive: false } so preventDefault() works.
  // React's onWheel is passive by default in modern browsers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Prevent default middle-click browser behavior (auto-scroll)
  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-bg">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        className="block"
      />
    </div>
  );
}
