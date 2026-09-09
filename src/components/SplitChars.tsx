import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  className?: string;
  /** rise = 逐字掩码升起；stamp = 逐字盖章砸入 */
  variant?: "rise" | "stamp";
  startDelay?: number; // 首字延迟 ms
  step?: number; // 每字间隔 ms
  /** 自动波浪翻滚（入场完成后，每隔 rollInterval 滚动一次） */
  roll?: boolean;
  /** 自动翻滚周期 ms，默认 6500 */
  rollInterval?: number;
  /** 变更时重播动画 */
  replayKey?: unknown;
  /** 在第 after 个字之后插入自定义节点（如黑洞标志），不参与翻滚 */
  inject?: { after: number; node: ReactNode };
}

/**
 * 拆字动画（仿 wodniack.dev 标题）：
 * 将文本拆为逐字 span，支持交错入场与定时自动波浪翻滚。
 * 翻滚采用双字叠放条带：滚动恰好一个字高，终点与起点画面一致，循环无接缝。
 */
export default function SplitChars({
  text,
  className,
  variant = "rise",
  startDelay = 0,
  step = 70,
  roll = true,
  rollInterval = 6500,
  replayKey,
  inject,
}: Props) {
  const [inView, setInView] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setInView(false);
    setRevealed(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setInView(true)));
    const total = startDelay + step * (Array.from(text).length + 1) + 900;
    const timer = setTimeout(() => setRevealed(true), total);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [text, replayKey, startDelay, step]);

  const chars = Array.from(text);

  return (
    <span
      className={cn(
        "split-chars",
        inView && "is-in",
        revealed && "revealed",
        variant === "stamp" && "variant-stamp",
        roll && "auto-roll",
        className,
      )}
      aria-label={text}
      role="text"
    >
      {chars.map((ch, i) => (
        <span key={`${i}-${ch}`} style={{ display: "contents" }}>
          <span className="sc-mask" aria-hidden>
            <span className="sc-reveal" style={{ transitionDelay: `${startDelay + i * step}ms` }}>
              <span
                className="sc-roll"
                style={{
                  animationDelay: `${i * 40}ms`,
                  animationDuration: `${rollInterval}ms`,
                }}
              >
                <span className="sc-glyph">{ch === " " ? "\u00A0" : ch}</span>
                <span className="sc-glyph" aria-hidden>
                  {ch === " " ? "\u00A0" : ch}
                </span>
              </span>
            </span>
          </span>
          {inject && i === inject.after && (
            <span className="sc-mask" aria-hidden>
              <span
                className="sc-reveal"
                style={{ transitionDelay: `${startDelay + (i + 1) * step}ms`, display: "inline-flex", alignItems: "center" }}
              >
                {inject.node}
              </span>
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
