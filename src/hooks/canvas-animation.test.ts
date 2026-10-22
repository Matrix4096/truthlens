import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasAnimation } from "./canvas-animation";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let time: number;
let page: EventTarget & { hidden: boolean };
let preference: EventTarget & { matches: boolean };
let intersect: (entries: { isIntersecting: boolean }[]) => void;
let disconnect: ReturnType<typeof vi.fn>;

function frame() {
  time += 1000 / 30;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(time));
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  time = 0;
  page = Object.assign(new EventTarget(), { hidden: false });
  preference = Object.assign(new EventTarget(), { matches: false });
  disconnect = vi.fn();
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { matchMedia: () => preference });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("decorative canvas lifecycle", () => {
  it("pauses while hidden or offscreen and resumes without a large time jump", () => {
    const draw = vi.fn();
    const animation = createCanvasAnimation({} as HTMLCanvasElement, draw);
    frame();
    expect(draw).toHaveBeenCalledTimes(1);
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    intersect([{ isIntersecting: false }]);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    time += 60_000;
    intersect([{ isIntersecting: true }]);
    frame();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls[1][0]).toBeLessThanOrEqual(64);
    animation.dispose();
  });

  it("switches to a static frame immediately when reduced motion is enabled", () => {
    const draw = vi.fn();
    const animation = createCanvasAnimation({} as HTMLCanvasElement, draw);
    frame();
    preference.matches = true;
    preference.dispatchEvent(new Event("change"));
    frame();
    expect(draw).toHaveBeenLastCalledWith(0);
    expect(frames.size).toBe(0);
    expect(animation.motionAllowed).toBe(false);
    animation.requestRender(); // A resized static canvas still needs painting.
    frame();
    expect(draw).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);
    preference.matches = false;
    preference.dispatchEvent(new Event("change"));
    frame();
    expect(frames.size).toBe(1);
    animation.dispose();
  });

  it("sleeps after an interactive scene settles and coalesces redraw requests", () => {
    const draw = vi.fn(() => false);
    const animation = createCanvasAnimation({} as HTMLCanvasElement, draw);
    frame();
    expect(frames.size).toBe(0);
    animation.requestRender();
    animation.requestRender();
    expect(frames.size).toBe(1);
    frame();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
    animation.dispose();
  });

  it("cancels pending work and detaches listeners on unmount", () => {
    const draw = vi.fn();
    const animation = createCanvasAnimation({} as HTMLCanvasElement, draw);
    animation.dispose();
    animation.requestRender();
    page.dispatchEvent(new Event("visibilitychange"));
    preference.dispatchEvent(new Event("change"));
    frame();
    expect(draw).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
