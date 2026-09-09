import { useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import type { VerificationResult, Verdict } from "@contracts/types";
import { VERDICT_STYLE } from "@/lib/verdict";
import { cn } from "@/lib/utils";
import ScoreGauge from "./ScoreGauge";
import EvidenceCard from "./EvidenceCard";
import SplitChars from "./SplitChars";
import { SectionBar, BinaryStrip } from "./Bits";
import DotsField from "./DotsField";

type Tab = "all" | "support" | "contradict" | "neutral";

interface Props {
  result: VerificationResult;
  onReset?: () => void;
}

export default function ResultView({ result, onReset }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const style = VERDICT_STYLE[result.verdict as Verdict];

  const filtered = result.sources.filter((s) => (tab === "all" ? true : s.stance === tab));
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "全部", count: result.stats.total },
    { key: "support", label: "支持", count: result.stats.support },
    { key: "contradict", label: "矛盾", count: result.stats.contradict },
    { key: "neutral", label: "中立", count: result.stats.neutral },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full">
      <SectionBar>Verdict · 核查判定结果</SectionBar>

      {/* ===== 判定主面板 ===== */}
      <div className="bg-panel relative border-b border-ink">
        <DotsField className="absolute inset-0 z-0 h-full w-full" tint={style.hex} />
        <div className="relative z-[1]">
        {/* 巨型号判定字（逐字盖章入场） */}
        <div className="overflow-hidden border-b border-panel-line px-4 pt-8 pb-4 sm:px-8">
          <div
            className="font-giant leading-[0.9] tracking-tight whitespace-nowrap"
            style={{ color: style.hex, fontSize: "clamp(72px, 14vw, 190px)" }}
          >
            <SplitChars text={style.label} variant="stamp" step={130} startDelay={150} replayKey={result.id} />
            <span className="font-mono2 ml-4 align-top text-[0.14em] tracking-[0.3em] text-panel-soft">
              {style.en}
            </span>
          </div>
        </div>

        <div className="grid gap-px bg-[color-mix(in_srgb,var(--panel-fg)_10%,transparent)] lg:grid-cols-[minmax(300px,380px)_1fr]">
          {/* 评分 */}
          <div className="bg-panel px-6 py-6 sm:px-8">
            <ScoreGauge score={result.credibilityScore} verdict={result.verdict} />
            {/* 置信度 */}
            <div className="mt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="mono-label text-[9px] text-panel-soft">CONFIDENCE · 判定置信度</span>
                <span className="font-giant text-2xl" style={{ color: style.hex }}>
                  {result.confidence}%
                </span>
              </div>
              <div className="h-2.5 w-full bg-[color-mix(in_srgb,var(--panel-fg)_10%,transparent)]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${result.confidence}%` }}
                  transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                  className="h-full"
                  style={{ backgroundColor: style.hex }}
                />
              </div>
            </div>
            {/* 统计 */}
            <div className="mt-6 grid grid-cols-2 gap-px border border-panel-line bg-[color-mix(in_srgb,var(--panel-fg)_10%,transparent)]">
              {[
                { label: "证据来源", value: result.stats.total },
                { label: "支持", value: result.stats.support },
                { label: "矛盾", value: result.stats.contradict },
                { label: "高权威", value: result.stats.highReliability },
                { label: "检索模式", value: result.mode === "quick" ? "快速" : "深度" },
                { label: "检索式", value: result.queries.length },
              ].map((s) => (
                <div key={s.label} className="bg-panel px-3 py-3">
                  <div className="font-giant text-2xl text-[color:var(--panel-fg)]">{s.value}</div>
                  <div className="mono-label mt-1 text-[8px] text-panel-soft">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 结论与要点 */}
          <div className="bg-panel px-6 py-6 sm:px-8">
            <div className="mono-label mb-3 text-[9px] text-panel-soft">SUMMARY · 综合结论</div>
            <p className="font-serif-body text-[17px] leading-relaxed text-[color:var(--panel-fg)]">
              {result.summary}
            </p>
            <div className="mono-label mt-7 mb-3 text-[9px] text-panel-soft">REASONING · 分析要点</div>
            <ul className="space-y-3">
              {result.reasoning.map((r, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.07 }}
                  className="flex gap-3 text-sm leading-relaxed text-panel-soft"
                >
                  <span className="font-giant shrink-0 text-base leading-tight" style={{ color: style.hex }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-serif-body">{r}</span>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>

        {/* 主张 + 检索策略 */}
        <div className="grid gap-px border-t border-panel-line bg-[color-mix(in_srgb,var(--panel-fg)_10%,transparent)] md:grid-cols-2">
          <div className="bg-panel px-6 py-5 sm:px-8">
            <div className="mono-label mb-3 text-[9px] text-panel-soft">CLAIMS · 拆解出的核心主张</div>
            <ul className="space-y-2">
              {result.coreClaims.map((c, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[color:var(--panel-fg)]">
                  <span className="font-mono2 shrink-0 text-[#f5273f]">[{i + 1}]</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-panel px-6 py-5 sm:px-8">
            <div className="mono-label mb-3 text-[9px] text-panel-soft">QUERIES · 实际执行的检索策略</div>
            <div className="flex flex-wrap gap-1.5">
              {result.queries.map((q) => (
                <span key={q} className="font-mono2 border border-[#f5273f]/40 bg-[#f5273f]/10 px-2 py-1 text-[10px] text-[#ff8090]">
                  {q}
                </span>
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* ===== 证据链 ===== */}
      <div className="bg-panel border-b border-ink">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-line px-4 py-3 sm:px-8">
          <span className="mono-label text-[9px] text-panel-soft">
            EVIDENCE CHAIN · 证据链（{result.stats.total}）
          </span>
          <div className="flex border border-panel-line">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "font-mono2 border-r border-panel-line px-3 py-1.5 text-[11px] last:border-r-0 transition-colors",
                  tab === t.key
                    ? "bg-[#f5273f] font-bold text-[#170f0e]"
                    : "text-panel-soft hover:text-[color:var(--panel-fg)]",
                )}
              >
                {t.label} {t.count}
              </button>
            ))}
          </div>
        </div>
        {filtered.length ? (
          <div className="grid gap-px bg-[color-mix(in_srgb,var(--panel-fg)_10%,transparent)] md:grid-cols-2">
            {filtered.map((s, i) => (
              <div key={s.id} className="bg-panel">
                <EvidenceCard source={s} index={i} />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center">
            <span className="mono-label text-panel-soft">该分类下没有证据来源</span>
          </div>
        )}
      </div>

      {/* ===== 底部操作 ===== */}
      <div className="bg-panel flex flex-col items-start justify-between gap-4 px-4 py-5 sm:flex-row sm:items-center sm:px-8">
        <p className="font-mono2 max-w-2xl text-[10px] leading-relaxed text-panel-soft">
          ⚠ 本结果由 AI 基于实时检索到的公开网络信息自动生成，判定受证据覆盖范围与时效限制，仅供参考。
          涉及健康、法律、财务等重大决策时，请进一步咨询专业机构。
          <span className="ml-2 opacity-60">
            {new Date(result.createdAt).toLocaleString("zh-CN")}
            {result.id > 0 && ` · #${result.id}`}
          </span>
        </p>
        {onReset && (
          <button
            onClick={onReset}
            className="font-giant flex shrink-0 items-center gap-2 bg-[#f5273f] px-6 py-3 text-lg tracking-wider text-[#170f0e] transition-all hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_color-mix(in_srgb,var(--panel-fg)_25%,transparent)]"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2.6} />
            核查新信息
          </button>
        )}
      </div>

      <BinaryStrip seed={result.id + 11} className="bg-chrome border-t border-ink px-4 py-2" />
    </motion.div>
  );
}
