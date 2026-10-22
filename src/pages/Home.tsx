import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { trpc } from "@/providers/trpc";
import ClaimInput from "@/components/ClaimInput";
import ElapsedTimer from "@/components/ElapsedTimer";
import PipelineSteps, { type Stage } from "@/components/PipelineSteps";
import ResultView from "@/components/ResultView";
import EditorialHero from "@/components/EditorialHero";
import { useAuth } from "@/lib/auth";
import { LLM_PROVIDERS, type LlmProviderId } from "@contracts/types";
import "@/styles/home.css";

const FEATURES = [
  {
    no: "01",
    title: "回到信息的来源",
    en: "SEARCH",
    desc: "从待核查说法提取问题，检索公开网络，寻找可以阅读、可以追溯的出处。",
    action: "提出一个问题",
  },
  {
    no: "02",
    title: "让证据彼此对照",
    en: "CROSS-CHECK",
    desc: "比较不同来源的立场、可靠性与分析要点，呈现支持、反对与尚待确认的依据。",
    action: "从证据出发",
  },
  {
    no: "03",
    title: "理解结论的边界",
    en: "ASSESS",
    desc: "结合证据生成判定与置信度，保留来源供你复核。AI 的结论仍需结合语境判断。",
    action: "开始一次核查",
  },
];

type Status = "idle" | Stage | "done" | "error";

export default function Home() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as {
    claimDraft?: unknown;
    draftOwnerId?: unknown;
  } | null;
  const initialDraft =
    typeof routeState?.claimDraft === "string" &&
    (routeState.draftOwnerId === null ||
      (user?.id !== undefined && routeState.draftOwnerId === user.id))
      ? routeState.claimDraft.slice(0, 2000)
      : "";
  const identity = user === undefined ? undefined : (user?.id ?? null);
  const [draftSession, setDraftSession] = useState(() => ({
    identity,
    value: initialDraft,
    edited: false,
    resolved: identity !== undefined,
  }));

  if (draftSession.identity !== identity) {
    // 首次身份解析仅接管当前草稿；之后的账号变化必须隔离旧草稿。
    // 条件式派生状态在子组件渲染前更新，避免账号切换后短暂展示旧内容。
    const firstResolution = !draftSession.resolved && identity !== undefined;
    setDraftSession({
      identity,
      value: firstResolution
        ? draftSession.edited
          ? draftSession.value
          : initialDraft
        : "",
      edited: firstResolution && draftSession.edited,
      resolved: draftSession.resolved || identity !== undefined,
    });
  }

  const setDraft = useCallback((value: string) => {
    setDraftSession(current => ({ ...current, value, edited: true }));
  }, []);

  useEffect(() => {
    // 草稿仅随本次接入流程传递；消费后移除，避免切换账号时再次恢复。
    if (user !== undefined && typeof routeState?.claimDraft === "string") {
      navigate(location.pathname + location.search, {
        replace: true,
        state: null,
      });
    }
  }, [
    location.pathname,
    location.search,
    navigate,
    routeState?.claimDraft,
    user,
  ]);

  // 账号改变时卸载任务状态与轮询，旧账号的迟到响应不能进入新账号页面。
  return (
    <HomeSession
      key={user?.id ?? "visitor"}
      draft={draftSession.value}
      onDraftChange={setDraft}
    />
  );
}

