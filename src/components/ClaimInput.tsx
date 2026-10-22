import { useState } from "react";
import { BinaryStrip } from "./Bits";
import { cn } from "@/lib/utils";
import type { SearchMode } from "@contracts/types";

const MODES: Array<{ key: SearchMode; zh: string; en: string; hint: string }> = [
  { key: "deep", zh: "深度核查", en: "DEEP", hint: "多路检索 + 正文抓取，约 2 分钟" },
  { key: "quick", zh: "快速核查", en: "QUICK", hint: "精简检索，约 1 分钟" },
];

const EXAMPLES = [
  "吃隔夜菜会致癌",
  "阿波罗登月是一场骗局",
  "每天走一万步能显著延长寿命",
  "5G 基站的辐射会危害人体健康",
  "维生素 C 可以预防感冒",
  "蚊子更喜欢叮 O 型血的人",
];

interface Props {
  busy: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (claim: string, mode: SearchMode) => void;
}

export default function ClaimInput({ busy, submitDisabled = false, submitLabel, value, onChange, onSubmit }: Props) {
  const [mode, setMode] = useState<SearchMode>(() => {
    try {
      return localStorage.getItem("tl-mode") === "quick" ? "quick" : "deep";
    } catch {
      return "deep";
    }
  });
  const len = value.trim().length;

  const pick = (m: SearchMode) => {
    setMode(m);
    try {
      localStorage.setItem("tl-mode", m);
    } catch {
      /* ignore */
    }
  };

  const submit = () => {
    if (busy || submitDisabled || len < 4) return;
    onSubmit(value.trim(), mode);
  };

  return (
    <div className="w-full">
      {/* 黑色输入面板 */}
      <div className="bg-panel dots-panel border border-ink">
        <div className="flex items-center justify-between border-b border-panel-line px-4 py-2">
          <span className="mono-label text-panel-soft">Input · 输入待核查信息</span>
          <span className="mono-label text-panel-soft">{String(len).padStart(4, "0")} / 2000</span>
        </div>
        <textarea
          aria-label="待核查信息"
          maxLength={2000}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
          placeholder="一条新闻、一个说法、一段传言……"
          className="min-h-[130px] w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-relaxed text-[color:var(--panel-fg)] placeholder:text-[color-mix(in_srgb,var(--panel-fg)_30%,transparent)] focus:outline-none disabled:opacity-50"
        />
        {/* 搜索模式切换 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-panel-line px-4 py-2.5">
          <span className="mono-label text-panel-soft">MODE · 检索模式</span>
          <div className="flex border border-panel-line">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={mode === m.key}
                disabled={busy}
                onClick={() => pick(m.key)}
                className={cn(
                  "px-3.5 py-1.5 text-xs font-medium tracking-wide transition-colors disabled:opacity-40",
                  mode === m.key
                    ? "bg-[color:var(--c-fg)] text-[color:var(--c-bg)]"
                    : "text-panel-soft hover:text-[color:var(--panel-fg)]",
                )}
              >
                {m.zh} <span className="mono-label ml-1 text-[8px] opacity-70">{m.en}</span>
              </button>
            ))}
          </div>
          <span className="mono-label text-[8px] text-panel-soft opacity-70">
            {MODES.find((m) => m.key === mode)?.hint}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-line px-4 py-3">
          <span className="mono-label text-panel-soft hidden sm:block">CTRL + ENTER ↵</span>
          <button
            onClick={submit}
            disabled={busy || submitDisabled || len < 4}
            aria-describedby="model-access-status"
            className={cn(
              "font-giant ml-auto flex items-center gap-2 px-8 py-3 text-xl tracking-wider transition-all",
              busy || submitDisabled || len < 4
                ? "cursor-not-allowed bg-[color-mix(in_srgb,var(--panel-fg)_15%,transparent)] text-[color-mix(in_srgb,var(--panel-fg)_35%,transparent)]"
                : "bg-[color:var(--c-fg)] text-[color:var(--c-bg)] hover:translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_color-mix(in_srgb,var(--panel-fg)_25%,transparent)]",
            )}
          >
            {submitLabel ?? (mode === "quick" ? "开始快速核查" : "开始深度核查")} ↤
          </button>
        </div>
      </div>

      {/* 示例 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mono-label opacity-70">试试 →</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            disabled={busy}
            onClick={() => onChange(ex)}
            className="border border-ink px-3 py-1.5 text-xs font-medium transition-colors hover:bg-ink disabled:opacity-40"
          >
            {ex}
          </button>
        ))}
      </div>

      <BinaryStrip seed={len + 3} className="mt-6" />
    </div>
  );
}
