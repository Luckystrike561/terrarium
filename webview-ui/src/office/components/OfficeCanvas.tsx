import { useCallback, useEffect, useRef } from 'react';

import { CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_SNAP_THRESHOLD, ZOOM_MIN } from '../../constants.js';
import { unlockAudio } from '../../notificationSound.js';
import { transport } from '../../transport/index.js';
import type { Building, Floor } from '../engine/building.js';
import { startGameLoop } from '../engine/gameLoop.js';
import type { FloorRenderState, WorldRenderState } from '../engine/sceneRenderer.js';
import { OfficeSceneRenderer } from '../engine/sceneRenderer.js';
import { worldToIso } from '../iso.js';
import { centeredPan, clampPan, fitZoom, gridRect, panToCenter } from '../projection.js';
import { computeNormalModeCursor } from './officeCanvasCursor.js';

interface OfficeCanvasProps {
  building: Building;
  onClick: (agentId: number) => void;
  /** Reports the fit zoom the canvas derived from the viewport and layout. */
  onZoomChange: (zoom: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
}

/** What one floor draws this frame. Only the selected agent's floor shows the seat under the cursor. */
function floorRenderState(building: Building, floor: Floor): FloorRenderState {
  const { office } = floor;
  const layout = office.getLayout();
  const selectedFloor =
    building.selectedAgentId === null ? undefined : building.floorOf(building.selectedAgentId);
  return {
    id: floor.id,
    name: floor.name,
    elevation: floor.elevation,
    slabPx: building.slabPx,
    layout,
    tileMap: office.tileMap,
    furniture: office.furniture,
    characters: office.getCharacters(),
    sittingOffset: (ch) => office.sittingOffset(ch),
    selection: {
      selectedAgentId: building.selectedAgentId,
      hoveredAgentId: building.hoveredAgentId,
      hoveredTile: selectedFloor === floor ? building.hoveredTile : null,
      seats: office.seats,
      characters: office.characters,
    },
    tileColors: layout.tileColors,
    layoutCols: layout.cols,
    layoutRows: layout.rows,
    carpetTiles: layout.carpetTiles,
    areas: layout.areas,
    areaTiles: layout.areaTiles,
    pets: office.pets,
  };
}

export function OfficeCanvas({ building, onClick, onZoomChange, panRef }: OfficeCanvasProps) {
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
  const frameParamsRef = useRef({ building });
  frameParamsRef.current = { building };

  const clampToView = useCallback((pan: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return pan;
    const { building } = frameParamsRef.current;
    return clampPan(
      pan,
      gridRect(building.ground.getLayout()),
      building.viewRect(),
      viewZoomRef.current,
      canvas.width,
      canvas.height,
    );
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
        frameParamsRef.current.building.update(dt);
      },
      render: () => {
        const { building } = frameParamsRef.current;
        const grid = gridRect(building.ground.getLayout());

        if (canvas.width > 0 && canvas.height > 0) {
          const view = building.viewRect();
          const target = fitZoom(view, canvas.width, canvas.height);
          if (!hasViewRef.current) {
            hasViewRef.current = true;
            viewZoomRef.current = target;
            panRef.current = centeredPan(grid, view, target, canvas.width, canvas.height);
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

        // Camera: smoothly center on the followed agent, on its own floor, or
        // while the greeter is speaking the Intro, on the character+bubble
        // center the IntroBubble overlay feeds via greeterCameraTarget (the
        // greeter stands on the first floor). An explicit follow (clicking an
        // agent) outranks the greeter target; a manual pan cancels both.
        const followId = building.cameraFollowId;
        const followCh = followId === null ? undefined : building.getCharacter(followId);
        const cameraFocus = followCh
          ? worldToIso(followCh.x, followCh.y, building.floorOf(followCh.id)?.elevation)
          : building.ground.greeterCameraTarget &&
            worldToIso(
              building.ground.greeterCameraTarget.x,
              building.ground.greeterCameraTarget.y,
            );
        if (cameraFocus) {
          const target = clampToView(
            panToCenter(cameraFocus, grid, zoom, canvas.width, canvas.height),
          );
          const dx = target.x - panRef.current.x;
          const dy = target.y - panRef.current.y;
          if (
            Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD &&
            Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD
          ) {
            panRef.current = target;
          } else {
            panRef.current = {
              x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
              y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
            };
          }
        }
        panRef.current = clampToView(panRef.current);

        const worldState: WorldRenderState = {
          floors: building.floors.map((floor) => floorRenderState(building, floor)),
          grid: building.ground.getLayout(),
          zoom,
          panX: panRef.current.x,
          panY: panRef.current.y,
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

  // Convert CSS mouse coords to iso local (unscaled sprite px) coords
  const screenToIso = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const deviceX = (clientX - rect.left) * dpr;
    const deviceY = (clientY - rect.top) * dpr;
    const zoom = viewZoomRef.current;
    return {
      isoX: (deviceX - offsetRef.current.x) / zoom,
      isoY: (deviceY - offsetRef.current.y) / zoom,
    };
  }, []);

  /** The selected agent's floor: the only floor its seat reassignment and walk commands can target. */
  const selectedFloor = useCallback(
    () =>
      building.selectedAgentId === null ? undefined : building.floorOf(building.selectedAgentId),
    [building],
  );

  /** The tile under the cursor on the selected agent's floor, or null. */
  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToIso(clientX, clientY);
      const floor = selectedFloor();
      if (!pos || !floor) return null;
      return building.tileAt(floor, pos.isoX, pos.isoY);
    },
    [screenToIso, selectedFloor, building],
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

      const pos = screenToIso(e.clientX, e.clientY);
      if (!pos) return;
      const hitId = building.getCharacterAt(pos.isoX, pos.isoY);
      // Only run pet hit-test if no character was hit (avoids redundant work).
      const pet = hitId === null ? building.getPetAt(pos.isoX, pos.isoY) : null;
      const tile = screenToTile(e.clientX, e.clientY);
      building.hoveredTile = tile;
      const canvas = canvasRef.current;
      const office = selectedFloor()?.office;
      if (canvas) {
        canvas.style.cursor = computeNormalModeCursor({
          hitId,
          petId: pet?.petId ?? null,
          selectedAgentId: building.selectedAgentId,
          tile,
          getSeatAtTile: (col, row) => office?.getSeatAtTile(col, row) ?? null,
          getSeat: (seatId) => office?.seats.get(seatId),
          getCharacter: (id) => building.getCharacter(id),
        });
      }
      building.hoveredAgentId = hitId;
    },
    [building, screenToIso, screenToTile, selectedFloor, panRef, clampToView],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      unlockAudio();
      if (e.button !== 1) return;
      // Middle mouse button starts panning
      e.preventDefault();
      // Break camera follow + greeter centering on manual pan
      building.cameraFollowId = null;
      building.ground.cancelGreeterCamera();
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
    [building, panRef],
  );

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return;
    isPanningRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'default';
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToIso(e.clientX, e.clientY);
      if (!pos) return;

      const hitId = building.getCharacterAt(pos.isoX, pos.isoY);
      if (hitId !== null) {
        // Dismiss any active bubble on click
        building.officeOf(hitId)?.dismissBubble(hitId);
        // Toggle selection: click same agent deselects, different agent selects
        if (building.selectedAgentId === hitId) {
          building.selectedAgentId = null;
          building.cameraFollowId = null;
        } else {
          building.selectedAgentId = hitId;
          building.cameraFollowId = hitId;
        }
        onClick(hitId); // still focus terminal
        return;
      }

      // Pet hit: toggle the heart bubble.
      const pet = building.getPetAt(pos.isoX, pos.isoY);
      if (pet !== null) {
        if (pet.office.pets.find((p) => p.id === pet.petId)?.bubbleType) {
          pet.office.dismissPetBubble(pet.petId);
        } else {
          pet.office.showPetBubble(pet.petId);
        }
        return;
      }

      // No agent hit — check seat click while agent is selected
      const selectedId = building.selectedAgentId;
      if (selectedId !== null) {
        const office = selectedFloor()?.office;
        const selectedCh = office?.characters.get(selectedId);
        // Skip seat reassignment for sub-agents
        if (office && selectedCh && !selectedCh.isSubagent) {
          const tile = screenToTile(e.clientX, e.clientY);
          const seatId = tile ? office.getSeatAtTile(tile.col, tile.row) : null;
          const seat = seatId ? office.seats.get(seatId) : undefined;
          if (seatId && seat) {
            if (selectedCh.seatId === seatId) {
              // Clicked own seat — send agent back to it
              office.sendToSeat(selectedId);
              building.selectedAgentId = null;
              building.cameraFollowId = null;
              return;
            } else if (!seat.assigned) {
              // Clicked available seat — reassign
              office.reassignSeat(selectedId, seatId);
              building.selectedAgentId = null;
              building.cameraFollowId = null;
              transport.send({ type: 'saveAgentSeats', seats: building.getPersistableSeats() });
              return;
            }
          }
        }
        // Clicked empty space — deselect
        building.selectedAgentId = null;
        building.cameraFollowId = null;
      }
    },
    [building, onClick, screenToIso, screenToTile, selectedFloor],
  );

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    building.hoveredAgentId = null;
    building.hoveredTile = null;
    // Reset the cursor so it doesn't stay a pointer after hovering a pet.
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'default';
    }
  }, [building]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Right-click to walk selected agent to a tile of its own floor
      const selectedId = building.selectedAgentId;
      const tile = screenToTile(e.clientX, e.clientY);
      if (selectedId !== null && tile) {
        selectedFloor()?.office.walkToTile(selectedId, tile.col, tile.row);
      }
    },
    [building, screenToTile, selectedFloor],
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
      building.cameraFollowId = null;
      building.ground.cancelGreeterCamera();
      panRef.current = clampToView({
        x: panRef.current.x - deltaX * dpr,
        y: panRef.current.y - deltaY * dpr,
      });
    },
    [building, panRef, clampToView],
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
