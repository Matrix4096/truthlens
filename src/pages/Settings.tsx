import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/lib/auth";
import { BinaryStrip, SectionBar } from "@/components/Bits";
import { LLM_PROVIDERS, USER_DAILY_LIMIT, type LlmProviderId } from "@contracts/types";

const PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as LlmProviderId[];

export default function Settings() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [provider, setProvider] = useState<LlmProviderId>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const setMut = trpc.auth.setLlmKey.useMutation({
    onSuccess: async () => {
      setNotice("验证通过，密钥已加密保存。此后你的核查将使用自己的额度，不限次数。");
      setError("");
      setApiKey("");
      await Promise.all([utils.auth.me.invalidate(), utils.verify.quota.invalidate()]);
    },
    onError: (e) => {
      setError(e.message);
      setNotice("");
    },
  });
  const clearMut = trpc.auth.clearLlmKey.useMutation({
    onSuccess: async () => {
      setNotice(`已清除自带密钥，恢复平台每日免费 ${USER_DAILY_LIMIT} 次额度。`);
      setError("");
      await Promise.all([utils.auth.me.invalidate(), utils.verify.quota.invalidate()]);
    },
    onError: (e) => {
      setError(e.message);
      setNotice("");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !user || apiKey.trim().length < 10) return;
    setError("");
    setNotice("");
    setMut.mutate({ provider, apiKey: apiKey.trim() });
  }

  const busy = setMut.isPending || clearMut.isPending;

  return (
    <div className="bg-chrome min-h-[calc(100vh-64px)]">
      <div className="px-4 pt-10 pb-6 sm:px-8">
        <h1 className="font-giant leading-[0.9] tracking-tight" style={{ fontSize: "clamp(48px, 8vw, 110px)" }}>
          密钥设置
        </h1>
        <p className="font-serif-body mt-3 max-w-lg text-sm leading-relaxed opacity-80">
          平台为每个账号提供每日 {USER_DAILY_LIMIT} 次免费核查。填写自己的 API Key 后，你的核查将走自己的额度，不限次数。
        </p>
      </div>

      <BinaryStrip seed={47} className="border-y border-ink-soft px-4 py-2 sm:px-8" />

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="px-4 py-10 sm:px-8"
      >
        <div className="mx-auto max-w-md border border-ink bg-panel">
          <SectionBar>BYOK · 自带密钥</SectionBar>

          {user === undefined ? (
            <div className="px-5 py-10 text-center font-mono2 text-xs text-panel-soft">LOADING…</div>
          ) : user === null ? (
            <div className="px-5 py-10 text-center">
              <KeyRound className="mx-auto mb-4 h-8 w-8 text-panel-soft" />
              <p className="font-serif-body mb-6 text-sm opacity-80">登录后才能设置自己的 API Key。</p>
              <Link
                to="/auth"
                state={{ from: "/settings" }}
                className="font-giant inline-block border border-ink px-6 py-2.5 text-sm tracking-wider transition-colors hover:bg-ink"
              >
                前往登录 →
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="px-5 py-6">
              {/* 当前状态 */}
              <div className="mb-6 flex items-center gap-3 border border-panel-line px-3 py-2.5">
                <ShieldCheck className={`h-4 w-4 ${user.hasLlmKey ? "text-[#2f9e6e]" : "text-panel-soft"}`} />
                <span className="font-mono2 text-xs text-[color:var(--panel-fg)]">
                  {user.hasLlmKey
                    ? `已设置自带密钥（${LLM_PROVIDERS[(user.llmProvider as LlmProviderId) ?? "deepseek"]?.label ?? user.llmProvider}），当前不限次数`
                    : `未设置自带密钥，当前使用平台每日 ${USER_DAILY_LIMIT} 次免费额度`}
                </span>
              </div>

              {/* 平台选择 */}
              <div className="mono-label mb-2 text-[9px] text-panel-soft">PLATFORM · 选择平台</div>
              <div className="mb-5 grid grid-cols-2 gap-px border border-panel-line bg-[color-mix(in_srgb,var(--panel-fg)_30%,transparent)]">
                {PROVIDER_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    aria-pressed={provider === id}
                    onClick={() => setProvider(id)}
                    className={`px-3 py-2.5 text-left text-sm transition-colors ${
                      provider === id
                        ? "bg-[color:var(--panel-fg)] font-semibold text-[color:var(--panel-bg)]"
                        : "bg-panel text-[color:var(--panel-fg)] hover:bg-[color-mix(in_srgb,var(--panel-fg)_7%,transparent)]"
                    }`}
                  >
                    {LLM_PROVIDERS[id].label}
                    <span className="font-mono2 mt-0.5 block text-[9px] opacity-60">{LLM_PROVIDERS[id].model}</span>
                  </button>
                ))}
              </div>

              {/* Key 输入 */}
              <label htmlFor="llm-api-key" className="mono-label mb-2 block text-[9px] text-panel-soft">API KEY · 仅存储于服务器</label>
              <input
                id="llm-api-key"
                type="password"
                disabled={busy}
                required
                maxLength={200}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={user.hasLlmKey ? "输入新 Key 以更换" : "sk-..."}
                autoComplete="off"
                className="font-mono2 mb-5 w-full border border-panel-line bg-transparent px-3 py-2.5 text-sm text-[color:var(--panel-fg)] outline-none placeholder:text-panel-soft/50 focus:border-[color:var(--panel-fg)]"
              />

              {error && (
                <div role="alert" className="mb-4 border border-[#fb4d63] px-3 py-2 font-mono2 text-[11px] leading-relaxed text-[#fb4d63]">
                  {error}
                </div>
              )}
              {notice && (
                <div role="status" className="mb-4 border border-[#2f9e6e] px-3 py-2 font-mono2 text-[11px] leading-relaxed text-[#2f9e6e]">
                  {notice}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={busy || apiKey.trim().length < 10}
                  className="font-giant flex-1 border border-ink py-2.5 text-sm tracking-wider transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {setMut.isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> 验证中…
                    </span>
                  ) : (
                    "验证并保存"
                  )}
                </button>
                {user.hasLlmKey && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => clearMut.mutate()}
                    className="font-giant inline-flex items-center gap-1.5 border border-[#fb4d63] px-4 py-2.5 text-sm tracking-wider text-[#fb4d63] transition-colors hover:bg-[#fb4d63]/10 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 清除
                  </button>
                )}
              </div>

              <p className="font-mono2 mt-5 text-[10px] leading-relaxed text-panel-soft">
                保存前会真实调用一次该平台验证 Key 可用；密钥经 AES-256-GCM 加密后落库，任何界面都无法回读。如需更换平台或 Key，直接选择并粘贴新值覆盖即可。
              </p>
            </form>
          )}
        </div>

        <div className="mx-auto mt-6 max-w-md">
          <Link to="/" className="font-mono2 inline-flex items-center gap-1.5 text-xs text-panel-soft transition-colors hover:text-[color:var(--panel-fg)]">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回核查台
          </Link>
        </div>
      </motion.section>
    </div>
  );
}
