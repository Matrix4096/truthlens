import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";

type GoFn = (to: string, opts?: { replace?: boolean }) => void;
const GoCtx = createContext<GoFn>(() => undefined);

/** Preserve the navigation API while letting navigation complete immediately. */
// Keep the existing navigation API colocated with its private context.
// eslint-disable-next-line react-refresh/only-export-components
export function useWipeNavigate() {
  return useContext(GoCtx);
}

export default function PageWipe({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname, search, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname && navigationType !== "POP" && !hash)
      window.scrollTo(0, 0);
    previousPath.current = pathname;
  }, [pathname, hash, navigationType]);
  const go = useCallback(
    (to: string, opts?: { replace?: boolean }) => {
      if (to === `${pathname}${search}${hash}`) return;
      navigate(to, { replace: opts?.replace });
    },
    [navigate, pathname, search, hash]
  );

  return (
    <GoCtx.Provider value={go}>
      {children}
      {/* A location change gets one small accent; no overlay can capture input.
          Router links retain their state, modifiers and native keyboard handling. */}
      <div key={key} className="route-transition-line" aria-hidden />
    </GoCtx.Provider>
  );
}
