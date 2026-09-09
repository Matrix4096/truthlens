import type { Verdict, Stance, Reliability } from "@contracts/types";

export interface VerdictStyle {
  label: string;
  en: string;
  desc: string;
  /** 主强调色（用于黑色面板上的大字/边框/数字） */
  hex: string;
  text: string;
  border: string;
  bg: string;
}

export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
  true: {
    label: "属实",
    en: "TRUE",
    desc: "多源证据一致支持该说法",
    hex: "#34d399",
    text: "text-emerald-400",
    border: "border-emerald-400/50",
    bg: "bg-emerald-400",
  },
  mostly_true: {
    label: "基本属实",
    en: "MOSTLY TRUE",
    desc: "主干内容属实，细节存在出入",
    hex: "#2dd4bf",
    text: "text-teal-300",
    border: "border-teal-300/50",
    bg: "bg-teal-300",
  },
  mixed: {
    label: "部分属实",
    en: "MIXED",
    desc: "部分内容可信，但存在争议或失实成分",
    hex: "#fbbf24",
    text: "text-amber-400",
    border: "border-amber-400/50",
    bg: "bg-amber-400",
  },
  mostly_false: {
    label: "基本失实",
    en: "MOSTLY FALSE",
    desc: "主干说法不成立，仅少量内容属实",
    hex: "#fb923c",
    text: "text-orange-400",
    border: "border-orange-400/50",
    bg: "bg-orange-400",
  },
  false: {
    label: "失实",
    en: "FALSE",
    desc: "证据明确指向该说法为虚假或谣言",
    hex: "#fb4d63",
    text: "text-rose-400",
    border: "border-rose-400/50",
    bg: "bg-rose-400",
  },
  unverifiable: {
    label: "无法判定",
    en: "UNVERIFIABLE",
    desc: "公开证据不足，无法形成可靠结论",
    hex: "#a8b3c2",
    text: "text-slate-400",
    border: "border-slate-400/50",
    bg: "bg-slate-400",
  },
};

export const STANCE_STYLE: Record<Stance, { label: string; hex: string; cls: string }> = {
  support: { label: "支持", hex: "#34d399", cls: "border-emerald-400/40 text-emerald-400" },
  contradict: { label: "矛盾", hex: "#fb4d63", cls: "border-rose-400/40 text-rose-400" },
  neutral: { label: "中立", hex: "#a8b3c2", cls: "border-slate-400/40 text-slate-400" },
};

export const RELIABILITY_STYLE: Record<Reliability, { label: string; cls: string }> = {
  high: { label: "高可信来源", cls: "border-cyan-300/40 text-cyan-300" },
  medium: { label: "一般来源", cls: "border-slate-400/40 text-slate-400" },
  low: { label: "低可信来源", cls: "border-orange-400/40 text-orange-400" },
};
