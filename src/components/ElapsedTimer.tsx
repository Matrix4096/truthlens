import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** 单个数字：定宽，变化时触发滚动入场动画 */
function Digit({ d }: { d: string }) {
  return (
    <span className="inline-block overflow-hidden" style={{ width: "0.6em" }}>
      <span key={d} className="digit-tick inline-block w-full text-center">
        {d}
      </span>
    </span>
  );
}

/**
 * 核查计时器 — 左侧 分:秒（逐位跳动），右侧 .厘秒 快速滚动。
 * 颜色全部取自主题变量，随主题切换自动适配。
 */
export default function ElapsedTimer({ className }: { className?: string }) {
  const startRef = useRef(Date.now());
  const [ms, setMs] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setMs(Date.now() - startRef.current), 31);
    return () => clearInterval(t);
  }, []);

  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const ss = totalS % 60;
  const mm = Math.floor(totalS / 60) % 100;

  const mmStr = String(mm).padStart(2, "0");
  const ssStr = String(ss).padStart(2, "0");
  const csStr = String(cs).padStart(2, "0");

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-chrome flex items-end justify-between border border-ink px-4 py-3 sm:px-6",
        className,
      )}
    >
      <div className="pb-1">
        <div className="mono-label text-[9px] opacity-60">ELAPSED TIME</div>
        <div className="mt-1 text-xs font-bold tracking-[0.25em]">
          核查计时 <span className="animate-blink">●</span>
        </div>
      </div>

      <div className="flex items-baseline leading-none">
        {/* 左：分:秒 */}
        <span className="font-giant flex text-5xl sm:text-6xl">
          <Digit d={mmStr[0]} />
          <Digit d={mmStr[1]} />
          <span className="animate-blink mx-1 inline-block" style={{ width: "0.32em" }}>
            :
          </span>
          <Digit d={ssStr[0]} />
          <Digit d={ssStr[1]} />
        </span>
        {/* 右：.厘秒 */}
        <span className="font-mono2 ml-2 text-2xl opacity-60 tabular-nums sm:text-3xl">
          .{csStr}
        </span>
      </div>
    </motion.div>
  );
}
