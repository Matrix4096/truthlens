import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ClaimAnalysis, SourceItem } from "@contracts/types";
import { SectionBar } from "./Bits";

export type Stage = "analyzing" | "searching" | "judging";
type StepKey = Stage | "cross";

const STEPS: { key: StepKey; no: string; title: string; en: string; desc: string }[] = [
  { key: "analyzing", no: "01", title: "主张拆解", en: "DECOMPOSE", desc: "提炼核心事实主张，生成多路检索策略" },
  { key: "searching", no: "02", title: "互联网深度搜索", en: "DEEP SEARCH", desc: "多路并行检索，抓取高权威来源正文" },
  { key: "cross", no: "03", title: "权威源交叉验证", en: "CROSS-CHECK", desc: "比对各来源立场、时效与一致性" },
  { key: "judging", no: "04", title: "置信度综合判定", en: "VERDICT", desc: "AI 基于证据链给出可靠度评分" },
];

const ORDER: Record<StepKey, number> = { analyzing: 0, searching: 1, cross: 2, judging: 3 };

interface Props {
  stage: Stage;
  analysis?: ClaimAnalysis | null;
  sources?: SourceItem[] | null;
}

export default function PipelineSteps({ stage, analysis, sources }: Props) {
  const current = ORDER[stage];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-panel border border-ink"
    >
      <SectionBar>
        Pipeline · 正在执行深度核查 <span className="animate-blink">●</span>
      </SectionBar>

      <div>
        {STEPS.map((step, i) => {
          const idx = ORDER[step.key];
          const done = current > idx || (stage === "judging" && step.key === "cross");
          const active = step.key === stage || (stage === "judging" && step.key === "judging");
          return (
            <div
              key={step.key}
              className={cn(
                "grid grid-cols-[64px_1fr_auto] items-start gap-4 px-4 py-4 sm:grid-cols-[80px_1fr_auto] sm:px-6",
                i < STEPS.length - 1 && "border-b border-panel-line",
              )}
            >
              <span
                className={cn(
                  "font-giant text-3xl leading-none sm:text-4xl",
                  done ? "text-[#f5273f]" : active ? "text-[color:var(--panel-fg)]" : "text-stroke-panel",
                )}
              >
                {step.no}
              </span>
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span
                    className={cn(
                      "text-sm font-bold tracking-wide",
                      done || active ? "text-[color:var(--panel-fg)]" : "text-panel-soft",
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="mono-label text-[8px] text-panel-soft">{step.en}</span>
                </div>
                <p className="mt-1 text-xs text-panel-soft">{step.desc}</p>

                {step.key === "analyzing" && analysis && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2.5 flex flex-wrap gap-1.5">
                    {analysis.queries.map((q) => (
                      <span key={q} className="font-mono2 border border-[#f5273f]/40 bg-[#f5273f]/10 px-2 py-0.5 text-[10px] text-[#ff8090]">
                        {q}
                      </span>
                    ))}
                  </motion.div>
                )}
                {step.key === "searching" && sources && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2.5">
                    <div className="font-mono2 text-[10px] text-emerald-400">
                      ▸ 已锁定 {sources.length} 个相关来源
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {[...new Set(sources.map((s) => s.siteName))].slice(0, 8).map((name) => (
                        <span key={name} className="font-mono2 border border-panel-line px-2 py-0.5 text-[10px] text-panel-soft">
                          {name}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
              <span className="mono-label pt-1 text-[9px]">
                {done ? (
                  <span className="text-[#f5273f]">■ DONE</span>
                ) : active ? (
                  <span className="animate-blink text-[color:var(--panel-fg)]">▶ RUN</span>
                ) : (
                  <span className="text-panel-soft">□ WAIT</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
