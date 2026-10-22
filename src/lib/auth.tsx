import { createContext, useCallback, useContext, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import type { SessionUser } from "@contracts/types";
import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { GUEST_TOKEN_KEY, TOKEN_KEY, readToken, writeToken } from "./session-storage";

/** 游客签名令牌：服务端 HMAC 签发、不可伪造；在 Cookie 被拦截的嵌入环境中经 x-guest-token 头回传 */
export function getGuestToken(): string | null {
  return readToken(GUEST_TOKEN_KEY);
}

export function setGuestToken(token: string | null | undefined) {
  if (token) writeToken(GUEST_TOKEN_KEY, token);
}

interface AuthCtxValue {
  /** undefined=加载中，null=未登录 */
  user: SessionUser | null | undefined;
  sessionError: boolean;
  retrySession: () => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtxValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const meQ = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const loginMut = trpc.auth.login.useMutation();
  const regMut = trpc.auth.register.useMutation();
  const logoutMut = trpc.auth.logout.useMutation();

  const applySession = useCallback(
    async (token: string | null, user: SessionUser | null) => {
      // 先取消旧身份请求，再清除个人数据；invalidate 会保留前一个账号的数据。
      await queryClient.cancelQueries();
      writeToken(TOKEN_KEY, token);
      utils.auth.me.setData(undefined, user);
      await Promise.all([
        queryClient.resetQueries({ queryKey: getQueryKey(trpc.verify) }),
        queryClient.resetQueries({ queryKey: getQueryKey(trpc.admin) }),
      ]);
    },
    [queryClient, utils],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await loginMut.mutateAsync({ username, password });
      await applySession(r.token, r.user);
    },
    [loginMut, applySession],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      const r = await regMut.mutateAsync({ username, password });
      await applySession(r.token, r.user);
    },
    [regMut, applySession],
  );

  const logout = useCallback(async () => {
    try {
      await logoutMut.mutateAsync();
    } catch {
      /* 忽略 */
    }
    await applySession(null, null);
  }, [logoutMut, applySession]);

  return (
    <Ctx.Provider value={{
      user: meQ.data,
      sessionError: meQ.isError,
      retrySession: () => { void meQ.refetch(); },
      login,
      register,
      logout,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtxValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
