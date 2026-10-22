import { useRef, useState } from "react";
import type { SearchMode } from "@contracts/types";
import "@/styles/claim-input.css";

const MODES: Array<{ key: SearchMode; zh: string; en: string; hint: string }> =
  [
    {
      key: "deep",
      zh: "深度核查",
      en: "DEEP",
      hint: "多路检索 + 正文抓取，约 2 分钟",
    },
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

export default function ClaimInput({
  busy,
  submitDisabled = false,
  submitLabel,
  value,
  onChange,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    <div className="tl-claim">
      {/* 黑色输入面板 */}
      <div className="tl-claim-panel">
        <div className="tl-claim-heading">
          <label htmlFor="claim-text" className="tl-claim-label">
            <span aria-hidden="true">↗</span> 输入待核查信息
          </label>
          <span className="tl-claim-count">
            {String(value.length).padStart(4, "0")} <span>/ 2000</span>
          </span>
        </div>
        <textarea
          ref={inputRef}
          id="claim-text"
          aria-label="待核查信息"
          aria-describedby="claim-writing-hint"
          maxLength={2000}
          value={value}
          onChange={e => onChange(e.target.value.slice(0, 2000))}
          onKeyDown={e => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
          placeholder="一条新闻、一个说法、一段传言……"
          className="tl-claim-textarea"
        />
        <p id="claim-writing-hint" className="tl-claim-writing-hint">
          描述越具体，越容易找到相关证据。至少输入 4 个字。
        </p>
        {/* 搜索模式切换 */}
        <div className="tl-claim-mode-row">
          <div className="tl-claim-modes" role="group" aria-label="检索模式">
            {MODES.map(m => (
              <button
                key={m.key}
                type="button"
                aria-pressed={mode === m.key}
                disabled={busy}
                onClick={() => pick(m.key)}
                className="tl-claim-mode"
              >
                <span className="tl-claim-mode-dot" aria-hidden="true" />
                {m.zh} <span className="tl-claim-mode-en">{m.en}</span>
              </button>
            ))}
          </div>
          <span className="tl-claim-mode-hint">
            {MODES.find(m => m.key === mode)?.hint}
          </span>
        </div>

        <div className="tl-claim-actions">
          <span className="tl-claim-shortcut">
            Ctrl / ⌘ + Enter <span aria-hidden="true">↵</span>
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={busy || submitDisabled || len < 4}
            aria-describedby="model-access-status"
            className="tl-claim-submit"
          >
            {busy
              ? "正在核查…"
              : (submitLabel ??
                (mode === "quick" ? "开始快速核查" : "开始深度核查"))}{" "}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>

      {/* 示例 */}
      <div className="tl-claim-examples">
        <span className="tl-claim-examples-label">
          没有头绪？从一个说法开始
        </span>
        <div className="tl-claim-example-list">
          {EXAMPLES.map((ex, index) => (
            <button
              type="button"
              key={ex}
              disabled={busy}
              onClick={() => {
                onChange(ex);
                inputRef.current?.focus({ preventScroll: true });
              }}
              className="tl-claim-example"
            >
              <span className="tl-claim-example-index" aria-hidden="true">
                0{index + 1}
              </span>
              <span>{ex}</span>
              <span className="tl-claim-example-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
