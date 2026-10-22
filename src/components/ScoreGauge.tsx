import { useEffect, useRef } from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import type { Verdict } from "@contracts/types";
import { VERDICT_STYLE } from "@/lib/verdict";

interface Props {
  score: number; // 0-100
  verdict: Verdict;
}

const SEGMENTS = 25;

export default function ScoreGauge({ score, verdict }: Props) {
  const style = VERDICT_STYLE[verdict];
  const progress = useMotionValue(0);
  const reduced = useReducedMotion();
  const boundedScore = Number.isFinite(score)
    ? Math.min(100, Math.max(0, score))
    : 0;
  const numberRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const segments = Array.from(barRef.current?.querySelectorAll("i") ?? []);
    let previousNumber = -1;
    let previousLit = -1;
    const paint = (value: number) => {
      const number = Math.round(value);
      if (number !== previousNumber && numberRef.current)
        numberRef.current.textContent = String(number);
      previousNumber = number;
      const lit = Math.round((value / 100) * SEGMENTS);
      if (lit !== previousLit)
        segments.forEach((element, i) => {
          element.style.opacity = i < lit ? "1" : "0.14";
        });
      previousLit = lit;
    };
    if (reduced) {
      progress.set(boundedScore);
      paint(boundedScore);
      return;
    }
    const controls = animate(progress, boundedScore, {
      duration: 1.3,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: paint,
    });
    return () => controls.stop();
  }, [boundedScore, progress, reduced]);

  return (
    <div
      className="flex flex-col items-start gap-3"
      role="meter"
      aria-label="可靠度评分"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedScore}
    >
      <div className="flex items-end gap-2 leading-none" aria-hidden>
        <span
          ref={numberRef}
          className="font-giant text-[88px] leading-[0.85] tabular-nums sm:text-[110px]"
          style={{ color: style.hex }}
        >
          0
        </span>
        <span className="font-mono2 mb-1 text-sm text-panel-soft">/100</span>
      </div>
      <div
        ref={barRef}
        className="flex w-full max-w-[280px] gap-[3px]"
        aria-hidden
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <i
            key={i}
            className="block h-3.5 flex-1"
            style={{ backgroundColor: style.hex, opacity: 0.14 }}
          />
        ))}
      </div>
      <span className="mono-label text-[9px] text-panel-soft">
        CREDIBILITY SCORE · 可靠度评分
      </span>
    </div>
  );
}
