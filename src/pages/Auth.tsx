import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { ArrowLeft, LogIn, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BinaryStrip, SectionBar } from "@/components/Bits";

type Mode = "login" | "register";

export default function Auth() {
  const { user, sessionError, retrySession, login, register, logout } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { from?: unknown; claimDraft?: unknown; draftOwnerId?: unknown } | null;
  const from = typeof routeState?.from === "string" && ["/", "/settings", "/history", "/admin"].includes(routeState.from)
    ? routeState.from
    : "/settings";
  const draftState = typeof routeState?.claimDraft === "string"
    ? { claimDraft: routeState.claimDraft.slice(0, 2000), draftOwnerId: typeof routeState.draftOwnerId === "number" ? routeState.draftOwnerId : null }
    : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current || sessionError || user === undefined) return;
    submitting.current = true;
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
      setPassword("");
      navigate(from, { replace: true, state: draftState });
    } catch (err) {
      setError((err as Error).message || "操作失败，请稍后重试");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="bg-chrome min-h-[80vh]">
      <div className="px-4 pt-10 pb-6 sm:px-8">
        <h1 className="font-giant leading-[0.9] tracking-tight" style={{ fontSize: "clamp(48px, 8vw, 110px)" }}>
          {user ? "账号" : mode === "login" ? "登录" : "注册"}
        </h1>
        <p className="font-serif-body mt-3 max-w-lg text-sm leading-relaxed opacity-80">
          登录后接入自己的模型 API Key，即可核查信息并保存历史存档。模型调用使用你在对应供应商的账户。
        </p>
      </div>

      <BinaryStrip seed={31} className="border-y border-ink-soft px-4 py-2 sm:px-8" />

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="px-4 py-10 sm:px-8"
      >
        <div className="mx-auto max-w-md border border-ink bg-panel">
          <SectionBar>Access · 账号准入</SectionBar>

          {sessionError ? (
            <div role="alert" className="px-6 py-8 font-mono2 text-xs text-[#fb4d63]">
              暂时无法确认登录状态，请检查网络后重试。
              <button type="button" onClick={retrySession} className="mt-4 block border border-panel-line px-4 py-2">重新连接</button>
            </div>
          ) : user === undefined ? (
            <div role="status" className="px-6 py-8 font-mono2 text-xs text-panel-soft">正在验证登录状态…</div>
          ) : user ? (
            <div className="px-6 py-8">
              <div className="mono-label text-[9px] text-panel-soft">CURRENT ACCOUNT · 当前账号</div>
              <div className="mt-3 flex items-center justify-between gap-3 border border-panel-line px-4 py-3">
                <span className="font-giant text-2xl tracking-wide text-[color:var(--panel-fg)]">{user.username}</span>
                <span className="mono-label border border-panel-line px-2 py-1 text-[8px] text-panel-soft">
                  {user.role === "admin" ? "管理员 ADMIN" : "用户 USER"}
                </span>
              </div>
              <Link
                data-no-transition
                to={user.hasLlmKey ? "/" : "/settings"}
                state={draftState}
                className="font-giant mt-5 block bg-[color:var(--c-fg)] px-4 py-3 text-center text-base tracking-wider text-[color:var(--c-bg)] transition-opacity hover:opacity-85"
              >
                {user.hasLlmKey ? "开始核查 →" : "接入我的模型 →"}
              </Link>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to="/history"
                  className="font-giant flex-1 border border-[color:var(--panel-fg)] px-4 py-2.5 text-center text-sm tracking-wider text-[color:var(--panel-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_10%,transparent)]"
                >
                  我的历史记录
                </Link>
                <button
                  onClick={() => void logout()}
                  className="font-giant border border-[#fb4d63]/60 px-4 py-2.5 text-sm tracking-wider text-[#fb4d63] transition-colors hover:bg-[#fb4d63]/10"
                >
                  退出登录
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} aria-busy={busy} className="px-6 py-8">
              {/* 模式切换 */}
              <div className="grid grid-cols-2 gap-px border border-panel-line bg-[color-mix(in_srgb,var(--panel-fg)_14%,transparent)]">
                {(
                  [
                    { key: "login", label: "登录", en: "LOGIN" },
                    { key: "register", label: "注册", en: "REGISTER" },
                  ] as { key: Mode; label: string; en: string }[]
                ).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    disabled={busy}
                    aria-pressed={mode === m.key}
                    onClick={() => {
                      setMode(m.key);
                      setError("");
                    }}
                    className={
                      mode === m.key
                        ? "bg-[color:var(--c-fg)] px-3 py-2.5 text-[color:var(--c-bg)]"
                        : "bg-panel px-3 py-2.5 text-panel-soft transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_6%,transparent)]"
                    }
                  >
                    <span className="font-giant block text-sm tracking-wider">{m.label}</span>
                    <span className="mono-label mt-0.5 block text-[7px] opacity-70">{m.en}</span>
                  </button>
                ))}
              </div>

              <label htmlFor="auth-username" className="mono-label mt-6 block text-[9px] text-panel-soft">USERNAME · 用户名</label>
              <input
                id="auth-username"
                name="username"
                required
                minLength={2}
                maxLength={32}
                disabled={busy}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="2-32 个字符"
                className="font-mono2 mt-1.5 w-full border border-panel-line bg-transparent px-3 py-2.5 text-sm text-[color:var(--panel-fg)] outline-none placeholder:text-panel-soft/50 focus:border-[color:var(--panel-fg)]"
              />

              <label htmlFor="auth-password" className="mono-label mt-4 block text-[9px] text-panel-soft">PASSWORD · 密码</label>
              <input
                id="auth-password"
                name="password"
                required
                minLength={6}
                maxLength={64}
                disabled={busy}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="至少 6 位"
                className="font-mono2 mt-1.5 w-full border border-panel-line bg-transparent px-3 py-2.5 text-sm text-[color:var(--panel-fg)] outline-none placeholder:text-panel-soft/50 focus:border-[color:var(--panel-fg)]"
              />

              {error && <div role="alert" className="font-mono2 mt-4 text-xs text-[#fb4d63]">ERROR — {error}</div>}

              <button
                type="submit"
                disabled={busy}
                className="font-giant mt-6 flex w-full items-center justify-center gap-2 bg-[color:var(--c-fg)] px-4 py-3 text-base tracking-wider text-[color:var(--c-bg)] transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
              </button>

              <p className="font-mono2 mt-4 text-center text-[10px] leading-relaxed text-panel-soft">
                {mode === "login" ? "还没有账号？切换到「注册」创建账号" : "注册完成后，请接入自己的模型 API Key。"}
              </p>
            </form>
          )}
        </div>

        <div className="mx-auto mt-6 max-w-md">
          <Link data-no-transition to="/" state={draftState} className="mono-label inline-flex items-center gap-1.5 opacity-70 hover:opacity-100">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回核查台
          </Link>
        </div>
      </motion.section>
    </div>
  );
}
