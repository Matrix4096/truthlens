import { useEffect, useRef } from "react";
import { animate, useMotionValue } from "framer-motion";
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
  const numberRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controls = animate(progress, score, {
      duration: 1.3,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(v) {
        if (numberRef.current) numberRef.current.textContent = String(Math.round(v));
        if (barRef.current) {
          const lit = Math.round((v / 100) * SEGMENTS);
          barRef.current.querySelectorAll("i").forEach((el, i) => {
            (el as HTMLElement).style.opacity = i < lit ? "1" : "0.14";
          });
        }
      },
    });
    return () => controls.stop();
  }, [score, progress]);

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-end gap-2 leading-none">
        <span
          ref={numberRef}
          className="font-giant text-[88px] leading-[0.85] tabular-nums sm:text-[110px]"
          style={{ color: style.hex }}
        >
          0
        </span>
        <span className="font-mono2 mb-1 text-sm text-panel-soft">/100</span>
      </div>
      <div ref={barRef} className="flex w-full max-w-[280px] gap-[3px]">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <i
            key={i}
            className="block h-3.5 flex-1"
            style={{ backgroundColor: style.hex, opacity: 0.14 }}
          />
        ))}
      </div>
      <span className="mono-label text-[9px] text-panel-soft">CREDIBILITY SCORE · 可靠度评分</span>
    </div>
  );
}
