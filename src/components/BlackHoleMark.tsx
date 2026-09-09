import { useEffect, useRef } from "react";

/**
 * 仿真黑洞标志（Canvas 实时渲染，从零重写 —— 主题为「引力」）：
 *  1. 引力透镜星场：恒星光线被弯折，像向外移位，近视界恒星被拉成弧
 *  2. 弯曲时空网格：同心圆 + 辐条向视界凹陷（橡胶膜可视化）
 *  3. 引力俘获物质：粒子按开普勒定律加速盘旋坠入视界
 *  4. 引力透镜吸积盘 + 光子环（远侧盘被弯折成上/下光环，左亮右暗）
 */
export default function BlackHoleMark({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = 320; // 逻辑分辨率（正方形）
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    ctx.scale(dpr, dpr);

    const cx = S / 2;
    const cy = S / 2;
    const HZ = 42; // 视界半径
    const RX = 138; // 吸积盘赤道半径
    const RY = 34; // 盘扁率
    const TILT = -0.2;
    const G_GRID = HZ * HZ * 1.15; // 网格凹陷强度
    const G_LENS = HZ * HZ * 0.85; // 星光弯折强度
    const TAU = Math.PI * 2;

    const rnd = mulberry(20260719);
    function mulberry(seed: number) {
      return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    }

    // ---------- 恒星（天球坐标，固定） ----------
    interface Star {
      th: number;
      r: number;
      mag: number;
      tw: number;
    }
    const stars: Star[] = Array.from({ length: 90 }, () => ({
      th: rnd() * TAU,
      r: HZ * 1.35 + rnd() * (S * 0.48 - HZ * 1.35),
      mag: 0.5 + rnd() * 1.5,
      tw: 1 + rnd() * 4,
    }));

    // ---------- 坠入物质粒子 ----------
    interface Grain {
      th: number;
      r: number;
      size: number;
    }
    const grains: Grain[] = Array.from({ length: 34 }, () => ({
      th: rnd() * TAU,
      r: 1.1 + rnd() * 0.5,
      size: 0.8 + rnd() * 1.3,
    }));

    // 引力弯折：径向距离被"压"向视界（橡胶膜）
    const warpR = (r: number) => Math.max(HZ * 1.03, r - G_GRID / r);
    // 引力透镜：像的视位置被推离中心
    const lensR = (r: number) => r + G_LENS / r;

    function ellipseArc(rx: number, ry: number, rot: number, a0: number, a1: number, stroke: string | CanvasGradient, width: number, blur: number) {
      if (!ctx) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, a0, a1);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(255,140,60,0.85)";
      ctx.shadowBlur = blur;
      ctx.stroke();
      ctx.restore();
    }

    const diskGradient = (alpha: number, flick: number) => {
      const g = ctx!.createLinearGradient(cx - RX, cy, cx + RX, cy);
      const a = alpha * flick;
      g.addColorStop(0, `rgba(255,216,150,${a})`);
      g.addColorStop(0.35, `rgba(255,150,70,${a * 0.95})`);
      g.addColorStop(0.7, `rgba(230,90,40,${a * 0.7})`);
      g.addColorStop(1, `rgba(150,40,20,${a * 0.4})`);
      return g;
    };

    let raf = 0;
    let t = 0;

    const draw = () => {
      t += 0.016;
      const flick = 0.93 + Math.sin(t * 4.7) * 0.05 + Math.sin(t * 12.3) * 0.02;
      ctx.clearRect(0, 0, S, S);

      // ========== 1. 弯曲时空网格 ==========
      ctx.save();
      ctx.strokeStyle = "rgba(190,210,255,0.16)";
      ctx.lineWidth = 0.7;
      // 同心圆
      for (const rr of [HZ * 1.6, HZ * 2.3, HZ * 3.1, HZ * 4.0, HZ * 5.0]) {
        ctx.beginPath();
        let started = false;
        for (let a = 0; a <= 360; a += 3) {
          const th = (a / 180) * Math.PI;
          const r2 = warpR(rr);
          const x = cx + Math.cos(th) * r2;
          const y = cy + Math.sin(th) * r2;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // 辐条
      for (let k = 0; k < 16; k++) {
        const th = (k / 16) * TAU;
        ctx.beginPath();
        let started = false;
        for (let r = HZ * 1.05; r <= HZ * 5.2; r += 7) {
          const r2 = warpR(r);
          const x = cx + Math.cos(th) * r2;
          const y = cy + Math.sin(th) * r2;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // ========== 2. 引力透镜星场 ==========
      for (const st of stars) {
        const rApp = lensR(st.r);
        const stretch = 1 + (G_LENS * 3) / (st.r * st.r); // 近视界切向拉长
        const x = cx + Math.cos(st.th) * rApp;
        const y = cy + Math.sin(st.th) * rApp;
        if (x < -8 || x > S + 8 || y < -8 || y > S + 8) continue;
        const tw = 0.65 + 0.35 * Math.sin(t * st.tw + st.th * 7);
        const boost = 1 + (G_LENS * 4) / (st.r * st.r); // 透镜增亮
        const alpha = Math.min(1, 0.55 * tw * boost);
        const tx = -Math.sin(st.th);
        const ty = Math.cos(st.th);
        const len = st.mag * stretch * 2.2;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(235,240,255,${alpha})`;
        ctx.lineWidth = st.mag * 0.75;
        ctx.lineCap = "round";
        ctx.moveTo(x - tx * len, y - ty * len);
        ctx.lineTo(x + tx * len, y + ty * len);
        ctx.stroke();
      }

      // ========== 3. 远侧吸积盘（被视界遮挡的后半） ==========
      ellipseArc(RX, RY, TILT, Math.PI, TAU, diskGradient(0.9, flick), 9, 13);

      // ========== 5. 事件视界 ==========
      const hg = ctx.createRadialGradient(cx, cy, HZ * 0.55, cx, cy, HZ * 1.02);
      hg.addColorStop(0, "#000");
      hg.addColorStop(0.88, "#000");
      hg.addColorStop(1, "rgba(12,5,3,0.95)");
      ctx.beginPath();
      ctx.fillStyle = hg;
      ctx.arc(cx, cy, HZ * 1.02, 0, TAU);
      ctx.fill();

      // ========== 6. 引力俘获：加速坠入的物质 ==========
      for (const g of grains) {
        // 开普勒：角速度 r^-1.5，径向加速内落
        g.th += 0.05 / Math.pow(g.r, 1.5);
        g.r -= 0.0045 / Math.sqrt(Math.max(g.r, 0.3));
        if (g.r < 0.52) {
          g.r = 1.15 + rnd() * 0.55;
          g.th = rnd() * TAU;
          continue;
        }
        const rr = 0.55 + (g.r - 0.52) * 0.75; // 轨道半径压缩到盘带
        const x = cx + Math.cos(g.th) * RX * rr;
        const y = cy + Math.sin(g.th) * RY * rr;
        const heat = Math.min(1, (1.05 - g.r) * 1.6); // 越近越热越亮
        const alpha = Math.min(1, Math.max(0, heat)) * (x < cx ? 1 : 0.6);
        if (alpha <= 0.03) continue;
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,${140 + Math.floor(100 * heat)},${60 + Math.floor(120 * heat)},${alpha})`;
        ctx.arc(x, y, g.size * (0.7 + heat * 0.5), 0, TAU);
        ctx.fill();
      }

      // ========== 8. 光子环 ==========
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,228,185,${0.85 * flick})`;
      ctx.lineWidth = 1.8;
      ctx.shadowColor = "rgba(255,200,120,0.95)";
      ctx.shadowBlur = 10;
      ctx.arc(cx, cy, HZ * 1.08, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ========== 9. 近侧吸积盘（前半，最亮） ==========
      ellipseArc(RX, RY, TILT, 0, Math.PI, diskGradient(1, flick), 10.5, 19);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: "1.25em",
        width: "1em",
        margin: "0 0.02em",
        overflow: "visible",
      }}
      aria-hidden
    >
      <canvas ref={ref} style={{ height: "0.98em", width: "0.98em", overflow: "visible" }} />
    </span>
  );
}
