import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Lock, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/lib/auth";
import ResultView from "@/components/ResultView";
import FlowField from "@/components/FlowField";
import { VERDICT_STYLE } from "@/lib/verdict";
import { BinaryStrip, SectionBar } from "@/components/Bits";
import type { Verdict } from "@contracts/types";

/** 流场背景：fixed 跟随视口；页面根容器另提供整页深色底，保证底部不留空隙 */
function WaveBackdrop() {
  return (
    <>
      <FlowField varName="--panel-fg" className="fixed inset-0 z-0 h-full w-full opacity-70" />
      {/* 顶部渐暗，保证标题可读 */}
      <div
        className="fixed inset-0 z-0 bg-gradient-to-b from-[rgba(10,8,8,0.55)] via-transparent to-[rgba(10,8,8,0.4)]"
        aria-hidden
      />
    </>
  );
}

export default function History() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState("");
  const utils = trpc.useUtils();
  const { user } = useAuth();

  const historyQ = trpc.verify.history.useQuery(undefined, {
    enabled: selectedId === null && user !== null && user !== undefined,
  });
  const detailQ = trpc.verify.byId.useQuery({ id: selectedId! }, { enabled: selectedId !== null && !!user });
  const removeMut = trpc.verify.remove.useMutation({
    onMutate: () => setRemoveError(""),
    onSuccess: async (result, input) => {
      if (!result.ok) {
        setRemoveError("记录删除失败或已不存在，请刷新列表后重试。");
      }
      await Promise.all([
        utils.verify.history.invalidate(),
        utils.verify.byId.invalidate({ id: input.id }),
      ]);
    },
    onError: (error) => setRemoveError(error.message || "删除失败，请稍后重试。"),
  });

  /* ---- 加载中 ---- */
  if (user === undefined) {
    return (
      <div className="bg-panel relative z-[1] flex min-h-[calc(100vh-64px)] items-center justify-center">
        <WaveBackdrop />
        <span className="mono-label text-panel-soft animate-blink relative z-[1]">
          LOADING · 正在验证登录状态…
        </span>
      </div>
    );
  }

  /* ---- 未登录：登录墙 ---- */
  if (user === null) {
    return (
      <div className="bg-panel relative z-[1] flex min-h-[calc(100vh-64px)] flex-col items-center justify-center px-4 py-24 text-center">
        <WaveBackdrop />
        <div className="relative z-[1]">
          <Lock className="mx-auto h-10 w-10 text-panel-soft" strokeWidth={1.6} />
          <div className="font-giant text-stroke-panel mt-6 text-6xl sm:text-8xl">LOCKED</div>
          <p className="font-mono2 mx-auto mt-4 max-w-sm text-xs leading-relaxed text-panel-soft">
            历史核查存档仅对注册账号开放，且每个账号的记录相互独立、互不互通。
          </p>
          <Link
            to="/auth"
            state={{ from: "/history" }}
            className="font-giant mt-6 inline-block bg-[color:var(--c-fg)] px-6 py-2.5 text-sm tracking-wider text-[color:var(--c-bg)] transition-opacity hover:opacity-85"
          >
            登录 / 注册账号 →
          </Link>
        </div>
      </div>
    );
  }

  /* ---- 详情视图 ---- */
  if (selectedId !== null) {
    return (
      <div className="bg-panel relative min-h-[calc(100vh-64px)]">
        <div className="px-4 py-4 sm:px-8">
          <button
            onClick={() => setSelectedId(null)}
            className="font-giant flex items-center gap-2 border border-panel-line px-4 py-2 text-base tracking-wider text-[color:var(--panel-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_8%,transparent)]"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.6} />
            返回历史列表
          </button>
        </div>
        {detailQ.isLoading && (
          <div className="px-4 py-20 text-center">
            <span className="mono-label text-panel-soft animate-blink">LOADING · 正在加载核查记录…</span>
          </div>
        )}
        {detailQ.data && <ResultView result={detailQ.data} />}
        {detailQ.isError && (
          <div role="alert" className="px-4 py-12 text-center text-panel-soft">
            <p className="font-mono2 text-xs">记录加载失败，请检查网络后重试。</p>
            <button type="button" onClick={() => void detailQ.refetch()} className="mt-4 border border-panel-line px-4 py-2 text-sm">重新加载</button>
          </div>
        )}
        {detailQ.data === null && !detailQ.isLoading && (
          <div className="px-4 py-20 text-center">
            <span className="mono-label text-panel-soft">记录不存在或已被删除</span>
          </div>
        )}
      </div>
    );
  }

  const items = historyQ.data ?? [];

  /* ---- 列表视图 ---- */
  return (
    <div className="bg-panel relative min-h-[calc(100vh-64px)]">
      <WaveBackdrop />

      <div className="relative z-[1]">
        <div className="px-4 pt-10 pb-6 sm:px-8">
          <h1
            className="font-giant leading-[0.9] tracking-tight text-[color:var(--panel-fg)]"
            style={{ fontSize: "clamp(48px, 8vw, 110px)" }}
          >
            历史记录
          </h1>
          <p className="font-serif-body mt-3 max-w-lg text-sm leading-relaxed text-panel-soft">
            显示最近 {items.length} 条核查存档。点击任意条目，查看完整证据链与判定细节。
          </p>
        </div>

        <BinaryStrip
          seed={99}
          className="border-y border-panel-line px-4 py-2 text-panel-soft sm:px-8"
        />

        <SectionBar invert className="mt-0 border-panel-line">
          Archive · 核查存档
        </SectionBar>

        <div>
          {removeError && <p role="alert" className="font-mono2 px-4 py-4 text-xs text-[#fb4d63] sm:px-8">{removeError}</p>}

          {historyQ.isError && (
            <div role="alert" className="px-4 py-12 text-center text-panel-soft">
              <p className="font-mono2 text-xs">历史记录加载失败，请检查网络后重试。</p>
              <button type="button" onClick={() => void historyQ.refetch()} className="mt-4 border border-panel-line px-4 py-2 text-sm">重新加载</button>
            </div>
          )}
          {historyQ.isLoading && (
            <div className="px-4 py-20 text-center">
              <span className="mono-label text-panel-soft animate-blink">LOADING…</span>
            </div>
          )}

          {!historyQ.isLoading && !historyQ.isError && items.length === 0 && (
            <div className="px-4 py-24 text-center">
              <div className="font-giant text-stroke-panel text-6xl sm:text-8xl">EMPTY</div>
              <p className="font-mono2 mt-4 text-xs text-panel-soft">还没有核查记录，去核查台提交第一条信息吧</p>
            </div>
          )}

          <AnimatePresence>
            {items.map((item, i) => {
              const style = VERDICT_STYLE[item.verdict as Verdict];
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-panel-line px-4 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_3%,transparent)] sm:px-8"
                >
                  <button onClick={() => setSelectedId(item.id)} className="contents text-left">
                    <span
                      className="font-giant w-24 shrink-0 text-center text-lg tracking-wider sm:w-28 sm:text-xl"
                      style={{ color: style.hex }}
                    >
                      {style.label}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[color:var(--panel-fg)] group-hover:underline group-hover:decoration-[#f5273f] group-hover:decoration-2 group-hover:underline-offset-4">
                        {item.claim}
                      </span>
                      <span className="font-mono2 mt-1 block text-[10px] text-panel-soft">
                        可靠度 <b style={{ color: style.hex }}>{item.credibilityScore}</b>/100 ·{" "}
                        {new Date(item.createdAt).toLocaleString("zh-CN")} · #{item.id}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => removeMut.mutate({ id: item.id })}
                    disabled={removeMut.isPending}
                    aria-label={`删除记录：${item.claim}`}
                    className="p-2 text-panel-soft transition-colors hover:text-[#fb4d63] disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    title="删除记录"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        <BinaryStrip seed={7} className="px-4 py-2 text-panel-soft sm:px-8" />
      </div>
    </div>
  );
}
