import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { trpc } from "@/providers/trpc";
import ClaimInput from "@/components/ClaimInput";
import ElapsedTimer from "@/components/ElapsedTimer";
import PipelineSteps, { type Stage } from "@/components/PipelineSteps";
import ResultView from "@/components/ResultView";
import FlowField from "@/components/FlowField";
import SplitChars from "@/components/SplitChars";
import BlackHoleMark from "@/components/BlackHoleMark";
import { BinaryStrip, Marquee, SectionBar, CellIndex } from "@/components/Bits";
import { useAuth, setGuestToken } from "@/lib/auth";

const FEATURES = [
  { no: "01", title: "全网深度搜索", en: "DEEP SEARCH", desc: "多路检索策略并行扫描互联网，直取高权威来源正文内容。" },
  { no: "02", title: "证据链交叉验证", en: "CROSS-CHECK", desc: "展示来源立场、可靠性与分析要点，帮助你追溯核查依据。" },
  { no: "03", title: "AI 置信度判定", en: "VERDICT", desc: "基于证据权重计算可靠度评分，给出六级判定结论。" },
];

type Status = "idle" | Stage | "done" | "error";

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submissionLock = useRef(false);
  const resultAnchor = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { user } = useAuth();
  const quotaQ = trpc.verify.quota.useQuery(undefined, { refetchOnWindowFocus: false });
  const quota = quotaQ.data;
  // 游客签名令牌落盘：嵌入预览中 Cookie 可能被浏览器拦截，后续请求改走 x-guest-token 头
  useEffect(() => {
    setGuestToken(quota?.guestToken);
  }, [quota?.guestToken]);
  const quotaLeft = quota && quota.limited ? Math.max(0, quota.limit - quota.used) : null;
  const quotaExhausted = quotaLeft === 0;

  const startMut = trpc.verify.start.useMutation();
  const utils = trpc.useUtils();

  // 轮询任务状态：进行中每 1.5s 拉取一次，结束自动停止
  const statusQ = trpc.verify.status.useQuery(
    { jobId: jobId! },
    {
      enabled: jobId !== null,
      refetchInterval: (query) => {
        const stage = query.state.data?.stage;
        if (stage === "done" || stage === "error" || query.state.status === "error") return false;
        return 1500;
      },
      retry: 2,
    },
  );

  const job = statusQ.data;
  const status: Status = submitting
    ? "analyzing"
    : submitError
      ? "error"
      : jobId
        ? job?.stage ?? "analyzing"
        : "idle";

  // 在拿到 jobId 前也必须锁定输入区，否则双击会启动多份相同的核查。
  const checking = submitting || (jobId !== null && status !== "done" && status !== "error");
  const busy = quotaQ.isLoading || checking;
  const connectionLost = jobId !== null && statusQ.isError && checking;

  async function runCheck(claim: string, mode: "deep" | "quick") {
    // ref 同步锁住双击及快捷键，避免等待 React 重渲染期间提交两次。
    if (submissionLock.current || busy || quotaExhausted) return;
    submissionLock.current = true;
    setSubmitError("");
    setSubmitting(true);
    setJobId(null);
    try {
      const res = await startMut.mutateAsync({ claim, mode });
      setGuestToken(res.guestToken);
      setJobId(res.jobId);
      void utils.verify.quota.invalidate();
    } catch (e) {
      console.error(e);
      setSubmitError((e as Error).message || "无法连接到核查服务，请稍后重试");
      setJobId(null);
      void utils.verify.quota.invalidate();
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }

  function reset() {
    setJobId(null);
    setSubmitError("");
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  // 完成后刷新历史缓存；等待结果面板入场后再滚动，否则 ref 尚未挂载。
  useEffect(() => {
    if (job?.stage === "done") {
      void utils.verify.history.invalidate();
    }
    if (job?.stage === "done" || job?.stage === "error") {
      void utils.verify.quota.invalidate();
    }
  }, [job?.stage, utils]);

  const error = job?.stage === "error" ? job.error || "核查过程中出现错误" : submitError;

  return (
    <div>
      {/* ===== HERO（铬层红/黑 + 交互流线场） ===== */}
      <section className="bg-chrome relative overflow-hidden border-b border-ink">
        <FlowField className="absolute inset-0 h-full w-full" />
        <div className="relative">
          <div className="flex items-center justify-between px-4 pt-4 sm:px-8">
            <span className="mono-label opacity-70">Deep-search fact-check engine</span>
            <span className="mono-label hidden opacity-70 sm:block">EST. 2026 — Running globally</span>
          </div>

          <div className="px-4 pt-10 pb-6 sm:px-8 sm:pt-14">
            <h1
              className="font-giant leading-[0.88] tracking-tight"
              style={{ fontSize: "clamp(64px, 12.5vw, 180px)" }}
            >
              <SplitChars
                text="真相透镜"
                step={110}
                startDelay={200}
                inject={{ after: 1, node: <BlackHoleMark /> }}
              />
            </h1>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="mt-4 flex flex-wrap items-end justify-between gap-4"
            >
              <p className="font-serif-body max-w-xl text-[15px] leading-relaxed sm:text-base">
                这条信息，可信吗？输入任何说法、新闻或传言 ——
                真相透镜将在互联网上深度搜索证据，交叉验证来源立场与权威性，
                给出可靠度评分与判定结论。
              </p>
              <span className="font-giant text-xl tracking-[0.2em] opacity-80 sm:text-2xl">
                TRUTH LENS
              </span>
            </motion.div>
          </div>

          <BinaryStrip seed={42} className="border-t border-ink-soft px-4 py-2 sm:px-8" />
        </div>
      </section>

      {/* ===== 输入区 ===== */}
      <AnimatePresence mode="wait">
        {status !== "done" ? (
          <motion.section
            key="input"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, y: -28, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } }}
            className="bg-chrome px-4 py-10 sm:px-8"
          >
            <div className="mx-auto max-w-5xl">
              <ClaimInput busy={busy || quotaExhausted} onSubmit={runCheck} />

              {quotaQ.isLoading && !checking && (
                <p role="status" className="font-mono2 mt-4 text-xs opacity-70">正在读取可用额度…</p>
              )}

              {quotaQ.isError && !checking && (
                <p role="status" className="font-mono2 mt-4 text-xs opacity-70">暂时无法读取额度，提交时会重新验证。</p>
              )}

              {checking && (
                <div className="mt-8">
                  <ElapsedTimer />
                  <div className="[&>div]:border-t-0">
                    <PipelineSteps
                      stage={status as Stage}
                      analysis={job?.analysis ?? null}
                      sources={job?.sources ?? null}
                    />
                  </div>
                </div>
              )}

              {connectionLost && (
                <div role="alert" className="bg-panel mt-4 flex flex-wrap items-center justify-between gap-3 border border-[#fb4d63] px-4 py-4">
                  <span className="font-mono2 text-xs text-[#fb4d63]">连接中断，核查任务可能仍在继续。重新连接可获取同一任务的进度。</span>
                  <button
                    type="button"
                    disabled={statusQ.isFetching}
                    onClick={() => void statusQ.refetch()}
                    className="font-giant border border-panel-line px-4 py-1.5 text-sm text-[color:var(--panel-fg)] disabled:opacity-50"
                  >
                    {statusQ.isFetching ? "正在连接…" : "重新连接"}
                  </button>
                </div>
              )}

              {!busy && !user && quota?.limited && status !== "error" && !quotaExhausted && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border border-ink px-4 py-2.5">
                  <span className="font-mono2 text-[11px] tracking-wide">
                    游客免费额度 · 剩余 <b>{quotaLeft}</b> / {quota.limit} 次核查（按设备与网络环境计）
                  </span>
                  <Link
                    to="/auth"
                    className="font-giant border border-ink px-3 py-1 text-xs tracking-wider transition-colors hover:bg-ink"
                  >
                    注册每日 5 次 →
                  </Link>
                </div>
              )}

              {!busy && user && quota?.limited && status !== "error" && !quotaExhausted && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border border-ink px-4 py-2.5">
                  <span className="font-mono2 text-[11px] tracking-wide">
                    今日免费额度 · 剩余 <b>{quotaLeft}</b> / {quota.limit} 次核查
                  </span>
                  <Link
                    to="/settings"
                    className="font-giant border border-ink px-3 py-1 text-xs tracking-wider transition-colors hover:bg-ink"
                  >
                    自带 Key 不限次 →
                  </Link>
                </div>
              )}

              {!busy && quota?.limited && quotaExhausted && (
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="bg-panel mt-4 border-2 border-[#fb4d63]"
                >
                  <div className="flex items-center justify-between border-b border-[#fb4d63]/40 px-4 py-2">
                    <span className="mono-label text-[8px] text-panel-soft">GUEST QUOTA · 游客免费额度</span>
                    <span className="mono-label animate-blink text-[8px] text-[#fb4d63]">● QUOTA EXHAUSTED</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-5">
                    <div className="flex items-center gap-4">
                      <span className="font-giant text-5xl leading-none text-[#fb4d63] sm:text-6xl">
                        0<span className="text-2xl text-panel-soft sm:text-3xl">/{quota.limit}</span>
                      </span>
                      <div>
                        <div className="font-giant text-lg tracking-wider text-[color:var(--panel-fg)] sm:text-xl">
                          {user ? "今日免费额度已用尽" : "免费额度已用尽"}
                        </div>
                        <div className="font-mono2 mt-1 max-w-md text-[10px] leading-relaxed text-panel-soft">
                          {user
                            ? `每日免费 ${quota.limit} 次，明日零点自动重置。填写自己的 API Key 即可不限次使用。`
                            : `未注册游客最多可核查 ${quota.limit} 次，按设备与网络环境计，清除浏览器数据不会重置。注册账号每日可免费核查 5 次，并保存专属历史核查存档。`}
                        </div>
                      </div>
                    </div>
                    <Link
                      to={user ? "/settings" : "/auth"}
                      className="font-giant animate-pulse bg-[#fb4d63] px-6 py-3 text-base tracking-wider text-[#170f0e] transition-opacity hover:opacity-85"
                    >
                      {user ? "填写 API Key →" : "注册 / 登录 →"}
                    </Link>
                  </div>
                </motion.div>
              )}

              {status === "error" && (
                <div role="alert" className="bg-panel mt-8 flex flex-wrap items-center justify-between gap-3 border border-[#fb4d63] px-4 py-4">
                  <span className="font-mono2 text-xs text-[#fb4d63]">ERROR — 核查失败：{error}</span>
                  <button
                    onClick={reset}
                    className="font-giant border border-ink px-4 py-1.5 text-sm tracking-wider transition-colors hover:bg-ink"
                  >
                    重新提交
                  </button>
                </div>
              )}

              {!busy && status !== "error" && (
                <div className="mt-14 grid gap-px border border-ink bg-[color-mix(in_srgb,var(--c-fg)_88%,transparent)] sm:grid-cols-3">
                  {FEATURES.map((f, i) => (
                    <motion.div
                      key={f.no}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.1 }}
                      className="bg-chrome relative px-5 py-6"
                    >
                      <div className="hatch absolute top-0 right-0 h-10 w-10 opacity-60" />
                      <CellIndex n={f.no} />
                      <div className="font-giant mt-3 text-2xl tracking-wide">{f.title}</div>
                      <div className="mono-label mt-1 text-[8px] opacity-60">{f.en}</div>
                      <p className="font-serif-body mt-3 text-[13px] leading-relaxed opacity-80">{f.desc}</p>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.section>
        ) : (
          <motion.section
            key="result"
            ref={resultAnchor}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, y: -40, transition: { duration: 0.4, ease: [0.4, 0, 1, 1] } }}
            onAnimationComplete={(definition) => {
              if (typeof definition === "object" && !Array.isArray(definition) && definition.opacity === 1) {
                resultAnchor.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
              }
            }}
          >
            {job?.result && <ResultView result={job.result} onReset={reset} />}
          </motion.section>
        )}
      </AnimatePresence>

      {/* ===== 页脚 ===== */}
      <footer className="bg-chrome border-t border-ink">
        <SectionBar invert className="border-b-0">Truthlens · 真相透镜 — 让每一条信息都经得起检验</SectionBar>
        <Marquee text="核查 · 辟谣 · 证据 ·" className="border-t border-ink py-3 text-5xl sm:text-7xl" />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink px-4 py-3 sm:px-8">
          <span className="mono-label opacity-60">© 2026 TRUTHLENS</span>
          <span className="mono-label opacity-60">AI + OPEN WEB EVIDENCE</span>
          <span className="mono-label opacity-60">结果仅供参考 · FOR REFERENCE ONLY</span>
        </div>
      </footer>
    </div>
  );
}
