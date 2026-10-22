import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  className?: string;
  /** rise = 逐字掩码升起；stamp = 轻微缩放显现 */
  variant?: "rise" | "stamp";
  startDelay?: number; // 首字延迟 ms
  step?: number; // 每字间隔 ms
  /** 入场完成后可选播放一次翻字，默认关闭 */
  roll?: boolean;
  /** 单次翻字时长 ms，默认 650；保留原有 prop 名以兼容调用方 */
  rollInterval?: number;
  /** 变更时重播动画 */
  replayKey?: unknown;
  /** 在第 after 个字之后插入装饰节点，不参与翻字 */
  inject?: { after: number; node: ReactNode };
}

/**
 * 标题只在出现或明确重播时入场，可选的翻字也仅播放一次。
 * 独立的可访问文本避免读屏重复朗读装饰字形。
 */
export default function SplitChars({
  text,
  className,
  variant = "rise",
  startDelay = 0,
  step = 45,
  roll = false,
  rollInterval = 650,
  replayKey,
  inject,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) {
      element.classList.add("is-in", "revealed");
      return;
    }
    element.classList.remove("is-in", "revealed");
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => element.classList.add("is-in"));
    });
    const total = startDelay + step * (Array.from(text).length + 1) + 560;
    const timer = setTimeout(() => element.classList.add("revealed"), total);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(timer);
    };
  }, [text, replayKey, startDelay, step, variant, className, roll]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !roll) return;
    let visible = true;
    const sync = () =>
      element.toggleAttribute(
        "data-animation-paused",
        !visible || document.hidden
      );
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [roll]);

  const chars = Array.from(text);

  return (
    <span
      ref={ref}
      className={cn(
        "split-chars",
        variant === "stamp" && "variant-stamp",
        roll && "auto-roll",
        className
      )}
    >
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => (
        <span key={`${i}-${ch}`} style={{ display: "contents" }}>
          <span className="sc-mask" aria-hidden>
            <span
              className="sc-reveal"
              style={{ transitionDelay: `${startDelay + i * step}ms` }}
            >
              <span
                className="sc-roll"
                style={{
                  animationDelay: `${i * 40}ms`,
                  animationDuration: `${rollInterval}ms`,
                }}
              >
                <span className="sc-glyph">{ch === " " ? "\u00A0" : ch}</span>
                {roll && (
                  <span className="sc-glyph" aria-hidden>
                    {ch === " " ? "\u00A0" : ch}
                  </span>
                )}
              </span>
            </span>
          </span>
          {inject && i === inject.after && (
            <span className="sc-mask sc-inject" aria-hidden>
              <span
                className="sc-reveal"
                style={{
                  transitionDelay: `${startDelay + (i + 1) * step}ms`,
                  display: "inline-flex",
                  alignItems: "center",
                }}
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
