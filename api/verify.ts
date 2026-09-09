import { z } from "zod";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getSessionUser, decryptApiKey } from "./auth";
import { webSearch, fetchPage, chatJson, isNetworkError } from "./services/agentgw";
import type { LlmConfig } from "./services/agentgw";
import { getDb } from "./queries/connection";
import { users, verifications } from "@db/schema";
import { and, count, desc, eq, gte, or } from "drizzle-orm";
import type {
  ClaimAnalysis,
  SearchMode,
  SourceItem,
  SourceStats,
  Verdict,
  VerificationResult,
  HistoryItem,
  Reliability,
} from "@contracts/types";
import { GUEST_LIMIT, LLM_PROVIDERS, USER_DAILY_LIMIT } from "@contracts/types";
import type { LlmProviderId } from "@contracts/types";
import type { TrpcContext } from "./context";

// ---------- 类型 ----------

type RawSource = SourceItem & { content?: string };

export type JobStage = "analyzing" | "searching" | "judging" | "done" | "error";

export interface JobState {
  id: string;
  stage: JobStage;
  claim: string;
  /** 归属：注册用户 id（游客为 null） */
  userId?: number | null;
  /** 归属：游客标识（注册用户为 null） */
  guestId?: string | null;
  analysis?: ClaimAnalysis;
  sources?: RawSource[];
  result?: VerificationResult;
  error?: string;
  createdAt: number;
  /** 任务级 LLM 通道（用户自带 Key）；null 时走环境变量或 agent-gw */
  llm?: LlmConfig | null;
  /** 游客访问 IP 的摘要（仅游客配额用，不下发客户端） */
  ipHash?: string | null;
}

/** 轮询接口使用的轻量任务状态，不返回仅供服务端判定使用的网页正文。 */
export type JobProgress = Omit<JobState, "sources" | "ipHash"> & { sources?: SourceItem[] };

// ---------- 任务存储（内存，30 分钟 TTL） ----------

const jobs = new Map<string, JobState>();
const GUEST_COOKIE = "tl-guest";
const GUEST_HEADER = "x-guest-token";
const GUEST_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
// 开发环境允许未配置密钥，但进程重启后会使游客身份失效；生产环境应始终设置 APP_SECRET。
const guestSigningSecret = process.env.GUEST_TOKEN_SECRET || process.env.APP_SECRET || randomBytes(32).toString("hex");

function sweepJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) {
    if (j.createdAt < cutoff) jobs.delete(id);
  }
}
setInterval(sweepJobs, 5 * 60 * 1000).unref();

/** 以 UTC+8 为日界的今日起点：每日免费额度按中国自然日重置，与服务器时区无关 */
function todayStartUtcMs(): number {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 8 * 3600 * 1000;
}

/** 读取用户自带的 LLM 配置（解密落库密文），未设置或已损坏返回 null */
async function userLlmConfig(userId: number): Promise<LlmConfig | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ p: users.llmProvider, k: users.llmApiKeyEnc })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = rows[0];
    if (!row?.p || !row.k) return null;
    const preset = LLM_PROVIDERS[row.p as LlmProviderId];
    if (!preset) return null;
    return { apiKey: decryptApiKey(row.k), baseUrl: preset.baseUrl, model: preset.model };
  } catch {
    return null;
  }
}

/** 注册用户今日已用配额：今日落库记录数 + 进行中任务数 */
async function dailyUsed(userId: number): Promise<number> {
  let used = 0;
  try {
    const db = getDb();
    const [row] = await db
      .select({ n: count() })
      .from(verifications)
      .where(and(eq(verifications.userId, userId), gte(verifications.createdAt, new Date(todayStartUtcMs()))));
    used = row?.n ?? 0;
  } catch {
    /* DB 异常时按 0 计 */
  }
  for (const j of jobs.values()) {
    if (j.userId === userId && isActiveJob(j)) used++;
  }
  return used;
}

function isActiveJob(job: JobState) {
  return job.stage !== "done" && job.stage !== "error";
}

function isSameOwner(job: JobState, userId: number | null, guestId: string | null) {
  return job.userId === userId && job.guestId === guestId;
}

/** `content` 是抓取阶段的临时输入，不应进入轮询响应。 */
function toJobProgress(job: JobState): JobProgress {
  const { ipHash: _ipHash, ...rest } = job;
  return {
    ...rest,
    sources: job.sources?.map(({ content: _content, ...source }) => source),
  };
}