function HomeSession({
  draft,
  onDraftChange,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submissionLock = useRef(false);
  const mounted = useRef(false);
  const resultAnchor = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const attachResultAnchor = useCallback(
    (node: HTMLElement | null) => {
      resultAnchor.current = node;
      // 静态模式没有入场动画；挂载时即可定位结果。
      if (node && reducedMotion)
        node.scrollIntoView({ behavior: "auto", block: "start" });
    },
    [reducedMotion]
  );
  const { user, sessionError, retrySession } = useAuth();
  const provider =
    user?.llmProvider && Object.hasOwn(LLM_PROVIDERS, user.llmProvider)
      ? LLM_PROVIDERS[user.llmProvider as LlmProviderId]
      : undefined;
  const ready = !sessionError && !!user?.hasLlmKey && !!provider;
  const draftState = { claimDraft: draft, draftOwnerId: user?.id ?? null };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const startMut = trpc.verify.start.useMutation();
  const utils = trpc.useUtils();

  // 轮询任务状态：进行中每 1.5s 拉取一次，结束自动停止
  const statusQ = trpc.verify.status.useQuery(
    { jobId: jobId! },
    {
      enabled: jobId !== null && !!user && !sessionError,
      refetchInterval: query => {
        const stage = query.state.data?.stage;
        if (
          stage === "done" ||
          stage === "error" ||
          query.state.status === "error"
        )
          return false;
        return 1500;
      },
      retry: 2,
    }
  );

  const job = statusQ.data;
  const status: Status = submitting
    ? "analyzing"
    : submitError
      ? "error"
      : jobId
        ? (job?.stage ?? "analyzing")
        : "idle";

  // 在拿到 jobId 前也必须锁定输入区，否则双击会启动多份相同的核查。
  const checking =
    submitting || (jobId !== null && status !== "done" && status !== "error");
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

  const error =
    job?.stage === "error" ? job.error || "核查过程中出现错误" : submitError;

  return (
    <div className="tl-home">
      <EditorialHero />

      {/* ===== 输入区 ===== */}
      <div id="verification-desk" className="tl-desk-anchor" tabIndex={-1}>
        <AnimatePresence mode="wait">
          {status !== "done" ? (
            <motion.section
              key="input"
              initial={reducedMotion ? false : { opacity: 0, y: 20 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
              }}
              exit={
                reducedMotion
                  ? { opacity: 1, transition: { duration: 0 } }
                  : { opacity: 0, y: -16, transition: { duration: 0.25 } }
              }
              className="tl-desk"
              aria-labelledby="tl-desk-title"
            >
              <div className="tl-shell tl-desk-grid">
                <div>
                  <p className="tl-eyebrow">VERIFICATION DESK / 核查工作台</p>
                  <h2 className="tl-desk-heading" id="tl-desk-title">
                    这条信息，
                    <br />
                    可信吗？
                  </h2>
                  <p className="tl-desk-intro">
                    写下一条新闻、一个说法或一段传言。尽量保留关键事实与上下文，让核查从一个清晰的问题开始。
                  </p>
                  <p className="tl-desk-meta">使用你自己的模型 API Key</p>
                </div>
                <div className="tl-desk-content">
                  <ClaimInput
                    busy={busy}
                    submitDisabled={!ready}
                    submitLabel={
                      sessionError
                        ? "请先恢复登录状态"
                        : user === undefined
                          ? "正在验证登录状态"
                          : !user
                            ? "登录后开始核查"
                            : !ready
                              ? "配置模型后开始核查"
                              : undefined
                    }
                    value={draft}
                    onChange={onDraftChange}
                    onSubmit={runCheck}
                  />

                  <div
                    id="model-access-status"
                    role={sessionError ? "alert" : "status"}
                    className="tl-access-status"
                  >
                    {sessionError ? (
                      <>
                        <p>
                          暂时无法确认登录和模型状态。草稿可以继续编辑，恢复连接后即可继续。
                        </p>
                        <button
                          type="button"
                          onClick={retrySession}
                          className="tl-access-action"
                        >
                          重新连接
                        </button>
                      </>
                    ) : user === undefined ? (
                      <p>正在验证登录状态，你可以先填写待核查信息。</p>
                    ) : !user ? (
                      <>
                        <p>
                          登录后接入自己的模型 API
                          Key，即可提交核查。当前草稿会随接入流程保留。
                        </p>
                        <Link
                          data-no-transition
                          to="/auth"
                          state={{ ...draftState, from: "/settings" }}
                          className="tl-access-action"
                        >
                          登录 / 注册后接入 ↗
                        </Link>
                      </>
                    ) : !ready ? (
                      <>
                        <p>
                          请先选择模型平台并保存有效的 API
                          Key。当前草稿会随配置流程保留。
                        </p>
                        <Link
                          data-no-transition
                          to="/settings"
                          state={draftState}
                          className="tl-access-action"
                        >
                          配置我的模型 ↗
                        </Link>
                      </>
                    ) : (
                      <>
                        <p>
                          已接入 {provider?.label} · 使用你自己的模型
                          Key，调用受供应商余额与限流规则约束。
                        </p>
                        <Link
                          data-no-transition
                          to="/settings"
                          state={draftState}
                          className="tl-access-action"
                        >
                          管理模型 ↗
                        </Link>
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
                    <div
                      role="alert"
                      className="bg-panel mt-4 flex flex-wrap items-center justify-between gap-3 border border-[#fb4d63] px-4 py-4"
                    >
                      <span className="font-mono2 text-xs text-[#fb4d63]">
                        连接中断，核查任务可能仍在继续。重新连接可获取同一任务的进度。
                      </span>
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
                    <div
                      role="alert"
                      className="bg-panel mt-8 flex flex-wrap items-center justify-between gap-3 border border-[#fb4d63] px-4 py-4"
                    >
                      <span className="font-mono2 text-xs text-[#fb4d63]">
                        ERROR — 核查失败：{error}
                      </span>
                      <button
                        onClick={reset}
                        className="font-giant border border-ink px-4 py-1.5 text-sm tracking-wider transition-colors hover:bg-ink"
                      >
                        重新提交
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          ) : (
            <motion.section
              key="result"
              ref={attachResultAnchor}
              initial={reducedMotion ? false : { opacity: 0, y: 20 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
              }}
              exit={
                reducedMotion
                  ? { opacity: 1, transition: { duration: 0 } }
                  : { opacity: 0, y: -20, transition: { duration: 0.25 } }
              }
              onAnimationComplete={definition => {
                if (
                  !reducedMotion &&
                  typeof definition === "object" &&
                  !Array.isArray(definition) &&
                  definition.opacity === 1
                ) {
                  resultAnchor.current?.scrollIntoView({
                    behavior: reducedMotion ? "auto" : "smooth",
                    block: "start",
                  });
                }
              }}
            >
              {job?.result && (
                <ResultView result={job.result} onReset={reset} />
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {!busy && status !== "error" && status !== "done" && (
        <section
          className="tl-shell tl-process"
          aria-labelledby="tl-process-title"
        >
          <div className="tl-process-header">
            <h2 id="tl-process-title">每一步，都有迹可循。</h2>
            <p className="tl-eyebrow">THE PROCESS / 核查如何展开</p>
          </div>
          <div className="tl-process-grid">
            {FEATURES.map((feature, index) => (
              <motion.article
                key={feature.no}
                className="tl-process-step"
                initial={reducedMotion ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span className="tl-process-number">
                  {feature.no} / {feature.en}
                </span>
                <h3 className="tl-process-title">{feature.title}</h3>
                <p className="tl-process-description">{feature.desc}</p>
                <a
                  href="#verification-desk"
                  data-no-transition
                  className="tl-process-link"
                >
                  {feature.action}
                  <span aria-hidden="true">↗</span>
                </a>
              </motion.article>
            ))}
          </div>
        </section>
      )}

      {/* ===== 页脚 ===== */}
      <footer className="tl-footer">
        <div className="tl-shell tl-footer-content">
          <span>© 2026 TRUTH LENS · 真相透镜</span>
          <span>让判断，有据可循。</span>
          <span>AI 辅助核查 · 结果供参考</span>
        </div>
      </footer>
    </div>
  );
}
