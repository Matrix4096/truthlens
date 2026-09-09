import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 确定性伪随机 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 二进制 0/1 装饰带 */
export function BinaryStrip({
  seed = 7,
  className,
  groups = 6,
}: {
  seed?: number;
  className?: string;
  groups?: number;
}) {
  const text = useMemo(() => {
    const rnd = mulberry32(seed);
    const parts: string[] = [];
    for (let g = 0; g < groups; g++) {
      let bits = "";
      const n = 10 + Math.floor(rnd() * 14);
      for (let i = 0; i < n; i++) bits += rnd() > 0.5 ? "1" : "0";
      parts.push(bits);
    }
    return parts;
  }, [seed, groups]);

  return (
    <div
      className={cn(
        "font-mono2 flex items-center gap-3 overflow-hidden whitespace-nowrap text-[9px] tracking-[0.18em] opacity-50 select-none",
        className,
      )}
      aria-hidden
    >
      <span>▸</span>
      {text.map((p, i) => (
        <span key={i} className="flex items-center gap-3">
          <span>{p}</span>
          <span className="opacity-60">{"//".repeat(14)}</span>
        </span>
      ))}
      <span>◂</span>
    </div>
  );
}

/** 超大字母跑马灯 */
export function Marquee({
  text,
  className,
  fast,
  outline,
}: {
  text: string;
  className?: string;
  fast?: boolean;
  outline?: boolean;
}) {
  const chunk = (
    <span className="flex shrink-0 items-baseline">
      {Array.from({ length: 6 }).map((_, i) => (
        <span key={i} className="font-giant mx-[0.35em] leading-none whitespace-nowrap">
          {text}
        </span>
      ))}
    </span>
  );
  return (
    <div className={cn("overflow-hidden select-none", className)} aria-hidden>
      <div className={cn("flex w-max", fast ? "animate-marquee-fast" : "animate-marquee", outline && "text-stroke-ink")}>
        {chunk}
        {chunk}
      </div>
    </div>
  );
}

/** 黑色节区标签条（等宽小号字） */
export function SectionBar({
  children,
  className,
  invert,
}: {
  children: ReactNode;
  className?: string;
  invert?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center px-4 py-2",
        invert ? "bg-chrome border-y border-ink" : "bg-ink",
        className,
      )}
    >
      <span className="mono-label">{children}</span>
    </div>
  );
}

/** 单元格角标序号 */
export function CellIndex({ n, className }: { n: string; className?: string }) {
  return (
    <span className={cn("mono-label opacity-60", className)}>[{n}]</span>
  );
}
