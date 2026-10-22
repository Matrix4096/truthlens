import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/utils";

/** 页面顺序：决定转场方向（向前=左进右出，向后=右进左出） */
const ORDER = ["/", "/history", "/settings", "/auth", "/admin"];
const PAGE_META: Record<string, { zh: string; en: string }> = {
  "/": { zh: "核查台", en: "CHECK DESK" },
  "/history": { zh: "历史记录", en: "ARCHIVE" },
  "/auth": { zh: "账号准入", en: "ACCESS" },
  "/admin": { zh: "管理后台", en: "ADMIN" },
  "/settings": { zh: "密钥设置", en: "BYOK" },
};

type Phase = "idle" | "cover" | "reveal";
interface WipeState {
  phase: Phase;
  dir: 1 | -1;
  label: { zh: string; en: string };
}

type GoFn = (to: string, opts?: { replace?: boolean }) => void;

const GoCtx = createContext<GoFn>(() => undefined);

/** 程序化导航时使用：与链接点击一致的扫板转场 */
// Keep the existing navigation API colocated with its private context.
// eslint-disable-next-line react-refresh/only-export-components
export function useWipeNavigate() {
  return useContext(GoCtx);
}

export default function PageWipe({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const [st, setSt] = useState<WipeState>({
    phase: "idle",
    dir: 1,
    label: { zh: "", en: "" },
  });
  const busy = useRef(false);
  const pending = useRef<{ to: string; replace?: boolean } | null>(null);

  const finish = useCallback(() => {
    pending.current = null;
    busy.current = false;
    setSt(s => ({ ...s, phase: "idle" }));
  }, []);

  const go = useCallback(
    (to: string, opts?: { replace?: boolean }) => {
      if (busy.current) return;
      const path = to.split(/[?#]/)[0] || "/";
      if (to === `${pathname}${search}${hash}`) return;
      if (
        path === pathname ||
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        navigate(to, { replace: opts?.replace });
        return;
      }
      busy.current = true;
      pending.current = { to, replace: opts?.replace };
      const fromIdx = ORDER.indexOf(pathname);
      const toIdx = ORDER.indexOf(path);
      const dir: 1 | -1 =
        fromIdx === -1 || toIdx === -1 || toIdx >= fromIdx ? 1 : -1;
      setSt({
        phase: "cover",
        dir,
        label: PAGE_META[path] ?? { zh: "页面", en: "PAGE" },
      });
    },
    [navigate, pathname, search, hash]
  );

  /** 扫入动画结束 → 立即换页 → 尽快进入扫出（无缝衔接） */
  const swap = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null; // A timeout and animationend must never navigate twice.
    navigate(p.to, { replace: p.replace });
    window.scrollTo(0, 0);
    setSt(s => ({ ...s, phase: "reveal" }));
  }, [navigate]);

  /** 面板动画结束事件驱动衔接（仅响应面板自身的动画，忽略子元素） */
  const onPanelAnimEnd = useCallback(
    (e: ReactAnimationEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (st.phase === "cover" && e.animationName.startsWith("pagewipe-in")) {
        swap();
      } else if (
        st.phase === "reveal" &&
        e.animationName.startsWith("pagewipe-out")
      ) {
        finish();
      }
    },
    [st.phase, swap, finish]
  );

  // CSS animation events can be lost when settings change or a tab is suspended.
  useEffect(() => {
    if (st.phase === "idle") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const advance = st.phase === "cover" ? swap : finish;
    const skip = () => {
      if (document.hidden || motion.matches) {
        advance();
        finish();
      }
    };
    const fallback = window.setTimeout(advance, 600);
    document.addEventListener("visibilitychange", skip);
    motion.addEventListener("change", skip);
    skip();
    return () => {
      clearTimeout(fallback);
      document.removeEventListener("visibilitychange", skip);
      motion.removeEventListener("change", skip);
    };
  }, [st.phase, swap, finish]);

  // 全局拦截站内链接点击 → 扫板转场
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as HTMLElement).closest?.(
        "a[href]"
      ) as HTMLAnchorElement | null;
      if (
        !a ||
        (a.target && a.target !== "_self") ||
        a.hasAttribute("download") ||
        a.hasAttribute("data-no-transition")
      )
        return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("//")) return;
      e.preventDefault();
      go(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [go]);

  return (
    <GoCtx.Provider value={go}>
      {children}
      {st.phase !== "idle" && (
        <div className="fixed inset-0 z-[90000] overflow-hidden" aria-hidden>
          <div
            key={st.phase}
            onAnimationEnd={onPanelAnimEnd}
            className={cn(
              "pagewipe-panel bg-chrome absolute inset-0 flex flex-col justify-between border-ink",
              st.phase === "cover"
                ? st.dir === 1
                  ? "pagewipe-in-left"
                  : "pagewipe-in-right"
                : st.dir === 1
                  ? "pagewipe-out-right"
                  : "pagewipe-out-left",
              st.dir === 1 && st.phase === "cover" && "border-r-[6px]",
              st.dir === -1 && st.phase === "cover" && "border-l-[6px]"
            )}
          >
            {/* 顶部标识行 */}
            <div className="flex items-center justify-between px-4 pt-4 sm:px-8">
              <span className="mono-label opacity-70">
                TRUTHLENS · NAVIGATING
              </span>
              <span className="mono-label opacity-70">{st.label.en}</span>
            </div>

            {/* 中央目标页标题（入场动画仅扫入阶段播放，扫出时静态，避免文字闪烁） */}
            <div className="px-4 sm:px-8">
              <div
                className={
                  st.phase === "cover" ? "pagewipe-caption" : undefined
                }
              >
                <div className="mono-label mb-2 text-[10px] opacity-60">
                  ▶▶ 正在前往 / NAVIGATE TO
                </div>
                <div
                  className="font-giant leading-[0.9] tracking-tight"
                  style={{ fontSize: "clamp(72px, 15vw, 200px)" }}
                >
                  {st.label.zh}
                </div>
              </div>
              <div
                className={cn(
                  "mono-label mt-3 text-xs tracking-[0.35em] opacity-70",
                  st.phase === "cover" && "pagewipe-caption-late"
                )}
              >
                {st.label.en} — TRUTHLENS
              </div>
            </div>

            {/* 底部装饰 */}
            <div>
              <div className="mono-label flex items-center justify-between px-4 pb-3 text-[9px] opacity-60 sm:px-8">
                <span>0110 1011 0110 0111</span>
                <span>//// //// //// ////</span>
              </div>
              <div className="h-[5px] w-full bg-[color:var(--c-fg)]" />
            </div>
          </div>
        </div>
      )}
    </GoCtx.Provider>
  );
}
