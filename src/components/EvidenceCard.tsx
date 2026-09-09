import { ExternalLink } from "lucide-react";
import type { SourceItem } from "@contracts/types";
import { STANCE_STYLE, RELIABILITY_STYLE } from "@/lib/verdict";
import { cn } from "@/lib/utils";

interface Props {
  source: SourceItem;
  index: number;
}

export default function EvidenceCard({ source, index }: Props) {
  const stance = STANCE_STYLE[source.stance];
  const rel = RELIABILITY_STYLE[source.reliability];

  return (
    <div className="group flex flex-col border border-panel-line bg-[color-mix(in_srgb,var(--panel-fg)_2%,transparent)] transition-colors hover:border-[color-mix(in_srgb,var(--panel-fg)_30%,transparent)]">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 border-b border-panel-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-giant shrink-0 text-xl leading-none" style={{ color: stance.hex }}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 text-sm leading-snug font-medium text-[color:var(--panel-fg)] decoration-[#f5273f] decoration-2 underline-offset-4 hover:underline"
          >
            {source.title}
          </a>
        </div>
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-panel-soft" />
      </div>

      {/* 元信息 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5">
        <span className="font-mono2 text-[10px] text-[color:var(--panel-fg)]">{source.siteName}</span>
        {source.date && <span className="font-mono2 text-[10px] text-panel-soft">· {source.date}</span>}
        <span className={cn("font-mono2 border px-1.5 py-px text-[9px]", stance.cls)}>{stance.label}</span>
        <span className={cn("font-mono2 border px-1.5 py-px text-[9px]", rel.cls)}>{rel.label}</span>
      </div>

      {/* 摘要 */}
      {source.snippet && (
        <p className="font-serif-body line-clamp-4 px-4 pb-3 text-xs leading-relaxed text-panel-soft">
          {source.snippet}
        </p>
      )}

      {/* 核查员注 */}
      {source.note && (
        <div className="mt-auto border-t border-panel-line px-4 py-2.5">
          <p className="font-mono2 text-[10px] leading-relaxed text-[#ff8090]">核查员注 — {source.note}</p>
        </div>
      )}
    </div>
  );
}
