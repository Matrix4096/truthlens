import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronDown, ShieldAlert, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/lib/auth";
import ResultView from "@/components/ResultView";
import { VERDICT_STYLE } from "@/lib/verdict";
import { BinaryStrip, SectionBar } from "@/components/Bits";
import type { Verdict } from "@contracts/types";

export default function Admin() {
  const { user } = useAuth();
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const isAdmin = user?.role === "admin";
  const overviewQ = trpc.admin.overview.useQuery(undefined, { enabled: isAdmin });
  const usersQ = trpc.admin.listUsers.useQuery(undefined, { enabled: isAdmin });
  const recordsQ = trpc.verify.history.useQuery(
    { userId: expandedUser! },
    { enabled: isAdmin && expandedUser !== null },
  );
  const detailQ = trpc.verify.byId.useQuery({ id: selectedId! }, { enabled: isAdmin && selectedId !== null });
  const delMut = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      void utils.admin.listUsers.invalidate();
      void utils.admin.overview.invalidate();
    },
  });

  /* ---- 权限墙 ---- */
  if (!isAdmin) {
    return (
      <div className="bg-panel flex min-h-[70vh] flex-col items-center justify-center px-4 py-24 text-center">
        <ShieldAlert className="h-10 w-10 text-[#fb4d63]" strokeWidth={1.6} />
        <div className="font-giant text-stroke-panel mt-6 text-6xl sm:text-8xl">403</div>
        <p className="font-mono2 mt-4 text-xs text-panel-soft">
          {user === undefined ? "正在验证权限…" : "该区域仅管理员可访问"}
        </p>
        {user === null && (
          <Link
            to="/auth"
            className="font-giant mt-6 bg-[color:var(--c-fg)] px-6 py-2.5 text-sm tracking-wider text-[color:var(--c-bg)]"
          >
            去登录
          </Link>
        )}
      </div>
    );
  }

  /* ---- 记录详情 ---- */
  if (selectedId !== null) {
    return (
      <div>
        <div className="bg-chrome px-4 py-4 sm:px-8">
          <button
            onClick={() => setSelectedId(null)}
            className="font-giant flex items-center gap-2 border border-ink px-4 py-2 text-base tracking-wider transition-colors hover:bg-ink"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.6} />
            返回管理后台
          </button>
        </div>
        {detailQ.isLoading && (
          <div className="bg-panel px-4 py-20 text-center">
            <span className="mono-label text-panel-soft animate-blink">LOADING…</span>
          </div>
        )}
        {detailQ.data && <ResultView result={detailQ.data} />}
      </div>
    );
  }

  const ov = overviewQ.data;
  const cards = [
    { label: "注册用户", en: "USERS", value: ov?.userCount ?? "—" },
    { label: "核查记录", en: "RECORDS", value: ov?.verificationCount ?? "—" },
    { label: "游客记录", en: "GUEST", value: ov?.guestCount ?? "—" },
  ];

  return (
    <div className="bg-chrome min-h-[70vh]">
      <div className="px-4 pt-10 pb-6 sm:px-8">
        <h1 className="font-giant leading-[0.9] tracking-tight" style={{ fontSize: "clamp(48px, 8vw, 110px)" }}>
          管理后台
        </h1>
        <p className="font-serif-body mt-3 max-w-lg text-sm leading-relaxed opacity-80">
          全站账号与核查存档总览。管理员可查看任意用户的记录，或删除违规账号。
        </p>
      </div>

      <BinaryStrip seed={77} className="border-y border-ink-soft px-4 py-2 sm:px-8" />

      {/* 统计卡片 */}
      <div className="grid gap-px border-b border-ink bg-[color-mix(in_srgb,var(--c-fg)_88%,transparent)] sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.en} className="bg-chrome px-5 py-5">
            <div className="mono-label text-[8px] opacity-60">{c.en}</div>
            <div className="font-giant mt-1 text-4xl leading-none">{c.value}</div>
            <div className="mt-1 text-xs font-bold tracking-wider opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      <SectionBar>Users · 账号管理</SectionBar>

      <div className="bg-panel">
        {usersQ.isLoading && (
          <div className="px-4 py-20 text-center">
            <span className="mono-label text-panel-soft animate-blink">LOADING…</span>
          </div>
        )}

        {(usersQ.data ?? []).map((u) => (
          <div key={u.id} className="border-b border-panel-line">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-4 sm:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-bold text-[color:var(--panel-fg)]">{u.username}</span>
                  <span
                    className={
                      u.role === "admin"
                        ? "mono-label border border-[#f5273f]/50 bg-[#f5273f]/10 px-1.5 py-0.5 text-[7px] text-[#ff8090]"
                        : "mono-label border border-panel-line px-1.5 py-0.5 text-[7px] text-panel-soft"
                    }
                  >
                    {u.role === "admin" ? "管理员" : "用户"}
                  </span>
                </div>
                <div className="font-mono2 mt-1 text-[10px] text-panel-soft">
                  #{u.id} · {u.verificationCount} 条核查 · 注册于 {new Date(u.createdAt).toLocaleDateString("zh-CN")}
                </div>
              </div>
              <button
                onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                className="font-giant flex items-center gap-1 border border-panel-line px-3 py-1.5 text-xs tracking-wider text-[color:var(--panel-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--panel-fg)_8%,transparent)]"
              >
                记录 <ChevronDown className={expandedUser === u.id ? "h-3.5 w-3.5 rotate-180 transition-transform" : "h-3.5 w-3.5 transition-transform"} />
              </button>
              {u.role !== "admin" && (
                <button
                  onClick={() => {
                    if (window.confirm(`确定删除用户「${u.username}」及其全部核查记录？`)) {
                      delMut.mutate({ id: u.id });
                    }
                  }}
                  className="p-2 text-panel-soft transition-colors hover:text-[#fb4d63]"
                  title="删除用户"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <AnimatePresence>
              {expandedUser === u.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-panel-line bg-[color-mix(in_srgb,var(--panel-fg)_3%,transparent)] px-4 py-2 sm:px-8">
                    {recordsQ.isLoading && (
                      <div className="py-4 text-center">
                        <span className="mono-label text-panel-soft animate-blink text-[9px]">LOADING…</span>
                      </div>
                    )}
                    {!recordsQ.isLoading && (recordsQ.data ?? []).length === 0 && (
                      <div className="font-mono2 py-4 text-center text-[10px] text-panel-soft">该用户暂无核查记录</div>
                    )}
                    {(recordsQ.data ?? []).map((r) => {
                      const style = VERDICT_STYLE[r.verdict as Verdict];
                      return (
                        <button
                          key={r.id}
                          onClick={() => setSelectedId(r.id)}
                          className="group flex w-full items-center gap-3 border-b border-panel-line/50 py-2.5 text-left last:border-0"
                        >
                          <span className="font-giant w-16 shrink-0 text-xs tracking-wider" style={{ color: style.hex }}>
                            {style.label}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--panel-fg)] group-hover:underline">
                            {r.claim}
                          </span>
                          <span className="font-mono2 shrink-0 text-[9px] text-panel-soft">
                            {new Date(r.createdAt).toLocaleDateString("zh-CN")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <BinaryStrip seed={12} className="px-4 py-2 sm:px-8" />
    </div>
  );
}
