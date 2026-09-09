import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { LogoContent } from "./SiteHeader";

type Phase = "loading" | "fly" | "done";

/** 加载时长（进度 0→100） */
const LOAD_MS = 1600;
/** 飞行时长 */
const FLY_MS = 900;
/** 中央展示时 logo 组合的视觉高度 */
const CENTER_H = 118;

/**
 * 启动加载动画：铬层全屏覆盖，中央 logo（与页头同一结构，放大呈现）+ 进度计数；
 * 完成后 logo 缩放平移飞入页头锚点，落定即与真实 logo 像素级重合，无交接跳变。
 */
export default function Preloader() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  // 初始 opacity 0：待测量后一次性放置到居中放大位（无过渡），避免首帧跳变
  const [flyStyle, setFlyStyle] = useState<CSSProperties>({ opacity: 0 });
  const flyerRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  // 锁滚动 + 隐藏真实页头 logo（加载/飞行期间由飞行体代替）
  useEffect(() => {
    document.documentElement.classList.add("preloading");
    return () => document.documentElement.classList.remove("preloading");
  }, []);
  // 完成时恢复（组件不卸载，需在阶段变化时移除类）
  useEffect(() => {
    if (phase === "done") document.documentElement.classList.remove("preloading");
  }, [phase]);

  // 初始定位：测量自然尺寸，放大至中央展示尺寸（直写无过渡）
  useEffect(() => {
    const flyer = flyerRef.current;
    if (!flyer) return;
    const nat = flyer.getBoundingClientRect();
    const k = Math.min(CENTER_H / nat.height, (window.innerWidth * 0.82) / nat.width);
    setFlyStyle({ transform: `translate(-50%, -50%) scale(${k})`, opacity: 1 });
  }, []);

  // 进度计数（缓出）：定时器驱动，后台/无头环境 rAF 节流时也能按时完成
  useEffect(() => {
    const t0 = Date.now();
    const iv = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / LOAD_MS);
      const eased = 1 - (1 - p) * (1 - p);
      setProgress(Math.round(eased * 100));
      if (p >= 1) window.clearInterval(iv);
    }, 50);
    timers.current.push(window.setTimeout(startFly, LOAD_MS + 200));
    return () => {
      window.clearInterval(iv);
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startFly = () => {
    const anchor = document.querySelector("[data-logo-anchor]");
    const flyer = flyerRef.current;
    if (!anchor || !flyer) {
      setPhase("done");
      return;
    }
    const a = anchor.getBoundingClientRect();
    // 飞行体视觉中心恒为视口中心（translate(-50%,-50%) + 中心原点缩放）；
    // 目标：scale 回到 1（与页头同构同尺寸），中心对齐锚点中心
    const dx = a.left + a.width / 2 - window.innerWidth / 2;
    const dy = a.top + a.height / 2 - window.innerHeight / 2;
    setFlyStyle({
      transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`,
      opacity: 1,
      transition: `transform ${FLY_MS}ms cubic-bezier(0.6, 0, 0.25, 1)`,
      willChange: "transform",
    });
    setPhase("fly");
    timers.current.push(window.setTimeout(() => setPhase("done"), FLY_MS + 140));
  };

  if (phase === "done") return null;
  const flying = phase === "fly";

  return (
    <div className="fixed inset-0 z-[100000]" style={{ pointerEvents: flying ? "none" : "auto" }}>
      {/* 铬层背景：飞行时渐隐揭示页面 */}
      <div
        className={cn("bg-chrome absolute inset-0 transition-opacity duration-700", flying && "opacity-0")}
      >
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4 sm:px-8">
          <span className="mono-label opacity-70">Deep-search fact-check engine</span>
          <span className="mono-label hidden opacity-70 sm:block">EST. 2026</span>
        </div>
        <div className="absolute inset-x-0 bottom-0">
          <div className="flex items-center justify-between px-4 pb-3 sm:px-8">
            <span className="mono-label opacity-70">LOADING TRUTHLENS</span>
            <span className="mono-label opacity-70">{String(progress).padStart(3, "0")} / 100</span>
          </div>
          {/* 进度条：直写宽度，避免过渡反复重定向造成顿挫 */}
          <div className="h-[5px] w-full bg-[color-mix(in_srgb,var(--c-fg)_18%,transparent)]">
            <div className="h-full bg-[color:var(--c-fg)]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* 飞行 logo：与页头同一 LogoContent，加载期居中放大，飞行期缩放回 1 并平移归位 */}
      <div
        ref={flyerRef}
        className={cn("preloader-flyer fixed top-1/2 left-1/2 z-[100001]", flying && "flying")}
        style={{ transformOrigin: "center", ...flyStyle }}
      >
        <div className="flex items-center gap-3">
          <LogoContent />
        </div>
      </div>
    </div>
  );
}