function cookieValue(ctx: TrpcContext, name: string): string | null {
  const cookie = ctx.req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function signGuestId(id: string): string {
  return createHmac("sha256", guestSigningSecret).update(id).digest("hex");
}

/** 校验签名令牌（Cookie 值与 x-guest-token 头共用同一格式），伪造或格式错误返回 null。 */
function verifyGuestToken(signed: string | null): string | null {
  if (!signed) return null;
  const [id, signature, ...rest] = signed.split(".");
  if (rest.length || !id || !signature || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = signGuestId(id);
  const received = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer) ? id : null;
}

function guestIdFromCookie(ctx: TrpcContext): string | null {
  return verifyGuestToken(cookieValue(ctx, GUEST_COOKIE));
}

/** Cookie + 请求头双通道：嵌入预览等第三方上下文会拦截 Cookie 写入，前端此时经 x-guest-token 头回传同一签名令牌。 */
function guestTokenFrom(ctx: TrpcContext): string | null {
  return guestIdFromCookie(ctx) ?? verifyGuestToken(ctx.req.headers.get(GUEST_HEADER));
}

function issueGuestCookie(ctx: TrpcContext, id: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  ctx.resHeaders.append(
    "Set-Cookie",
    `${GUEST_COOKIE}=${id}.${signGuestId(id)}; Path=/; Max-Age=${GUEST_COOKIE_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
  );
}

/** 获取或签发游客身份；同时返回签名令牌，供前端在 Cookie 不可用时走请求头通道。 */
function getOrCreateGuestToken(ctx: TrpcContext): { id: string; token: string } {
  const current = guestTokenFrom(ctx);
  if (current) return { id: current, token: `${current}.${signGuestId(current)}` };
  const id = randomUUID();
  issueGuestCookie(ctx, id);
  return { id, token: `${id}.${signGuestId(id)}` };
}

/** 访问者 IP 的 HMAC 摘要：取代理透传的首个 X-Forwarded-For。本地/未知来源返回 null（退化为仅按游客身份计数）。 */
function clientIpHash(ctx: TrpcContext): string | null {
  const fwd = ctx.req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0]?.trim() : null) || ctx.req.headers.get("x-real-ip")?.trim() || null;
  if (!ip || ip === "127.0.0.1" || ip === "::1") return null;
  return createHmac("sha256", guestSigningSecret).update(`ip:${ip}`).digest("hex");
}

/** 游客已用配额：该游客身份与该访问 IP 落库记录的并集 + 任一匹配的进行中任务 */
async function guestUsage(guestId: string, ipHash: string | null): Promise<number> {
  let used = 0;
  try {
    const db = getDb();
    const cond = ipHash
      ? or(eq(verifications.guestId, guestId), eq(verifications.ipHash, ipHash))
      : eq(verifications.guestId, guestId);
    const [row] = await db.select({ n: count() }).from(verifications).where(cond);
    used = row?.n ?? 0;
  } catch {
    /* DB 异常时按 0 计 */
  }
  for (const j of jobs.values()) {
    if (isActiveJob(j) && (j.guestId === guestId || (ipHash !== null && j.ipHash === ipHash))) used++;
  }
  return used;
}

// ---------- 工具 ----------

function sourceId(url: string) {
  return createHash("md5").update(url).digest("hex").slice(0, 10);
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function reliabilityFromAuthority(a?: string): Reliability {
  if (!a) return "medium";
  const up = a.toUpperCase();
  if (up.startsWith("A")) return "high";
  if (up.startsWith("C") || up.startsWith("D")) return "low";
  return "medium";
}

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------- 步骤一：主张拆解 ----------

interface AnalyzeLLM {
  coreClaims?: string[];
  topic?: string;
  queries?: string[];
}

/** 模板检索式：快速模式与 LLM 拆解失败时的回退策略（原句核查/质疑/辟谣/权威数据） */
function templateQueries(claim: string): ClaimAnalysis {
  const short = claim.length > 60 ? claim.slice(0, 60) : claim;
  return {
    coreClaims: [claim.slice(0, 200)],
    topic: "其他",
    queries: [short, `${short} 是真的吗`, `${short} 辟谣`, `${short} 权威 数据`],
  };
}

function todayText() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

async function analyzeClaim(claim: string, llm: LlmConfig | null = null): Promise<ClaimAnalysis> {
  const sys =
    "你是专业事实核查专家，擅长把一段待核查信息拆解为可验证的事实主张，并设计检索策略。只输出 JSON，不要输出任何其他文字。";
  const usr = `今天是${todayText()}。\n【待核查信息】\n${claim}\n\n请完成：\n1. 提炼 1-3 个可核查的核心事实主张 coreClaims（若原文是观点/问题，提炼其隐含的事实前提）\n2. 给出主题分类 topic（如 健康/科技/历史/财经/社会/科学/国际/其他）\n3. 生成 4 条中文搜索检索式 queries，每条不超过 22 字、去掉口语化表述：第1条直接核查原始说法，第2条偏向权威来源（政府/学术/主流媒体），第3条偏向查证辟谣/反方证据，第4条补充背景与数据；若信息有时效性，在检索式中加入当前年份限定。\n\n严格输出 JSON：{"coreClaims":["..."],"topic":"...","queries":["...","...","...","..."]}`;
  const parsed = await chatJson<AnalyzeLLM>(sys, usr, { maxTokens: 3000, timeoutMs: 60_000, llm });
  if (!parsed) return templateQueries(claim);
  const coreClaims = (parsed.coreClaims ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
  const queries = (parsed.queries ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
  const fallback = templateQueries(claim);
  return {
    coreClaims: coreClaims.length ? coreClaims : fallback.coreClaims,
    topic: parsed.topic?.trim() || "其他",
    queries: queries.length ? queries : fallback.queries,
  };
}

// ---------- 步骤二：深度搜索 ----------

interface RoundOutcome {
  items: Awaited<ReturnType<typeof webSearch>>;
  error?: string;
}

function collectItems(byUrl: Map<string, RawSource>, items: RoundOutcome["items"]) {
  for (const item of items) {
    const url = (item.url ?? "").trim();
    if (!url || byUrl.has(url)) continue;
    const snippet = (item.snippet || item.content || "").replace(/\s+/g, " ").trim();
    if (!snippet && !item.title) continue;
    byUrl.set(url, {
      id: sourceId(url),
      title: (item.title ?? "").trim() || hostOf(url) || url,
      url,
      siteName: (item.site_name ?? "").trim() || hostOf(url),
      date: item.date,
      authority: item.authority,
      snippet: snippet.slice(0, 800),
      stance: "neutral",
      reliability: reliabilityFromAuthority(item.authority),
    });
  }
}

/** 单轮检索：并发度 2 + 250ms 错峰启动（重试机制兜底限流）；返回来源与失败数 */
async function searchRound(qs: string[]): Promise<{ sources: RawSource[]; failures: number; errors: string[] }> {
  const byUrl = new Map<string, RawSource>();
  const errors: string[] = [];
  let failures = 0;
  let firstNetworkError: string | null = null;

  // 并发度 2 的简单信号量调度
  let idx = 0;
  const worker = async () => {
    while (idx < qs.length) {
      const i = idx++;
      const q = qs[i];
      try {
        const items = await webSearch(q, i === 0 ? 2 : 1);
        collectItems(byUrl, items);
      } catch (e) {
        failures++;
        const msg = (e as Error).message;
        if (errors.length < 2 && !errors.some((x) => x === msg)) errors.push(msg);
        console.error(`[verify] 检索失败（${q.slice(0, 30)}…）:`, msg);
        if (i === 0 && isNetworkError(msg)) firstNetworkError = msg;
      }
    }
  };
  const w1 = worker();
  await new Promise((r) => setTimeout(r, 250));
  const w2 = worker();
  await Promise.all([w1, w2]);

  // 首路即网络层失败 → 网关整体不可达，本轮视为整体故障
  if (firstNetworkError && byUrl.size === 0) {
    return { sources: [], failures, errors };
  }
  return { sources: [...byUrl.values()], failures, errors };
}

async function deepSearch(
  claim: string,
  queries: string[],
  mode: SearchMode,
  headRound: RoundOutcome,
): Promise<RawSource[]> {
  const quick = mode === "quick";
  const byUrl = new Map<string, RawSource>();
  let headFailed = false;
  if (headRound.error) {
    headFailed = true;
    console.error(`[verify] 并行首轮检索失败:`, headRound.error);
  } else {
    collectItems(byUrl, headRound.items);
  }

  // claim 原文已在分析阶段并行检索，本轮只跑 LLM 生成的检索式
  const qs = [...new Set(queries)].filter((q) => q !== claim.slice(0, 80)).slice(0, quick ? 2 : 4);
  const { sources: roundSources, failures, errors } = await searchRound(qs);
  for (const src of roundSources) if (!byUrl.has(src.url)) byUrl.set(src.url, src);
  let merged = [...byUrl.values()];

  // 一条来源都没有：首轮或本轮调用失败所致 → 搜索服务故障（抛出，任务进入 error 态）
  if (merged.length === 0) {
    if (failures > 0 || headFailed) {
      const detail = errors[0] ?? headRound.error ?? "";
      throw new Error(`搜索服务暂时不可用（多路检索均失败：${detail.slice(0, 140)}），请稍后重新提交`);
    }
    if (!quick) {
      console.warn("[verify] 首轮检索 0 结果，2.5s 后补一轮");
      await new Promise((r) => setTimeout(r, 2500));
      const retry = await searchRound(qs);
      merged = retry.sources;
    }
  }

  // 加权排序：权威度为主，有日期、摘要信息量大者加分
  const weight = (s: RawSource) => {
    const rank = { high: 100, medium: 60, low: 30 }[s.reliability];
    return rank + (s.date ? 18 : 0) + Math.min(20, s.snippet.length / 40);
  };
  merged = merged.sort((a, b) => weight(b) - weight(a)).slice(0, quick ? 6 : 10);
  const sources = merged;

  return sources;
}

/** 深度抓取正文（原地填充 content）：与逐源评估并行执行，不阻塞彼此 */
async function enrichSources(sources: RawSource[]): Promise<void> {
  const deepTargets = sources.filter((s) => s.reliability !== "low").slice(0, 3);
  const contents = await Promise.all(deepTargets.map((s) => fetchPage(s.url)));
  deepTargets.forEach((s, i) => {
    const text = (contents[i] ?? "").replace(/\s+/g, " ").trim();
    if (text) s.content = text.slice(0, 2500);
  });
}

// ---------- 步骤三：交叉验证与置信度判定 ----------

interface JudgeLLM {
  verdict?: string;
  confidence?: number;
  summary?: string;
  reasoning?: string[];
  sourceAssessments?: Array<{
    id?: string;
    stance?: string;
    reliability?: string;
    note?: string;
  }>;
}

type Assessment = NonNullable<JudgeLLM["sourceAssessments"]>[number];

function computeStats(sources: SourceItem[]): SourceStats {
  return {
    total: sources.length,
    support: sources.filter((s) => s.stance === "support").length,
    contradict: sources.filter((s) => s.stance === "contradict").length,
    neutral: sources.filter((s) => s.stance === "neutral").length,
    highReliability: sources.filter((s) => s.reliability === "high").length,
  };
}

function computeScore(verdict: Verdict, stats: SourceStats, sources: SourceItem[]): number {
  const base: Record<Verdict, number> = {
    true: 90,
    mostly_true: 74,
    mixed: 50,
    mostly_false: 26,
    false: 8,
    unverifiable: 40,
  };
  let score = base[verdict];
  if (stats.total >= 8) score += 3;
  else if (stats.total <= 3) score -= 6;
  score += Math.min(5, stats.highReliability * 1.2);
  if (verdict !== "mixed" && stats.support > 0 && stats.contradict > 0) {
    score -= Math.min(10, Math.min(stats.support, stats.contradict) * 4);
  }
  // 可靠度加权支持比：高权威支持/反对权重 3，中 2，低 1
  const w = (s: SourceItem) => ({ high: 3, medium: 2, low: 1 })[s.reliability];
  const wSupport = sources.filter((s) => s.stance === "support").reduce((a, s) => a + w(s), 0);
  const wContra = sources.filter((s) => s.stance === "contradict").reduce((a, s) => a + w(s), 0);
  const wTotal = wSupport + wContra;
  if (wTotal > 0 && verdict !== "unverifiable" && verdict !== "mixed") {
    const ratio = verdict === "true" || verdict === "mostly_true" ? wSupport / wTotal : wContra / wTotal;
    score += Math.round((ratio - 0.5) * 10); // 加权立场一致性 ±5
  }
  if (verdict === "unverifiable") score = Math.min(score, 50);
  return clampScore(score);
}

function buildEvidence(sources: RawSource[], withContent: boolean): string {
  return sources
    .map((s) => {
      const body = withContent && s.content ? `\n  正文摘录: ${s.content.slice(0, 800)}` : "";
      return `[${s.id}] ${s.title}\n  来源: ${s.siteName} (${hostOf(s.url)})${s.date ? ` 日期: ${s.date}` : ""} 权威等级: ${s.authority ?? "未知"}\n  摘要: ${s.snippet.slice(0, 350)}${body}`;
    })
    .join("\n\n");
}

/** 逐源立场评估：仅依据标题/摘要（输入短、生成快），失败返回 null（降级为 neutral） */
async function assessSources(claim: string, sources: RawSource[], mode: SearchMode, llm: LlmConfig | null = null): Promise<Assessment[] | null> {
  if (sources.length === 0) return null;
  const sys = "你是资深事实核查编辑，基于给定证据做客观评估。只输出 JSON，不要输出任何其他文字。";
  const usr = `【待核查信息】\n${claim}\n\n【检索到的证据】\n${buildEvidence(sources, false)}\n\n请逐条评估每个证据与该信息的关系，输出 JSON：\n{\n  "assessments": [{"id": "证据编号", "stance": "support|contradict|neutral", "reliability": "high|medium|low", "note": "一句话评价，不超过 20 字"}]\n}\n\n口径：support=支持该信息；contradict=反驳/证伪；neutral=仅相关背景。reliability 按来源权威性评定（政府/学术/主流媒体多为 high，自媒体多为 low）。`;
  const res = await chatJson<{ assessments?: Assessment[]; sourceAssessments?: Assessment[] }>(sys, usr, {
    maxTokens: mode === "quick" ? 4500 : 6000,
    retries: 1,
    llm,
  });
  return res ? (res.assessments ?? res.sourceAssessments ?? []) : null;
}

/** 综合判定：依据完整证据（含正文摘录）输出判定/置信度/结论/要点 */
async function verdictOnEvidence(
  claim: string,
  coreClaims: string[],
  sources: RawSource[],
  mode: SearchMode,
  llm: LlmConfig | null = null,
): Promise<JudgeLLM | null> {
  const quick = mode === "quick";
  const sys = "你是资深事实核查编辑，基于给定证据做客观判定。只输出 JSON，不要输出任何其他文字。";
  const claimsText = coreClaims.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const usr = `今天是${todayText()}，判定时请注意信息的时效性。\n【待核查信息】\n${claim}\n\n【核心主张】\n${claimsText}\n\n【检索到的证据】\n${buildEvidence(sources, true) || "（未检索到有效证据）"}\n\n请完成交叉验证并输出 JSON：\n{\n  "verdict": "true | mostly_true | mixed | mostly_false | false | unverifiable",\n  "confidence": 0-100 的整数,\n  "summary": "2-3 句中文综合结论，直接回答该信息是否可靠",\n  "reasoning": ["3 条中文分析要点，每条不超过 60 字且必须注明依据的来源标题"]\n}\n\n判定口径：\n- true=证据充分且一致支持；mostly_true=主干属实但细节有出入；mixed=部分属实或证据严重分歧；mostly_false=主干基本不成立；false=明确失实/谣言；unverifiable=证据不足无法判断。\n- 高权威来源（政府/学术/主流媒体）权重大于普通来源；自媒体孤证不足为据。\n- confidence 校准：≥2 个高权威来源一致方可 ≥85；仅有普通来源一致时 ≤75；证据分歧明显时 ≤60；证据不足时 ≤40。`;
  return chatJson<JudgeLLM>(sys, usr, { maxTokens: quick ? 6000 : 8000, llm });
}

/** 合并判定与逐源评估，计算统计与可靠度评分 */
function mergeJudgment(
  claim: string,
  coreClaims: string[],
  sources: RawSource[],
  parsed: JudgeLLM | null,
  assessments: Assessment[] | null,
): Omit<VerificationResult, "id" | "createdAt" | "queries"> {
  // 有证据但判定服务多次未返回有效结果 → 明确报错，不伪装成"无法判定"
  if (!parsed && sources.length > 0) {
    throw new Error("判定服务暂时不可用（分析结果多次生成失败），请稍后重新提交");
  }

  // 网页正文仅服务于本次 LLM 判定，避免返回给客户端或写入 JSON 历史记录。
  const merged: SourceItem[] = sources.map(({ content: _content, ...source }) => source);
  let verdict: Verdict = "unverifiable";
  let confidence = 40;
  let summary = "证据不足，无法对该信息做出可靠判定。建议提供更多背景或稍后重试。";
  let reasoning: string[] = ["未能形成有效分析，请重试。"];

  const byId = new Map<string, Assessment>();
  for (const a of assessments ?? []) {
    const id = String(a.id ?? "");
    if (id) byId.set(id, a);
  }
  for (const src of merged) {
    const a = byId.get(src.id) ?? byId.get(src.id.replace(/^s/i, ""));
    if (!a) continue;
    if (a.stance === "support" || a.stance === "contradict" || a.stance === "neutral") src.stance = a.stance;
    if (a.reliability === "high" || a.reliability === "medium" || a.reliability === "low") src.reliability = a.reliability;
    if (a.note) src.note = String(a.note).slice(0, 120);
  }

  if (parsed) {
    const v = String(parsed.verdict ?? "").toLowerCase();
    if (["true", "mostly_true", "mixed", "mostly_false", "false", "unverifiable"].includes(v)) verdict = v as Verdict;
    confidence = Math.max(5, Math.min(98, Math.round(Number(parsed.confidence) || 50)));
    if (parsed.summary) summary = String(parsed.summary);
    const rs = (parsed.reasoning ?? []).map((r) => String(r).trim()).filter(Boolean).slice(0, 5);
    if (rs.length) reasoning = rs;
  }

  // 无任何证据时强制无法判定
  if (merged.length === 0) {
    verdict = "unverifiable";
    confidence = Math.min(confidence, 30);
    summary = "本次未能从互联网检索到与该信息相关的有效证据（可能受检索服务波动影响），无法判断其真实性，建议稍后重新核查。";
    reasoning = ["多路检索均未返回可用来源：可能是检索服务短时波动，也可能该说法过于冷门、时效性太强或表述不清。建议稍后重试或换个表述。"];
  }

  const stats = computeStats(merged);
  const credibilityScore = computeScore(verdict, stats, merged);

  return {
    claim,
    verdict,
    confidence,
    credibilityScore,
    summary,
    reasoning,
    sources: merged,
    coreClaims,
    stats,
  };
}

// ---------- 任务执行 ----------

async function runJob(job: JobState, mode: SearchMode) {
  try {
    job.stage = "analyzing";
    // 提速：LLM 拆解与原文首轮检索并行启动，分析完成时首路证据通常已就位
    // 快速模式跳过 LLM 拆解，直接使用模板检索式（仅一次判定调用，显著更快）
    const quick = mode === "quick";
    const analysisP = quick ? Promise.resolve(templateQueries(job.claim)) : analyzeClaim(job.claim, job.llm ?? null);
    const headP: Promise<RoundOutcome> = webSearch(job.claim.slice(0, 80), 2)
      .then((items) => ({ items }))
      .catch((e) => ({ items: [], error: (e as Error).message }));
    const analysis = await analysisP;
    job.analysis = analysis;

    job.stage = "searching";
    const headRound = await headP;
    const sources = await deepSearch(job.claim, analysis.queries, mode, headRound);
    job.sources = sources;

    job.stage = "judging";
    // 提速：逐源评估（短输入）与正文抓取并行；综合判定待正文就绪后进行
    const assessP: Promise<Assessment[] | null> = assessSources(job.claim, sources, mode, job.llm ?? null).catch(() => null);
    if (mode !== "quick") await enrichSources(sources);
    const parsed = await verdictOnEvidence(job.claim, analysis.coreClaims, sources, mode, job.llm ?? null);
    const assessments = await assessP;
    const judged = mergeJudgment(job.claim, analysis.coreClaims, sources, parsed, assessments);

    const result: VerificationResult = {
      ...judged,
      queries: analysis.queries,
      mode,
      id: 0,
      createdAt: new Date(),
    };

    // 持久化（失败不影响本次结果）
    try {
      const db = getDb();
      const payload = {
        reasoning: result.reasoning,
        sources: result.sources,
        queries: result.queries,
        coreClaims: result.coreClaims,
        stats: result.stats,
        mode: result.mode ?? "deep",
      };
      const inserted = await db.insert(verifications).values({
        claim: result.claim,
        verdict: result.verdict,
        confidence: result.confidence,
        credibilityScore: result.credibilityScore,
        summary: result.summary,
        payload,
        userId: job.userId ?? null,
        guestId: job.guestId ?? null,
        ipHash: job.ipHash ?? null,
      });
      result.id = Number((inserted as unknown as Array<{ insertId: number | string }>)[0]?.insertId ?? 0);
    } catch (e) {
      console.error("[verify] 历史记录写入失败（不影响本次结果）:", (e as Error).message);
    }

    job.result = result;
    job.stage = "done";
  } catch (e) {
    console.error("[verify] 任务失败:", (e as Error).message);
    let msg = (e as Error).message || "核查过程中出现错误";
    if (job.llm) {
      msg = `你自带的 API Key 调用失败（${msg}）。请到「API 密钥设置」检查或清除该 Key，清除后将使用平台每日免费额度。`;
    }
    job.error = msg;
    job.stage = "error";
  }
}

// ---------- 路由 ----------

export const verifyRouter = createRouter({
  /** 提交核查任务，立即返回任务号 */
  start: publicQuery
    .input(
      z.object({
        claim: z.string().trim().min(4).max(2000),
        mode: z.enum(["deep", "quick"]).optional().default("deep"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      sweepJobs();
      const user = await getSessionUser(ctx);
      const userId = user?.id ?? null;
      let guestId: string | null = null;
      let guestToken: string | undefined;
      let ipHash: string | null = null;
      if (!user) {
        const g = getOrCreateGuestToken(ctx);
        guestId = g.id;
        guestToken = g.token;
        ipHash = clientIpHash(ctx);
      }

      // 双击、网络重试或并发标签页不应创建相同的昂贵核查任务。
      const runningJob = [...jobs.values()].find(
        (job) => isActiveJob(job) && job.claim === input.claim && isSameOwner(job, userId, guestId),
      );
      if (runningJob) return { jobId: runningJob.id, guestToken };

      // 注册用户：自带 Key 走自己的额度且不限次；否则受每日免费额度约束（管理员不限）
      let jobLlm: LlmConfig | null = null;
      if (user) {
        jobLlm = await userLlmConfig(user.id);
        if (!jobLlm && user.role !== "admin") {
          const used = await dailyUsed(user.id);
          if (used >= USER_DAILY_LIMIT) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `今日免费 ${USER_DAILY_LIMIT} 次已用完，明日（UTC+8 零点）自动重置；也可在「API 密钥设置」中填写自己的 Key 后不限次使用`,
            });
          }
        }
      }

      if (!user) {
        // 上方 getOrCreateGuestId 已保证游客标识非空（闭包捕获使 TS 无法窄化，这里显式取值）
        const gid: string = guestId!;
        // 配额 = 游客身份 ∪ 访问 IP 的已用次数（清除浏览器数据/换无痕不会重置）
        const used = await guestUsage(gid, ipHash);
        if (used >= GUEST_LIMIT) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `未注册游客最多可免费核查 ${GUEST_LIMIT} 次（按设备与网络环境计）。注册账号后每日可免费核查 ${USER_DAILY_LIMIT} 次并保存历史记录`,
          });
        }
      }
      const job: JobState = {
        id: randomUUID(),
        stage: "analyzing",
        claim: input.claim,
        userId,
        guestId,
        createdAt: Date.now(),
        llm: jobLlm,
        ipHash,
      };
      jobs.set(job.id, job);
      void runJob(job, input.mode);
      return { jobId: job.id, guestToken };
    }),

  /** 查询当前访客/用户的配额使用情况 */
  quota: publicQuery
    .query(async ({ ctx }) => {
      const user = await getSessionUser(ctx);
      if (user) {
        const ownKey = (await userLlmConfig(user.id)) !== null;
        if (user.role === "admin" || ownKey) {
          return { limited: false, used: 0, limit: USER_DAILY_LIMIT, guestToken: null, hasLlmKey: ownKey };
        }
        const used = await dailyUsed(user.id);
        return { limited: true, used, limit: USER_DAILY_LIMIT, guestToken: null, hasLlmKey: false };
      }
      const guest = getOrCreateGuestToken(ctx);
      const used = await guestUsage(guest.id, clientIpHash(ctx));
      return { limited: true, used, limit: GUEST_LIMIT, guestToken: guest.token, hasLlmKey: false };
    }),

  /** 轮询任务状态 */
  status: publicQuery
    .input(z.object({ jobId: z.string().min(1).max(40) }))
    .query(async ({ input, ctx }): Promise<JobProgress> => {
      const job = jobs.get(input.jobId);
      if (!job) {
        return {
          id: input.jobId,
          stage: "error",
          claim: "",
          error: "任务不存在或已过期，请重新提交",
          createdAt: 0,
        };
      }
      const user = await getSessionUser(ctx);
      const guestId = guestTokenFrom(ctx);
      const allowed =
        (user !== null && (job.userId === user.id || (job.guestId !== null && job.guestId === guestId))) ||
        (user === null && job.guestId !== null && job.guestId === guestId);
      if (!allowed) {
        return {
          id: input.jobId,
          stage: "error",
          claim: "",
          error: "任务不存在、已过期或无权访问",
          createdAt: 0,
        };
      }
      return toJobProgress(job);
    }),

  history: publicQuery
    .input(z.object({ userId: z.number().int().positive().optional() }).optional())
    .query(async ({ input, ctx }): Promise<HistoryItem[]> => {
      const user = await getSessionUser(ctx);
      if (!user) return []; // 未登录：前端展示登录引导
      // 普通用户仅见自己的记录；管理员可见全部或指定用户的记录
      const filter =
        user.role === "admin"
          ? input?.userId
            ? eq(verifications.userId, input.userId)
            : undefined
          : eq(verifications.userId, user.id);
      try {
        const db = getDb();
        const rows = await db
          .select({
            id: verifications.id,
            claim: verifications.claim,
            verdict: verifications.verdict,
            confidence: verifications.confidence,
            credibilityScore: verifications.credibilityScore,
            summary: verifications.summary,
            createdAt: verifications.createdAt,
          })
          .from(verifications)
          .where(filter)
          .orderBy(desc(verifications.createdAt))
          .limit(50);
        return rows.map((r) => ({ ...r, verdict: r.verdict as Verdict }));
      } catch (e) {
        console.error("[verify] 历史记录读取失败:", (e as Error).message);
        return [];
      }
    }),

  byId: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }): Promise<VerificationResult | null> => {
      try {
        const db = getDb();
        const rows = await db.select().from(verifications).where(eq(verifications.id, input.id)).limit(1);
        const row = rows[0];
        if (!row) return null;
        const user = await getSessionUser(ctx);
        const guestId = guestTokenFrom(ctx);
        const allowed =
          (user && (user.role === "admin" || row.userId === user.id)) ||
          (!user && row.guestId !== null && row.guestId === guestId);
        if (!allowed) return null;
        const p = row.payload as {
          reasoning: string[];
          sources: SourceItem[];
          queries: string[];
          coreClaims: string[];
          stats: SourceStats;
          mode?: SearchMode;
        };
        return {
          id: row.id,
          claim: row.claim,
          verdict: row.verdict as Verdict,
          confidence: row.confidence,
          credibilityScore: row.credibilityScore,
          summary: row.summary,
          reasoning: p.reasoning ?? [],
          sources: p.sources ?? [],
          queries: p.queries ?? [],
          coreClaims: p.coreClaims ?? [],
          stats: p.stats ?? { total: 0, support: 0, contradict: 0, neutral: 0, highReliability: 0 },
          mode: p.mode ?? "deep",
          createdAt: row.createdAt,
        };
      } catch (e) {
        console.error("[verify] 记录读取失败:", (e as Error).message);
        return null;
      }
    }),

  remove: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user = await getSessionUser(ctx);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      try {
        const db = getDb();
        const rows = await db
          .select({ userId: verifications.userId })
          .from(verifications)
          .where(eq(verifications.id, input.id))
          .limit(1);
        if (!rows[0]) return { ok: false };
        if (user.role !== "admin" && rows[0].userId !== user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己的核查记录" });
        }
        await db.delete(verifications).where(eq(verifications.id, input.id));
        return { ok: true };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        return { ok: false };
      }
    }),
});
