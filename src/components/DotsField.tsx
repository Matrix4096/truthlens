import { useEffect, useRef } from "react";
import { createCanvasAnimation } from "@/hooks/canvas-animation";

interface Props {
  className?: string;
  /** 鼠标附近点阵的高亮颜色 */
  tint?: string;
}

const GAP = 11; // 点间距 px
const RADIUS = 150; // 鼠标作用半径 px
const LEVELS = 12; // 颜色量化档位

/** 交互点阵背景：点随鼠标靠近而提亮、放大并向四周轻微推挤 */
export default function DotsField({ className, tint = "#f5273f" }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const compact = window.matchMedia("(pointer: coarse)").matches;
    const gap = compact ? 15 : GAP;

    // tint → rgb
    const raw = tint.replace("#", "");
    const full =
      raw.length === 3
        ? raw
            .split("")
            .map(c => c + c)
            .join("")
        : raw;
    const tv = parseInt(full, 16);
    const tr = (tv >> 16) & 255;
    const tg = (tv >> 8) & 255;
    const tb = tv & 255;

    // 预计算各档颜色（基础灰白 → tint 高亮）
    const base = { r: 232, g: 222, b: 222 };
    const fills: string[] = [];
    for (let i = 0; i <= LEVELS; i++) {
      const t = i / LEVELS;
      const r = Math.round(base.r + (tr - base.r) * t);
      const g = Math.round(base.g + (tg - base.g) * t);
      const b = Math.round(base.b + (tb - base.b) * t);
      const a = i === 0 ? 0.16 : Math.min(0.95, 0.3 + t * 0.65);
      fills.push(`rgba(${r},${g},${b},${a})`);
    }

    let w = 0;
    let h = 0;
    let dots: Float32Array = new Float32Array(0);
    const mouse = {
      x: -9999,
      y: -9999,
      tx: -9999,
      ty: -9999,
      power: 0,
      tpower: 0,
    };

    const rebuild = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(compact ? 1.5 : 2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.max(1, Math.floor(w / gap));
      const rows = Math.max(1, Math.floor(h / gap));
      const ox = (w - (cols - 1) * gap) / 2;
      const oy = (h - (rows - 1) * gap) / 2;
      dots = new Float32Array(cols * rows * 2);
      let k = 0;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          dots[k++] = ox + i * gap;
          dots[k++] = oy + j * gap;
        }
      }
      animation.requestRender();
    };

    const draw = (deltaMs: number) => {
      ctx.clearRect(0, 0, w, h);
      const frames = deltaMs / (1000 / 60);
      mouse.x += (mouse.tx - mouse.x) * (1 - 0.84 ** frames);
      mouse.y += (mouse.ty - mouse.y) * (1 - 0.84 ** frames);
      mouse.power =
        deltaMs === 0
          ? 0
          : mouse.power + (mouse.tpower - mouse.power) * (1 - 0.92 ** frames);

      const R2 = RADIUS * RADIUS;
      const sigma2 = 2 * (RADIUS * 0.55) ** 2;
      let cur = -1;
      for (let i = 0; i < dots.length; i += 2) {
        const x0 = dots[i];
        const y0 = dots[i + 1];
        let px = x0;
        let py = y0;
        let lvl = 0;
        let sz = 1.2;
        if (mouse.power > 0.02) {
          const dx = x0 - mouse.x;
          const dy = y0 - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2) {
            const d = Math.sqrt(d2) || 1;
            const fall = Math.exp(-d2 / sigma2) * mouse.power;
            const push = fall * 7;
            px = x0 + (dx / d) * push;
            py = y0 + (dy / d) * push;
            lvl = Math.max(1, Math.round(fall * LEVELS));
            sz = 1.2 + fall * 1.8;
          }
        }
        if (lvl !== cur) {
          ctx.fillStyle = fills[lvl];
          cur = lvl;
        }
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
      }
      // Once the pointer settles, preserve the canvas pixels without another frame.
      return (
        Math.abs(mouse.tpower - mouse.power) > 0.005 ||
        (mouse.tpower > 0 &&
          (Math.abs(mouse.tx - mouse.x) > 0.1 ||
            Math.abs(mouse.ty - mouse.y) > 0.1))
      );
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !animation.motionAllowed) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      mouse.tx = x;
      mouse.ty = y;
      const margin = RADIUS * 0.4;
      mouse.tpower =
        x > -margin &&
        y > -margin &&
        x < rect.width + margin &&
        y < rect.height + margin
          ? 1
          : 0;
      animation.requestRender();
    };
    const onLeave = () => {
      mouse.tpower = 0;
      animation.requestRender();
    };

    const animation = createCanvasAnimation(canvas, draw);
    rebuild();
    const ro = new ResizeObserver(rebuild);
    ro.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    return () => {
      animation.dispose();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [tint]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
