/** Shared lifecycle for decorative canvases. A false return lets interactive scenes sleep. */
export function createCanvasAnimation(
  element: HTMLCanvasElement,
  draw: (deltaMs: number) => boolean | void,
  fps = 30
) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true;
  let disposed = false;
  let raf = 0;
  let lastTime = 0;
  const interval = 1000 / fps;

  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    lastTime = 0;
  };
  const frame = (time: number) => {
    raf = 0;
    if (disposed || !visible || document.hidden) return;
    const elapsed = lastTime ? time - lastTime : interval;
    if (!motion.matches && elapsed < interval - 1) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastTime = time;
    // Clamp resumed/slow frames so particles never jump across the scene.
    const again = draw(motion.matches ? 0 : Math.min(elapsed, 64));
    if (!motion.matches && again !== false) raf = requestAnimationFrame(frame);
    else lastTime = 0;
  };
  const requestRender = () => {
    if (!disposed && visible && !document.hidden && !raf)
      raf = requestAnimationFrame(frame);
  };
  const sync = () => {
    stop();
    requestRender();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  observer.observe(element);
  document.addEventListener("visibilitychange", sync);
  motion.addEventListener("change", sync);
  requestRender();

  return {
    requestRender,
    get motionAllowed() {
      return !motion.matches && visible && !document.hidden;
    },
    dispose() {
      disposed = true;
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    },
  };
}
