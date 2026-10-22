import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { LogoContent } from "./SiteHeader";

type Phase = "loading" | "fly" | "done";
const INTRO_MS = 420;
const FLY_MS = 520;
const CENTER_H = 118;
const SEEN_KEY = "truthlens:intro-seen";

function shouldSkipIntro() {
  if (
    document.hidden ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return true;
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** A short, skippable brand reveal; it does not pretend to track network loading. */
export default function Preloader() {
  const [phase, setPhase] = useState<Phase>(() =>
    shouldSkipIntro() ? "done" : "loading"
  );
  const [progress, setProgress] = useState(0);
  const [flyStyle, setFlyStyle] = useState<CSSProperties>({ opacity: 0 });
  const flyerRef = useRef<HTMLDivElement>(null);
  const finished = phase === "done";

  useEffect(() => {
    if (finished) {
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* Storage can be disabled. */
      }
      return;
    }
    const root = document.documentElement;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    root.classList.add("preloading");
    const finish = () => setPhase("done");
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    const onMotion = () => {
      if (motion.matches) finish();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("keydown", onKey);
    motion.addEventListener("change", onMotion);

    const frame = requestAnimationFrame(() => {
      const rect = flyerRef.current?.getBoundingClientRect();
      if (!rect?.height || !rect.width) {
        finish();
        return;
      }
      const scale = Math.min(
        CENTER_H / rect.height,
        (window.innerWidth * 0.82) / rect.width
      );
      setFlyStyle({
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity: 1,
      });
    });
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      setProgress(
        Math.min(100, ((performance.now() - startedAt) / INTRO_MS) * 100)
      );
    }, 50);
    const flyTimer = window.setTimeout(() => {
      clearInterval(interval);
      setProgress(100);
      const anchor = document.querySelector("[data-logo-anchor]");
      if (!anchor || !flyerRef.current) {
        finish();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
      const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
      setFlyStyle({
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`,
        opacity: 1,
        transition: `transform ${FLY_MS}ms cubic-bezier(0.6, 0, 0.25, 1)`,
        willChange: "transform",
      });
      setPhase("fly");
    }, INTRO_MS);
    // Always release the overlay, including when transitionend is lost.
    const deadline = window.setTimeout(finish, INTRO_MS + FLY_MS + 100);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
      clearTimeout(flyTimer);
      clearTimeout(deadline);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("keydown", onKey);
      motion.removeEventListener("change", onMotion);
      root.classList.remove("preloading");
    };
  }, [finished]);

  if (finished) return null;
  const flying = phase === "fly";

  return (
    <div
      className="fixed inset-0 z-[100000]"
      style={{ pointerEvents: flying ? "none" : "auto" }}
    >
      <div
        className={cn(
          "bg-chrome absolute inset-0 transition-opacity duration-500",
          flying && "opacity-0"
        )}
        aria-hidden
      >
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4 sm:px-8">
          <span className="mono-label opacity-70">
            Deep-search fact-check engine
          </span>
          <span className="mono-label hidden opacity-70 sm:block">
            EST. 2026
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0">
          <div className="flex items-center justify-between px-4 pb-3 sm:px-8">
            <span className="mono-label opacity-70">WELCOME TO TRUTHLENS</span>
            <span className="mono-label opacity-70">READY</span>
          </div>
          <div className="h-[5px] w-full bg-[color-mix(in_srgb,var(--c-fg)_18%,transparent)]">
            <div
              className="h-full origin-left bg-[color:var(--c-fg)]"
              style={{ transform: `scaleX(${progress / 100})` }}
            />
          </div>
        </div>
      </div>
      {!flying && (
        <button
          type="button"
          onClick={() => setPhase("done")}
          className="absolute right-4 bottom-14 z-10 border border-ink px-3 py-2 text-xs sm:right-8"
        >
          跳过动画 · Esc
        </button>
      )}
      <div
        ref={flyerRef}
        aria-hidden
        className={cn(
          "preloader-flyer fixed top-1/2 left-1/2 z-[100001]",
          flying && "flying"
        )}
        style={{ transformOrigin: "center", ...flyStyle }}
        onTransitionEnd={event => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "transform" &&
            flying
          )
            setPhase("done");
        }}
      >
        <div className="flex items-center gap-3">
          <LogoContent />
        </div>
      </div>
    </div>
  );
}
