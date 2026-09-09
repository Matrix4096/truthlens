import { createContext, useCallback, useContext, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import type { SessionUser } from "@contracts/types";

const TOKEN_KEY = "tl-token";
const GUEST_TOKEN_KEY = "tl-guest-token";

/** 游客签名令牌：服务端 HMAC 签发、不可伪造；在 Cookie 被拦截的嵌入环境中经 x-guest-token 头回传 */
export function getGuestToken(): string | null {
  return localStorage.getItem(GUEST_TOKEN_KEY);
}

export function setGuestToken(token: string | null | undefined) {
  if (token) localStorage.setItem(GUEST_TOKEN_KEY, token);
}

interface AuthCtxValue {
  /** undefined=加载中，null=未登录 */
  user: SessionUser | null | undefined;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtxValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const meQ = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const loginMut = trpc.auth.login.useMutation();
  const regMut = trpc.auth.register.useMutation();
  const logoutMut = trpc.auth.logout.useMutation();

  const applySession = useCallback(
    (token: string, user: SessionUser) => {
      localStorage.setItem(TOKEN_KEY, token);
      utils.auth.me.setData(undefined, user);
      void utils.verify.history.invalidate();
      void utils.verify.quota.invalidate();
    },
    [utils],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await loginMut.mutateAsync({ username, password });
      applySession(r.token, r.user);
    },
    [loginMut, applySession],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      const r = await regMut.mutateAsync({ username, password });
      applySession(r.token, r.user);
    },
    [regMut, applySession],
  );

  const logout = useCallback(async () => {
    try {
      await logoutMut.mutateAsync();
    } catch {
      /* 忽略 */
    }
    localStorage.removeItem(TOKEN_KEY);
    utils.auth.me.setData(undefined, null);
    void utils.verify.history.invalidate();
    void utils.verify.quota.invalidate();
  }, [logoutMut, utils]);

  return <Ctx.Provider value={{ user: meQ.data, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtxValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
