import { MAX_DELTA_TIME_SEC } from '../../constants.js';

/** @internal */
export interface GameLoopCallbacks {
  update: (dt: number) => void;
  render: () => void;
}

export function startGameLoop(callbacks: GameLoopCallbacks): () => void {
  let lastTime = 0;
  let rafId = 0;
  let stopped = false;

  const frame = (time: number) => {
    if (stopped) return;
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC);
    lastTime = time;

    callbacks.update(dt);
    callbacks.render();

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}
