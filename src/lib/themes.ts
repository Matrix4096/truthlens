/** 站点主题：bg=铬层底色 fg=墨色前景（面板恒为近黑，不随主题变化） */
export interface ThemeDef {
  key: string;
  zh: string;
  en: string;
  bg: string;
  fg: string;
}

export const THEMES: ThemeDef[] = [
  { key: "red", zh: "赤", en: "RED", bg: "#f5273f", fg: "#170f0e" },
  { key: "ink", zh: "墨", en: "INK", bg: "#170f0e", fg: "#f5273f" },
  { key: "phosphor", zh: "磷", en: "PHOSPHOR", bg: "#0d0208", fg: "#00ff41" },
  { key: "klein", zh: "蓝", en: "KLEIN", bg: "#002fa7", fg: "#f2efe9" },
  { key: "warning", zh: "示", en: "HAZARD", bg: "#ffd400", fg: "#17130a" },
  { key: "paper", zh: "纸", en: "PAPER", bg: "#f2efe9", fg: "#c8102e" },
];

export const DEFAULT_THEME = "red";

export function resolveTheme(key: string | null | undefined): string {
  return THEMES.some((t) => t.key === key) ? (key as string) : DEFAULT_THEME;
}
