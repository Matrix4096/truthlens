import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  Contrast,
  LogIn,
  LogOut,
  ShieldCheck,
  User,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, resolveTheme } from "@/lib/themes";
import { useAuth } from "@/lib/auth";
import "@/styles/site-header.css";

/** 与主题同步的品牌线条标记。 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      data-logo-bars
      className={cn(
        "bg-ink flex items-center justify-center gap-[3px] px-2 py-1.5",
        className
      )}
    >
      <i className="block h-4 w-[3px] bg-current opacity-100" />
      <i className="block h-4 w-[3px] bg-current opacity-80" />
      <i className="block h-4 w-[3px] bg-current opacity-60" />
      <i className="block h-4 w-[3px] bg-current opacity-40" />
    </span>
  );
}

/** 页头品牌组合。 */
export function LogoContent() {
  return (
    <>
      <LogoMark />
      <span className="leading-none">
        <span className="font-giant block text-lg tracking-wide">真相透镜</span>
        <span className="mono-label mt-1 block text-[8px] opacity-70">
          TRUTHLENS
        </span>
      </span>
    </>
  );
}

export default function SiteHeader() {
  const { pathname } = useLocation();
  const [themeKey, setThemeKey] = useState(() => {
    try {
      const saved =
        localStorage.getItem("tl-theme") ??
        (localStorage.getItem("tl-contrast") === "dark" ? "ink" : "red");
      return resolveTheme(saved);
    } catch {
      return resolveTheme(document.documentElement.dataset.theme ?? "red");
    }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const theme = THEMES.find(t => t.key === themeKey) ?? THEMES[0];

  useEffect(() => {
    document.documentElement.dataset.theme = themeKey;
  }, [themeKey]);

  // 点击选择器外部时收起
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pickerOpen]);

  // 点击用户菜单外部时收起
  useEffect(() => {
    if (!userOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!userRef.current?.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [userOpen]);

  useEffect(() => {
    if (!pickerOpen && !userOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pickerOpen)
        pickerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      else userRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      setPickerOpen(false);
      setUserOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [pickerOpen, userOpen]);

  const applyTheme = useCallback(
    (next: string) => {
      if (next === themeKey) return;
      // 方向感知：主题列表中向前（序号更大）左→右擦入，向后右→左擦入
      const dir =
        THEMES.findIndex(t => t.key === next) >
        THEMES.findIndex(t => t.key === themeKey)
          ? "ltr"
          : "rtl";

      const apply = () => {
        setThemeKey(next);
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("tl-theme", next);
        } catch {
          /* Theme remains usable without storage. */
        }
      };

      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => { finished: Promise<void> };
      };
      if (reduced || typeof doc.startViewTransition !== "function") {
        apply();
        return;
      }
      document.documentElement.style.viewTransitionName = `page-${dir}`;
      const vt = doc.startViewTransition(apply);
      vt.finished
        .catch(() => undefined)
        .finally(() => {
          document.documentElement.style.viewTransitionName = "";
        });
    },
    [themeKey]
  );

  const nav = [
    { to: "/", label: "核查台", en: "CHECK" },
    { to: "/history", label: "历史记录", en: "ARCHIVE" },
  ];

  return (
    <header className="tl-site-header bg-chrome sticky top-0 z-40 border-b border-ink-soft">
      <div className="tl-site-header-inner">
        {/* Logo */}
        <Link
          to="/"
          data-logo-anchor
          className="tl-site-brand flex items-center gap-3 px-3 py-3 sm:px-4"
        >
          <LogoContent />
        </Link>

        {/* 中部标语 */}
        <div className="tl-site-tagline items-center px-4">
          <span className="mono-label opacity-70">
            EVIDENCE BEFORE CONCLUSIONS
          </span>
        </div>

        {/* 导航 */}
        <nav
          aria-label="主导航"
          className="tl-site-nav flex items-stretch justify-end"
        >
          {nav.map(item => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "tl-site-nav-link flex flex-col items-center justify-center px-2 py-2 leading-none transition-colors sm:px-6",
                  active && "tl-site-nav-active"
                )}
              >
                <span className="text-[13px] font-bold sm:text-sm">
                  {item.label}
                </span>
                <span className="mono-label mt-1 hidden text-[7px] opacity-60 sm:block">
                  {item.en}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* 主题选择 */}
        <div ref={pickerRef} className="relative">
          <button
            onClick={() => setPickerOpen(o => !o)}
            title="切换主题"
            aria-label="切换主题"
            aria-expanded={pickerOpen}
            aria-controls="theme-options"
            className="flex h-full items-center gap-2.5 border-l border-ink px-2 transition-colors hover:bg-[color-mix(in_srgb,var(--c-fg)_8%,transparent)] sm:px-5"
          >
            <span
              className="border-ink flex h-[18px] w-[18px] items-center justify-center gap-[2px] border"
              style={{ backgroundColor: theme.bg }}
            >
              {[0, 1, 2].map(i => (
                <i
                  key={i}
                  className="block h-2.5 w-[2px]"
                  style={{ backgroundColor: theme.fg, opacity: 1 - i * 0.25 }}
                />
              ))}
            </span>
            <Contrast className="hidden h-[15px] w-[15px] opacity-70 sm:block" />
          </button>

          {pickerOpen && (
            <div
              id="theme-options"
              className="tl-site-popover bg-panel border-ink absolute top-full right-0 z-50 w-44 border shadow-[8px_8px_0_0_rgba(0,0,0,0.35)]"
            >
              <div className="border-panel-line border-b px-3 py-2">
                <span className="mono-label text-panel-soft">THEME · 主题</span>
              </div>
              {THEMES.map(t => (
                <button
                  key={t.key}
                  aria-pressed={t.key === themeKey}
                  onClick={() => {
                    setPickerOpen(false);
                    applyTheme(t.key);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_9%,transparent)]",
                    t.key === themeKey &&
                      "bg-[color-mix(in_srgb,var(--panel-fg)_6%,transparent)]"
                  )}
                >
                  <span
                    className="border-panel-line flex h-7 w-7 shrink-0 items-center justify-center gap-[2px] border"
                    style={{ backgroundColor: t.bg }}
                  >
                    {[0, 1, 2].map(i => (
                      <i
                        key={i}
                        className="block h-3 w-[2px]"
                        style={{ backgroundColor: t.fg, opacity: 1 - i * 0.25 }}
                      />
                    ))}
                  </span>
                  <span className="leading-none">
                    <span className="block text-sm font-bold text-[color:var(--panel-fg)]">
                      {t.zh}
                    </span>
                    <span className="mono-label text-panel-soft mt-0.5 block text-[7px]">
                      {t.en}
                    </span>
                  </span>
                  {t.key === themeKey && (
                    <span className="mono-label text-panel-soft ml-auto text-[9px]">
                      ●
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 账号 */}
        {user ? (
          <div ref={userRef} className="relative">
            <button
              onClick={() => setUserOpen(o => !o)}
              title="账号菜单"
              aria-label="账号菜单"
              aria-expanded={userOpen}
              aria-controls="account-options"
              className="flex h-full items-center gap-2 border-l border-ink px-2 transition-colors hover:bg-[color-mix(in_srgb,var(--c-fg)_8%,transparent)] sm:px-4"
            >
              <User className="h-[15px] w-[15px]" />
              <span className="hidden max-w-28 truncate text-sm font-bold sm:block">
                {user.username}
              </span>
            </button>
            {userOpen && (
              <div
                id="account-options"
                className="tl-site-popover bg-panel border-ink absolute top-full right-0 z-50 w-44 border shadow-[8px_8px_0_0_rgba(0,0,0,0.35)]"
              >
                <div className="border-panel-line border-b px-3 py-2.5">
                  <span className="block truncate text-sm font-bold text-[color:var(--panel-fg)]">
                    {user.username}
                  </span>
                  <span className="mono-label text-panel-soft mt-0.5 block text-[7px]">
                    {user.role === "admin" ? "管理员 ADMIN" : "注册用户 USER"}
                  </span>
                </div>
                <Link
                  to="/history"
                  onClick={() => setUserOpen(false)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-[color:var(--panel-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_9%,transparent)]"
                >
                  <User className="h-3.5 w-3.5 opacity-70" /> 我的历史记录
                </Link>
                <Link
                  to="/settings"
                  onClick={() => setUserOpen(false)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-[color:var(--panel-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_9%,transparent)]"
                >
                  <KeyRound className="h-3.5 w-3.5 opacity-70" /> API 密钥设置
                </Link>
                {user.role === "admin" && (
                  <Link
                    to="/admin"
                    onClick={() => setUserOpen(false)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-[color:var(--panel-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_9%,transparent)]"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 opacity-70" /> 管理后台
                  </Link>
                )}
                <button
                  onClick={() => {
                    setUserOpen(false);
                    void logout();
                  }}
                  className="flex w-full items-center gap-2.5 border-t border-panel-line px-3 py-2.5 text-left text-sm text-[#fb4d63] transition-colors hover:bg-[#fb4d63]/10"
                >
                  <LogOut className="h-3.5 w-3.5" /> 退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            to="/auth"
            title="登录 / 注册"
            className="flex items-center gap-2 border-l border-ink px-2 transition-colors hover:bg-[color-mix(in_srgb,var(--c-fg)_8%,transparent)] sm:px-4"
          >
            <LogIn className="h-[15px] w-[15px]" />
            <span className="hidden text-sm font-bold sm:block">登录</span>
          </Link>
        )}

        {/* 状态 */}
        <div className="tl-site-theme-status items-center gap-2 border-l border-ink-soft px-5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
          <span className="mono-label opacity-70">THEME: {theme.en}</span>
        </div>
      </div>
    </header>
  );
}
