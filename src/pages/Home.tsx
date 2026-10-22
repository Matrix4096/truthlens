import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
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
import { useAuth } from "@/lib/auth";
import { LLM_PROVIDERS, type LlmProviderId } from "@contracts/types";

const FEATURES = [
  { no: "01", title: "全网深度搜索", en: "DEEP SEARCH", desc: "多路检索策略并行扫描互联网，直取高权威来源正文内容。" },
  { no: "02", title: "证据链交叉验证", en: "CROSS-CHECK", desc: "展示来源立场、可靠性与分析要点，帮助你追溯核查依据。" },
  { no: "03", title: "AI 置信度判定", en: "VERDICT", desc: "基于证据权重计算可靠度评分，给出六级判定结论。" },
];

type Status = "idle" | Stage | "done" | "error";

export default function Home() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as { claimDraft?: unknown; draftOwnerId?: unknown } | null;
  const initialDraft = typeof routeState?.claimDraft === "string" &&
    (routeState.draftOwnerId === null || routeState.draftOwnerId === user?.id)
    ? routeState.claimDraft.slice(0, 2000)
    : "";

  useEffect(() => {
    // 草稿仅随本次接入流程传递；消费后移除，避免切换账号时再次恢复。
    if (user !== undefined && typeof routeState?.claimDraft === "string") {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.pathname, location.search, navigate, routeState?.claimDraft, user]);

  // 账号改变时卸载任务状态与轮询，旧账号的迟到响应不能进入新账号页面。
  return <HomeSession key={user?.id ?? "visitor"} initialDraft={initialDraft} />;
}

function HomeSession({ initialDraft }: { initialDraft: string }) {
  const [draft, setDraft] = useState(initialDraft);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submissionLock = useRef(false);
  const mounted = useRef(false);
  const resultAnchor = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { user, sessionError, retrySession } = useAuth();
  const provider = user?.llmProvider && Object.hasOwn(LLM_PROVIDERS, user.llmProvider)
    ? LLM_PROVIDERS[user.llmProvider as LlmProviderId]
    : undefined;
  const ready = !sessionError && !!user?.hasLlmKey && !!provider;
  const draftState = { claimDraft: draft, draftOwnerId: user?.id ?? null };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const startMut = trpc.verify.start.useMutation();
  const utils = trpc.useUtils();

  // 轮询任务状态：进行中每 1.5s 拉取一次，结束自动停止
  const statusQ = trpc.verify.status.useQuery(
    { jobId: jobId! },
    {
      enabled: jobId !== null && !!user && !sessionError,
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
  const busy = checking;
  const connectionLost = jobId !== null && statusQ.isError && checking;

  async function runCheck(claim: string, mode: "deep" | "quick") {
    // ref 同步锁住双击及快捷键，避免等待 React 重渲染期间提交两次。
    if (submissionLock.current || busy || !ready) return;
    submissionLock.current = true;
    setSubmitError("");
    setSubmitting(true);
    setJobId(null);
    try {
      const res = await startMut.mutateAsync({ claim, mode });
      if (!mounted.current) return;
      setJobId(res.jobId);
    } catch (e) {
      if (!mounted.current) return;
      console.error(e);
      setSubmitError((e as Error).message || "无法连接到核查服务，请稍后重试");
      setJobId(null);
      void utils.auth.me.invalidate();
    } finally {
      submissionLock.current = false;
      if (mounted.current) setSubmitting(false);
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
  }, [job?.stage, utils]);

  const error = job?.stage === "error" ? job.error || "核查过程中出现错误" : submitError;

  return (
    <div>
      {/* ===== HERO（铬层红/黑 + 交互流线场） ===== */}
      <section className="truthlens-hero bg-chrome relative overflow-hidden border-b border-ink">
        <FlowField className="truthlens-hero-flow absolute inset-0 h-full w-full" />
        <div className="relative">
          <div className="flex items-center justify-between px-4 pt-4 sm:px-8">
            <span className="mono-label opacity-70">Deep-search fact-check engine</span>
            <span className="mono-label hidden opacity-70 sm:block">EST. 2026 — Running globally</span>
          </div>

          <div className="px-4 pt-10 pb-6 sm:px-8 sm:pt-14">
            <h1 className="truthlens-hero-title font-giant leading-[0.88] tracking-tight">
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
              <ClaimInput
                busy={busy}
                submitDisabled={!ready}
                submitLabel={sessionError ? "请先恢复登录状态" : user === undefined ? "正在验证登录状态" : !user ? "登录后开始核查" : !ready ? "配置模型后开始核查" : undefined}
                value={draft}
                onChange={setDraft}
                onSubmit={runCheck}
              />

              <div
                id="model-access-status"
                role={sessionError ? "alert" : "status"}
                className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-ink px-4 py-3"
              >
                {sessionError ? (
                  <>
                    <p className="font-mono2 text-xs">暂时无法确认登录和模型状态。草稿可以继续编辑，恢复连接后即可继续。</p>
                    <button type="button" onClick={retrySession} className="font-giant border border-ink px-3 py-1 text-xs tracking-wider">重新连接</button>
                  </>
                ) : user === undefined ? (
                  <p className="font-mono2 text-xs">正在验证登录状态，你可以先填写待核查信息。</p>
                ) : !user ? (
                  <>
                    <p className="font-mono2 text-xs">登录后接入自己的模型 API Key，即可提交核查。当前草稿会随接入流程保留。</p>
                    <Link data-no-transition to="/auth" state={{ ...draftState, from: "/settings" }} className="font-giant border border-ink px-3 py-1 text-xs tracking-wider transition-colors hover:bg-ink">登录 / 注册后接入 →</Link>
                  </>
                ) : !ready ? (
                  <>
                    <p className="font-mono2 text-xs">请先选择模型平台并保存有效的 API Key。当前草稿会随配置流程保留。</p>
                    <Link data-no-transition to="/settings" state={draftState} className="font-giant border border-ink px-3 py-1 text-xs tracking-wider transition-colors hover:bg-ink">配置我的模型 →</Link>
                  </>
                ) : (
                  <>
                    <p className="font-mono2 text-xs">已接入 {provider?.label} · 使用你自己的模型 Key，调用受供应商余额与限流规则约束。</p>
                    <Link data-no-transition to="/settings" state={draftState} className="font-giant border border-ink px-3 py-1 text-xs tracking-wider transition-colors hover:bg-ink">管理模型 →</Link>
                  </>
                )}
              </div>

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
