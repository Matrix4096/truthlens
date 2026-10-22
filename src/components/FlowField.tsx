import { useEffect, useRef } from "react";
import { createCanvasAnimation } from "@/hooks/canvas-animation";

/**
 * 交互式流线场（仿 wodniack.dev <a-waves>）：
 *  - 竖直细线做环境波浪运动
 *  - 线条随鼠标位置被"推开"，弯曲环绕光标（带惯性平滑）
 *  - 鼠标离开后影响力逐渐衰减，线条弹回
 */
export default function FlowField({
  className,
  varName = "--c-fg",
}: {
  className?: string;
  /** 线条颜色取自哪个 CSS 变量 */
  varName?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let t = Math.random() * 100;
    const compact = window.matchMedia("(pointer: coarse)").matches;
    let dpr = 1;

    // ---- 鼠标状态（目标值 + 平滑当前值 + 强度） ----
    const mouse = {
      x: -9999,
      y: -9999,
      tx: -9999,
      ty: -9999,
      power: 0,
      targetPower: 0,
    };
    const RADIUS = 240; // 影响半径 px
    const STRENGTH = 95; // 最大推挤位移 px

    const onMove = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = clientX - r.left;
      mouse.ty = clientY - r.top;
      mouse.targetPower = 1;
    };
    const onLeave = () => {
      mouse.targetPower = 0;
    };
    const handlePointer = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !animation.motionAllowed) return;
      onMove(e.clientX, e.clientY);
    };
    window.addEventListener("pointermove", handlePointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    const resize = () => {
      dpr = Math.min(compact ? 1.5 : 2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      animation.requestRender();
    };

    let ink = "#170f0e";
    const updateInk = () => {
      ink =
        getComputedStyle(document.documentElement)
          .getPropertyValue(varName)
          .trim() || "#170f0e";
      animation.requestRender();
    };

    const draw = (deltaMs: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // 平滑趋近
      const frames = deltaMs / (1000 / 60);
      mouse.x += (mouse.tx - mouse.x) * (1 - 0.91 ** frames);
      mouse.y += (mouse.ty - mouse.y) * (1 - 0.91 ** frames);
      mouse.power =
        deltaMs === 0
          ? 0
          : mouse.power +
            (mouse.targetPower - mouse.power) * (1 - 0.94 ** frames);

      ctx.strokeStyle = ink;
      ctx.lineWidth = dpr * 0.55;

      const gap = (compact ? 15 : 11) * dpr;
      const cols = Math.ceil(w / gap) + 2;
      const step = (compact ? 12 : 7) * dpr;
      const mx = mouse.x * dpr;
      const my = mouse.y * dpr;
      const R = RADIUS * dpr;
      const S = STRENGTH * dpr * mouse.power;
      const TWO_R2 = 2 * R * R;

      for (let i = -1; i < cols; i++) {
        const x0 = i * gap;
        // 光标附近的线条提亮
        const lineBoost =
          mouse.power > 0.02
            ? Math.exp(-((x0 - mx) * (x0 - mx)) / TWO_R2) * 0.4 * mouse.power
            : 0;
        ctx.globalAlpha = Math.min(0.75, 0.32 + lineBoost);
        ctx.beginPath();
        for (let y = 0; y <= h + step; y += step) {
          const yy = y / dpr;
          // 环境波动
          let n =
            Math.sin(yy * 0.0042 + i * 0.31 + t) * 24 * dpr +
            Math.sin(yy * 0.0013 - i * 0.17 + t * 0.63) * 34 * dpr +
            Math.sin(i * 0.043 + t * 0.4) * 10 * dpr;

          // 鼠标推挤：高斯衰减的径向位移
          if (S > 0.5) {
            const dx = x0 - mx;
            const dy = y - my;
            const d2 = dx * dx + dy * dy;
            if (d2 < R * R * 4) {
              const fall = Math.exp(-d2 / TWO_R2); // 0..1
              const d = Math.sqrt(d2) || 1;
              n += (dx / d) * S * fall;
            }
          }

          const x = x0 + n;
          if (y === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      t += 0.0038 * frames;
    };
    const animation = createCanvasAnimation(canvas, draw, compact ? 24 : 30);
    resize();
    updateInk();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // Read theme colors only when they change, avoiding a style read on every frame.
    const themeObserver = new MutationObserver(updateInk);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      animation.dispose();
      ro.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("pointermove", handlePointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [varName]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
